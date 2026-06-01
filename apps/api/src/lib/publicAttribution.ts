function looksLikeInternalUserId(value: string | null | undefined): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return /^c[a-z0-9]{20,}$/i.test(raw);
}

function normalizePublicProfileHandle(value: string | null | undefined): string | null {
  const raw = String(value || "").trim().replace(/^@+/, "");
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.startsWith("remote")) return null;
  if (lower.includes("certifyd.") || lower.includes(".comuser")) return null;
  if (lower.includes("http") || lower.includes("https")) return null;
  if (/[:/]/.test(lower)) return null;
  if (!/^[a-z0-9._-]{2,32}$/i.test(raw)) return null;
  if (looksLikeInternalUserId(raw)) return null;
  return raw;
}

function resolveSafeProfilePath(profilePathRaw: string | null | undefined): string {
  const raw = String(profilePathRaw || "").trim();
  if (!raw) return "";
  try {
    if (/^https?:\/\//i.test(raw)) {
      const parsed = new URL(raw);
      const mRemote = String(parsed.pathname || "").match(/^\/u\/([^/?#]+)/i);
      if (!mRemote || !mRemote[1]) return "";
      const remoteHandle = normalizePublicProfileHandle(decodeURIComponent(mRemote[1]));
      if (!remoteHandle) return "";
      return parsed.origin + "/u/" + encodeURIComponent(remoteHandle);
    }
    const trimmed = raw.startsWith("/") ? raw : "/" + raw;
    const mLocal = trimmed.match(/^\/u\/([^/?#]+)/i);
    if (!mLocal || !mLocal[1]) return "";
    const handle = normalizePublicProfileHandle(decodeURIComponent(mLocal[1]));
    if (!handle) return "";
    return "/u/" + encodeURIComponent(handle);
  } catch {
    return "";
  }
}

export function deriveContributorProfilePath(input: {
  profilePath?: string | null;
  displayName?: string | null;
  name?: string | null;
}): string {
  const direct = resolveSafeProfilePath(input.profilePath || "");
  if (direct) return direct;
  const derived = normalizePublicProfileHandle(String(input.displayName || input.name || "").trim());
  if (!derived) return "";
  return "/u/" + encodeURIComponent(derived);
}

