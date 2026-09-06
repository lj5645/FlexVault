# FlexVault

Bitwarden-compatible self-hosted password manager. Fork of [NodeWarden](https://github.com/shuaiplus/nodewarden) with added Node.js / Docker self-hosted deployment support, while keeping full Cloudflare Workers compatibility.

[中文文档](./README_ZH.md)

> **Disclaimer**
> This project is for learning and discussion purposes only. Please back up your vault regularly.
> This project is not affiliated with Bitwarden. Please do not report FlexVault issues to the official Bitwarden team.

---

## Features

- **Bitwarden-compatible API** — works with official Bitwarden clients (desktop, mobile, browser extension)
- **Web Vault** — original web UI included
- **Dual deployment modes** — Cloudflare Workers (original) or Node.js / Docker (self-hosted)
- **SQLite storage** — local file-based database via `@libsql/client`, no external DB required
- **File system storage** — attachments stored on local disk (R2-compatible adapter)
- **WebSocket notifications** — real-time sync across devices (Durable Object replacement)
- **TOTP / Passkey / WebAuthn** — full 2FA and passwordless auth support
- **Backup center** — WebDAV / S3 scheduled incremental backups
- **Import / Export** — Bitwarden JSON / CSV / ZIP
- **Multi-user** — invite-code registration
- **Domain rules** — equivalent domains, global exclusions
- **PWA / offline mode** — installable, works offline

---

## Quick Start (Docker)

```bash
docker run -d \
  --name flexvault \
  -p 3000:3000 \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -v flexvault-data:/app/data \
  --restart unless-stopped \
  registry.cn-guangzhou.aliyuncs.com/myskyts/nodewarden:latest
```

Open `http://localhost:3000` and create your admin account.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | — | JWT signing secret, at least 32 characters |
| `DATABASE_PATH` | No | `./data/nodewarden.db` | SQLite database file path |
| `STORAGE_PATH` | No | `./data/attachments` | Attachment storage directory |
| `PORT` | No | `3000` | HTTP listen port |
| `HOST` | No | `0.0.0.0` | HTTP listen host |
| `HIDE_WEB_VAULT` | No | — | Set to `1` to hide the Web Vault (API still works) |
| `FRONTEND_PATH` | No | — | Custom frontend static file path |

---

## Docker Compose

```yaml
services:
  flexvault:
    image: registry.cn-guangzhou.aliyuncs.com/myskyts/nodewarden:latest
    ports:
      - "3000:3000"
    environment:
      JWT_SECRET: "your-secret-at-least-32-chars"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

---

## Build Docker Image

This repo includes a GitHub Actions workflow (`.github/workflows/docker.yml`) for manual image build and push to Aliyun ACR.

To build locally:

```bash
docker build -f Dockerfile.selfhosted -t flexvault:latest .
```

---

## Local Development (Node.js)

```bash
git clone https://github.com/lj5645/FlexVault.git
cd FlexVault
npm install

# Set required env
export JWT_SECRET="your-secret-at-least-32-chars"

# Run with tsx
npx tsx --loader ./src/selfhosted/cloudflare-workers-loader.mjs ./src/selfhosted/index.ts
```

Requires Node.js 22+.

---

## Cloudflare Workers Deployment

The original Cloudflare Workers deployment is fully supported. See `wrangler.toml` for configuration.

```bash
npm install
npx wrangler login
npm run build
npm run deploy
```

---

## Tested Clients

- Windows desktop
- Mobile app (iOS / Android)
- Browser extension (Chrome / Firefox / Edge)
- Linux desktop
- Web Vault (browser)

---

## License

LGPL-3.0 License

---

## Credits

- [NodeWarden](https://github.com/shuaiplus/nodewarden) — Upstream project
- [Bitwarden](https://bitwarden.com/) — Original design and clients
- [Vaultwarden](https://github.com/dani-garcia/vaultwarden) — Server implementation reference
- [Cloudflare Workers](https://workers.cloudflare.com/) — Serverless platform
