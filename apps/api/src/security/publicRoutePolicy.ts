export type PublicRouteClassification =
  | "public-health"
  | "public-profile"
  | "public-network"
  | "public-commerce"
  | "public-delivery"
  | "public-invite"
  | "public-derivative";

export type PublicRoutePolicyEntry = {
  method: "GET" | "POST" | "OPTIONS";
  pattern: string;
  classification: PublicRouteClassification;
  note: string;
};

export const PUBLIC_ROUTE_ALLOWLIST: PublicRoutePolicyEntry[] = [
  { method: "GET", pattern: "/", classification: "public-profile", note: "canonical public profile root" },
  { method: "GET", pattern: "/health", classification: "public-health", note: "public listener health" },
  { method: "GET", pattern: "/api/health", classification: "public-health", note: "public listener health" },
  { method: "GET", pattern: "/public/ping", classification: "public-health", note: "public listener ping" },
  { method: "GET", pattern: "/p/:token", classification: "public-profile", note: "short public link" },
  { method: "GET", pattern: "/u/:handle", classification: "public-profile", note: "public creator profile" },
  { method: "GET", pattern: "/u/:handle/proofs.json", classification: "public-profile", note: "public proof bundle" },
  { method: "GET", pattern: "/profile", classification: "public-profile", note: "public profile redirect" },
  { method: "GET", pattern: "/logo.png", classification: "public-profile", note: "public profile asset" },
  { method: "GET", pattern: "/certifyd-profile-logo.png", classification: "public-profile", note: "public profile asset" },
  { method: "GET", pattern: "/certifyd-tab-icon.svg", classification: "public-profile", note: "public icon asset" },
  { method: "GET", pattern: "/certifyd-tab-icon.png", classification: "public-profile", note: "public icon asset" },
  { method: "GET", pattern: "/favicon.ico", classification: "public-profile", note: "public icon asset" },
  { method: "GET", pattern: "/favicon.png", classification: "public-profile", note: "public icon asset" },
  { method: "GET", pattern: "/apple-touch-icon.png", classification: "public-profile", note: "public icon asset" },
  { method: "GET", pattern: "/.well-known/certifyd-node", classification: "public-network", note: "signed public node presence" },
  { method: "GET", pattern: "/api/network/nodes", classification: "public-network", note: "public network discovery" },
  { method: "GET", pattern: "/api/network/nodes/:nodeId", classification: "public-network", note: "public node discovery" },
  { method: "GET", pattern: "/api/network/provider/capabilities", classification: "public-network", note: "public provider capabilities" },
  { method: "POST", pattern: "/api/network/provider/acknowledge-client", classification: "public-network", note: "public provider handshake" },
  { method: "POST", pattern: "/api/network/provider/accept-operation-intent", classification: "public-network", note: "public provider handshake" },
  { method: "POST", pattern: "/api/network/provider/execute-test", classification: "public-network", note: "public provider execution test" },
  { method: "POST", pattern: "/api/network/provider/delegated-publish", classification: "public-network", note: "public delegated publish ingress" },
  { method: "POST", pattern: "/api/derivatives/remote-request", classification: "public-derivative", note: "remote derivative clearance request" },
  { method: "GET", pattern: "/api/derivatives/remote-status", classification: "public-derivative", note: "remote derivative clearance status" },
  { method: "POST", pattern: "/api/derivatives/remote-vote", classification: "public-derivative", note: "remote derivative vote" },
  { method: "GET", pattern: "/buy/:contentId", classification: "public-commerce", note: "public buy page" },
  { method: "GET", pattern: "/buy/receipt/:receiptId", classification: "public-commerce", note: "public receipt page" },
  { method: "GET", pattern: "/library", classification: "public-commerce", note: "buyer library via buyer session" },
  { method: "GET", pattern: "/buy/content/:contentId/offer", classification: "public-commerce", note: "public offer metadata" },
  { method: "GET", pattern: "/buy/content/:contentId/access-status", classification: "public-commerce", note: "buyer content access status" },
  { method: "GET", pattern: "/buy/content/:id/preview-file", classification: "public-delivery", note: "public preview redirect" },
  { method: "GET", pattern: "/buy/content/:id/cover", classification: "public-delivery", note: "public cover delivery" },
  { method: "GET", pattern: "/public/content/:id", classification: "public-commerce", note: "public content metadata" },
  { method: "GET", pattern: "/public/content/:id/context", classification: "public-commerce", note: "public content context" },
  { method: "GET", pattern: "/public/discoverable-content", classification: "public-network", note: "public discovery feed" },
  { method: "GET", pattern: "/public/discovery/signals", classification: "public-network", note: "public discovery signals" },
  { method: "GET", pattern: "/public/content/:id/attribution", classification: "public-commerce", note: "public attribution" },
  { method: "GET", pattern: "/public/content/:id/access", classification: "public-commerce", note: "public content access policy" },
  { method: "GET", pattern: "/public/content/:contentId/access-status", classification: "public-commerce", note: "public content access status" },
  { method: "GET", pattern: "/public/content/:id/preview-file", classification: "public-delivery", note: "public preview delivery" },
  { method: "GET", pattern: "/public/content/:id/hls/master.m3u8", classification: "public-delivery", note: "public HLS playlist" },
  { method: "GET", pattern: "/public/content/:id/hls/key", classification: "public-delivery", note: "public HLS key" },
  { method: "GET", pattern: "/public/content/:id/hls/segment/:asset", classification: "public-delivery", note: "public HLS segment" },
  { method: "GET", pattern: "/public/content/:id/cover", classification: "public-delivery", note: "public cover delivery" },
  { method: "GET", pattern: "/public/avatars/:userId/:filename", classification: "public-delivery", note: "public avatar delivery" },
  { method: "GET", pattern: "/public/profile-wallpapers/:userId/:filename", classification: "public-delivery", note: "public wallpaper delivery" },
  { method: "GET", pattern: "/public/content/:id/credits", classification: "public-commerce", note: "public credits" },
  { method: "POST", pattern: "/public/interactions", classification: "public-commerce", note: "public audience interaction" },
  { method: "GET", pattern: "/public/users/:id", classification: "public-profile", note: "public user metadata" },
  { method: "GET", pattern: "/public/users/:userId/payout-destination", classification: "public-commerce", note: "public payout destination summary" },
  { method: "POST", pattern: "/api/buyer/bootstrap", classification: "public-commerce", note: "buyer session bootstrap" },
  { method: "GET", pattern: "/api/buyer/me", classification: "public-commerce", note: "buyer session lookup" },
  { method: "POST", pattern: "/api/buyer/logout", classification: "public-commerce", note: "buyer session logout" },
  { method: "GET", pattern: "/api/buyer/entitlements", classification: "public-commerce", note: "buyer entitlements via buyer session" },
  { method: "POST", pattern: "/api/buyer/buys", classification: "public-commerce", note: "buyer library action" },
  { method: "POST", pattern: "/public/provider/payment-intents", classification: "public-commerce", note: "delegated provider invoice creation" },
  { method: "GET", pattern: "/public/provider/payment-intents/:paymentIntentId/status", classification: "public-commerce", note: "delegated provider payment status" },
  { method: "POST", pattern: "/api/buyer/entitlements/claim", classification: "public-commerce", note: "free-content entitlement claim" },
  { method: "POST", pattern: "/buy/payments/intents", classification: "public-commerce", note: "public invoice creation" },
  { method: "POST", pattern: "/api/public/payments/intents", classification: "public-commerce", note: "public invoice creation alias" },
  { method: "GET", pattern: "/api/payments/intents/:id", classification: "public-commerce", note: "receipt-token payment status polling" },
  { method: "POST", pattern: "/api/payments/intents/:id/refresh", classification: "public-commerce", note: "receipt-token payment status refresh" },
  { method: "POST", pattern: "/buy/permits", classification: "public-commerce", note: "public buy permit creation" },
  { method: "GET", pattern: "/buy/receipts/:receiptToken/status", classification: "public-commerce", note: "receipt status polling" },
  { method: "GET", pattern: "/buy/receipts/:receiptToken/fulfill", classification: "public-commerce", note: "receipt entitlement fulfillment" },
  { method: "GET", pattern: "/buy/receipts/:receiptToken/file", classification: "public-delivery", note: "receipt-protected file delivery" },
  { method: "GET", pattern: "/buy/receipts/r/:receiptId/status", classification: "public-commerce", note: "durable receipt status" },
  { method: "POST", pattern: "/buy/receipts/r/:receiptId/reissue-token", classification: "public-commerce", note: "durable receipt token reissue" },
  { method: "GET", pattern: "/invites/:token", classification: "public-invite", note: "public invite lookup" },
  { method: "GET", pattern: "/invites/:token/accounting", classification: "public-invite", note: "public invite accounting" },
  { method: "GET", pattern: "/invite/:token", classification: "public-invite", note: "public invite page" },
  { method: "POST", pattern: "/invites/:token/accept", classification: "public-invite", note: "public invite acceptance" },
  { method: "GET", pattern: "/content/:manifestHash/:fileId", classification: "public-delivery", note: "legacy public content file" }
];

