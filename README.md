<p align="center">
  <img src="./NodeWarden.png" alt="FlexVault Logo" />
</p>

<p align="center">
  灵活的 Bitwarden 兼容密码管理服务端 - 支持 Cloudflare Workers 和 Node.js 双部署
</p>

[![Powered by Cloudflare](https://img.shields.io/badge/Powered%20by-Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: LGPL-3.0](https://img.shields.io/badge/License-LGPL--3.0-2ea44f)](./LICENSE)

[提交问题](https://github.com/lj5645/FlexVault/issues/new/choose)

> **免责声明**  
> 本项目仅供学习与交流使用，请定期备份你的密码库。  
> 本项目与 Bitwarden 官方无关，请不要向 Bitwarden 官方反馈 FlexVault 的问题。

---

## 与 Bitwarden 官方服务端能力对比

| 能力 | Bitwarden | FlexVault | 说明 |
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

FlexVault 支持两种部署方式：

| 部署方式 | 适用场景 | 优势 | 劣势 |
|---------|---------|------|------|
| **Cloudflare Workers** | 无服务器、边缘计算 | 全球 CDN、自动扩展、免费额度充足 | 需要 Cloudflare 账号 |
| **Node.js 自托管** | 私有服务器、内网部署 | 完全自主控制、无外部依赖 | 需要自行维护服务器 |

---

## 方式一：Cloudflare Workers 部署

### 网页部署

1. Fork `FlexVault` 仓库到自己的 GitHub 账号
2. 进入 [Cloudflare Workers 创建页面](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create)
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
git clone https://github.com/lj5645/FlexVault.git
cd FlexVault

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

---

## 方式二：Node.js 自托管部署

### 环境要求

| 要求 | 说明 |
|------|------|
| **Node.js** | >= 18.0.0（推荐使用 LTS 版本） |
| **操作系统** | Windows / Linux / macOS |
| **磁盘空间** | 至少 1GB（用于数据库和附件存储） |
| **内存** | 建议 512MB 以上 |

---

### 详细部署步骤

#### 第一步：安装 Node.js

**Windows 系统：**

1. 访问 [Node.js 官网](https://nodejs.org/)
2. 下载 LTS（长期支持）版本安装包
3. 运行安装程序，保持默认选项即可
4. 打开 PowerShell，验证安装：
   ```powershell
   node --version
   npm --version
   ```

**Linux 系统（Ubuntu/Debian）：**

```bash
# 使用 NodeSource 安装 Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node --version
npm --version
```

**macOS 系统：**

```bash
# 使用 Homebrew 安装
brew install node

# 验证安装
node --version
npm --version
```

---

#### 第二步：下载项目代码

**方式 A：使用 Git 克隆（推荐）**

```bash
# 安装 Git（如果没有）
# Windows: 从 https://git-scm.com/download/win 下载安装
# Linux: sudo apt install git
# macOS: brew install git

# 克隆项目
git clone https://github.com/lj5645/FlexVault.git

# 进入项目目录
cd FlexVault
```

**方式 B：直接下载 ZIP**

1. 访问 https://github.com/lj5645/FlexVault
2. 点击绿色按钮 `Code` → `Download ZIP`
3. 解压下载的文件
4. 在终端中进入解压后的目录

---

#### 第三步：安装项目依赖

```bash
# 在项目根目录执行
npm install
```

等待依赖安装完成，通常需要 1-3 分钟。

---

#### 第四步：配置环境变量

**创建配置文件：**

```bash
# 复制示例配置文件
cp .env.selfhosted.example .env
```

**编辑 `.env` 文件：**

使用任意文本编辑器打开 `.env` 文件，配置以下参数：

```env
# ============================================
# 必需配置
# ============================================

# JWT 密钥 - 用于签名认证令牌
# ⚠️ 重要：必须至少 32 个字符，建议使用随机字符串
# 生成方法：openssl rand -base64 32
# 或在线生成：https://www.random.org/strings/
JWT_SECRET=your-secure-jwt-secret-at-least-32-characters-long

# ============================================
# 可选配置（使用默认值即可）
# ============================================

# TOTP 密钥 - 服务器端两步验证功能
# TOTP_SECRET=your-totp-secret

# 数据库存储路径
# 默认：./data/nodewarden.db
DATABASE_PATH=./data/nodewarden.db

# 附件存储路径
# 默认：./data/attachments
STORAGE_PATH=./data/attachments

# 服务器监听端口
# 默认：3000
PORT=3000

# 服务器监听地址
# 默认：0.0.0.0（监听所有网卡）
# 如仅本机访问可设为 127.0.0.1
HOST=0.0.0.0

# 前端静态文件路径（可选）
# 如果需要服务 Web Vault 界面，设置构建后的前端路径
# FRONTEND_PATH=./dist
```

**生成安全的 JWT_SECRET：**

```bash
# Linux/macOS
openssl rand -base64 32

# 或使用 Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

#### 第五步：启动服务器

**开发模式（推荐首次测试）：**

```bash
npm run dev:selfhosted
```

开发模式特点：
- 自动监听文件变化并重启
- 显示详细调试日志
- 适合开发和调试

**生产模式：**

```bash
npm run start:selfhosted
```

**启动成功标志：**

```
NodeWarden self-hosted server running at http://0.0.0.0:3000
```

---

#### 第六步：验证服务运行

**测试 API 接口：**

```bash
# 获取服务器版本
curl http://localhost:3000/api/version

# 获取服务器配置
curl http://localhost:3000/api/config
```

**预期返回：**

```json
{
  "version": "2026.1.0",
  ...
}
```

---

#### 第七步：配置客户端

在 Bitwarden 官方客户端中配置自托管服务器：

1. 打开 Bitwarden 客户端
2. 点击左上角 **设置**（齿轮图标）
3. 找到 **服务器** 设置
4. 选择 **自托管**
5. 输入服务器 URL：`http://你的服务器IP:3000`
6. 点击保存

**支持的客户端：**
- ✅ Windows 桌面端
- ✅ macOS 桌面端
- ✅ Linux 桌面端
- ✅ iOS App
- ✅ Android App
- ✅ 浏览器扩展

---

### Docker 部署

#### 使用 Docker Compose（推荐）

**1. 创建配置文件：**

```bash
# 创建 .env 文件
echo "JWT_SECRET=your-secure-jwt-secret-at-least-32-characters-long" > .env
```

**2. 启动服务：**

```bash
docker-compose -f docker-compose.selfhosted.yml up -d
```

**3. 查看运行状态：**

```bash
docker-compose -f docker-compose.selfhosted.yml ps
```

**4. 查看日志：**

```bash
docker-compose -f docker-compose.selfhosted.yml logs -f
```

**5. 停止服务：**

```bash
docker-compose -f docker-compose.selfhosted.yml down
```

#### 手动构建 Docker 镜像

```bash
# 构建镜像
docker build -f Dockerfile.selfhosted -t flexvault .

# 运行容器
docker run -d \
  --name flexvault \
  -p 3000:3000 \
  -e JWT_SECRET=your-secure-jwt-secret-at-least-32-characters-long \
  -v flexvault-data:/app/data \
  flexvault
```

---

### 生产环境部署建议

#### 1. 使用 HTTPS（强烈推荐）

**使用 Nginx 反向代理：**

```nginx
# /etc/nginx/sites-available/flexvault.conf
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书配置（使用 Let's Encrypt）
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # 上传文件大小限制
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

**获取 Let's Encrypt 免费证书：**

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo certbot renew --dry-run
```

#### 2. 使用进程管理器

**使用 PM2（推荐）：**

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start "npm run start:selfhosted" --name flexvault

# 查看状态
pm2 status

# 查看日志
pm2 logs flexvault

# 设置开机自启
pm2 startup
pm2 save

# 重启服务
pm2 restart flexvault

# 停止服务
pm2 stop flexvault
```

**使用 systemd（Linux）：**

创建服务文件 `/etc/systemd/system/flexvault.service`：

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
# 启动服务
sudo systemctl start flexvault

# 开机自启
sudo systemctl enable flexvault

# 查看状态
sudo systemctl status flexvault
```

#### 3. 数据备份

```bash
# 手动备份
tar -czvf flexvault-backup-$(date +%Y%m%d).tar.gz data/

# 定时备份（使用 crontab）
crontab -e

# 每天凌晨 3 点备份
0 3 * * * cd /path/to/FlexVault && tar -czvf /backup/flexvault-$(date +\%Y\%m\%d).tar.gz data/
```

#### 4. 安全加固

```bash
# 配置防火墙（仅开放必要端口）
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp
sudo ufw enable

# 定期更新依赖
npm audit
npm update
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
- FlexVault JSON
- 网页导入器里可见的多种浏览器 / 密码管理器格式

当前支持的导出方式包括：

- Bitwarden JSON
- Bitwarden 加密 JSON
- 带附件的 ZIP 导出
- FlexVault JSON 系列
- 备份中心中的实例级完整手动导出

---

## 开发

### 项目结构

```
FlexVault/
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

**问题：端口被占用**
```bash
# 查看端口占用（Linux/macOS）
lsof -i :3000

# 查看端口占用（Windows）
netstat -ano | findstr :3000

# 更换端口：修改 .env 中的 PORT 值
```

---

## 同步上游更新

FlexVault 基于 [NodeWarden](https://github.com/shuaiplus/nodewarden) 开发，当上游项目更新时，可以按以下步骤同步：

### 首次设置（只需执行一次）

```bash
# 添加上游仓库为远程源
git remote add upstream https://github.com/shuaiplus/nodewarden.git

# 验证远程源配置
git remote -v
# 应看到：
# origin    https://github.com/lj5645/FlexVault.git (fetch)
# origin    https://github.com/lj5645/FlexVault.git (push)
# upstream  https://github.com/shuaiplus/nodewarden.git (fetch)
# upstream  https://github.com/shuaiplus/nodewarden.git (push)
```

### 同步更新流程

```bash
# 1. 获取上游最新代码
git fetch upstream

# 2. 切换到主分支
git checkout main

# 3. 合并上游更新
git merge upstream/main

# 4. 如果有冲突，解决后提交
# 冲突文件会标记出来，手动编辑解决后：
git add .
git commit -m "merge: 合并上游更新"

# 5. 推送到仓库
git push origin main
```

### 可能产生冲突的文件

| 文件 | 冲突可能性 | 原因 |
|------|-----------|------|
| `package.json` | 高 | 添加了自托管依赖 |
| `src/index.ts` | 中 | 修改了导出结构 |
| `src/handlers/*.ts` | 中 | 改变了 import 路径 |
| `src/selfhosted/*` | 无 | 独立新增目录，不会冲突 |

### 冲突解决建议

1. **保留你的修改** - 对于 `src/selfhosted/` 目录，始终保留你的版本
2. **合并依赖** - 对于 `package.json`，合并上游的新依赖和你添加的自托管依赖

---

## 开源协议

LGPL-3.0 License

---

## 致谢

- [NodeWarden](https://github.com/shuaiplus/nodewarden) - 原 NodeWarden 项目，本项目基于此添加了 Node.js 自托管支持
