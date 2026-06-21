import { useEffect, useState } from "react";
import { api, getApiBase } from "../lib/api";
import { getToken } from "../lib/auth";
import type { IdentityDetail } from "../lib/identity";
import { PAYOUT_DESTINATIONS_LABEL } from "../lib/terminology";
import AuditPanel from "../components/AuditPanel";
import VerificationPanel from "../modules/witness/VerificationPanel";

type Me = {
  id: string;
  email: string;
  displayName: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  profileTheme?: ProfileTheme | null;
  createdAt: string;
};

type ProfileThemeMode = "auto" | "vibrant" | "dark" | "minimal" | "high_contrast";
type ProfileCardStrength = "transparent" | "light" | "medium" | "strong";
type ProfileOverlayStrength = "lighter" | "balanced" | "darker";
type ProfileButtonStyle = "glass" | "filled" | "outline";

type ProfileTheme = {
  themeWallpaperImageUrl: string | null;
  themeMode: ProfileThemeMode;
  themeAccentColor: string;
  themeAccentOverrideColor: string | null;
  themeResolvedAccentColor?: string;
  themeBackgroundColor: string;
  themeCardColor: string;
  themeBorderColor: string;
  themeButtonColor: string;
  themeButtonTextColor: string;
  themeTextColor: string;
  themeMutedTextColor: string;
  themeCardStrength: ProfileCardStrength;
  themeOverlayStrength: ProfileOverlayStrength;
  themeButtonStyle: ProfileButtonStyle;
  themeSuggestedAccentColors?: string[];
  themeGeneratedFromImage: boolean;
  themeUpdatedAt: string | null;
};

const DEFAULT_PROFILE_THEME: ProfileTheme = {
  themeWallpaperImageUrl: null,
  themeMode: "auto",
  themeAccentColor: "#d4b26a",
  themeAccentOverrideColor: null,
  themeResolvedAccentColor: "#d4b26a",
  themeBackgroundColor: "#040506",
  themeCardColor: "#0a0b0d",
  themeBorderColor: "#2f2b27",
  themeButtonColor: "#d4b26a",
  themeButtonTextColor: "#0b0b0b",
  themeTextColor: "#f4f2ec",
  themeMutedTextColor: "#b7afa1",
  themeCardStrength: "medium",
  themeOverlayStrength: "balanced",
  themeButtonStyle: "glass",
  themeSuggestedAccentColors: ["#d4b26a", "#38bdf8", "#a78bfa", "#ef4444", "#22c55e", "#f8fafc"],
  themeGeneratedFromImage: false,
  themeUpdatedAt: null
};

type CreatorSignalBreakdown = {
  score: number;
  totalScore: number;
  identityScore: number;
  presenceBonus: number;
  nodeScore: number;
  tier: "Emerging" | "Verified" | "Strong" | "High Assurance" | "Sovereign Node";
  percent: number;
  verifiedPlatforms: number;
  nodeDetails: {
    hasPublicTunnel: boolean;
    hasLightningConfigured: boolean;
    canReceivePayments: boolean;
    channelCount: number;
  };
};

type PublicLocationPrecision = "country" | "region" | "city";
type PublicLocationSource = "operator_declared" | "browser_confirmed";

