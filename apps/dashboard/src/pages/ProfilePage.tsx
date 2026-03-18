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
  createdAt: string;
};

type ProfilePageProps = {
  me: Me | null;
  setMe: (next: Me | null) => void;
  identityDetail: IdentityDetail | null;
  onOpenParticipations: () => void;
  onOpenNodeLightning?: () => void;
};
export default function ProfilePage({ me, setMe, identityDetail, onOpenParticipations, onOpenNodeLightning }: ProfilePageProps) {
  const [payoutSettings, setPayoutSettings] = useState<{ lightningAddress: string; lnurl: string; btcAddress: string } | null>(null);
  const [payoutMsg, setPayoutMsg] = useState<string | null>(null);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [avatarUploadMsg, setAvatarUploadMsg] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

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
              <button
                onClick={onOpenParticipations}
                className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              >
                Splits I’m in
              </button>
              <button
                onClick={onOpenNodeLightning}
                className="ml-2 text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              >
                Configure Lightning
              </button>
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
                autoComplete="off"
              />
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
          </div>
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