function normalizePath(input: string): string {
  const raw = String(input || "").split("?")[0] || "/";
  if (raw === "/") return raw;
  return raw.replace(/\/+$/, "") || "/";
}

function routePatternToRegex(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  const escaped = normalized
    .split("/")
    .map((part) => {
      if (!part) return "";
      if (part.startsWith(":")) return "[^/]+";
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${escaped}$`);
}

const COMPILED_PUBLIC_ROUTE_ALLOWLIST = PUBLIC_ROUTE_ALLOWLIST.map((entry) => ({
  ...entry,
  regex: routePatternToRegex(entry.pattern)
}));

export function getPublicRoutePolicy(method: string, pathOrUrl: string): PublicRoutePolicyEntry | null {
  const normalizedMethod = String(method || "GET").trim().toUpperCase();
  if (normalizedMethod === "OPTIONS") {
    return { method: "OPTIONS", pattern: "*", classification: "public-health", note: "CORS preflight" };
  }
  const path = normalizePath(pathOrUrl);
  return (
    COMPILED_PUBLIC_ROUTE_ALLOWLIST.find((entry) => entry.method === normalizedMethod && entry.regex.test(path)) || null
  );
}

export function isPublicRouteAllowed(method: string, pathOrUrl: string): boolean {
  return Boolean(getPublicRoutePolicy(method, pathOrUrl));
}
