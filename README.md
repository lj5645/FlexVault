# FlexVault

Bitwarden-compatible self-hosted password manager. Fork of [NodeWarden](https://github.com/shuaiplus/nodewarden) with a Node.js self-hosted server that also runs in Docker, while keeping full Cloudflare Workers compatibility.

[中文文档](./README_ZH.md)

> **Disclaimer**
> This project is for learning and discussion purposes only. Please back up your vault regularly.
> This project is not affiliated with Bitwarden. Please do not report FlexVault issues to the official Bitwarden team.

---

## Features

- **Bitwarden-compatible API** — works with official Bitwarden clients (desktop, mobile, browser extension)
- **Web Vault** — original web UI included
- **Flexible deployment** — run the same server on Node.js (no Docker), in Docker, or on Cloudflare Workers
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

## Deployment Options

The same server code supports three deployment modes. Docker is optional — the
container runs the exact same Node.js process as the local start scripts.

| Mode | Best for | Entry point |
|------|----------|-------------|
| **Node.js** (no Docker) | Local machines, VMs, systemd/NSSM services | `start-selfhosted.sh` / `start-selfhosted.bat` |
| **Docker** | Reproducible container deployments | `Dockerfile.selfhosted` |
| **Cloudflare Workers** | Serverless hosting | `wrangler.toml` |

---

## Environment Variables

These apply to both the Node.js and Docker self-hosted modes.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | — | JWT signing secret, at least 32 characters |
| `DATABASE_PATH` | No | `./data/nodewarden.db` | SQLite database file path |
| `STORAGE_PATH` | No | `./data/attachments` | Attachment storage directory |
| `PORT` | No | `3000` | HTTP listen port |
| `HOST` | No | `0.0.0.0` | HTTP listen host |
| `HIDE_WEB_VAULT` | No | — | Set to `1` to hide the Web Vault (API still works) |
| `FRONTEND_PATH` | No | `./dist` locally, `/app/dist` in Docker | Frontend static file directory |
| `TRUST_PROXY` | No | `0` | Set to `1` only behind a proxy you control; enables `X-Forwarded-*` and `X-Real-IP` |
| `ALLOW_LEGACY_WS_QUERY_TOKEN` | No | `0` | Deprecated: accept access JWTs in the WebSocket query string |
| `MAX_UPLOAD_BYTES` | No | `104857600` | Hard cap for a request body / attachment upload |
| `WEBAUTHN_RP_ID` | No | — | WebAuthn relying party ID (public hostname) |
| `WEBAUTHN_RP_NAME` | No | `NodeWarden` | WebAuthn relying party display name |
| `WEBAUTHN_ALLOWED_ORIGINS` | No | — | Comma-separated WebAuthn origins allowed for official clients |

---

## Local Deployment (Node.js)

Docker is not required. Run the server directly with Node.js; the database and
attachments stay in local files.

Requirements: Node.js **22.19+ (22.x)** or **24.11+**, and npm.

```bash
git clone https://github.com/lj5645/FlexVault.git
cd FlexVault

npm install
npm run build                  # build the Web Vault into ./dist

cp .env.selfhosted.example .env   # Windows: the .bat file creates it on first run
# Edit .env and set JWT_SECRET to a random string of at least 32 characters.

# Linux / macOS
./start-selfhosted.sh

# Windows (Command Prompt, or double-click the .bat file)
start-selfhosted.bat
```

Open `http://localhost:3000` and create your admin account.

The start scripts load `.env` automatically. On the first run, if `.env` does
not exist, they copy `.env.selfhosted.example`, print a reminder, and exit;
edit the file and run the script again.

Default paths:

- Web Vault: `./dist` (`FRONTEND_PATH`)
- Database: `./data/nodewarden.db` (`DATABASE_PATH`)
- Attachments: `./data/attachments` (`STORAGE_PATH`)

Set `HIDE_WEB_VAULT=1` to serve the API only. To keep it running in production,
use systemd, pm2, or NSSM, and put HTTPS in front of it (see
[Reverse proxy and HTTPS](#reverse-proxy-and-https)).

If you prefer to start it manually:

```bash
npx tsx --loader ./src/selfhosted/cloudflare-workers-loader.mjs ./src/selfhosted/index.ts
```

---

## Docker Deployment

```bash
docker run -d \
  --name flexvault \
  -p 3000:3000 \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -v nodewarden-data:/app/data \
  --restart unless-stopped \
  registry.cn-guangzhou.aliyuncs.com/myskyts/flexvault:latest
```

Open `http://localhost:3000` and create your admin account. The image bundles the
Web Vault (`FRONTEND_PATH=/app/dist`), so a single container serves both the UI
and the API. The image runs the same Node.js server as the local start scripts.

> Accessing FlexVault from another machine requires HTTPS: browsers only expose
> `crypto.subtle` (used for client-side vault encryption) in a secure context.
> See [Reverse proxy and HTTPS](#reverse-proxy-and-https).

---

## Docker Compose

```yaml
services:
  flexvault:
    image: registry.cn-guangzhou.aliyuncs.com/myskyts/flexvault:latest
    ports:
      - "3000:3000"
    environment:
      JWT_SECRET: "your-secret-at-least-32-chars"
      # Set to 1 only when TLS is terminated by a reverse proxy you control.
      TRUST_PROXY: "1"
      WEBAUTHN_RP_ID: "vault.example.com"
      WEBAUTHN_ALLOWED_ORIGINS: "https://vault.example.com"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

> When using a bind mount (`./data:/app/data`), make sure the host directory is
> writable by UID/GID 1000 (`chown -R 1000:1000 ./data`); the container runs as
> the unprivileged `node` user. Named volumes are initialized with the correct
> ownership automatically.

---

## Reverse proxy and HTTPS

Browsers only expose `crypto.subtle` in a secure context, so the Web Vault must
be served over HTTPS unless you access it via `localhost`. Terminate TLS in a
reverse proxy and forward to the container:

```nginx
server {
  listen 443 ssl;
  server_name vault.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;

    # Required for Bitwarden's SignalR notifications.
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;

    # Keep this in sync with MAX_UPLOAD_BYTES.
    client_max_body_size 100m;
  }
}
```

Set `TRUST_PROXY=1` **only** when such a proxy is in front of the container.
Without it, FlexVault ignores `X-Forwarded-*`/`X-Real-IP` and uses the socket
address, which prevents clients from bypassing per-IP rate limits by spoofing
headers.

> The self-hosted notification hub keeps WebSocket connections in process
> memory. Run a single replica; if you put multiple replicas behind a load
> balancer, enable sticky sessions. Horizontal scaling requires an external
> pub/sub adapter and is not supported out of the box.

---

## Build Docker Image

This repo includes a GitHub Actions workflow (`.github/workflows/docker.yml`) for manual image build and push to Aliyun ACR.

To build locally:

```bash
docker build -f Dockerfile.selfhosted -t flexvault:latest .
```

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
