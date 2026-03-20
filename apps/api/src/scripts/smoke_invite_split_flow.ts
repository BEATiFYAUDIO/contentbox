import assert from "node:assert/strict";

const API_BASE = String(process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");

type SignupResponse = {
  token: string;
  user: { id: string; email: string };
};

type ContentResponse = {
  id: string;
  title: string;
  type: string;
};

type InviteRow = {
  id: string;
  token: string;
  status: string;
  contentId: string | null;
  targetValue: string;
};

async function request(path: string, opts?: RequestInit & { token?: string; expectStatus?: number }) {
  const headers = new Headers(opts?.headers || {});
  headers.set("Accept", "application/json");
  if (opts?.token) headers.set("Authorization", `Bearer ${opts.token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (typeof opts?.expectStatus === "number") {
    assert.equal(
      res.status,
      opts.expectStatus,
      `Expected ${opts.expectStatus} for ${path}, got ${res.status}. body=${JSON.stringify(json)}`
    );
  } else {
    assert.ok(res.ok, `Request failed ${path}: ${res.status} body=${JSON.stringify(json)}`);
  }
  return json;
}

async function signup(email: string, displayName: string): Promise<SignupResponse> {
  const payload = {
    email,
    password: "Password123!",
    displayName
  };
  const json = await request("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.ok(json?.token, "signup missing token");
  assert.ok(json?.user?.id, "signup missing user");
  return json as SignupResponse;
}

async function uploadDummyFile(contentId: string, token: string) {
  const form = new FormData();
  const blob = new Blob([`smoke-file-${Date.now()}`], { type: "text/plain" });
  form.append("file", blob, "smoke.txt");
  await request(`/content/${encodeURIComponent(contentId)}/files`, {
    method: "POST",
    body: form,
    token
  });
}

async function main() {
  const runId = Date.now().toString(36);
  const ownerEmail = `smoke-owner-${runId}@local.test`;
  const recipientEmail = `smoke-recipient-${runId}@local.test`;

  console.log("[smoke-invite-split] signup users");
  const owner = await signup(ownerEmail, "Smoke Owner");
  const recipient = await signup(recipientEmail, "Smoke Recipient");

  console.log("[smoke-invite-split] create content");
  const content = (await request("/content", {
    method: "POST",
    token: owner.token,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: `Smoke Split ${runId}`, type: "song" })
  })) as ContentResponse;
  assert.ok(content?.id, "content create missing id");

  console.log("[smoke-invite-split] upload file");
  await uploadDummyFile(content.id, owner.token);

  console.log("[smoke-invite-split] save split with owner + recipient");
  await request(`/content/${encodeURIComponent(content.id)}/splits`, {
    method: "POST",
    token: owner.token,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      participants: [
        { participantEmail: ownerEmail, role: "writer", percent: 50 },
        { participantEmail: recipientEmail, role: "writer", percent: 50 }
      ]
    })
  });

  const sentInvites = (await request("/my/invitations?includeHistory=1", {
    token: owner.token
  })) as InviteRow[];
  const pending = sentInvites.find(
    (row) =>
      String(row.contentId || "") === content.id &&
      String(row.targetValue || "").toLowerCase() === recipientEmail.toLowerCase() &&
      String(row.status || "").toLowerCase() === "pending"
  );
  assert.ok(pending?.token, "pending invite token not found for recipient");

  console.log("[smoke-invite-split] recipient accepts invite");
  await request(`/invites/${encodeURIComponent(pending.token)}/accept`, {
    method: "POST",
    token: recipient.token,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

  const sentAfterAccept = (await request("/my/invitations?includeHistory=1", {
    token: owner.token
  })) as InviteRow[];
  const accepted = sentAfterAccept.find(
    (row) =>
      String(row.contentId || "") === content.id &&
      String(row.targetValue || "").toLowerCase() === recipientEmail.toLowerCase() &&
      String(row.status || "").toLowerCase() === "accepted"
  );
  assert.ok(accepted, "invite did not transition to accepted");

  console.log("[smoke-invite-split] lock split v1");
  await request(`/content/${encodeURIComponent(content.id)}/splits/v1/lock`, {
    method: "POST",
    token: owner.token,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

  console.log("[smoke-invite-split] verify recipient views");
  const received = (await request("/my/invitations/received?includeHistory=1", {
    token: recipient.token
  })) as any[];
  const receivedAccepted = received.find(
    (row) =>
      String(row.contentId || "") === content.id &&
      String(row.status || "").toLowerCase() === "accepted"
  );
  assert.ok(receivedAccepted, "recipient received invites missing accepted row");

  const participations = (await request("/my/split-participations", { token: recipient.token })) as any[];
  const participation = participations.find((row) => String(row.contentId || "") === content.id);
  assert.ok(participation, "recipient split participations missing locked content");

  const royalties = (await request("/my/royalties", { token: recipient.token })) as { works?: any[] };
  const royaltyWork = (royalties.works || []).find((row) => String(row.contentId || "") === content.id);
  assert.ok(royaltyWork, "recipient royalties missing accepted split content");

  console.log("[smoke-invite-split] PASS");
}

main().catch((err) => {
  console.error("[smoke-invite-split] FAIL", err?.message || err);
  process.exit(1);
});

