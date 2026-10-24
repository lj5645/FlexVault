# FlexVault

Bitwarden 兼容的自托管密码管理器。基于 [NodeWarden](https://github.com/shuaiplus/nodewarden) 开发，提供可独立运行的 Node.js 自托管服务（也可用 Docker 运行），同时保持 Cloudflare Workers 部署模式完全兼容。

> **免责声明**
> 本项目仅供学习与交流使用，请定期备份你的密码库。
> 本项目与 Bitwarden 官方无关，请不要向 Bitwarden 官方反馈 FlexVault 的问题。

---

## 主要特性

- **Bitwarden 兼容 API** — 支持官方 Bitwarden 客户端（桌面端、移动端、浏览器扩展）
- **Web Vault** — 包含原创网页密码库界面
- **灵活部署** — 同一套服务端代码支持 Node.js（无需 Docker）、Docker 和 Cloudflare Workers 三种方式
- **SQLite 存储** — 基于 `@libsql/client` 的本地文件数据库，无需外部数据库
- **文件系统存储** — 附件存储在本地磁盘（R2 兼容适配器）
- **WebSocket 通知** — 跨设备实时同步（Durable Object 替代方案）
- **TOTP / Passkey / WebAuthn** — 完整的 2FA 和无密码认证支持
- **备份中心** — WebDAV / S3 定时增量备份
- **导入 / 导出** — Bitwarden JSON / CSV / ZIP
- **多用户** — 邀请码注册
- **域名规则** — 等效域名、全局域名排除
- **PWA / 离线模式** — 可安装、支持离线使用

---

## 部署方式

同一套服务端代码支持三种部署方式。Docker 不是必需的——容器里运行的也是和本地
启动脚本完全相同的 Node.js 进程。

| 方式 | 适用场景 | 入口 |
|------|----------|------|
| **Node.js**（无需 Docker） | 本地机器、虚拟机、systemd/NSSM 服务 | `start-selfhosted.sh` / `start-selfhosted.bat` |
| **Docker** | 需要可复现的容器部署 | `Dockerfile.selfhosted` |
| **Cloudflare Workers** | 无服务器托管 | `wrangler.toml` |

---

## 环境变量

以下变量对 Node.js 和 Docker 两种自托管方式都适用。

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `JWT_SECRET` | 是 | — | JWT 签名密钥，至少 32 个字符 |
| `DATABASE_PATH` | 否 | `./data/nodewarden.db` | SQLite 数据库文件路径 |
| `STORAGE_PATH` | 否 | `./data/attachments` | 附件存储目录 |
| `PORT` | 否 | `3000` | HTTP 监听端口 |
| `HOST` | 否 | `0.0.0.0` | HTTP 监听地址 |
| `HIDE_WEB_VAULT` | 否 | — | 设为 `1` 隐藏 Web Vault（API 仍可用） |
| `FRONTEND_PATH` | 否 | 本地 `./dist`，Docker 内 `/app/dist` | 前端静态文件目录 |
| `TRUST_PROXY` | 否 | `0` | 仅在受控反向代理后设为 `1`，启用 `X-Forwarded-*` / `X-Real-IP` |
| `ALLOW_LEGACY_WS_QUERY_TOKEN` | 否 | `0` | 已弃用：允许 WebSocket 查询串携带 access JWT |
| `MAX_UPLOAD_BYTES` | 否 | `104857600` | 单次请求体/附件上传硬上限 |
| `WEBAUTHN_RP_ID` | 否 | — | WebAuthn 依赖方 ID（公网域名） |
| `WEBAUTHN_RP_NAME` | 否 | `NodeWarden` | WebAuthn 依赖方显示名称 |
| `WEBAUTHN_ALLOWED_ORIGINS` | 否 | — | 允许官方客户端使用 WebAuthn 的来源，逗号分隔 |

---

## 本地部署（Node.js）

不需要 Docker，直接用 Node.js 运行服务，数据库和附件保存在本地文件。

要求：Node.js **22.19+（22.x 系列）**或 **24.11+**，以及 npm。

```bash
git clone https://github.com/lj5645/FlexVault.git
cd FlexVault

npm install
npm run build                  # 构建 Web Vault 到 ./dist

cp .env.selfhosted.example .env   # Windows 用户：.bat 首次运行会自动创建
# 编辑 .env，把 JWT_SECRET 改成至少 32 个字符的随机字符串

# Linux / macOS
./start-selfhosted.sh

# Windows（在命令提示符中运行，或直接双击 .bat 文件）
start-selfhosted.bat
```

打开 `http://localhost:3000` 创建管理员账号。

启动脚本会自动加载 `.env`。首次运行时如果 `.env` 不存在，脚本会复制
`.env.selfhosted.example`、给出提示后退出；编辑好文件再运行一次即可。

默认路径：

- Web Vault：`./dist`（`FRONTEND_PATH`）
- 数据库：`./data/nodewarden.db`（`DATABASE_PATH`）
- 附件：`./data/attachments`（`STORAGE_PATH`）

设置 `HIDE_WEB_VAULT=1` 可以只提供 API、不提供网页界面。生产环境建议用
systemd、pm2 或 NSSM 托管进程，并在前面配置 HTTPS（见
[反向代理与 HTTPS](#反向代理与-https)）。

如果你想手动启动：

```bash
npx tsx --loader ./src/selfhosted/cloudflare-workers-loader.mjs ./src/selfhosted/index.ts
```

---

## Docker 部署

```bash
docker run -d \
  --name flexvault \
  -p 3000:3000 \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -v nodewarden-data:/app/data \
  --restart unless-stopped \
  registry.cn-guangzhou.aliyuncs.com/myskyts/flexvault:latest
```

打开 `http://localhost:3000` 创建管理员账号。镜像已内置 Web Vault
（`FRONTEND_PATH=/app/dist`），单容器即可同时提供界面和 API。镜像运行的
就是与本地启动脚本相同的 Node.js 服务。

> 从其他机器访问时必须使用 HTTPS：浏览器只在安全上下文中提供
> `crypto.subtle`（客户端加密依赖它）。参见[反向代理与 HTTPS](#反向代理与-https)。

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
      # 仅在受控反向代理终止 TLS 时设为 1
      TRUST_PROXY: "1"
      WEBAUTHN_RP_ID: "vault.example.com"
      WEBAUTHN_ALLOWED_ORIGINS: "https://vault.example.com"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

> 使用 bind mount（`./data:/app/data`）时，请确保宿主机目录对 UID/GID 1000
> 可写（`chown -R 1000:1000 ./data`）；容器以非特权 `node` 用户运行。命名卷会
> 自动继承镜像内的属主。

---

## 反向代理与 HTTPS

浏览器只在安全上下文中提供 `crypto.subtle`，因此除 `localhost` 外，Web Vault
必须通过 HTTPS 访问。建议由反向代理终止 TLS：

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

    # Bitwarden SignalR 通知需要 WebSocket 升级
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;

    # 与 MAX_UPLOAD_BYTES 保持一致
    client_max_body_size 100m;
  }
}
```

**仅当**容器确实位于此类代理之后时才设置 `TRUST_PROXY=1`。未开启时，
FlexVault 会忽略 `X-Forwarded-*` / `X-Real-IP` 并使用 socket 地址，防止客户端
伪造请求头绕过按 IP 的限流。

> 自托管通知中心把 WebSocket 连接保存在进程内存中。请保持单副本运行；若必须
> 多副本，请在负载均衡器上启用会话粘滞。水平扩展需要外部 pub/sub 适配器，当前
> 版本不内置。

---

## 构建 Docker 镜像

本仓库包含 GitHub Actions 工作流（`.github/workflows/docker.yml`），支持手动构建并推送到阿里云 ACR。

本地构建：

```bash
docker build -f Dockerfile.selfhosted -t flexvault:latest .
```

---

## Cloudflare Workers 部署

原始的 Cloudflare Workers 部署模式完全支持，配置见 `wrangler.toml`。

```bash
npm install
npx wrangler login
npm run build
npm run deploy
```

---

## 已测试客户端

- Windows 桌面端
- 移动端 App（iOS / Android）
- 浏览器扩展（Chrome / Firefox / Edge）
- Linux 桌面端
- Web Vault（浏览器）

---

## 开源协议

LGPL-3.0 License

---

## 致谢

- [NodeWarden](https://github.com/shuaiplus/nodewarden) — 上游项目
- [Bitwarden](https://bitwarden.com/) — 原始设计与客户端
- [Vaultwarden](https://github.com/dani-garcia/vaultwarden) — 服务端实现参考
- [Cloudflare Workers](https://workers.cloudflare.com/) — 无服务器平台
