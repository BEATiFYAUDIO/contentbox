# ThunderHub GUI (Localhost Only)

ThunderHub is a local web dashboard. We keep it **localhost-only** and access it through an SSH tunnel.

## Install ThunderHub

Follow ThunderHub’s official install instructions for your distro. Once installed, confirm:

```bash
thunderhub --version || true
```

## Configure ThunderHub (local only)

Create a config file (example location: `/home/<USER>/.thunderhub/config.json`):

```json
{
  "port": 3000,
  "host": "127.0.0.1",
  "accountConfigPath": "/home/<USER>/.thunderhub/accounts.yaml"
}
```

Create `/home/<USER>/.thunderhub/accounts.yaml` with placeholders:

```yaml
masterPassword: <THUNDERHUB_PASSWORD>
accounts:
  - name: "Studio LND"
    serverUrl: "127.0.0.1:10009"
    macaroonPath: "<LND_ADMIN_MACAROON_PATH>"
    certificatePath: "<LND_TLS_CERT_PATH>"
```

Notes:
- Do **not** commit these files.
- Use the real macaroon and TLS cert paths from your LND directory when you set this up.
- Keep everything bound to `127.0.0.1`.

## Start ThunderHub

```bash
thunderhub
```

Verify it is only listening on localhost:

```bash
ss -lntp | egrep ':3000'
```

## Access via SSH Tunnel

From your laptop (client machine):

```bash
ssh -L 3000:127.0.0.1:3000 <USER>@<NODE_HOST>
```

Then open:

```
http://127.0.0.1:3000
```

This keeps the GUI private and encrypted without exposing it to the internet.
