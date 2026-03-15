\Cloudflare Tunnel Configuration Guide for Certifyd
Overview

This guide explains how to configure a Cloudflare Tunnel for a Certifyd creator storefront. It provides a clean, repeatable configuration pattern that works on:

Linux

macOS

Windows

The guide assumes:

cloudflared is installed locally

the Certifyd service runs locally on 127.0.0.1:4000

a Cloudflare Tunnel token is available

the tunnel exposes the creator storefront to the internet

Current Architecture
Internet
  ↓
Cloudflare Edge
  ↓
Cloudflare Tunnel (cloudflared)
  ↓
127.0.0.1:4000
  ↓
Certifyd creator storefront

The tunnel publishes the creator storefront through Cloudflare and forwards traffic to the local Certifyd service.

Important Scope

This guide applies only to the creator storefront machine.

At the current Certifyd stage:

creator storefronts use Cloudflare tunnels

commerce/provider nodes do not provide tunnelling

commerce/provider nodes do not host creator storefronts

The tunnel belongs to the creator machine and exposes the creator-facing Certifyd application.

Why Token Mode Is Used

This setup uses token mode for Cloudflare tunnels because it is simple and avoids configuration drift.

Avoid mixing:

config.yml

named tunnel credential files

token files

multiple tunnel launch methods

foreground and background tunnels at the same time

Mixed configurations often cause issues such as:

HTTP 530

stale tunnels

invalid credential errors

conflicting tunnel processes

Operational Rules

Use:

one Cloudflare tunnel token

one launcher script

one startup method

one recovery method

Avoid:

mixing token mode with config-based tunnel mode

running multiple tunnel processes

leaving foreground tunnels attached to terminals

Public Hostnames

Cloudflare should route a public hostname to the tunnel.

Example structure:

creator.example.com
store.example.com
app.example.com

The tunnel forwards traffic to:

http://127.0.0.1:4000
Storefront Authority Rule

Buyer-facing URLs must resolve from the creator host exposed by the tunnel.

Examples:

https://creator.example.com/u/<creator>
https://creator.example.com/buy/<content>
https://creator.example.com/api/health

They must never resolve to:

localhost
127.0.0.1
provider host
Manual Tunnel Command

The token-based command to start the tunnel is:

cloudflared tunnel run --token <TUNNEL_TOKEN>

This command is useful for:

initial validation

troubleshooting

foreground testing

Successful startup usually logs messages such as:

Registered tunnel connection
protocol=quic
location=<region>
Foreground Run Warning

Running the tunnel manually like this:

cloudflared tunnel run --token <TOKEN>

keeps the process attached to the terminal.

If the terminal closes, the tunnel stops.

Persistent setups should use a startup script or system scheduler.

Linux / macOS Configuration
Verify Installation

Check the installed binary:

which cloudflared
cloudflared --version

Typical result:

/usr/local/bin/cloudflared
cloudflared version <version>
Local Cloudflare State

The Cloudflare state directory is typically:

~/.cloudflared

Token mode does not require:

config.yml
tunnel credential JSON files
token files
Run Script

Suggested location:

~/.local/bin/cloudflared-certifyd-run.sh

Script:

#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="$HOME/cloudflared.log"

if pgrep -x cloudflared >/dev/null 2>&1; then
  exit 0
fi

nohup cloudflared tunnel run --token <TUNNEL_TOKEN> >> "$LOG_FILE" 2>&1 &
disown || true
Make Script Executable
chmod +x ~/.local/bin/cloudflared-certifyd-run.sh
Startup Without systemd

Use cron if systemd is not available.

Edit crontab:

crontab -e

Add:

@reboot /home/<USER>/.local/bin/cloudflared-certifyd-run.sh
*/1 * * * * pgrep -x cloudflared >/dev/null 2>&1 || /home/<USER>/.local/bin/cloudflared-certifyd-run.sh

Replace <USER> with the local username.

macOS Startup Note

macOS can use the same run script. For automatic startup, it is recommended to call the script using a LaunchAgent.

Windows Configuration
Verify Installation

Check the binary:

where cloudflared
cloudflared --version

Typical locations include:

C:\Program Files\cloudflared\cloudflared.exe
C:\Program Files (x86)\cloudflared\cloudflared.exe
Local Cloudflare State

The Cloudflare directory is typically:

%USERPROFILE%\.cloudflared

Token mode does not require:

config.yml
tunnel credential JSON
token files
Run Script

Create:

C:\Users\<USER>\certifyd-cloudflared-start.cmd

Script:

@echo off
tasklist /FI "IMAGENAME eq cloudflared.exe" | find /I "cloudflared.exe" >nul
if %ERRORLEVEL%==0 exit /b 0

start "" /min cloudflared tunnel run --token <TUNNEL_TOKEN>
exit /b 0
Manual Start

Run from Command Prompt:

C:\Users\<USER>\certifyd-cloudflared-start.cmd
Persistent Startup

Use Windows Task Scheduler.

Create a task that:

runs at logon or startup

launches the script:

C:\Users\<USER>\certifyd-cloudflared-start.cmd

Recommended options:

run with highest privileges if needed

restart on failure

prevent multiple instances

Health Checks
Verify Local Certifyd Service
curl http://127.0.0.1:4000/api/health

Expected result:

healthy response
Verify Tunnel Process

Linux/macOS:

ps aux | grep cloudflared

Windows:

tasklist | findstr cloudflared
Verify Public Endpoint
curl -I https://creator.example.com/api/health

Expected:

HTTP/2 200
Common Warnings
ICMP Proxy Warning

Example:

ICMP proxy feature is disabled

This is not fatal for HTTP tunnels.

UDP Buffer Warning

Example:

failed to sufficiently increase receive buffer size

This warning is also not usually fatal. The tunnel can still operate normally.

Operational Best Practices

run only one tunnel process per machine

do not mix token mode with config-based tunnels

keep the local Certifyd service private

rotate tokens if exposed

verify automatic restart after reboot

Quick Recovery Checklist

If the public endpoint stops responding:

curl http://127.0.0.1:4000/api/health
ps aux | grep cloudflared
tail -n 100 ~/cloudflared.log
curl -I https://creator.example.com/api/health

Restart the tunnel if necessary using the startup script.

Final State Summary

A Certifyd creator storefront machine should:

run cloudflared

expose the storefront through a Cloudflare tunnel

forward traffic to 127.0.0.1:4000

restart automatically after reboot

recover automatically if the tunnel stops

This provides a stable public entry point for the Certifyd creator storefront while keeping the local service private.
