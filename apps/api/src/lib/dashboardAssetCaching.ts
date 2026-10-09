const HASHED_DASHBOARD_ASSET = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[^/]+$/;

export function dashboardAssetCacheControl(pathname: string): string {
  const normalized = String(pathname || "/").split("?")[0] || "/";

  if (
    normalized === "/" ||
    normalized.endsWith(".html") ||
    normalized === "/manifest.json" ||
    normalized === "/service-worker.js"
  ) {
    return "no-store";
  }

  if (HASHED_DASHBOARD_ASSET.test(normalized)) {
    return "public, max-age=31536000, immutable";
  }

  return "no-cache";
}
