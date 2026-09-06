# FlexVault

Bitwarden 兼容的自托管密码管理器。基于 [NodeWarden](https://github.com/shuaiplus/nodewarden) 开发，新增 Node.js / Docker 自托管部署能力，同时保持 Cloudflare Workers 部署模式完全兼容。

> **免责声明**
> 本项目仅供学习与交流使用，请定期备份你的密码库。
> 本项目与 Bitwarden 官方无关，请不要向 Bitwarden 官方反馈 FlexVault 的问题。

---

## 主要特性

- **Bitwarden 兼容 API** — 支持官方 Bitwarden 客户端（桌面端、移动端、浏览器扩展）
- **Web Vault** — 包含原创网页密码库界面
- **双部署模式** — Cloudflare Workers（原始模式）或 Node.js / Docker（自托管模式）
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

## 快速开始（Docker）

```bash
docker run -d \
  --name flexvault \
  -p 3000:3000 \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -v flexvault-data:/app/data \
  --restart unless-stopped \
  registry.cn-guangzhou.aliyuncs.com/myskyts/nodewarden:latest
```

打开 `http://localhost:3000` 创建管理员账号。

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `JWT_SECRET` | 是 | — | JWT 签名密钥，至少 32 个字符 |
| `DATABASE_PATH` | 否 | `./data/nodewarden.db` | SQLite 数据库文件路径 |
| `STORAGE_PATH` | 否 | `./data/attachments` | 附件存储目录 |
| `PORT` | 否 | `3000` | HTTP 监听端口 |
| `HOST` | 否 | `0.0.0.0` | HTTP 监听地址 |
| `HIDE_WEB_VAULT` | 否 | — | 设为 `1` 隐藏 Web Vault（API 仍可用） |
| `FRONTEND_PATH` | 否 | — | 自定义前端静态文件路径 |

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

## 构建 Docker 镜像

本仓库包含 GitHub Actions 工作流（`.github/workflows/docker.yml`），支持手动构建并推送到阿里云 ACR。

本地构建：

```bash
docker build -f Dockerfile.selfhosted -t flexvault:latest .
```

---

## 本地开发（Node.js）

```bash
git clone https://github.com/lj5645/FlexVault.git
cd FlexVault
npm install

# 设置必需的环境变量
export JWT_SECRET="your-secret-at-least-32-chars"

# 使用 tsx 运行
npx tsx --loader ./src/selfhosted/cloudflare-workers-loader.mjs ./src/selfhosted/index.ts
```

需要 Node.js 22+。

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
