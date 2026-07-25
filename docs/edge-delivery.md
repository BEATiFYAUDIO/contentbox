# Edge Delivery (Optional)

Optional Cloudflare Worker path for byte-range delivery.

- Origin route remains authoritative.
- Edge route is an optional proxy layer.
- Payment/entitlement authority remains in Certifyd API.
- Protected audio/video masters must not be served as reusable direct URLs.

## Flags

```env
EDGE_DELIVERY_ENABLED=false
EDGE_TICKET_SECRET=<strong-secret>
EDGE_BASE_URL=https://certifyd.example.com
EDGE_TICKET_TTL_SECONDS=60
```

When disabled:

- edge ticket endpoints are not active
- existing origin behavior remains unchanged

## Guardrails

- route worker only for `/edge/content/*`
- fetch origin `/content/*`
- avoid looped routing
- redact delivery tokens from worker, proxy, CDN, analytics and error logs
- set restrictive referrer policy on metadata and media responses
- do not expose permanent storage URLs for paid or protected media
- keep original master files private even when derived playback files exist

## Protected audio/video delivery

Paid stream-only audio/video is delivered as encrypted HLS:

- public access responses return a short-lived `.m3u8` playlist URL
- playlist, segment and key routes independently validate the signed delivery token
- tokens are bound to the exact content ID, normalized source file path and full-access mode
- direct master delivery through public byte routes returns `ENCRYPTED_HLS_REQUIRED`
- seeking remains supported through authorized HLS segment requests

This is the security boundary for protected playback. A copied master-file URL should not return paid media bytes.

## Free and public media

Free media is intentionally public, so encrypted HLS is not required for access control.

HLS may still be used for large public audio/video as a performance optimization, but it should not be described as a security feature for public media.

## Previews

Secure previews should use a separate generated preview asset or rendition.

Do not rely on per-request byte caps as a time-limit control. Clients can request successive ranges, and byte ranges do not map reliably to playback duration across codecs and containers.

## Player support

Certifyd Fan must support HLS playback URLs:

- Safari/iOS can play HLS natively
- Chromium and Firefox require `hls.js`
- existing MP3/MP4 URLs should continue to work as fallback

## Quick smoke

Bad token should fail:

```bash
curl -i "https://<edge-host>/edge/content/<manifestHash>/<fileId>?t=bad"
```

Valid token + range should return `206` with `Content-Range`.

For protected HLS:

```bash
curl -i "https://<origin>/public/content/<contentId>/hls/master.m3u8?objectKey=<file>&t=bad"
```

Bad, expired or copied tokens should fail before any playlist, key or segment bytes are returned.
