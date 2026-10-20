const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require(path.join(process.env.CORE_API_DIR, 'node_modules', '@prisma', 'client'));

const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const userId = fs.readFileSync(process.env.TEST_USER_ID_FILE, 'utf8').trim();
const workId = 'beta24-native-upgrade-work';
const intentId = 'beta24-native-upgrade-intent';

async function main() {
  if (process.argv[2] === 'seed') {
    await db.contentItem.create({ data: { id: workId, ownerUserId: userId, title: 'Synthetic upgrade work', type: 'song', status: 'published' } });
    await db.paymentIntent.create({ data: { id: intentId, contentId: workId, amountSats: 1000n, status: 'paid', purpose: 'CONTENT_PURCHASE', subjectType: 'CONTENT', subjectId: workId, receiptId: 'beta24-native-upgrade-receipt', paidAt: new Date('2024-01-02T00:00:00Z') } });
    await db.entitlement.create({ data: { id: 'beta24-native-upgrade-entitlement', buyerUserId: userId, contentId: workId, manifestSha256: 'a'.repeat(64), paymentIntentId: intentId } });
    await db.sale.create({ data: { id: 'beta24-native-upgrade-sale', intentId, contentId: workId, sellerUserId: userId, amountSats: 1000n, rail: 'synthetic', recognizedAt: new Date('2024-01-02T00:00:00Z') } });
  }
  const [user, work, intent, entitlement, sale] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.contentItem.findUnique({ where: { id: workId } }),
    db.paymentIntent.findUnique({ where: { id: intentId } }),
    db.entitlement.findUnique({ where: { id: 'beta24-native-upgrade-entitlement' } }),
    db.sale.findUnique({ where: { id: 'beta24-native-upgrade-sale' } })
  ]);
  if (user?.email !== 'beta24-native-upgrade@example.test' || work?.ownerUserId !== userId || intent?.status !== 'paid' || intent?.amountSats !== 1000n || intent?.receiptId !== 'beta24-native-upgrade-receipt' || entitlement?.paymentIntentId !== intentId || sale?.intentId !== intentId || sale?.amountSats !== 1000n) {
    throw new Error('Protected synthetic records differ');
  }
  console.log('creator/work/purchase/receipt/entitlement/sale=PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
