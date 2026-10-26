import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as parsers from "./cloudflaredServiceInspection.js";

const source = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "inspectCloudflaredServices");
assert.ok(node);
function inspector(platform: string, run: (cmd: string, args: string[]) => Promise<string>, files: string[] = []) {
  const context = vm.createContext({ ...parsers, process: { platform }, NAMED_CONTROL_COMMAND_TIMEOUT_MS: 100,
    fsSync: { existsSync: () => files.length > 0 }, fs: { readdir: async () => files }, runInspectionCommand: run });
  vm.runInContext(ts.transpileModule(node!.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.inspectCloudflaredServices as () => Promise<parsers.CloudflaredServiceRecord[]>;
}
test("reconciliation: Linux SysV fallback preserves stopped state without blocking on systemctl", async () => {
  const calls: string[] = [];
  const inspect = inspector("linux", async (cmd) => { calls.push(cmd); throw Object.assign(new Error("fixture"), { code: cmd === "systemctl" ? 1 : 3 }); }, ["cloudflared"]);
  const result = await inspect();
  assert.deepEqual(calls, ["systemctl", "/etc/init.d/cloudflared"]);
  assert.equal(result[0]?.state, "stopped");
});
test("reconciliation: unknown SysV inspection does not become a running service", async () => {
  const inspect = inspector("linux", async () => { throw Object.assign(new Error("fixture"), { code: "INSPECTION_TIMEOUT" }); }, ["cloudflared"]);
  assert.equal((await inspect())[0]?.state, "unknown");
});
test("reconciliation: macOS system launch daemon survives empty user inventory", async () => {
  const calls: string[][] = [];
  const inspect = inspector("darwin", async (_cmd, args) => { calls.push(args); return args[0] === "list" ? "PID Status Label\n" : "state = running\npid = 123\nprogram = /usr/bin/cloudflared\n"; }, ["com.cloudflare.cloudflared.plist"]);
  const result = await inspect();
  assert.equal(result.length, 1); assert.equal(result[0]?.state, "running"); assert.equal(result[0]?.pid, 123);
  assert.equal(calls[1]?.[1], "system/com.cloudflare.cloudflared");
});
test("reconciliation: async service inspection yields while an OS query is pending", async () => {
  let release!: (value: string) => void;
  const pending = new Promise<string>(resolve => { release = resolve; });
  const inspect = inspector("linux", async () => pending);
  let done = false; const result = inspect().then(() => { done = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(done, false);
  release("Id=cloudflared.service\nLoadState=loaded\nActiveState=active\nMainPID=123\nExecStart=/usr/bin/cloudflared\n"); await result;
});
