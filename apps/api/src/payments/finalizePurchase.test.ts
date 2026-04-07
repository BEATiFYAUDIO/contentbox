import test from "node:test";
import assert from "node:assert/strict";

import { resolveDerivativeParentLockedSplitForFinalize } from "./finalizePurchase.js";

test("derivative finalize authority fails when snapshot is missing", async () => {
  const prisma = {
    splitVersion: {
      findUnique: async () => null
    }
  } as any;

  await assert.rejects(
    async () =>
      resolveDerivativeParentLockedSplitForFinalize(prisma, {
        id: "link_1",
        parentContentId: "parent_1",
        parentSplitVersionId: null
      }),
    (err: any) => err?.code === "DERIVATIVE_PARENT_SPLIT_AUTHORITY_MISSING"
  );
});

test("derivative finalize authority resolves exact snapshot id (not content fallback)", async () => {
  const calls: string[] = [];
  const prisma = {
    splitVersion: {
      findUnique: async ({ where }: any) => {
        calls.push(String(where?.id || ""));
        if (where?.id === "split_snapshot") {
          return {
            id: "split_snapshot",
            contentId: "parent_1",
            status: "locked",
            participants: []
          };
        }
        return null;
      }
    }
  } as any;

  const split = await resolveDerivativeParentLockedSplitForFinalize(prisma, {
    id: "link_2",
    parentContentId: "parent_1",
    parentSplitVersionId: "split_snapshot"
  });

  assert.equal(split.id, "split_snapshot");
  assert.deepEqual(calls, ["split_snapshot"]);
});
