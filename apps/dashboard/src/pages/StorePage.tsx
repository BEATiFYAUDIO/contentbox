import React from "react";

function guessApiBase() {
  const raw = ((import.meta as any).env?.VITE_API_URL || window.location.origin) as string;
  return raw.replace(/\/$/, "");
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
          <div className="text-sm">Buy from a link</div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a ContentBox link, receipt link/token, or content ID"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
          />
          <div className="text-xs text-neutral-500">
            Examples: https://seller.site/buy/CONTENT_ID · https://seller.site/public/receipts/TOKEN · TOKEN
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <div className="text-xs text-neutral-500">Seller host (if you pasted a content ID)</div>
              <input
                value={sellerHost}
                onChange={(e) => setSellerHost(e.target.value)}
                placeholder="https://seller.site"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
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
          <input
            disabled
            placeholder="Search"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 opacity-50"
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
