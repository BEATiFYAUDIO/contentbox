# Certifyd Network Map V1

## Purpose

The Certifyd Network Map is a provider discovery and provisioning foundation. It is not a Lightning explorer, proof explorer, or node operator dashboard.

The map should help creators answer:

- Which sovereign infrastructure nodes exist?
- Which services does each node provide?
- Is the node reachable, durable, and provision-capable?
- Can the node support commerce without exposing Lightning internals?
- Which public identifiers are required to provision through the node?

## Participant Model

### Sovereign node operators

Operators provide network services:

- Identity
- Content
- Commerce
- Settlement
- Proofs

### Creators

Most creators should not need to run infrastructure. Creators should discover nodes, compare service capability and trust posture, then choose a provider.

## Public Endpoint Design

### `GET /api/network/nodes`

Returns a public-safe registry response:

```json
{
  "schema": "certifyd.network.nodes.v1",
  "generatedAt": "2026-06-11T00:00:00.000Z",
  "items": []
}
```

### `GET /api/network/nodes/:nodeId`

Returns one public-safe registry node:

```json
{
  "schema": "certifyd.network.node.v1",
  "generatedAt": "2026-06-11T00:00:00.000Z",
  "node": {}
}
```

## Network Node DTO

The V1 DTO is designed for long-term map and provisioning use:

```ts
type NetworkNode = {
  nodeId: string;
  displayName: string;
  operator?: string;
  roles: ("creator" | "identity" | "content" | "commerce" | "settlement" | "proof")[];
  location?: {
    country?: string;
    region?: string;
    city?: string;
    displayLocation?: string;
    precision?: "country" | "region" | "city";
    source?: "operator_declared" | "browser_confirmed";
  };
  overallStatus: "ready" | "limited" | "disabled" | "offline" | "unknown";
  services: {
    identity: ServiceStatus;
    content: ServiceStatus;
    commerce: ServiceStatus;
    settlement: ServiceStatus;
    proofs: ServiceStatus;
  };
  readiness: {
    provisioned: SignalStatus;
    durable: SignalStatus;
    reachable: SignalStatus;
  };
  trust: {
    operatorVerified: boolean;
    proofCapable: boolean;
    proofCount?: number;
    trustScore?: number;
  };
  connect: {
    providerNodeId: string;
    providerPublicKey: string;
    providerProfileId: string | null;
    providerCanonicalUrl: string;
    capabilities: {
      identity: boolean;
      content: boolean;
      commerce: boolean;
      settlement: boolean;
      proofs: boolean;
    };
  };
  technical: {
    version?: string;
    network?: string;
  };
  history?: {
    nodeAgeDays?: number | null;
    reliability30d?: number | null;
    reliability90d?: number | null;
    successfulPayments30d?: number | null;
  };
};
```

## Public Location Metadata

Location is optional and operator-controlled. It is stored in the existing public networking config file:

```text
${CONTENTBOX_ROOT}/state/public-origin-config.json
```

The dashboard edits it from Profile → Public Profile (Presentation) → Public Location. The same `/api/public/config` save path persists the `publicLocation` object without duplicating storage.

Example saved value:

```json
{
  "publicLocation": {
    "country": "Canada",
    "region": "Ontario",
    "city": "Innisfil",
    "displayLocation": "Innisfil, Ontario",
    "precision": "city",
    "source": "operator_declared"
  }
}
```

When configured, `GET /api/network/nodes` and `GET /api/network/nodes/:nodeId` include it as `node.location`. If unset, `location` is omitted.

Example public output:

```json
{
  "nodeId": "node:...",
  "displayName": "Innisfil Sovereign Node",
  "location": {
    "country": "Canada",
    "region": "Ontario",
    "city": "Innisfil",
    "displayLocation": "Innisfil, Ontario",
    "precision": "city",
    "source": "operator_declared"
  }
}
```

The browser helper requests geolocation permission only to support operator review. ContentBox does not store exact browser coordinates, does not publish coordinates, does not infer from IP, and does not auto-publish location fields.

## Status Model

Public node status is service capability, not raw connectivity.

