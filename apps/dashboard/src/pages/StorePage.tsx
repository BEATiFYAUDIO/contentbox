import React from "react";
import { getApiBase } from "../lib/api";

function guessApiBase() {
  return getApiBase();
}

function isLikelyUrl(s: string) {
  return /^https?:\/\//i.test(s.trim());
}

function extractReceiptToken(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (v.length >= 16 && !v.includes("/") && !v.includes(" ")) return v;
  const m = v.match(/\/public\/receipts\/([^/?#]+)/i);
  if (m) return m[1];
  return null;
}

function extractBuyUrl(input: string): string | null {
  const v = input.trim();
  if (!isLikelyUrl(v)) return null;
  if (v.includes("/buy/")) return v;
  return null;
}

export default function StorePage(props: { onOpenReceipt: (token: string) => void }) {
  const [input, setInput] = React.useState("");
  const [sellerHost, setSellerHost] = React.useState(() => guessApiBase());
  const [msg, setMsg] = React.useState<string | null>(null);

  function onOpen() {
    setMsg(null);
    const buyUrl = extractBuyUrl(input);
    if (buyUrl) {
      window.location.assign(buyUrl);
      return;
    }

    const token = extractReceiptToken(input);
    if (token) {
      props.onOpenReceipt(token);
      return;
    }

    const contentId = input.trim();
    if (!contentId) {
      setMsg("Paste a link, receipt token, or content ID.");
      return;
    }
    if (!sellerHost) {
      setMsg("Enter the seller host to open this content.");
      return;
    }
    const host = sellerHost.replace(/\/$/, "");
    window.location.assign(`${host}/buy/${contentId}`);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Store (Direct link)</div>
        <div className="text-sm text-neutral-400 mt-1">
          Buy directly from a creator link. No marketplace required.
        </div>

        <div className="mt-4 space-y-2">
          <label className="text-sm" htmlFor="store-buy-link">
            Buy from a link
          </label>
          <input
            id="store-buy-link"
            name="storeBuyLink"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a ContentBox link, receipt link/token, or content ID"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
            autoComplete="off"
          />
          <div className="text-xs text-neutral-500">
            Examples: https://seller.site/buy/CONTENT_ID · https://seller.site/public/receipts/TOKEN · TOKEN
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs text-neutral-500" htmlFor="store-seller-host">
                Seller host (if you pasted a content ID)
              </label>
              <input
                id="store-seller-host"
                name="storeSellerHost"
                value={sellerHost}
                onChange={(e) => setSellerHost(e.target.value)}
                placeholder="https://seller.site"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                autoComplete="url"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={onOpen}
                className="w-full text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
              >
                Open
              </button>
            </div>
          </div>
          {msg ? <div className="text-xs text-amber-300">{msg}</div> : null}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6 opacity-80">
        <div className="text-lg font-semibold">Discovery (Coming soon)</div>
        <div className="text-sm text-neutral-400 mt-1">
          Discovery is coming soon. Creators opt-in by listing content. Direct links work today.
        </div>
        <div className="mt-4 grid gap-3">
          <label className="sr-only" htmlFor="store-search">
            Search
          </label>
          <input
            id="store-search"
            name="storeSearch"
            disabled
            placeholder="Search"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 opacity-50"
            autoComplete="off"
          />
          <div className="grid grid-cols-2 gap-2">
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Music
            </button>
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Video
            </button>
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Books
            </button>
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Files
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
