# Troubleshooting Remote Invites

## Symptom

Remote split invite acceptance fails with:

```text
INVITE_FORWARDED_IDENTITY_UNTRUSTED
FORWARDED_PAYLOAD_TS_INVALID
```

## Cause

The accepting machine clock is out of sync with the authority node clock.

Certifyd uses signed timestamps on forwarded invite acceptance proofs to prevent replay attacks. If the local clock is too far ahead or behind, the authority node rejects the forwarded proof even when the invite and identity are otherwise valid.

## Linux Checks

Check local time and NTP state:

```bash
timedatectl
date -u
```

Enable network time sync:

```bash
sudo timedatectl set-ntp true
sudo systemctl restart systemd-timesyncd
```

Check again:

```bash
timedatectl
date -u
```

## Important

Do not widen the invite timestamp validation window as the fix. Clock sync is infrastructure for cross-node trust and replay protection.
