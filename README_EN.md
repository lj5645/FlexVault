<p align="center">
  <img src="./NodeWarden.png" alt="FlexVault Logo" />
</p>

<p align="center">
  Flexible Bitwarden-compatible password manager server - Supports both Cloudflare Workers and Node.js deployment
</p>

[![Powered by Cloudflare](https://img.shields.io/badge/Powered%20by-Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: LGPL-3.0](https://img.shields.io/badge/License-LGPL--3.0-2ea44f)](./LICENSE)

[Report an Issue](https://github.com/lj5645/FlexVault/issues/new/choose)

> **Disclaimer**
>
> This project is for learning and discussion purposes only. Please back up your vault regularly.
>
> This project is not affiliated with Bitwarden. Please do not report FlexVault issues to the official Bitwarden team.

---

## Feature Comparison with Official Bitwarden Server

| Capability | Bitwarden | FlexVault | Notes |
|---|---|---|---|
| Web Vault | ✅ | ✅ | **Original Web Vault interface** |
| Full sync `/api/sync` | ✅ | ✅ | Compatibility optimized for official clients |
| Attachment upload / download | ✅ | ✅ | Cloudflare R2 / KV or local file system |
| Send | ✅ | ✅ | Supports both text and file Sends |
| Import / Export | ✅ | ✅ | Supports Bitwarden JSON / CSV / **ZIP import with attachments** |
| **Cloud Backup Center** | ❌ | ✅ | **Scheduled backup to WebDAV / E3** |
| Password hint (web) | ⚠️ Limited | ✅ | **No email required** |
| TOTP / Steam TOTP | ✅ | ✅ | Includes `steam://` support |
| Multi-user | ✅ | ✅ | Invite-based registration |
| Organizations / Collections / Member roles | ✅ | ❌ | Not implemented |
| Login 2FA | ✅ | ⚠️ Partial | Currently only user-level TOTP |
| SSO / SCIM / Enterprise directory | ✅ | ❌ | Not implemented |

---

## Tested Clients

- ✅ Windows desktop client
- ✅ Mobile app
- ✅ Browser extension
- ✅ Linux desktop client
- ⚠️ macOS desktop client has not been fully verified yet

---

## Deployment Methods

FlexVault supports two deployment methods:

| Deployment Method | Use Case | Advantages | Disadvantages |
|---|---|---|---|
| **Cloudflare Workers** | Serverless, edge computing | Global CDN, auto-scaling, generous free tier | Requires Cloudflare account |
| **Node.js Self-hosted** | Private servers, intranet deployment | Full control, no external dependencies | Requires server maintenance |

---

## Method 1: Cloudflare Workers Deployment

### Web Deploy

1. Fork the `FlexVault` repository to your GitHub account
2. Go to [Cloudflare Workers creation page](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create)
3. Select `Continue with GitHub`
4. Select your forked repository
5. Continue with default configuration
6. If you plan to use KV mode, change the deploy command to `npm run deploy:kv`
7. After deployment completes, open the generated Workers URL
8. Set `JWT_SECRET` as prompted. Do not use a temporary random value. This value is critical for token security - use at least 32 random characters in production.

> [!TIP]
> Difference between default R2 and optional KV:
>
> | Storage | Card Required | Single attachment/Send file limit | Free Tier |
> |---|---|---|---|
> | R2 | Yes | 100 MB (soft limit, adjustable) | 10 GB |
> | KV | No | 25 MiB (Cloudflare limit) | 1 GB |

### CLI Deploy

```powershell
git clone https://github.com/lj5645/FlexVault.git
cd FlexVault

npm install
npx wrangler login

# Default: R2 mode
npm run deploy

# Optional: KV mode
npm run deploy:kv

# Local development
npm run dev
npm run dev:kv
```

---

## Method 2: Node.js Self-hosted Deployment

### Requirements

| Requirement | Description |
|---|---|
| **Node.js** | >= 18.0.0 (LTS version recommended) |
| **Operating System** | Windows / Linux / macOS |
| **Disk Space** | At least 1GB (for database and attachment storage) |
| **Memory** | 512MB or more recommended |

---

### Detailed Deployment Steps

#### Step 1: Install Node.js

**Windows:**

1. Visit [Node.js official website](https://nodejs.org/)
2. Download the LTS (Long Term Support) version installer
3. Run the installer with default options
4. Open PowerShell and verify installation:
   ```powershell
   node --version
   npm --version
   ```

**Linux (Ubuntu/Debian):**

```bash
# Install Node.js 20 LTS using NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

**macOS:**

```bash
# Install using Homebrew
brew install node

# Verify installation
node --version
npm --version
```

---

#### Step 2: Download Project Code

**Option A: Clone with Git (Recommended)**

```bash
# Install Git if not already installed
# Windows: Download from https://git-scm.com/download/win
# Linux: sudo apt install git
# macOS: brew install git

# Clone the project
git clone https://github.com/lj5645/FlexVault.git

# Enter project directory
cd FlexVault
```

**Option B: Download ZIP directly**

1. Visit https://github.com/lj5645/FlexVault
2. Click the green `Code` button → `Download ZIP`
3. Extract the downloaded file
4. Open terminal in the extracted directory

---

#### Step 3: Install Dependencies

```bash
# Run in project root directory
npm install
```

Wait for dependencies to install, typically 1-3 minutes.

---

#### Step 4: Configure Environment Variables

**Create configuration file:**

```bash
# Copy example configuration file
cp .env.selfhosted.example .env
```

**Edit `.env` file:**

Open the `.env` file with any text editor and configure the following parameters:

```env
# ============================================
# Required Configuration
# ============================================

# JWT Secret - Used for signing authentication tokens
# ⚠️ Important: Must be at least 32 characters, random string recommended
# Generate with: openssl rand -base64 32
# Or online: https://www.random.org/strings/
JWT_SECRET=your-secure-jwt-secret-at-least-32-characters-long

# ============================================
# Optional Configuration (use defaults)
# ============================================

# TOTP Secret - Server-side two-factor authentication
# TOTP_SECRET=your-totp-secret

# Database storage path
# Default: ./data/nodewarden.db
DATABASE_PATH=./data/nodewarden.db

# Attachment storage path
# Default: ./data/attachments
STORAGE_PATH=./data/attachments

# Server listen port
# Default: 3000
PORT=3000

# Server listen address
# Default: 0.0.0.0 (listen on all interfaces)
# Set to 127.0.0.1 for localhost only
HOST=0.0.0.0

# Frontend static files path (optional)
# Set to built frontend path to serve Web Vault
# FRONTEND_PATH=./dist
```

**Generate secure JWT_SECRET:**

```bash
# Linux/macOS
openssl rand -base64 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

#### Step 5: Start the Server

**Development mode (recommended for first test):**

```bash
npm run dev:selfhosted
```

Development mode features:
- Automatically restarts on file changes
- Shows detailed debug logs
- Suitable for development and debugging

**Production mode:**

```bash
npm run start:selfhosted
```

**Successful startup indicator:**

```
NodeWarden self-hosted server running at http://0.0.0.0:3000
```

---

#### Step 6: Verify Service is Running

**Test API endpoints:**

```bash
# Get server version
curl http://localhost:3000/api/version

# Get server configuration
curl http://localhost:3000/api/config
```

**Expected response:**

```json
{
  "version": "2026.1.0",
  ...
}
```

---

#### Step 7: Configure Client

Configure the self-hosted server in Bitwarden official client:

1. Open Bitwarden client
2. Click **Settings** (gear icon) in the top left
3. Find **Server** settings
4. Select **Self-hosted**
5. Enter server URL: `http://your-server-ip:3000`
6. Click Save

**Supported clients:**
- ✅ Windows desktop
- ✅ macOS desktop
- ✅ Linux desktop
- ✅ iOS App
- ✅ Android App
- ✅ Browser extension

---

### Docker Deployment

#### Using Aliyun Image (Recommended)

Pull the pre-built image directly, no local build required:

```bash
# Pull image
docker pull registry.cn-guangzhou.aliyuncs.com/myskyts/flexvault:latest

# Run container
docker run -d \
  --name flexvault \
  -p 3000:3000 \
  -e JWT_SECRET=your-secure-jwt-secret-at-least-32-characters-long \
  -v flexvault-data:/app/data \
  registry.cn-guangzhou.aliyuncs.com/myskyts/flexvault:latest
```

**Using Docker Compose:**

Create `docker-compose.yml` file:

```yaml
version: '3.8'
services:
  flexvault:
    image: registry.cn-guangzhou.aliyuncs.com/myskyts/flexvault:latest
    container_name: flexvault
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - JWT_SECRET=your-secure-jwt-secret-at-least-32-characters-long
    volumes:
      - flexvault-data:/app/data

volumes:
  flexvault-data:
```

```bash
# Start service
docker-compose up -d
```

---

### Production Recommendations

#### Use Process Manager

**Using PM2 (Recommended):**

```bash
# Install PM2
npm install -g pm2

# Start service
pm2 start "npm run start:selfhosted" --name flexvault

# View status
pm2 status

# View logs
pm2 logs flexvault

# Set up startup on boot
pm2 startup
pm2 save

# Restart service
pm2 restart flexvault

# Stop service
pm2 stop flexvault
```

**Using systemd (Linux):**

Create service file `/etc/systemd/system/flexvault.service`:

```ini
[Unit]
Description=FlexVault Password Manager
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/FlexVault
ExecStart=/usr/bin/node /path/to/FlexVault/node_modules/.bin/tsx src/selfhosted/index.ts
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# Start service
sudo systemctl start flexvault

# Enable startup on boot
sudo systemctl enable flexvault

# View status
sudo systemctl status flexvault
```

#### Data Backup

```bash
# Manual backup
tar -czvf flexvault-backup-$(date +%Y%m%d).tar.gz data/

# Scheduled backup (using crontab)
crontab -e

# Backup daily at 3 AM
0 3 * * * cd /path/to/FlexVault && tar -czvf /backup/flexvault-$(date +\%Y\%m\%d).tar.gz data/
```

---

## Architecture

### Cloudflare Workers Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge Network                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Workers   │  │   D1 DB     │  │    R2 / KV          │  │
│  │  (Compute)  │  │  (SQLite)   │  │   (Object Storage)  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Durable Objects (WebSocket Notifications)  ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Node.js Self-hosted Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Node.js Server                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  HTTP/WSS   │  │   SQLite    │  │    File System      │  │
│  │  (Service)  │  │  (libsql)   │  │ (Attachment Storage)│  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              WebSocket Server (Real-time Notifications) ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              node-cron (Scheduled Backup Tasks)         ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Feature Comparison

| Feature | Cloudflare Workers | Node.js Self-hosted |
|---|---|---|
| Database | D1 (Distributed SQLite) | SQLite (libsql) |
| File Storage | R2 / KV | Local file system |
| Real-time Notifications | Durable Objects | WebSocket server |
| Scheduled Tasks | Cron Triggers | node-cron |
| Caching | Cache API | Memory cache |
| Scalability | Auto-scaling | Manual scaling |
| Cost | Free within tier | Server cost |

---

## Cloud Backup Notes

- Remote backup supports **WebDAV** and **E3**
- When `Include attachments` is enabled:
  - ZIP still contains only `db.json` and `manifest.json`
  - Actual attachments are stored separately in `attachments/`
  - Subsequent backups reuse existing attachments by stable blob name, no full re-upload
- During remote restore:
  - Required attachments are loaded from `attachments/` on demand
  - Missing attachments are safely skipped
  - Skipped attachments do not leave broken records in restored database

---

## Import / Export

Current supported import sources include:

- Bitwarden JSON
- Bitwarden CSV
- Bitwarden vault + attachments ZIP
- FlexVault JSON
- Multiple browser / password-manager formats available in the web import selector

Current supported export formats include:

- Bitwarden JSON
- Bitwarden encrypted JSON
- ZIP export with attachments
- FlexVault JSON variants
- Full manual instance export from the backup center

---

## Development

### Project Structure

```
FlexVault/
├── src/
│   ├── index.ts              # Core business logic
│   ├── worker.ts             # Cloudflare Workers entry
│   ├── router.ts             # Route handling
│   ├── handlers/             # Business handlers
│   ├── services/             # Service layer
│   ├── durable/              # Durable Objects
│   │   ├── notifications-hub.ts  # Cloudflare DO
│   │   └── notifications.ts      # Platform-agnostic notification functions
│   └── selfhosted/           # Node.js adapter layer
│       ├── index.ts          # Node.js entry
│       ├── database.ts       # SQLite adapter
│       ├── storage.ts        # File storage adapter
│       ├── websocket.ts      # WebSocket server
│       ├── cache-polyfill.ts # Memory cache
│       └── env.ts            # Environment configuration
├── webapp/                   # Frontend Web Vault
├── migrations/               # Database migrations
├── shared/                   # Shared code
├── wrangler.toml             # Cloudflare config (R2)
├── wrangler.kv.toml          # Cloudflare config (KV)
├── tsconfig.selfhosted.json  # TypeScript config
├── Dockerfile.selfhosted     # Docker build file
└── docker-compose.selfhosted.yml
```

### Local Development Commands

```bash
# Cloudflare Workers development
npm run dev          # R2 mode
npm run dev:kv       # KV mode

# Node.js self-hosted development
npm run dev:selfhosted

# Build frontend
npm run build

# Type check
npm run build:selfhosted
```

---

## License

LGPL-3.0 License

---

## Credits

- [NodeWarden](https://github.com/shuaiplus/nodewarden) - Original NodeWarden project, this project adds Node.js self-hosted support based on it
