# ContentBox — Local-first sharing, invites, and P2P collaboration

ContentBox is a **local-first content collaboration system** designed to work on a single machine or across trusted peers (for example, on a LAN). It allows creators to define ownership splits, invite collaborators, and record verifiable proofs of participation — without requiring a centralized platform.

This repository contains **development tooling and reference implementations**. It is intended for **local use, experimentation, and architectural exploration**, not as a hardened production service exposed directly to the public internet.

---

## What this README is (and is not)

**This README covers:**

* Running ContentBox locally for development or testing
* Creating and accepting collaboration invites on a trusted network
* The architecture and data model behind invites, proofs, and settlement
* Optional payment and entitlement designs (documented, not required)

**This README does NOT imply:**

* Production readiness
* Internet-facing security hardening
* Custodial responsibility for funds
* A hosted service or platform offering

If you only want to **try ContentBox locally**, you can safely ignore the sections on cryptographic proofs, payments, and settlement.

---

## Contents

* Overview
* Local development setup (Docker)
* Running the owner node (local)
* Running an invitee node (optional)
* Creating invites
* Accepting invites (quick flow)
* Signed P2P acceptance (design + optional flow)
* Proofs and split locking
* Payments (design overview, optional)
* Derivatives and settlement (design overview)
* Environment configuration (examples)
* Troubleshooting
* Next steps

---

## Overview

ContentBox is a **local-first content collaboration system**.

An owner:

* Creates content
* Defines a split (participants + percentages)
* Generates invite links for collaborators

Invite links are **single-use secret tokens**. Only a hash of each token is stored server-side; the raw token is shown once and is not recoverable later.

### Invite acceptance modes

There are two supported acceptance modes:

1. **Quick accept (default)**
   The invitee opens the invite URL in a browser and clicks **Accept**.
   This does not require the invitee to run their own node.

2. **Signed P2P accept (optional, advanced)**
   The invitee runs their own ContentBox node, signs an acceptance payload locally, and submits the signed payload to the owner.
   This produces cryptographic proof of acceptance.

---

## Local development setup (Docker)

Docker is used to start shared infrastructure services for local development.

This setup starts:

* PostgreSQL
* MinIO (object storage)

It does **not** expose a hosted service or run containers intended for public use.

From the repository root:

```bash
cd infra
docker compose up -d
```

Verify services:

```bash
docker compose ps
```

Default local services:

* PostgreSQL: `localhost:5432`
* MinIO: `localhost:9000`

---

## Running the owner node (local)

These steps run the ContentBox API and dashboard from source on a local machine.

Assumptions (example values only):

* API port: `4000`
* Dashboard port: `5173`
* LAN access only

### 1. API setup

Create an environment file at:

```
apps/api/.env
```

(see **Environment configuration** below)

Install dependencies and prepare Prisma (run once):

```bash
cd /path/to/contentbox/apps/api
npm install
npm run prisma:generate
npx prisma migrate dev --name init
```

Start the API:

```bash
npm run dev
```

The API listens on `0.0.0.0:4000`.
Only expose this port on **trusted networks**.

---

### 2. Dashboard setup

Start the dashboard and point it at the owner API:

```bash
cd /path/to/contentbox/apps/dashboard
VITE_API_URL="http://<owner-host>:4000" npm run dev -- --host 0.0.0.0 --port 5173
```

Open in a browser:

```
http://<owner-host>:5173
```

---

## Running an invitee node (optional)

For the **quick accept** flow, the invitee does **not** need to run ContentBox locally.

To test the **signed P2P acceptance** flow, the invitee runs their own local API + dashboard.

Key points:

* The invitee node is still local-first
* The owner must be able to reach the invitee node on a trusted network
* No public internet exposure is assumed or required

---

## Creating invites (owner)

1. Log in to the owner dashboard
2. Create a content item
3. Open the **Splits** page
4. Define participants and percentages (must total 100)
5. Click **Create invites**

Invite URLs are shown **once** at creation time.

Important:

* Copy invite URLs immediately
* Only a hash of each token is stored
* Tokens cannot be recovered later

---

## Accepting invites (quick flow)

Invitees can accept without running their own node:

1. Open the invite URL in a browser
2. Click **Accept**

The owner API records the acceptance.

This is the recommended flow for most collaborators.

---

## Signed P2P acceptance (advanced, optional)

For stronger verification:

* Invitee runs a local ContentBox node
* Invitee signs acceptance locally
* Signed payload is sent to the owner
* Owner verifies the signature using the invitee’s published public key
* Verification metadata is recorded as an audit event

This flow is optional and intended for cases where cryptographic proof of acceptance is required.

---

## Proofs and split locking

When a split version is **locked**, ContentBox generates a canonical `proof.json` and a stable `proofHash`.

Proofs are:

* Deterministic
* Human-readable
* Commit-tracked
* Used as anchors for downstream processes

Example location:

```
<CONTENTBOX_ROOT>/<type>s/<repo>/proofs/v1/proof.json
```

Proofs include:

* content identifier
* split version
* participant shares
* manifest hash
* timestamps

---

## Payments (design overview — optional)

⚠️ **Payments are optional and NOT required to run or test ContentBox.**
This section documents architecture and interfaces only.

Playback and collaboration **do not depend on blockchain or payment systems**.

Payment modules are designed to:

* Issue receipts
* Record entitlements
* Anchor settlement to proofs

Default and recommended setting for development:

```env
PAYMENT_PROVIDER=none
```

No real credentials should ever be committed to this repository.

---

## Derivatives and settlement (design overview)

Derivative works are modeled as new content records linked to parent content.

Key principles:

* Derivatives have their own manifests and splits
* Parents may receive upstream revenue shares
* Settlement math is deterministic and auditable

This section describes the model and data flow, not a production deployment.

---

## Environment configuration (examples)

All examples below are **non-production** and intentionally incomplete.

Owner API example:

```env
DATABASE_URL="postgres://contentbox:contentbox_dev_password@127.0.0.1:5432/contentbox"
JWT_SECRET="dev-secret-change-me"
CONTENTBOX_ROOT="~/.contentbox"
APP_BASE_URL="http://<owner-host>:5173"
PORT=4000
PAYMENT_PROVIDER=none
```

Invitee API example:

```env
DATABASE_URL="postgres://contentbox:contentbox_dev_password@127.0.0.1:5432/contentbox"
JWT_SECRET="dev-secret-invitee"
CONTENTBOX_ROOT="~/.contentbox-invitee"
APP_BASE_URL="http://<invitee-host>:5173"
PORT=4000
PAYMENT_PROVIDER=none
```

Never commit real secrets.

---

## Troubleshooting

* Invite token missing
  Tokens are shown once by design. Pending invites do not reveal tokens.

* Network connectivity issues
  Ensure API and dashboard ports are reachable on the trusted network.

* Payments unavailable
  Expected if `PAYMENT_PROVIDER=none`.

---

## Next steps

Planned improvements include:

* Simplified installers
* Optional containerized API/dashboard
* Improved P2P discovery
* Desktop-first packaging

ContentBox is intentionally built as **software you run**, not a platform you join.

---

### Fast path for collaborators

1. Owner: create invite and copy URL
2. Invitee: open URL and click **Accept**

That’s it.

