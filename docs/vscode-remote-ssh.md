# VS Code Remote-SSH Workflow

This document describes the recommended way to work directly on the edge server filesystem from VS Code.

## Why

- Edit and debug files in-place on the server (`/home/zmartify/zmartify-edge`).
- Avoid file drift between local and server copies.
- Run build/test/deploy commands in the exact runtime environment.

## Prerequisites

- Local VS Code extension: `ms-vscode-remote.remote-ssh`
- SSH host aliases in `~/.ssh/config`:

```sshconfig
Host zmartify-edge
  HostName zmartify-edge
  User zmartify

Host zmartify-edge-public
  HostName pilot.zmartify.dk
  User zmartify
```

Use `zmartify-edge` on LAN when possible. Use `zmartify-edge-public` only when remote access is needed.

## Connect

1. Open Command Palette.
2. Run `Remote-SSH: Connect to Host...`.
3. Select `zmartify-edge`.
4. Open folder `/home/zmartify/zmartify-edge`.

## Recommended Daily Flow

1. Pull latest changes in the remote terminal.
2. Make and test changes on the remote workspace.
3. Build before commit for touched apps/services.
4. Commit from your local Git identity settings (inside the remote VS Code session).

## Best Practices

- Keep production config and secrets out of Git.
- Stage only intended files (`git add <file>`), then review with `git diff --staged`.
- Prefer small, focused commits.
- Run at least one relevant validation command before commit:
  - `cd zmartify-admin && npm run build`
  - `cd admin-ui && npm run build`
  - `cd zmartify-edge-api && pytest -q` (when backend files change)
- Verify runtime services after deploy:
  - `docker compose ps`
  - `curl -k https://localhost/health`

## Notes

- `zmartify-admin` currently warns if Node < 22 because of Capacitor CLI engine requirements. Builds can still succeed on Node 20 in current setup.
- For MQTT TLS in this deployment, Mosquitto reads certs from `mosquitto/config/tls` (copied from Let's Encrypt paths).