- `ready`: public service appears usable.
- `limited`: service exists but has degraded or incomplete readiness.
- `disabled`: service is not advertised.
- `offline`: service is not reachable.
- `unknown`: state cannot be established safely.

## Commerce Readiness

Commerce readiness is deliberately separate from uptime. A node can be reachable but still limited for commerce.

Private inputs may include:

- Active channels
- Outbound liquidity
- Inbound liquidity
- Recent payment success
- Route diversity
- Receive readiness
- Peer quality
- Payout success
- Settlement history

Public output should remain coarse:

- Commerce service status
- Settlement service status
- Provider provision capability
- Public-safe reason codes such as `LOW_ROUTE_DIVERSITY`, `LOW_INBOUND_LIQUIDITY`, `RECEIVE_NOT_READY`, or `NO_ACTIVE_CHANNELS`
- Optional aggregate score, without raw balances or channel identifiers

The public endpoint must not expose channel IDs, peer addresses, balances, invoices, payment hashes, or wallet state.

## Durability Readiness

Durability is separate from reachability and commerce readiness. A named public endpoint can be reachable while the node is still young, weakly proven, or commerce-limited.

Current/future private inputs:

- Persistent named public origin
- Endpoint reachability
- Commerce readiness
- Proof activity
- Node age
- Future reliability history
- Future settlement/payment history

Public output:

- `readiness.durable.status`
- `readiness.durable.score`
- Public-safe reason codes such as `NON_PERSISTENT_PUBLIC_ORIGIN`, `COMMERCE_LIMITED`, `LOW_PROOF_ACTIVITY`, or `NEW_NODE`

## Reachability Readiness

Reachability only answers whether the node's public route is available. It does not imply commerce capability.

Inputs:

- Public route status
- Presence endpoint state
- Runtime health
- Named tunnel/canonical origin status

Public output:

- `readiness.reachable.status`
- Optional reason code `PUBLIC_ENDPOINT_UNREACHABLE`

## Provisioning Readiness

Provisioning readiness answers whether creators can realistically provision through the node.

Inputs:

- Identity service status
- Content service status
- Commerce readiness
- Settlement readiness
- Proof capability

Public output:

- `readiness.provisioned.status`
- `readiness.provisioned.score`
- Public-safe reason codes such as `IDENTITY_UNAVAILABLE`, `COMMERCE_LIMITED`, `SETTLEMENT_LIMITED`, or `PROOFS_LIMITED`

## Provider Provisioning Architecture

Future creator-side provider configuration:

```ts
type ProviderConfiguration = {
  configuredProviderNodeId: string;
  configuredProviderPublicKey: string;
  configuredProviderUrl: string;
  observedProviderNodeId?: string;
  observedProviderPublicKey?: string;
  verificationStatus:
    | "not_configured"
    | "selected"
    | "verifying"
    | "verified"
    | "mismatch"
    | "unreachable"
    | "revoked";
};
```

Future endpoints:

- `POST /api/network/provider/select`
- `GET /api/network/provider/status`
- `GET /api/network/provider/verification`

These endpoints are not exposed through the public node registry response. The public registry returns stable provider identifiers only.

Provisioning flow:

1. Creator discovers a node through the Network Map.
2. Creator reviews services, trust, readiness, and canonical connection identifiers.
3. Creator selects "Provision from this Node".
4. Creator stores provider node ID, public key, and canonical URL.
5. Creator verifies the provider `/.well-known/certifyd-node` descriptor.
6. Provider status becomes verified or mismatch/unreachable.
7. Creator provisions identity/content/commerce flows through the provider.

## Security Review

Never expose:

- Macaroons
- TLS certificates
- Invoice data
- Payment hashes
- Wallet balances
- Channel balances
- Peer addresses
- Local ports
- Internal REST endpoints
- Payout destinations
- Private infrastructure details
- Street addresses
- Exact coordinates
- IP-derived location

Public-safe data:

- Node ID
- Node public key
- Provider profile ID
- Canonical public URL
- Coarse status/readiness
- Service capability booleans
- Proof capability/count
- Operator display name when already public
- Operator-declared approximate public location

## Frontend Placement

No frontend UI is part of V1.

When ready, the dashboard Network page is the lowest-risk placement because it already contains network/provider sections and a Network Discovery placeholder.
