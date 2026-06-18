import React from "react";
import { api } from "../lib/api";

type IdentifierType = "ISRC" | "UPC" | "ISWC" | "DOI" | "ISBN" | "EIDR";

const IDENTIFIER_TYPES: IdentifierType[] = ["ISRC", "UPC", "ISWC", "DOI", "ISBN", "EIDR"];

type Discovery = {
  title?: string | null;
  artist?: string | null;
  artworkUrl?: string | null;
  releaseDate?: string | null;
  description?: string | null;
  identifiers?: Array<{ type: string; value: string }>;
  externalUrl?: string | null;
  spotifyUrl?: string | null;
  appleMusicUrl?: string | null;
  youtubeUrl?: string | null;
  musicBrainzUrl?: string | null;
  discogsUrl?: string | null;
  provider?: string | null;
};

type LookupResponse = {
  identifier?: {
    type: IdentifierType;
    value: string;
    normalizedValue: string;
    displayValue: string;
  };
  url?: string;
  discovery: Discovery;
};

type ConnectResponse = {
  content?: { id?: string; title?: string; assetOrigin?: string | null };
};

export default function RightsHoldersPage({ onOpenLegacyCatalog }: { onOpenLegacyCatalog?: () => void }) {
  const [mode, setMode] = React.useState<"identifier" | "url">("identifier");
  const [type, setType] = React.useState<IdentifierType>("ISRC");
  const [value, setValue] = React.useState("");
  const [urlValue, setUrlValue] = React.useState("");
  const [lookup, setLookup] = React.useState<LookupResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function discover(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLookup(null);
    const nextValue = mode === "url" ? urlValue.trim() : value.trim();
    if (!nextValue) {
      setError(mode === "url" ? "URL is required." : "Identifier value is required.");
      return;
    }
    setLoading(true);
    try {
      const result = mode === "url"
        ? await api<LookupResponse>("/api/connect-work/resolve-url", "POST", { url: nextValue })
        : await api<LookupResponse>("/api/connect-work/lookup", "POST", { type, value: nextValue });
      setLookup(result);
      if (!result.discovery?.title) {
        setMessage(mode === "url" ? "No rich metadata was found, but you can still connect the URL as a Legacy asset." : "Identifier validated. No rich metadata was found, but you can still connect the work.");
      }
    } catch (err: any) {
      setError(String(err?.message || "Discovery failed."));
    } finally {
      setLoading(false);
    }
  }

  async function connectWork() {
    if (!lookup) return;
    setError(null);
    setMessage(null);
    setConnecting(true);
    try {
      const discovery = lookup.discovery || {};
      const identifiers = Array.isArray(discovery.identifiers) ? discovery.identifiers : [];
      const result = await api<ConnectResponse>("/api/connect-work/connect", "POST", {
        type: lookup.identifier?.type || identifiers[0]?.type || null,
        value: lookup.identifier?.value || identifiers[0]?.value || null,
        identifiers: identifiers.length ? identifiers : lookup.identifier ? [lookup.identifier] : [],
        title: discovery.title || (lookup.identifier ? `${lookup.identifier.type} ${lookup.identifier.displayValue}` : "Connected legacy asset"),
        artist: discovery.artist || null,
        releaseDate: discovery.releaseDate || null,
        artworkUrl: discovery.artworkUrl || null,
        description: discovery.description || null,
        externalUrl: discovery.externalUrl || null,
        spotifyUrl: discovery.spotifyUrl || null,
        appleMusicUrl: discovery.appleMusicUrl || null,
        youtubeUrl: discovery.youtubeUrl || null,
        musicBrainzUrl: discovery.musicBrainzUrl || null,
        discogsUrl: discovery.discogsUrl || null,
        provider: discovery.provider || "MusicBrainz"
      });
      setMessage(`Connected legacy asset: ${result.content?.title || "Untitled work"}`);
      onOpenLegacyCatalog?.();
    } catch (err: any) {
      setError(String(err?.message || "Connect failed."));
    } finally {
      setConnecting(false);
    }
  }

  const discovery = lookup?.discovery || null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Rights Holders</div>
        <div className="mt-2 max-w-2xl text-sm text-neutral-400">
          A standalone registry for people, publishers, labels, organizations, and collecting societies will live here.
          Connect Work lets you create a Legacy catalog asset from an existing industry identifier.
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Connect Work</div>
        <div className="mt-1 text-sm text-neutral-400">
          Paste a Spotify, Apple Music, or YouTube URL, or enter an industry identifier. Review discovered metadata, then create a private Legacy asset in your catalog.
        </div>

        <div className="mt-4 inline-flex overflow-hidden rounded-lg border border-neutral-800">
          <button
            type="button"
            className={`px-3 py-2 text-sm ${mode === "url" ? "bg-emerald-950/40 text-emerald-200" : "text-neutral-300 hover:bg-neutral-900"}`}
            onClick={() => {
              setMode("url");
              setLookup(null);
              setMessage(null);
              setError(null);
            }}
          >
            Paste URL
          </button>
          <button
            type="button"
            className={`border-l border-neutral-800 px-3 py-2 text-sm ${mode === "identifier" ? "bg-emerald-950/40 text-emerald-200" : "text-neutral-300 hover:bg-neutral-900"}`}
            onClick={() => {
              setMode("identifier");
              setLookup(null);
              setMessage(null);
              setError(null);
            }}
          >
            Enter Identifier
          </button>
        </div>

        <form onSubmit={discover} className={`mt-4 grid gap-3 ${mode === "identifier" ? "md:grid-cols-[180px_1fr_auto]" : "md:grid-cols-[1fr_auto]"}`}>
          {mode === "identifier" ? (
            <div>
              <label className="mb-1 block text-xs text-neutral-400" htmlFor="connect-work-type">Identifier type</label>
              <select
                id="connect-work-type"
                value={type}
                onChange={(e) => setType(e.target.value as IdentifierType)}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              >
                {IDENTIFIER_TYPES.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-xs text-neutral-400" htmlFor="connect-work-value">
              {mode === "url" ? "Spotify, Apple Music, or YouTube URL" : "Identifier value"}
            </label>
            <input
              id="connect-work-value"
              value={mode === "url" ? urlValue : value}
              onChange={(e) => (mode === "url" ? setUrlValue(e.target.value) : setValue(e.target.value))}
              placeholder={mode === "url" ? "https://open.spotify.com/track/…" : "e.g. USRC17607839"}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-950 disabled:opacity-60"
            >
              {loading ? "Discovering…" : "Discover"}
            </button>
          </div>
        </form>

        {error ? <div className="mt-3 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        {message ? <div className="mt-3 rounded-lg border border-amber-900 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">{message}</div> : null}

        {discovery ? (
          <div className="mt-5 rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Discovery result</div>
                <div className="text-xs text-neutral-500">Provider: {discovery.provider || "MusicBrainz"}</div>
                {lookup?.url ? <div className="text-xs text-neutral-500">Resolved from URL</div> : null}
              </div>
              <button
                type="button"
                onClick={connectWork}
                disabled={connecting}
                className="rounded-lg border border-orange-900 bg-orange-600 px-3 py-2 text-sm font-medium text-black hover:bg-orange-500 disabled:opacity-60"
              >
                {connecting ? "Connecting…" : "Connect"}
              </button>
            </div>
            <div className="flex flex-col gap-4 md:flex-row">
              <div className="h-32 w-32 shrink-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/70">
                {discovery.artworkUrl ? (
                  <img src={discovery.artworkUrl} alt="Discovered artwork" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-wide text-neutral-500">No artwork</div>
                )}
              </div>
              <div className="min-w-0 space-y-2 text-sm">
                <div>
                  <div className="text-xs text-neutral-500">Title</div>
                  <div className="text-neutral-100">{discovery.title || "Untitled work"}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Artist</div>
                  <div className="text-neutral-300">{discovery.artist || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Release date</div>
                  <div className="text-neutral-300">{discovery.releaseDate || "—"}</div>
                </div>
                {discovery.externalUrl ? (
                  <a className="inline-block break-all text-xs text-sky-300 hover:text-sky-200" href={discovery.externalUrl} target="_blank" rel="noreferrer">
                    {discovery.externalUrl}
                  </a>
                ) : null}
                {discovery.identifiers?.length ? (
                  <div>
                    <div className="text-xs text-neutral-500">Resolved identifiers</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {discovery.identifiers.map((identifier, index) => (
                        <span key={`${identifier.type}-${identifier.value}-${index}`} className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-300">
                          {identifier.type}: {identifier.value}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
