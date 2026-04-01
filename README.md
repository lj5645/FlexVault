<p align="center">
  <img src="./NodeWarden.png" alt="NodeWarden Logo" />
</p>

<p align="center">
  运行在 Cloudflare Workers 或 Node.js 上的第三方 Bitwarden 兼容服务端。
</p>

[![Powered by Cloudflare](https://img.shields.io/badge/Powered%20by-Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: LGPL-3.0](https://img.shields.io/badge/License-LGPL--3.0-2ea44f)](./LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/shuaiplus/NodeWarden?display_name=tag)](https://github.com/shuaiplus/NodeWarden/releases/latest)
[![Sync Upstream](https://github.com/shuaiplus/NodeWarden/actions/workflows/sync-upstream.yml/badge.svg)](https://github.com/shuaiplus/NodeWarden/actions/workflows/sync-upstream.yml)

[更新日志](./RELEASE_NOTES.md) | [提交问题](https://github.com/shuaiplus/NodeWarden/issues/new/choose) | [最新发布](https://github.com/shuaiplus/NodeWarden/releases/latest)

English: [`README_EN.md`](./README_EN.md)

> **免责声明**  
> 本项目仅供学习与交流使用，请定期备份你的密码库。  
> 本项目与 Bitwarden 官方无关，请不要向 Bitwarden 官方反馈 NodeWarden 的问题。

---

## 与 Bitwarden 官方服务端能力对比

| 能力 | Bitwarden | NodeWarden | 说明 |
|---|---|---|---|
| 网页密码库 | ✅ | ✅ | **原创Web Vault界面** |
| 全量同步 `/api/sync` | ✅ | ✅ | 已针对官方客户端做兼容优化 |
| 附件上传 / 下载 | ✅ | ✅ | Cloudflare R2 / KV 或本地文件系统 |
| Send | ✅ | ✅ | 支持文本与文件 Send |
| 导入 / 导出 | ✅ | ✅ | 支持 Bitwarden JSON / CSV / **ZIP 导入（包括附件）** |
| **云端备份中心** | ❌ | ✅ | **支持 WebDAV / E3 定时备份** |
| 密码提示（网页端） | ⚠️ 有限 | ✅ | **无需发送邮件** |
| TOTP / Steam TOTP | ✅ | ✅ | 含 `steam://` 支持 |
| 多用户 | ✅ | ✅ | 支持邀请码注册 |
| 组织 / 集合 / 成员权限 | ✅ | ❌ | 未实现 |
| 登录 2FA | ✅ | ⚠️ 部分支持 | 当前仅支持用户级 TOTP |
| SSO / SCIM / 企业目录 | ✅ | ❌ | 未实现 |

---

## 已测试客户端

- ✅ Windows 桌面端
- ✅ 手机 App
- ✅ 浏览器扩展
- ✅ Linux 桌面端
- ⚠️ macOS 桌面端尚未完整验证

---

## 部署方式

NodeWarden 支持两种部署方式：

| 部署方式 | 适用场景 | 优势 | 劣势 |
|---------|---------|------|------|
| **Cloudflare Workers** | 无服务器、边缘计算 | 全球 CDN、自动扩展、免费额度充足 | 需要 Cloudflare 账号 |
| **Node.js 自托管** | 私有服务器、内网部署 | 完全自主控制、无外部依赖 | 需要自行维护服务器 |

---

## 方式一：Cloudflare Workers 部署

### 网页部署

1. Fork `NodeWarden` 仓库到自己的 GitHub 账号
2. 进入  [Cloudflare Workers 创建页面](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create)
3. 选择 `Continue with GitHub`
4. 选择你刚刚 Fork 的仓库
5. 保持默认配置继续部署
6. 如果你打算用 KV 模式，把部署命令改成 `npm run deploy:kv`
7. 等部署完成后，打开生成的 Workers 域名
8. 根据页面提示设置`JWT_SECRET` ，不建议临时乱填。这个值直接关系到令牌签发安全，正式环境至少使用 32 个字符以上的随机字符串。

> [!TIP] 
> 默认R2与可选KV的区别：
>   | 储存 | 是否需绑卡 | 单个附件/Send文件上限 | 免费额度 |
>   |---|---|---|---|
>   | R2 | 需要 | 100 MB（软限制可更改） | 10 GB |
>   | KV | 不需要 | 25 MiB（Cloudflare限制） | 1 GB |

### CLI 部署

```powershell
git clone https://github.com/shuaiplus/NodeWarden.git
cd NodeWarden

npm install
npx wrangler login

# 默认：R2 模式
npm run deploy

# 可选：KV 模式
npm run deploy:kv

# 本地开发
npm run dev
npm run dev:kv
```

### 更新方法

- **手动**：打开你 Fork 的 GitHub 仓库，看到顶部同步提示后，点击 `Sync fork` ➜ `Update branch`
- **自动**：进入你的 Fork 仓库 ➜ `Actions` ➜ `Sync upstream` ➜ `Enable workflow`，会在每天凌晨 3 点自动同步上游。

---

## 方式二：Node.js 自托管部署

### 环境要求

- Node.js >= 18.0.0
- 支持 Windows / Linux / macOS

### 快速开始

#### 1. 克隆项目

```bash
git clone https://github.com/shuaiplus/NodeWarden.git
cd NodeWarden
```

#### 2. 安装依赖

```bash
npm install
```

#### 3. 配置环境变量

复制示例配置文件：

```bash
cp .env.selfhosted.example .env
```

编辑 `.env` 文件，设置必要的配置：

```env
# 必需：JWT 密钥（至少 32 个字符，建议使用随机字符串）
JWT_SECRET=your-secure-jwt-secret-at-least-32-characters-long

# 可选：TOTP 密钥（服务器端 TOTP 功能）
# TOTP_SECRET=your-totp-secret

# 数据库路径（默认：./data/nodewarden.db）
DATABASE_PATH=./data/nodewarden.db

# 附件存储路径（默认：./data/attachments）
STORAGE_PATH=./data/attachments

# 服务器端口（默认：3000）
PORT=3000

# 服务器主机（默认：0.0.0.0）
HOST=0.0.0.0

# 可选：前端静态文件路径（用于服务 Web 应用）
# FRONTEND_PATH=./dist
```

#### 4. 启动服务器

**开发模式**（自动重启）：

```bash
npm run dev:selfhosted
```

**生产模式**：

```bash
npm run start:selfhosted
```

服务器启动后会显示：

```
NodeWarden self-hosted server running at http://0.0.0.0:3000
```

### Docker 部署

#### 使用 Docker Compose（推荐）

1. 创建 `.env` 文件：

```env
JWT_SECRET=your-secure-jwt-secret-at-least-32-characters-long
```

2. 启动服务：

```bash
docker-compose -f docker-compose.selfhosted.yml up -d
```

3. 查看日志：

```bash
docker-compose -f docker-compose.selfhosted.yml logs -f
```

#### 手动构建 Docker 镜像

```bash
docker build -f Dockerfile.selfhosted -t nodewarden-selfhosted .
docker run -d -p 3000:3000 \
  -e JWT_SECRET=your-secure-jwt-secret-at-least-32-characters-long \
  -v nodewarden-data:/app/data \
  nodewarden-selfhosted
```

### 客户端配置

在 Bitwarden 官方客户端中，将服务器 URL 设置为你的自托管服务器地址：

```
http://your-server-ip:3000
```

支持的客户端：
- ✅ Windows 桌面端
- ✅ macOS 桌面端
- ✅ Linux 桌面端
- ✅ iOS App
- ✅ Android App
- ✅ 浏览器扩展

### 生产环境建议

1. **使用 HTTPS**
   - 配置反向代理（如 Nginx、Caddy）
   - 启用 SSL/TLS 证书（推荐 Let's Encrypt）

2. **数据备份**
   - 定期备份 `data/` 目录
   - 使用内置的云端备份功能（WebDAV / E3）

3. **进程管理**
   - 使用 PM2 或 systemd 管理进程
   - 配置自动重启和日志收集

4. **安全加固**
   - 使用防火墙限制访问
   - 定期更新依赖包
   - 使用强随机 JWT_SECRET

### Nginx 反向代理配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### PM2 进程管理

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start "npm run start:selfhosted" --name nodewarden

# 设置开机自启
pm2 startup
pm2 save

# 查看状态
pm2 status

# 查看日志
pm2 logs nodewarden
```

---

## 架构说明

### Cloudflare Workers 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge Network                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Workers   │  │   D1 DB     │  │    R2 / KV          │  │
│  │  (计算层)   │  │  (SQLite)   │  │   (对象存储)         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Durable Objects (WebSocket 通知)           ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Node.js 自托管架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Node.js Server                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  HTTP/WSS   │  │   SQLite    │  │    文件系统          │  │
│  │  (服务层)   │  │  (libsql)   │  │   (附件存储)         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              WebSocket Server (实时通知)                 ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              node-cron (定时备份任务)                    ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 功能对比

| 功能 | Cloudflare Workers | Node.js 自托管 |
|------|-------------------|---------------|
| 数据库 | D1 (分布式 SQLite) | SQLite (libsql) |
| 文件存储 | R2 / KV | 本地文件系统 |
| 实时通知 | Durable Objects | WebSocket 服务器 |
| 定时任务 | Cron Triggers | node-cron |
| 缓存 | Cache API | 内存缓存 |
| 扩展性 | 自动扩展 | 需手动扩展 |
| 成本 | 免费额度内免费 | 服务器成本 |

---

## 云端备份说明

- 远程备份支持 **WebDAV** 与 **E3**
- 勾选"包含附件"后：
  - ZIP 内仍只包含 `db.json` 与 `manifest.json`
  - 真实附件单独存放在 `attachments/`
  - 后续备份会按稳定 blob 名复用已有附件，不会每次全量重传
- 远程还原时：
  - 会从 `attachments/` 目录按需读取附件
  - 缺失的附件会被安全跳过
  - 被跳过的附件不会在恢复后的数据库中留下脏记录

---

## 导入 / 导出

当前支持的导入来源包括：

- Bitwarden JSON
- Bitwarden CSV
- Bitwarden 密码库 + 附件 ZIP
- NodeWarden JSON
- 网页导入器里可见的多种浏览器 / 密码管理器格式

当前支持的导出方式包括：

- Bitwarden JSON
- Bitwarden 加密 JSON
- 带附件的 ZIP 导出
- NodeWarden JSON 系列
- 备份中心中的实例级完整手动导出

---

## 开发

### 项目结构

```
NodeWarden/
├── src/
│   ├── index.ts              # 核心业务逻辑
│   ├── worker.ts             # Cloudflare Workers 入口
│   ├── router.ts             # 路由处理
│   ├── handlers/             # 业务处理器
│   ├── services/             # 服务层
│   ├── durable/              # Durable Objects
│   │   ├── notifications-hub.ts  # Cloudflare DO
│   │   └── notifications.ts      # 平台无关通知函数
│   └── selfhosted/           # Node.js 适配层
│       ├── index.ts          # Node.js 入口
│       ├── database.ts       # SQLite 适配器
│       ├── storage.ts        # 文件存储适配器
│       ├── websocket.ts      # WebSocket 服务器
│       ├── cache-polyfill.ts # 内存缓存
│       └── env.ts            # 环境配置
├── webapp/                   # 前端 Web Vault
├── migrations/               # 数据库迁移
├── shared/                   # 共享代码
├── wrangler.toml             # Cloudflare 配置 (R2)
├── wrangler.kv.toml          # Cloudflare 配置 (KV)
├── tsconfig.selfhosted.json  # TypeScript 配置
├── Dockerfile.selfhosted     # Docker 构建文件
└── docker-compose.selfhosted.yml
```

### 本地开发命令

```bash
# Cloudflare Workers 开发
npm run dev          # R2 模式
npm run dev:kv       # KV 模式

# Node.js 自托管开发
npm run dev:selfhosted

# 构建前端
npm run build

# 类型检查
npm run build:selfhosted
```

---

## 故障排除

### Cloudflare Workers

**问题：部署失败**
- 检查 `wrangler.toml` 配置是否正确
- 确保已登录 `npx wrangler login`

**问题：数据库初始化失败**
- 检查 D1 数据库绑定是否正确
- 查看 Workers 日志获取详细错误

### Node.js 自托管

**问题：`JWT_SECRET` 相关错误**
- 确保 `.env` 文件中 `JWT_SECRET` 至少 32 个字符

**问题：数据库初始化失败**
- 检查 `DATABASE_PATH` 是否有写入权限
- 确保目录存在或可创建

**问题：附件上传失败**
- 检查 `STORAGE_PATH` 是否有写入权限
- 检查磁盘空间是否充足

**问题：客户端连接失败**
- 确认服务器正在运行
- 检查防火墙设置
- 确认客户端配置的服务器 URL 正确

---

## 开源协议

LGPL-3.0 License

---

## 致谢

- [Bitwarden](https://bitwarden.com/) - 原始设计与客户端
- [Vaultwarden](https://github.com/dani-garcia/vaultwarden) - 服务端实现参考
- [Cloudflare Workers](https://workers.cloudflare.com/) - 无服务器平台

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=shuaiplus/NodeWarden&type=timeline&legend=top-left)](https://www.star-history.com/#shuaiplus/NodeWarden&type=timeline&legend=top-left)
