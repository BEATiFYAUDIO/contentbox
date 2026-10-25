import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { bindPurchaseBuyer, readPurchaseBuyerBinding, recoverPurchaseFulfillment, trackSettledPurchase } from "./purchaseFulfillment.js";
import { finalizePurchase, SETTLEMENT_ALLOCATION_INVALID } from "./finalizePurchase.js";

test("isolated SQLite purchase fulfillment and legacy compatibility", async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"certifyd-fulfillment-"));
  const api=fileURLToPath(new URL("../..",import.meta.url));
  const url=`file:${path.join(dir,"fixture.db")}`;
  fs.closeSync(fs.openSync(path.join(dir,"fixture.db"),"w"));
  const tier=process.env.PRODUCT_TIER;
  execFileSync(process.execPath,[path.join(api,"node_modules/prisma/build/index.js"),"db","push","--schema",path.join(api,"prisma/schema.prisma"),"--skip-generate"],{env:{...process.env,DATABASE_URL:url},stdio:"pipe"});
  let db=new PrismaClient({datasources:{db:{url}}});
  const seller=await db.user.create({data:{email:"seller@fixture.invalid"}});
  const user=await db.user.create({data:{email:"user@fixture.invalid"}});
  const buyer=await db.buyer.create({data:{email:"buyer@fixture.invalid"}});
  let seq=0;
  async function split(contentId:string){return db.splitVersion.create({data:{contentId,versionNumber:1,status:"locked",createdByUserId:seller.id,participants:{create:[{role:"writer",percent:"60",bps:6000},{role:"producer",percent:"40",bps:4000}]}}});}
  async function fixture(o:{locked?:boolean;user?:boolean;tracked?:boolean;buyerId?:string;disabled?:boolean}={}){
    const content=await db.contentItem.create({data:{title:`fixture-${++seq}`,type:"song",ownerUserId:seller.id,status:"published",storefrontStatus:o.disabled?"DISABLED":"LISTED",priceSats:101n}});
    if(o.locked!==false)await split(content.id);
    const intent=await db.paymentIntent.create({data:{contentId:content.id,subjectId:content.id,subjectType:"CONTENT",purpose:"CONTENT_PURCHASE",manifestSha256:`manifest-${seq}`,amountSats:101n,status:"paid",paidVia:"lightning",paidAt:new Date(),buyerUserId:o.user?user.id:null,receiptId:`rcpt_fixture_${seq}`,receiptToken:seq.toString(16).padStart(48,"a"),receiptTokenExpiresAt:new Date(Date.now()+60000)}});
    if(o.tracked!==false)await db.$transaction(tx=>trackSettledPurchase(tx,{intentId:intent.id,buyerId:o.buyerId||null,rail:"node_invoice"}));
    return {content,intent};
  }
  try{
    process.env.PRODUCT_TIER="advanced";
    await t.test("User purchase, deterministic allocation, idempotency and no regrant after revocation",async()=>{
      const {intent}=await fixture({user:true});
      for(let i=0;i<3;i++)assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"complete");
      assert.equal(await db.sale.count({where:{intentId:intent.id}}),1);
      const s=await db.settlement.findUniqueOrThrow({where:{paymentIntentId:intent.id},include:{lines:true}});
      assert.deepEqual(s.lines.map(l=>Number(l.amountSats)).sort((a,b)=>a-b),[40,61]);
      const e=await db.entitlement.findFirstOrThrow({where:{paymentIntentId:intent.id}});assert.equal(e.buyerUserId,user.id);
      await db.entitlement.delete({where:{id:e.id}});
      await recoverPurchaseFulfillment(db,intent.id);assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),0);
    });
    await t.test("missing split fails visibly; fixture correction recovers across restart and buyer sessions",async()=>{
      const {content,intent}=await fixture({locked:false,buyerId:buyer.id});
      assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"pending");
      assert.equal(await db.auditEvent.count({where:{entityId:intent.id,action:"purchase.fulfillment_failed"}}),1);
      assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),0);
      await split(content.id);await db.$disconnect();db=new PrismaClient({datasources:{db:{url}}});
      assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"complete");
      const session=await db.buyerSession.create({data:{buyerId:buyer.id,expiresAt:new Date(Date.now()+60000)}});
      assert.ok(await db.entitlement.findFirst({where:{buyerId:session.buyerId,contentId:content.id}}));
    });
    await t.test("concurrent fulfillment creates exactly one set of records",async()=>{
      const {intent}=await fixture();await Promise.allSettled(Array.from({length:3},()=>recoverPurchaseFulfillment(db,intent.id)));
      assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"complete");
      assert.equal(await db.sale.count({where:{intentId:intent.id}}),1);
      assert.equal(await db.settlement.count({where:{paymentIntentId:intent.id}}),1);
      assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),1);
    });
    await t.test("late transaction failure rolls back accounting and ownership",async()=>{
      const {intent}=await fixture({user:true});
      const failing=new Proxy(db,{get(target,key){if(key==="$transaction")return(fn:any)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==="sale")return{upsert:async()=>{throw Error("fixture failure")}};return Reflect.get(t,k)}})));return Reflect.get(target,key)}});
      assert.equal((await recoverPurchaseFulfillment(failing,intent.id)).status,"pending");
      assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),0);assert.equal(await db.settlement.count({where:{paymentIntentId:intent.id}}),0);
      assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"complete");
    });
    await t.test("historical expired receipt, entitlement and discrepant ledger records remain unchanged",async()=>{
      const {intent,content}=await fixture({tracked:false,disabled:true});
      await db.paymentIntent.update({where:{id:intent.id},data:{receiptTokenExpiresAt:new Date(0)}});
      await db.entitlement.create({data:{buyerId:buyer.id,contentId:content.id,manifestSha256:intent.manifestSha256!,paymentIntentId:intent.id}});
      const sv=await db.splitVersion.findFirstOrThrow({where:{contentId:content.id}});
      await db.settlement.create({data:{paymentIntentId:intent.id,contentId:content.id,splitVersionId:sv.id,netAmountSats:101n,lines:{create:{amountSats:51n}}}});
      const read=()=>db.paymentIntent.findUnique({where:{id:intent.id},include:{entitlements:true,settlement:{include:{lines:true}}}});
      const before=await read();assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"legacy_untracked");assert.deepEqual(await read(),before);
    });
    await t.test("disabled storefront does not change valid settled purchase fulfillment",async()=>{
      const {intent}=await fixture({disabled:true,user:true});assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"complete");
    });
    await t.test("pending payment cannot grant ownership",async()=>{
      const {intent}=await fixture({tracked:false});await db.paymentIntent.update({where:{id:intent.id},data:{status:"pending"}});
      await assert.rejects(db.$transaction(tx=>trackSettledPurchase(tx,{intentId:intent.id,buyerId:buyer.id,rail:"node_invoice"})),/SETTLED_PURCHASE_REQUIRED/);
      assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"legacy_untracked");assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),0);
    });
    await t.test("approved derivative keeps its exact parent snapshot and upstream allocation",async()=>{
      const parent=await fixture({tracked:false});
      const parentSplit=await db.splitVersion.findFirstOrThrow({where:{contentId:parent.content.id}});
      const child=await fixture({user:true});
      const link=await db.contentLink.create({data:{childContentId:child.content.id,parentContentId:parent.content.id,parentSplitVersionId:parentSplit.id,relation:"derivative",upstreamBps:1000,requiresApproval:true,approvedAt:new Date()}});
      const before=await db.contentLink.findUnique({where:{id:link.id}});
      assert.equal((await recoverPurchaseFulfillment(db,child.intent.id)).status,"complete");
      const settlement=await db.settlement.findUniqueOrThrow({where:{paymentIntentId:child.intent.id},include:{lines:true}});
      assert.equal(settlement.lines.filter(l=>l.role==="upstream").reduce((s,l)=>s+l.amountSats,0n),10n);
      assert.equal(settlement.lines.reduce((s,l)=>s+l.amountSats,0n),101n);
      assert.deepEqual(await db.contentLink.findUnique({where:{id:link.id}}),before);
    });
    await t.test("new buyer binding survives session deletion without pre-payment access",async()=>{
      const {intent}=await fixture({tracked:false});
      await db.paymentIntent.update({where:{id:intent.id},data:{status:"pending"}});
      const session=await db.buyerSession.create({data:{buyerId:buyer.id,expiresAt:new Date(Date.now()+60000)}});
      await bindPurchaseBuyer(db,intent.id,session.buyerId);
      assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),0);
      await db.buyerSession.delete({where:{id:session.id}});
      assert.equal(await readPurchaseBuyerBinding(db,intent.id),buyer.id);
      await db.$transaction(async tx=>{
        await tx.paymentIntent.update({where:{id:intent.id},data:{status:"paid"}});
        await trackSettledPurchase(tx,{intentId:intent.id,buyerId:buyer.id,rail:"node_invoice"});
      });
      assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"complete");
      assert.equal((await db.entitlement.findFirstOrThrow({where:{paymentIntentId:intent.id}})).buyerId,buyer.id);
    });
    await t.test("malformed empty locked split keeps a settled 100-sat payment paid and pending",async()=>{
      const {content,intent}=await fixture({buyerId:buyer.id});
      const sv=await db.splitVersion.findFirstOrThrow({where:{contentId:content.id}});
      await db.splitParticipant.deleteMany({where:{splitVersionId:sv.id}});
      await db.paymentIntent.update({where:{id:intent.id},data:{amountSats:100n}});
      const paymentBefore=await db.paymentIntent.findUnique({where:{id:intent.id}});
      await Promise.allSettled(Array.from({length:3},()=>recoverPurchaseFulfillment(db,intent.id)));
      assert.deepEqual(await recoverPurchaseFulfillment(db,intent.id),{status:"pending",code:SETTLEMENT_ALLOCATION_INVALID});
      assert.deepEqual(await db.paymentIntent.findUnique({where:{id:intent.id}}),paymentBefore);
      for(const model of [db.sale,db.settlement,db.entitlement] as any[]) {
        assert.equal(await model.count({where:model===db.sale?{intentId:intent.id}:{paymentIntentId:intent.id}}),0);
      }
      assert.notEqual(((await db.auditEvent.findUniqueOrThrow({where:{id:`purchase-fulfillment:${intent.id}`}})).payloadJson as {status?:string})?.status,"complete");
      // Administrator correction is fixture-only; production never invents recipients.
      await db.splitParticipant.create({data:{splitVersionId:sv.id,role:"creator",percent:"100",bps:10000}});
      await db.$disconnect();db=new PrismaClient({datasources:{db:{url}}});
      assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"complete");
      await Promise.all([recoverPurchaseFulfillment(db,intent.id),recoverPurchaseFulfillment(db,intent.id)]);
      assert.equal(await db.sale.count({where:{intentId:intent.id}}),1);
      const settlement=await db.settlement.findUniqueOrThrow({where:{paymentIntentId:intent.id},include:{lines:true}});
      assert.deepEqual(settlement.lines.map(line=>line.amountSats),[100n]);
      assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),1);
      assert.deepEqual(await db.paymentIntent.findUnique({where:{id:intent.id}}),paymentBefore);
    });
    await t.test("legacy percentage-only creator and multi-party splits retain exact rounding",async()=>{
      for(const percents of [["100"],["60","40"]]){
        const {content,intent}=await fixture();
        const sv=await db.splitVersion.findFirstOrThrow({where:{contentId:content.id}});
        await db.splitParticipant.deleteMany({where:{splitVersionId:sv.id}});
        for(const percent of percents)await db.splitParticipant.create({data:{splitVersionId:sv.id,role:"creator",percent,bps:0}});
        assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"complete");
        const lines=await db.settlementLine.findMany({where:{settlement:{paymentIntentId:intent.id}}});
        assert.deepEqual(lines.map(l=>l.amountSats).sort((a,b)=>Number(a-b)),percents.length===1?[101n]:[40n,61n]);
      }
    });
    await t.test("positive allocation pool with zero weights cannot falsely fulfill",async()=>{
      const {content,intent}=await fixture();
      await db.splitParticipant.updateMany({where:{splitVersion:{contentId:content.id}},data:{bps:0,percent:"0"}});
      assert.deepEqual(await recoverPurchaseFulfillment(db,intent.id),{status:"pending",code:SETTLEMENT_ALLOCATION_INVALID});
      assert.equal(await db.settlement.count({where:{paymentIntentId:intent.id}}),0);
      assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),0);
    });
    await t.test("empty required parent allocation fails without changing derivative approval",async()=>{
      const parent=await fixture();const child=await fixture();
      const sv=await db.splitVersion.findFirstOrThrow({where:{contentId:parent.content.id}});
      await db.splitParticipant.deleteMany({where:{splitVersionId:sv.id}});
      const link=await db.contentLink.create({data:{childContentId:child.content.id,parentContentId:parent.content.id,parentSplitVersionId:sv.id,relation:"derivative",upstreamBps:1000,requiresApproval:true,approvedAt:new Date()}});
      assert.deepEqual(await recoverPurchaseFulfillment(db,child.intent.id),{status:"pending",code:SETTLEMENT_ALLOCATION_INVALID});
      assert.equal(await db.settlement.count({where:{paymentIntentId:child.intent.id}}),0);
      assert.equal(await db.entitlement.count({where:{paymentIntentId:child.intent.id}}),0);
      assert.deepEqual(await db.contentLink.findUnique({where:{id:link.id}}),link);
    });
    await t.test("missing persisted allocation rows roll back settlement and ownership",async()=>{
      const {intent}=await fixture();
      const failing=new Proxy(db,{get(target,key){if(key==="$transaction")return(fn:any)=>target.$transaction(tx=>fn(new Proxy(tx,{get(t,k){if(k==="settlement")return new Proxy(t.settlement,{get(model,method){if(method==="create")return(args:any)=>model.create({data:{...args.data,lines:{create:[]}}});return Reflect.get(model,method)}});return Reflect.get(t,k)}})));return Reflect.get(target,key)}});
      assert.deepEqual(await recoverPurchaseFulfillment(failing,intent.id),{status:"pending",code:SETTLEMENT_ALLOCATION_INVALID});
      assert.equal(await db.settlement.count({where:{paymentIntentId:intent.id}}),0);
      assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),0);
      assert.equal(await db.sale.count({where:{intentId:intent.id}}),0);
      assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"complete");
    });
    await t.test("pending checkpoint with an existing empty settlement is reported, never repaired",async()=>{
      const {content,intent}=await fixture();
      const sv=await db.splitVersion.findFirstOrThrow({where:{contentId:content.id}});
      const settlement=await db.settlement.create({data:{paymentIntentId:intent.id,contentId:content.id,splitVersionId:sv.id,netAmountSats:101n}});
      assert.deepEqual(await recoverPurchaseFulfillment(db,intent.id),{status:"pending",code:SETTLEMENT_ALLOCATION_INVALID});
      assert.deepEqual(await db.settlement.findUnique({where:{id:settlement.id}}),settlement);
      assert.equal(await db.settlementLine.count({where:{settlementId:settlement.id}}),0);
      assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),0);
    });
    await t.test("untracked finalizer rejects new empty allocations before granting access",async()=>{
      const {content,intent}=await fixture({tracked:false,user:true});
      await db.splitParticipant.deleteMany({where:{splitVersion:{contentId:content.id}}});
      await assert.rejects(finalizePurchase(intent.id,db),{message:SETTLEMENT_ALLOCATION_INVALID});
      assert.equal((await db.paymentIntent.findUniqueOrThrow({where:{id:intent.id}})).status,"paid");
      assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),0);
      assert.equal(await db.settlement.count({where:{paymentIntentId:intent.id}}),0);
    });
    await t.test("legacy settlement write failure is explicit and grants no ownership",async()=>{
      const {intent}=await fixture({tracked:false,user:true});
      const failing=new Proxy(db,{get(target,key){if(key==="settlement")return new Proxy(target.settlement,{get(model,method){if(method==="create")return async()=>{throw Error("fixture database failure")};return Reflect.get(model,method)}});return Reflect.get(target,key)}});
      await assert.rejects(finalizePurchase(intent.id,failing),{message:SETTLEMENT_ALLOCATION_INVALID});
      assert.equal((await db.paymentIntent.findUniqueOrThrow({where:{id:intent.id}})).status,"paid");
      assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),0);
      assert.equal(await db.settlement.count({where:{paymentIntentId:intent.id}}),0);
      assert.equal(await db.auditEvent.count({where:{entityId:intent.id,action:"settlement.create.failed"}}),1);
      await finalizePurchase(intent.id,db);
      assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),1);
      assert.equal(await db.settlement.count({where:{paymentIntentId:intent.id}}),1);
    });
    await t.test("legacy finalization reports allocation failure and never reaches the payout bridge",async()=>{
      const {content,intent}=await fixture({tracked:false,user:true});
      await db.splitParticipant.deleteMany({where:{splitVersion:{contentId:content.id}}});
      const source=fs.readFileSync(path.join(api,"src/server.ts"),"utf8");
      const ast=ts.createSourceFile("server.ts",source,ts.ScriptTarget.Latest,true);
      const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="finalizePaymentIntent");assert.ok(node);
      let payoutCalls=0;
      const context:any={prisma:db,finalizePurchase,recoverPurchaseFulfillment,SETTLEMENT_ALLOCATION_INVALID,Date,
        resolveProductTier:()=>({productTier:"advanced"}),
        bridgeDirectSaleToParticipantPayouts:()=>{payoutCalls++;throw Error("Unexpected payout bridge")}};
      vm.createContext(context);
      vm.runInContext(ts.transpileModule(node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
      for(let i=0;i<2;i++)await assert.rejects(context.finalizePaymentIntent(intent.id,{rail:"node_invoice"}),
        (error:any)=>error.code===SETTLEMENT_ALLOCATION_INVALID&&error.statusCode===409&&error.message.includes("Do not pay again"));
      assert.equal(payoutCalls,0);
      assert.equal((await db.paymentIntent.findUniqueOrThrow({where:{id:intent.id}})).status,"paid");
      assert.equal(await db.sale.count({where:{intentId:intent.id}}),1);
      assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),0);
      assert.equal(await db.settlement.count({where:{paymentIntentId:intent.id}}),0);
    });
    await t.test("completed checkpoints do not revalidate historical ledger or regrant revoked access",async()=>{
      const {content,intent}=await fixture({buyerId:buyer.id});
      assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"complete");
      await db.settlementLine.deleteMany({where:{settlement:{paymentIntentId:intent.id}}});
      await db.entitlement.deleteMany({where:{paymentIntentId:intent.id}});
      await db.splitParticipant.deleteMany({where:{splitVersion:{contentId:content.id}}});
      const paymentBefore=await db.paymentIntent.findUnique({where:{id:intent.id}});
      assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"complete");
      assert.deepEqual(await db.paymentIntent.findUnique({where:{id:intent.id}}),paymentBefore);
      assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),0);
      assert.equal(await db.settlementLine.count({where:{settlement:{paymentIntentId:intent.id}}}),0);
    });
    await t.test("Basic preserves its no-sale/no-settlement behavior",async()=>{
      process.env.PRODUCT_TIER="basic";const {intent}=await fixture({locked:false,user:true});
      assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"complete");assert.equal(await db.entitlement.count({where:{paymentIntentId:intent.id}}),1);
      assert.equal(await db.sale.count({where:{intentId:intent.id}}),0);assert.equal(await db.settlement.count({where:{paymentIntentId:intent.id}}),0);
      const anonymous=await fixture({locked:false});
      const empty=await split(anonymous.content.id);await db.splitParticipant.deleteMany({where:{splitVersionId:empty.id}});
      await Promise.allSettled([recoverPurchaseFulfillment(db,anonymous.intent.id),recoverPurchaseFulfillment(db,anonymous.intent.id)]);
      assert.equal((await recoverPurchaseFulfillment(db,anonymous.intent.id)).status,"complete");
      assert.equal(await db.entitlement.count({where:{paymentIntentId:anonymous.intent.id}}),1);
    });
    assert.equal(await db.participantPayout.count(),0);
  }finally{if(tier===undefined)delete process.env.PRODUCT_TIER;else process.env.PRODUCT_TIER=tier;await db.$disconnect();fs.rmSync(dir,{recursive:true,force:true});}
});
