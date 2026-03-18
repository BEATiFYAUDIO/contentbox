# Certifyd Dashboard

React + TypeScript + Vite frontend for Certifyd Creator.

## Run

```bash
npm install
npm run dev
```

Default dev URL:

- `http://127.0.0.1:5173`

## API target

Set in `apps/dashboard/.env.local`:

```env
VITE_API_BASE_URL=http://127.0.0.1:4000
```

Fallback env key still accepted:

- `VITE_API_URL`

## Build

```bash
npm run build
```

## UI posture rules

Dashboard should render from backend posture truth:

- selected mode vs effective mode are separate
- storefront authority and commerce authority are separate
- provider connection does not imply Sovereign Node