type PublicLocationResponse = {
  publicLocation?: {
    country?: string | null;
    region?: string | null;
    city?: string | null;
    displayLocation?: string | null;
    precision?: PublicLocationPrecision | null;
    source?: PublicLocationSource | null;
  } | null;
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function normalizeHexColor(value: string | null | undefined): string | null {
  const match = String(value || "").trim().match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toLowerCase()}` : null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = normalizeHexColor(hex) || "#000000";
  return {
    r: parseInt(clean.slice(1, 3), 16),
    g: parseInt(clean.slice(3, 5), 16),
    b: parseInt(clean.slice(5, 7), 16)
  };
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const convert = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * convert(r) + 0.7152 * convert(g) + 0.0722 * convert(b);
}

function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

function readableTextFor(background: string): string {
  return contrastRatio(background, "#f8fafc") >= contrastRatio(background, "#08090b") ? "#f8fafc" : "#08090b";
}

function resolvedProfileAccent(theme: ProfileTheme): string {
  return normalizeHexColor(theme.themeAccentOverrideColor) || normalizeHexColor(theme.themeResolvedAccentColor) || normalizeHexColor(theme.themeAccentColor) || "#d4b26a";
}

function profileAccentSuggestions(theme: ProfileTheme): string[] {
  const base = [
    ...(theme.themeSuggestedAccentColors || []),
    theme.themeAccentColor,
    theme.themeBorderColor,
    theme.themeButtonColor,
    "#d4b26a",
    "#38bdf8",
    "#a78bfa",
    "#ef4444",
    "#22c55e",
    "#f8fafc"
  ];
  const out: string[] = [];
  for (const candidate of base) {
    const hex = normalizeHexColor(candidate);
    if (!hex || out.includes(hex)) continue;
    out.push(hex);
    if (out.length >= 8) break;
  }
  return out;
}

type ProfilePageProps = {
  me: Me | null;
  setMe: (next: Me | null) => void;
  identityDetail: IdentityDetail | null;
  requireLocalLightning?: boolean;
  onOpenNodeLightning?: () => void;
};
export default function ProfilePage({
  me,
  setMe,
  identityDetail,
  requireLocalLightning = true,
  onOpenNodeLightning
}: ProfilePageProps) {
  const [payoutSettings, setPayoutSettings] = useState<{ lightningAddress: string; lnurl: string; btcAddress: string } | null>(null);
  const [payoutMsg, setPayoutMsg] = useState<string | null>(null);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [avatarUploadMsg, setAvatarUploadMsg] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [profileTheme, setProfileTheme] = useState<ProfileTheme>(me?.profileTheme || DEFAULT_PROFILE_THEME);
  const [themeMode, setThemeMode] = useState<ProfileThemeMode>((me?.profileTheme?.themeMode as ProfileThemeMode) || "auto");
  const [themeMsg, setThemeMsg] = useState<string | null>(null);
  const [themeBusy, setThemeBusy] = useState(false);
  const [themeAdvancedOpen, setThemeAdvancedOpen] = useState(false);
  const [creatorSignal, setCreatorSignal] = useState<CreatorSignalBreakdown | null>(null);
  const [creatorSignalError, setCreatorSignalError] = useState<string | null>(null);
  const [publicLocationCountry, setPublicLocationCountry] = useState("");
  const [publicLocationRegion, setPublicLocationRegion] = useState("");
  const [publicLocationCity, setPublicLocationCity] = useState("");
  const [publicLocationDisplay, setPublicLocationDisplay] = useState("");
  const [publicLocationPrecision, setPublicLocationPrecision] = useState<PublicLocationPrecision>("region");
  const [publicLocationSource, setPublicLocationSource] = useState<PublicLocationSource>("operator_declared");
  const [publicLocationMsg, setPublicLocationMsg] = useState<string | null>(null);
  const [publicLocationLoading, setPublicLocationLoading] = useState(false);
  const [publicLocationSaving, setPublicLocationSaving] = useState(false);

  const loadPayoutSettings = async () => {
    try {
      setPayoutLoading(true);
      const res = await api<{ lightningAddress: string; lnurl: string; btcAddress: string }>(`/api/me/payout`, "GET");
      setPayoutSettings(res || { lightningAddress: "", lnurl: "", btcAddress: "" });
    } catch {
      setPayoutSettings({ lightningAddress: "", lnurl: "", btcAddress: "" });
    } finally {
      setPayoutLoading(false);
    }
  };

  useEffect(() => {
    loadPayoutSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api<{ theme?: ProfileTheme }>("/api/me/profile-theme", "GET");
        if (!mounted) return;
        const nextTheme = res?.theme || me?.profileTheme || DEFAULT_PROFILE_THEME;
        setProfileTheme(nextTheme);
        setThemeMode(nextTheme.themeMode || "auto");
      } catch {
        if (!mounted) return;
        setProfileTheme(me?.profileTheme || DEFAULT_PROFILE_THEME);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setPublicLocationLoading(true);
        const res = await api<PublicLocationResponse>("/api/public/config", "GET");
        const location = res?.publicLocation || {};
        if (!mounted) return;
        setPublicLocationCountry(String(location.country || ""));
        setPublicLocationRegion(String(location.region || ""));
        setPublicLocationCity(String(location.city || ""));
        setPublicLocationDisplay(String(location.displayLocation || ""));
        setPublicLocationPrecision(
          location.precision === "country" || location.precision === "region" || location.precision === "city"
            ? location.precision
            : "region"
        );
        setPublicLocationSource(location.source === "browser_confirmed" ? "browser_confirmed" : "operator_declared");
        setPublicLocationMsg(null);
      } catch (e: unknown) {
        if (!mounted) return;
        setPublicLocationMsg(errorMessage(e, "Public location unavailable."));
      } finally {
        if (mounted) setPublicLocationLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api<{ ok?: boolean; creatorSignal?: CreatorSignalBreakdown }>("/api/me/creator-signal", "GET");
        if (!mounted) return;
        setCreatorSignal(res?.creatorSignal || null);
        setCreatorSignalError(null);
      } catch (e: any) {
        if (!mounted) return;
        setCreatorSignal(null);
        setCreatorSignalError(String(e?.message || "Creator signal unavailable"));
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const nodeMode = identityDetail?.nodeMode || "basic";
  const productTier = identityDetail?.productTier || "basic";
  const isBasicTier = productTier === "basic";
  const ownerEmail = identityDetail?.ownerEmail || null;
  const nodeBadge =
    nodeMode === "advanced"
      ? "Sovereign creator profile"
      : nodeMode === "lan"
        ? "Studio creator profile"
        : "Basic creator profile";

  const apiBase = getApiBase();
  const profileAvatarUrl = (() => {
    const raw = String(me?.avatarUrl || "").trim();
    if (!raw) return "";
    const base = apiBase.replace(/\/+$/, "");
    if (raw.startsWith("/public/avatars/")) return `${base}${raw}`;
    try {
      const u = new URL(raw);
      if (u.pathname.startsWith("/public/avatars/")) return `${base}${u.pathname}${u.search || ""}`;
    } catch {}
    return raw;
  })();

  const uploadProfileImage = async (file: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarUploadMsg("Please choose an image file.");
      return;
    }
    setAvatarUploading(true);
    setAvatarUploadMsg(null);
    try {
      const token = getToken();
      if (!token) {
        setAvatarUploadMsg("Please sign in again before uploading.");
        return;
      }
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${apiBase}/api/me/avatar/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setAvatarUploadMsg(String(payload?.message || payload?.error || "Failed to upload profile image."));
        return;
      }
      const nextMe = payload?.me || null;
      if (nextMe && typeof nextMe === "object") {
        setMe(nextMe as Me);
      } else {
        const refreshed = await api<any>(`/me`, "GET");
        setMe(refreshed);
      }
      setAvatarUploadMsg("Profile image updated.");
    } catch {
      setAvatarUploadMsg("Failed to upload profile image.");
    } finally {
      setAvatarUploading(false);
    }
  };

  const resolvePublicImageUrl = (raw: string | null | undefined) => {
    const value = String(raw || "").trim();
    if (!value) return "";
    const base = apiBase.replace(/\/+$/, "");
    if (value.startsWith("/public/")) return `${base}${value}`;
    try {
      const u = new URL(value);
      if (u.pathname.startsWith("/public/")) return `${base}${u.pathname}${u.search || ""}`;
    } catch {}
    return value;
  };

  const uploadWallpaper = async (file: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.type.includes("svg")) {
      setThemeMsg("Choose a PNG, JPG, WebP, or AVIF image.");
      return;
    }
    setThemeBusy(true);
    setThemeMsg(null);
    try {
      const token = getToken();
      if (!token) {
        setThemeMsg("Please sign in again before uploading.");
        return;
      }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", themeMode);
      const res = await fetch(`${apiBase}/api/me/profile-theme/wallpaper/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setThemeMsg(String(payload?.message || payload?.error || "Failed to upload wallpaper."));
        return;
      }
      const nextTheme = payload?.theme || DEFAULT_PROFILE_THEME;
      setProfileTheme(nextTheme);
      setThemeMode(nextTheme.themeMode || themeMode);
      const refreshed = await api<any>(`/me`, "GET");
      setMe(refreshed);
      setThemeMsg("Wallpaper uploaded and theme generated.");
    } catch {
      setThemeMsg("Failed to upload wallpaper.");
    } finally {
      setThemeBusy(false);
    }
  };

  const regenerateTheme = async () => {
    setThemeBusy(true);
    setThemeMsg(null);
    try {
      const res = await api<{ theme?: ProfileTheme }>("/api/me/profile-theme/generate", "POST", { mode: themeMode });
      const nextTheme = res?.theme || profileTheme;
      setProfileTheme(nextTheme);
      setThemeMsg("Theme regenerated. Save to publish it.");
    } catch (e: unknown) {
      setThemeMsg(errorMessage(e, "Failed to regenerate theme."));
    } finally {
      setThemeBusy(false);
    }
  };

  const saveTheme = async () => {
    setThemeBusy(true);
    setThemeMsg(null);
    try {
      const res = await api<{ theme?: ProfileTheme }>("/api/me/profile-theme", "PATCH", {
        theme: { ...profileTheme, themeMode }
      });
      const nextTheme = res?.theme || profileTheme;
      setProfileTheme(nextTheme);
      const refreshed = await api<any>(`/me`, "GET");
      setMe(refreshed);
      setThemeMsg("Profile theme saved.");
    } catch (e: unknown) {
      setThemeMsg(errorMessage(e, "Failed to save theme."));
    } finally {
      setThemeBusy(false);
    }
  };

  const resetTheme = async () => {
    setThemeBusy(true);
    setThemeMsg(null);
    try {
      const res = await api<{ theme?: ProfileTheme }>("/api/me/profile-theme/reset", "POST");
      const nextTheme = res?.theme || DEFAULT_PROFILE_THEME;
      setProfileTheme(nextTheme);
      setThemeMode(nextTheme.themeMode || "auto");
      const refreshed = await api<any>(`/me`, "GET");
      setMe(refreshed);
      setThemeMsg("Profile theme reset to Certifyd default.");
    } catch (e: unknown) {
      setThemeMsg(errorMessage(e, "Failed to reset theme."));
    } finally {
      setThemeBusy(false);
    }
  };

  const buildPublicLocationPayload = () => {
    const country = publicLocationCountry.trim();
    const region = publicLocationRegion.trim();
    const city = publicLocationCity.trim();
    const displayLocation = publicLocationDisplay.trim();
    if (!country && !region && !city && !displayLocation) return null;
    return {
      country,
      region,
      city,
      displayLocation,
      precision: publicLocationPrecision,
      source: publicLocationSource
    };
  };

  const useApproximateBrowserLocation = () => {
    setPublicLocationMsg(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setPublicLocationMsg("Browser location is unavailable. Enter country, region, and city manually.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => {
        setPublicLocationSource("browser_confirmed");
        setPublicLocationMsg(
          "Browser permission granted. Exact coordinates were not saved or published. Review and save only the approximate public area you want shown."
        );
      },
      () => {
        setPublicLocationMsg("Browser location was not available. Enter country, region, and city manually.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  };

  const savePublicLocation = async () => {
    try {
      setPublicLocationSaving(true);
      setPublicLocationMsg(null);
      await api("/api/public/config", "POST", { publicLocation: buildPublicLocationPayload() });
      setPublicLocationMsg("Public location saved.");
    } catch (e: unknown) {
      setPublicLocationMsg(errorMessage(e, "Failed to save public location."));
    } finally {
      setPublicLocationSaving(false);
    }
  };

  const clearPublicLocation = async () => {
    try {
      setPublicLocationSaving(true);
      setPublicLocationMsg(null);
      await api("/api/public/config", "POST", { publicLocation: null });
      setPublicLocationCountry("");
      setPublicLocationRegion("");
      setPublicLocationCity("");
      setPublicLocationDisplay("");
      setPublicLocationPrecision("region");
      setPublicLocationSource("operator_declared");
      setPublicLocationMsg("Public location cleared.");
    } catch (e: unknown) {
      setPublicLocationMsg(errorMessage(e, "Failed to clear public location."));
    } finally {
      setPublicLocationSaving(false);
    }
  };

  const previewAccent = resolvedProfileAccent(profileTheme);
  const previewCardAlpha =
    profileTheme.themeCardStrength === "transparent" ? 0 : profileTheme.themeCardStrength === "light" ? 0.16 : profileTheme.themeCardStrength === "strong" ? 0.3 : 0.22;
  const previewOverlayAlpha = profileTheme.themeOverlayStrength === "lighter" ? 0.24 : profileTheme.themeOverlayStrength === "darker" ? 0.48 : 0.34;
  const previewButtonBackground =
    profileTheme.themeButtonStyle === "filled"
      ? previewAccent
      : profileTheme.themeButtonStyle === "outline"
        ? "rgba(255,255,255,.025)"
        : "rgba(255,255,255,.07)";
  const previewButtonText = profileTheme.themeButtonStyle === "filled" ? readableTextFor(previewAccent) : profileTheme.themeTextColor;
  const previewAccentSuggestions = profileAccentSuggestions(profileTheme);

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
      <div className="text-lg font-semibold">Profile</div>
      <div className="text-sm text-neutral-400 mt-1">Creator identity and public profile.</div>

      <div className="mt-5 space-y-4">

        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">Node Account (Local)</div>
              <div className="text-xs text-neutral-500">This is who controls this node.</div>
            </div>
            <div className="text-xs rounded-full border border-neutral-800 px-2 py-1 text-neutral-300">
              {nodeBadge}
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <div>
              <div className="text-xs text-neutral-400">User ID</div>
              <div className="text-sm text-neutral-100 break-all">{me?.id || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-400">Email</div>
              <div className="text-sm text-neutral-100 break-all">{me?.email || "—"}</div>
            </div>
            {ownerEmail ? (
              <div>
                <div className="text-xs text-neutral-400">Owner email</div>
                <div className="text-sm text-neutral-100 break-all">{ownerEmail}</div>
              </div>
            ) : null}
            <div>
              {requireLocalLightning ? (
                <button
                  onClick={onOpenNodeLightning}
                  className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                >
                  Configure Lightning
                </button>
              ) : (
                <span className="text-xs text-neutral-400">
                  Provider-backed commerce active (local Lightning not required)
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-sm font-medium">Public Profile (Presentation)</div>
          <div className="text-xs text-neutral-500">Shown on share pages and proof bundles (does not change ownership).</div>

          <div className="mt-3 space-y-3">
            <div>
              <label className="text-sm" htmlFor="profile-display-name">
                Display name
              </label>
              <div className="flex gap-2">
                <input
                  id="profile-display-name"
                  name="displayName"
                  value={me?.displayName || ""}
                  onChange={(e) => setMe(me ? { ...me, displayName: e.target.value } : me)}
                  className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                  autoComplete="name"
                />
                <button
                  onClick={async () => {
                    try {
                      await api(`/me`, "PATCH", { displayName: me?.displayName, bio: me?.bio || null, avatarUrl: me?.avatarUrl ?? null });
                      const m = await api<any>(`/me`, "GET");
                      setMe(m);
                    } catch {
                      // ignore for now
                    }
                  }}
                  className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
                >
                  Save
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm" htmlFor="profile-bio">
                Bio
              </label>
              <textarea
                id="profile-bio"
                name="bio"
                value={me?.bio || ""}
                onChange={(e) => setMe(me ? { ...me, bio: e.target.value } : me)}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 mt-1"
                rows={3}
                maxLength={20}
                autoComplete="off"
              />
              <div className="mt-1 text-xs text-neutral-500">{(me?.bio || "").length}/20</div>
            </div>

            <div>
              <label className="text-sm" htmlFor="profile-avatar-url">
                Profile image
              </label>
              <div className="flex gap-2 items-center mt-1">
                <input
                  id="profile-avatar-url"
                  name="avatarUrl"
                  value={me?.avatarUrl || ""}
                  onChange={(e) => setMe(me ? { ...me, avatarUrl: e.target.value } : me)}
                  className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                  autoComplete="url"
                  placeholder="https://example.com/avatar.jpg or upload an image below"
                />
                {profileAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profileAvatarUrl} alt="avatar" className="w-12 h-12 rounded-full object-cover" />
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-xs rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 cursor-pointer">
                  {avatarUploading ? "Uploading…" : "Upload image"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                    className="hidden"
                    disabled={avatarUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadProfileImage(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="text-xs rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-60"
                  disabled={avatarUploading}
                  onClick={() => {
                    setMe(me ? { ...me, avatarUrl: null } : me);
                    setAvatarUploadMsg(null);
                  }}
                >
                  Clear image
                </button>
                <div className="text-xs text-neutral-500">Images up to 2MB.</div>
              </div>
              {avatarUploadMsg ? <div className="mt-1 text-xs text-amber-300">{avatarUploadMsg}</div> : null}
            </div>

            <div id="public-location" className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-3">
              <div className="text-sm font-medium">Public Location</div>
              <div className="mt-1 text-xs text-neutral-500">
                This is your approximate public display location. It may be used for profile discovery and, if your node is eligible,
                on the Certifyd Network Map. Never enter a street address, postal code, phone number, URL, email, exact coordinates,
                or private location.
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs text-neutral-400" htmlFor="public-location-country">
                  Country
                  <input
                    id="public-location-country"
                    name="publicLocationCountry"
                    value={publicLocationCountry}
                    onChange={(e) => setPublicLocationCountry(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
                    placeholder="Canada"
                    autoComplete="country-name"
                  />
                </label>
                <label className="text-xs text-neutral-400" htmlFor="public-location-region">
                  Region / Province / State
                  <input
                    id="public-location-region"
                    name="publicLocationRegion"
                    value={publicLocationRegion}
                    onChange={(e) => setPublicLocationRegion(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
                    placeholder="Ontario"
                    autoComplete="address-level1"
                  />
                </label>
                <label className="text-xs text-neutral-400" htmlFor="public-location-city">
                  City / Area
                  <input
                    id="public-location-city"
                    name="publicLocationCity"
                    value={publicLocationCity}
                    onChange={(e) => setPublicLocationCity(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
                    placeholder="Innisfil"
                    autoComplete="address-level2"
                  />
                </label>
                <label className="text-xs text-neutral-400" htmlFor="public-location-display">
                  Public Display Location
                  <input
                    id="public-location-display"
                    name="publicLocationDisplay"
                    value={publicLocationDisplay}
                    onChange={(e) => setPublicLocationDisplay(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
                    placeholder="Innisfil, Ontario"
                    autoComplete="off"
                  />
                </label>
                <label className="text-xs text-neutral-400" htmlFor="public-location-precision">
                  Location Precision
                  <select
                    id="public-location-precision"
                    name="publicLocationPrecision"
                    value={publicLocationPrecision}
                    onChange={(e) => setPublicLocationPrecision(e.target.value as PublicLocationPrecision)}
                    className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
                  >
                    <option value="country">Country only</option>
                    <option value="region">Region / Province / State</option>
                    <option value="city">City / Area</option>
                  </select>
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={useApproximateBrowserLocation}
                  className="text-xs rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
                >
                  Use approximate browser location
                </button>
                <button
                  type="button"
                  onClick={savePublicLocation}
                  disabled={publicLocationSaving}
                  className="text-xs rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-60"
                >
                  {publicLocationSaving ? "Saving…" : "Save approximate public location"}
                </button>
                <button
                  type="button"
                  onClick={clearPublicLocation}
                  disabled={publicLocationSaving}
                  className="text-xs rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-60"
                >
                  Clear public location
                </button>
                <span className="text-xs text-neutral-500">
                  Source: {publicLocationSource === "browser_confirmed" ? "browser confirmed" : "operator declared"}
                </span>
              </div>
              <div className="mt-2 text-xs text-neutral-500">
                The browser helper only confirms permission. It never saves exact coordinates or publishes browser coordinates.
                You must manually review and save the approximate public location above.
              </div>
              {publicLocationLoading ? <div className="mt-2 text-xs text-neutral-500">Loading public location…</div> : null}
              {publicLocationMsg ? <div className="mt-2 text-xs text-amber-300">{publicLocationMsg}</div> : null}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Appearance</div>
              <div className="text-xs text-neutral-500">
                Upload a public profile wallpaper and generate an accessible color theme automatically.
              </div>
            </div>
            <div className="text-xs rounded-full border border-neutral-800 px-2 py-1 text-neutral-300">
              {profileTheme.themeGeneratedFromImage ? "Image theme" : "Certifyd default"}
            </div>
          </div>

          <div
            className="relative mt-3 min-h-72 overflow-hidden rounded-xl border p-4"
            style={{
              borderColor: profileTheme.themeBorderColor,
              background: profileTheme.themeWallpaperImageUrl
                ? `url(${resolvePublicImageUrl(profileTheme.themeWallpaperImageUrl)}) center/cover`
                : profileTheme.themeBackgroundColor,
              color: profileTheme.themeTextColor
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                background:
                  `radial-gradient(circle at 50% 8%, rgba(0,0,0,.04), rgba(0,0,0,${previewOverlayAlpha}) 58%, rgba(0,0,0,.54) 100%), linear-gradient(180deg, rgba(0,0,0,.20), rgba(0,0,0,${Math.min(previewOverlayAlpha + 0.1, 0.62)}))`
              }}
            />
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: `radial-gradient(520px 180px at 18% 4%, ${previewAccent}33, transparent 70%)`
              }}
            />
            <div
              className="relative max-w-xl rounded-lg border p-3 shadow-2xl backdrop-blur-md"
              style={{
                borderColor: `${profileTheme.themeBorderColor}bb`,
                background: `rgba(10,10,10,${previewCardAlpha})`,
                backdropFilter: "blur(20px) saturate(125%)",
                boxShadow: `0 18px 45px rgba(0,0,0,.32), 0 0 36px ${previewAccent}22`
              }}
            >
              <div className="text-xs uppercase tracking-wide" style={{ color: profileTheme.themeMutedTextColor }}>
                Full-page public profile preview
              </div>
              <div className="mt-1 text-xl font-semibold">{me?.displayName || "Creator"}</div>
              <div className="mt-1 text-sm" style={{ color: profileTheme.themeMutedTextColor }}>
                Wallpaper sits behind the whole profile. Existing trust score, verification, works, collaborations, and proof sections render as glass panels.
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.07)", border: `1px solid ${previewAccent}99` }}>
                <div className="h-full w-2/3 rounded-full" style={{ background: `linear-gradient(90deg, ${previewAccent}, ${profileTheme.themeButtonColor})` }} />
              </div>
              <button
                type="button"
                className="mt-3 rounded-lg px-3 py-2 text-sm font-medium"
                style={{
                  background: previewButtonBackground,
                  color: previewButtonText,
                  border: `1px solid ${previewAccent}bb`,
                  boxShadow: `0 0 18px ${previewAccent}22`
                }}
              >
                Preview button
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs text-neutral-400" htmlFor="profile-theme-mode">
              Theme mode
              <select
                id="profile-theme-mode"
                value={themeMode}
                onChange={(e) => setThemeMode(e.target.value as ProfileThemeMode)}
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
              >
                <option value="auto">Auto</option>
                <option value="vibrant">Vibrant</option>
                <option value="dark">Dark</option>
                <option value="minimal">Minimal</option>
                <option value="high_contrast">High Contrast</option>
              </select>
            </label>
            <div className="text-xs text-neutral-500 md:self-end">
              Themes are generated server-side with high-contrast text and button safety checks.
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/25 p-3">
            <div className="text-xs font-medium text-neutral-200">Quick Adjust</div>
            <div className="mt-1 text-xs text-neutral-500">Fix generated colors without editing raw hex values.</div>

            <div className="mt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-neutral-400">Accent Color</div>
                <div className="text-xs text-neutral-500">
                  Generated: <span className="font-mono">{profileTheme.themeAccentColor}</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {previewAccentSuggestions.map((color) => {
                  const selected = previewAccent.toLowerCase() === color.toLowerCase();
                  return (
                    <button
                      type="button"
                      key={color}
                      title={color}
                      onClick={() => setProfileTheme((theme) => ({ ...theme, themeAccentOverrideColor: color, themeResolvedAccentColor: color }))}
                      className={`h-8 w-8 rounded-full border ${selected ? "border-white ring-2 ring-white/30" : "border-neutral-700"}`}
                      style={{ background: color }}
                    />
                  );
                })}
                <button
                  type="button"
                  onClick={() => setProfileTheme((theme) => ({ ...theme, themeAccentOverrideColor: null, themeResolvedAccentColor: theme.themeAccentColor }))}
                  className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
                >
                  Use generated
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="text-xs text-neutral-400">
                Card Strength
                <select
                  value={profileTheme.themeCardStrength}
                  onChange={(e) => setProfileTheme((theme) => ({ ...theme, themeCardStrength: e.target.value as ProfileCardStrength }))}
                  className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
                >
                  <option value="transparent">Transparent</option>
                  <option value="light">Light</option>
                  <option value="medium">Medium</option>
                  <option value="strong">Strong</option>
                </select>
              </label>
              <label className="text-xs text-neutral-400">
                Overlay
                <select
                  value={profileTheme.themeOverlayStrength}
                  onChange={(e) => setProfileTheme((theme) => ({ ...theme, themeOverlayStrength: e.target.value as ProfileOverlayStrength }))}
                  className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
                >
                  <option value="lighter">Lighter</option>
                  <option value="balanced">Balanced</option>
                  <option value="darker">Darker</option>
                </select>
              </label>
              <label className="text-xs text-neutral-400">
                Button Style
                <select
                  value={profileTheme.themeButtonStyle}
                  onChange={(e) => setProfileTheme((theme) => ({ ...theme, themeButtonStyle: e.target.value as ProfileButtonStyle }))}
                  className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
                >
                  <option value="glass">Glass</option>
                  <option value="filled">Filled</option>
                  <option value="outline">Outline</option>
                </select>
              </label>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 cursor-pointer">
              {themeBusy ? "Working…" : "Upload/change wallpaper"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                className="hidden"
                disabled={themeBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadWallpaper(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={regenerateTheme}
              disabled={themeBusy}
              className="text-xs rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-60"
            >
              Regenerate theme
            </button>
            <button
              type="button"
              onClick={saveTheme}
              disabled={themeBusy}
              className="text-xs rounded-lg border border-amber-700 bg-amber-600/15 px-3 py-2 text-amber-100 hover:bg-amber-600/25 disabled:opacity-60"
            >
              Save theme
            </button>
            <button
              type="button"
              onClick={resetTheme}
              disabled={themeBusy}
              className="text-xs rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-60"
            >
              Reset to Certifyd default
            </button>
          </div>

          <details className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/30 p-3" open={themeAdvancedOpen} onToggle={(e) => setThemeAdvancedOpen(e.currentTarget.open)}>
            <summary className="cursor-pointer text-xs text-neutral-300">Advanced color controls</summary>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              {[
                ["themeAccentColor", "Accent"],
                ["themeBackgroundColor", "Background"],
                ["themeCardColor", "Card"],
                ["themeBorderColor", "Border"],
                ["themeButtonColor", "Button"],
                ["themeButtonTextColor", "Button text"],
                ["themeTextColor", "Text"],
                ["themeMutedTextColor", "Muted text"]
              ].map(([key, label]) => (
                <label key={key} className="text-xs text-neutral-400">
                  {label}
                  <input
                    type="color"
                    value={(profileTheme as any)[key] || "#000000"}
                    onChange={(e) => setProfileTheme((theme) => ({ ...theme, [key]: e.target.value }))}
                    className="mt-1 h-9 w-full rounded border border-neutral-800 bg-neutral-950"
                  />
                </label>
              ))}
            </div>
          </details>

          <div className="mt-2 text-xs text-neutral-500">
            Wallpaper appears behind the existing profile header with a dark readability overlay. SVG wallpapers are not accepted.
          </div>
          {themeMsg ? <div className="mt-2 text-xs text-amber-300">{themeMsg}</div> : null}
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Creator Signal</div>
              <div className="text-xs text-neutral-500">Trust = identity assurance + operational capability.</div>
            </div>
            {creatorSignal ? (
              <div
                className={`text-xs rounded-full border px-2 py-1 ${
                  creatorSignal.tier === "Sovereign Node"
                    ? "border-emerald-700 bg-emerald-950/30 text-emerald-200"
                    : "border-neutral-700 text-neutral-300"
                }`}
              >
                {creatorSignal.tier}
              </div>
            ) : null}
          </div>
          {creatorSignal ? (
            <div className="mt-3 space-y-2">
              <div className="text-sm text-neutral-100">
                Score {creatorSignal.totalScore} • {creatorSignal.percent}% meter
              </div>
              <div className="h-2 w-full rounded-full border border-neutral-800 bg-neutral-900 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-cyan-400 to-blue-400"
                  style={{ width: `${Math.max(0, Math.min(100, creatorSignal.percent))}%` }}
                />
              </div>
              <div className="grid gap-2 text-xs text-neutral-300 md:grid-cols-3">
                <div className="rounded border border-neutral-800 bg-neutral-900/40 px-2 py-2">
                  <div className="text-neutral-400">Identity Proofs</div>
                  <div className="text-neutral-100">+{creatorSignal.identityScore}</div>
                </div>
                <div className="rounded border border-neutral-800 bg-neutral-900/40 px-2 py-2">
                  <div className="text-neutral-400">Presence Bonus</div>
                  <div className="text-neutral-100">+{creatorSignal.presenceBonus}</div>
                </div>
                <div className="rounded border border-neutral-800 bg-neutral-900/40 px-2 py-2">
                  <div className="text-neutral-400">Node Operator Bonus</div>
                  <div className="text-neutral-100">+{creatorSignal.nodeScore}</div>
                </div>
              </div>
              <div className="rounded border border-neutral-800 bg-neutral-900/30 p-2 text-xs text-neutral-300 space-y-1">
                <div className="text-neutral-400">Node Trust</div>
                <div>Public tunnel: {creatorSignal.nodeDetails.hasPublicTunnel ? "yes (+3)" : "no (+0)"}</div>
                <div>Lightning configured: {creatorSignal.nodeDetails.hasLightningConfigured ? "yes (+4)" : "no (+0)"}</div>
                <div>Can receive payments: {creatorSignal.nodeDetails.canReceivePayments ? "yes (+6)" : "no (+0)"}</div>
                <div>
                  Active channels: {creatorSignal.nodeDetails.channelCount} (
                  {creatorSignal.nodeDetails.channelCount > 0
                    ? `+${2 + Math.min(Math.max(creatorSignal.nodeDetails.channelCount, 0), 3)}`
                    : "+0"}
                  )
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-neutral-500">{creatorSignalError || "Creator signal unavailable."}</div>
          )}
        </div>

        <VerificationPanel />

        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-sm font-medium">Integrations</div>
          <div className="text-xs text-neutral-500">Configure payout and external identity integrations for this node.</div>
          <div className="mt-3 space-y-2">
            <label className="text-xs text-neutral-400" htmlFor="payments-lightning-address">
              Lightning Address
            </label>
            <input
              id="payments-lightning-address"
              name="lightningAddress"
              placeholder="Lightning Address (name@domain.com)"
              value={payoutSettings?.lightningAddress || ""}
              onChange={(e) => setPayoutSettings((s) => ({ lightningAddress: e.target.value, lnurl: s?.lnurl || "", btcAddress: s?.btcAddress || "" }))}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
              autoComplete="off"
            />
            {isBasicTier && !(payoutSettings?.lightningAddress || "").trim() ? (
              <div className="text-xs text-amber-300">Lightning address required in Basic mode.</div>
            ) : null}
            <label className="text-xs text-neutral-400" htmlFor="payments-lnurl">
              LNURL (optional)
            </label>
            <input
              id="payments-lnurl"
              name="lnurl"
              placeholder="LNURL (optional)"
              value={payoutSettings?.lnurl || ""}
              onChange={(e) => setPayoutSettings((s) => ({ lightningAddress: s?.lightningAddress || "", lnurl: e.target.value, btcAddress: s?.btcAddress || "" }))}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
              autoComplete="off"
            />
            <label className="text-xs text-neutral-400" htmlFor="payments-btc-address">
              BTC Address (optional)
            </label>
            <input
              id="payments-btc-address"
              name="btcAddress"
              placeholder="BTC Address (optional)"
              value={payoutSettings?.btcAddress || ""}
              onChange={(e) => setPayoutSettings((s) => ({ lightningAddress: s?.lightningAddress || "", lnurl: s?.lnurl || "", btcAddress: e.target.value }))}
              className={`w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 ${isBasicTier ? "opacity-50 cursor-not-allowed" : ""}`}
              disabled={isBasicTier}
              title={isBasicTier ? "On-chain BTC payments are not supported in Basic mode." : undefined}
              autoComplete="off"
            />
            <button
              onClick={async () => {
                if (isBasicTier && !(payoutSettings?.lightningAddress || "").trim()) {
                  setPayoutMsg("Lightning address required in Basic mode.");
                  return;
                }
                try {
                  setPayoutMsg(null);
                  await api(`/api/me/payout`, "POST", {
                    lightningAddress: payoutSettings?.lightningAddress || "",
                    lnurl: payoutSettings?.lnurl || "",
                    btcAddress: payoutSettings?.btcAddress || ""
                  });
                  await loadPayoutSettings();
                  setPayoutMsg("Saved.");
                } catch (e: any) {
                  setPayoutMsg(e?.message || "Failed to save payout settings.");
                }
              }}
              className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-60"
              disabled={isBasicTier && !(payoutSettings?.lightningAddress || "").trim()}
            >
              {payoutLoading ? "Loading…" : "Save payout settings"}
            </button>
            {payoutMsg ? <div className="text-xs text-amber-300">{payoutMsg}</div> : null}
            <div className="text-xs text-neutral-500">{PAYOUT_DESTINATIONS_LABEL}</div>
            <div className="text-xs text-neutral-500">NIP-05 and advanced identity proofs are managed in Verification.</div>
          </div>
        </div>

        <AuditPanel scopeType="identity" title="Audit" exportName="identity-audit.json" />
      </div>

    </div>
  );
}
