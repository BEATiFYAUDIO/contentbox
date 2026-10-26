# OS-managed cloudflared service adoption (deferred capability)

Core currently discovers OS-managed cloudflared services and verifies whether a configured public route reaches this Core instance. Discovery does not grant Core permission to manage the service. For an unadopted service, Core may enable or disable its own public listener after creator consent, but must not start, stop, or restart the OS service.

Explicit service adoption requires a separate implementation and review. It must persist an authenticated creator's grant for one verified service, determine its manager (SysV, systemd, launchd, or Windows Service) and whether Core has the necessary privileges, and verify the exact tunnel identity and hostnames before any lifecycle command. It must reject ambiguous or shared services rather than affecting other tunnels. Revocation must restore discovery-only behavior. No privileged service commands are added by the tunnel UI correction branch.
