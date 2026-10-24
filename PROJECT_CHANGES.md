# FlexVault 项目改动记录

> 本文档从零梳理本仓库（FlexVault）相对上游 [NodeWarden](https://github.com/shuaiplus/nodewarden) 的**新增内容、修改内容、修复记录、构建发布记录与维护流程**。
> 与 `CHANGELOG.md` 的区别：CHANGELOG 按时间记录变更流水；本文档提供**全量清单 + 实现说明 + 操作手册**，便于长期维护和交接。

- 仓库地址：`https://github.com/lj5645/FlexVault`
- 上游仓库：`https://github.com/shuaiplus/nodewarden`（remote 名 `upstream`）
- 当前版本：`1.8.1`（`package.json` / `shared/app-version.ts`）
- 当前 HEAD：`241feeb`（2026-10-24 整理）
- 许可证：LGPL-3.0

---

## 一、项目定位

FlexVault 是 NodeWarden 的 Fork，核心目标是：

1. **保留 Cloudflare Workers 原生部署模式**，与上游代码保持同步；
2. **新增 Node.js / Docker 自托管部署模式**，使用 SQLite + 本地文件系统，无需 D1 / R2 / Durable Object；
3. 通过 GitHub Actions 构建多架构镜像并推送到阿里云 ACR，供自建服务器拉取。

两种模式共用同一套 `src/` 业务代码，自托管模式通过**适配层 + ESM Loader** 让上游代码零改动运行在 Node.js 中。

```text
                    ┌─────────────────────────┐
                    │   src/ (上游业务代码)    │
                    └───────────┬─────────────┘
                                │ 同一套路由/服务
          ┌─────────────────────┴─────────────────────┐
          │                                           │
  Cloudflare Workers                         Node.js / Docker
  D1 / R2 / Durable Object                   src/selfhosted 适配层
  wrangler deploy                            SQLite / 文件系统 / ws
```

---

## 二、新增文件清单

### 2.1 自托管适配层 `src/selfhosted/`

| 文件 | 行数（约） | 作用 |
|------|-----------|------|
| `database.ts` | 171 | SQLite 版 **D1 适配器**，基于 `@libsql/client` 实现 `prepare/bind/run/all/first/batch/dump/exec/close` |
| `storage.ts` | 379 | 文件系统版 **R2 适配器**，实现 `put/get/delete/list/head`，含 metadata 侧车文件与路径穿越防护 |
| `websocket.ts` | 424 | **SignalR 协议兼容**的 WebSocket 通知中心，替代 Durable Object；含一次性连接令牌与命名空间/Stub 模拟 |
| `index.ts` | 234 | HTTP 服务入口：Node `http.Server` ↔ Web `Request/Response` 转换、静态资源、定时任务、优雅关闭 |
| `env.ts` | 176 | 环境变量加载、`SelfHostedEnv` 构造、静态资源 Handler（SPA fallback + MIME） |
| `cache-polyfill.ts` | 56 | `globalThis.caches` 的 Node.js 内存实现（`default` / `open` / `match` / `put` / `delete`） |
| `backup-transfer-stub.ts` | 43 | Cloudflare Durable Object `BACKUP_TRANSFER_RUNNER` 的占位实现 |
| `cloudflare-workers-loader.mjs` | 20 | Node ESM Loader：把 `cloudflare:workers` 映射到本地 stub |
| `cloudflare-workers-stub.mjs` | 12 | `DurableObject` / `waitUntil` 空实现 |
| `types.ts` | 18 | 自托管配置类型定义 |
| `global-types.d.ts` | 11 | 全局类型桥接（让上游 `D1Database` / `R2Bucket` / `DurableObjectNamespace` 类型指向本地适配器） |

### 2.2 部署与构建配置

| 文件 | 作用 |
|------|------|
| `Dockerfile.selfhosted` | 基于 `node:22-alpine` 的镜像构建；`npm ci` → 启动 `tsx + loader` |
| `docker-compose.selfhosted.yml` | Compose 编排：端口 3000、数据卷、健康检查 |
| `.env.selfhosted.example` | 环境变量示例（复制为 `.env` 使用） |
| `tsconfig.selfhosted.json` | 自托管编译配置（ESNext + Bundler，兼容 tsx） |
| `selfhosted.package.json` | 早期独立包配置（历史遗留，目前未参与构建，见「九、已知问题」） |
| `start-selfhosted.bat` / `.sh` | Windows / Linux 启动脚本（依赖 `tsc` 编译产物） |
| `.npmrc` | 固定 `legacy-peer-deps=true`，解决 `npm ci` 的 peer 依赖冲突 |
| `.github/workflows/docker.yml` | 手动触发的双架构镜像构建 + 推送阿里云 ACR |

### 2.3 文档与记录

| 文件 | 说明 |
|------|------|
| `README.md` | 英文说明：特性、Docker 快速开始、环境变量、自托管开发、Workers 部署 |
| `README_ZH.md` | 中文说明（内容对等） |
| `CHANGELOG.md` | 按时间顺序的变更流水（含 commit hash） |
| `PROJECT_CHANGES.md` | **本文档**：全量改动清单与维护手册 |

### 2.4 本地保留的上游已删除文件（当前未被引用）

> 这些文件是从早期上游快照带入本 Fork 的，上游后续已移除，但本仓库未同步删除。目前**不参与运行**，属于清理候选。

| 文件 | 状态 |
|------|------|
| `src/worker.ts` | 仅做 re-export（`NotificationsHub` + `default`），当前入口为 `src/index.ts` |
| `src/durable/notifications.ts` | 旧的轮询式通知辅助函数，已被 `src/durable/notifications-hub.ts` 取代 |
| `webapp/src/lib/passkey.ts` | 上游已移除 passkey 功能（commit `76623d7`），本文件无任何 import 引用 |

---

## 三、修改的上游文件

| 文件 | 修改内容 |
|------|----------|
| `package.json` | ① 增加自托管运行时依赖：`@libsql/client`、`dotenv`、`node-cron`、`ws`；② 增加类型依赖：`@types/node-cron`、`@types/ws`；③ 保留上游 `overrides`（`sharp 0.35.4`、`browserslist 4.28.7` 等） |
| `package-lock.json` | 为包含自托管依赖，按 **npm 10.9.8**（与 Docker `node:22-alpine` 一致）重新生成；每次同步上游后都需重新生成 |
| `.gitignore` | 新增 `data/`，忽略自托管运行时产生的 SQLite 数据库与附件 |
| `.github/dependabot.yml` | `open-pull-requests-limit: 0`，禁用 Dependabot 自动 PR，避免频繁打断上游同步 |
| `README.md` / `README_ZH.md` | **整体替换为 FlexVault 内容**（上游 README 不再覆盖本地）；同步上游时始终保留本地版本 |
| `src/selfhosted/env.ts`（新增文件，但曾修补） | 修正 `Request` 对象 URL 解析（详见「七、问题与修复」#4） |

---

## 四、核心实现说明

### 4.1 数据库：`SQLiteD1Adapter`

- 用 `@libsql/client` 打开 `file:${DATABASE_PATH}`，并自动创建父目录；
- 实现 Cloudflare D1 的接口子集：`prepare()` 返回带 `bind()` 的语句对象，支持 `run/all/first`；
- `batch()` 走 libsql 的事务批处理（`'write'` 模式），并校验语句来源；
- `dump()` 返回**真实 SQLite 文件字节**（供备份使用）；
- 初始化时启用：
  - `PRAGMA journal_mode = WAL` —— 读写并发不互相阻塞；
  - `PRAGMA busy_timeout = 5000` —— 并发写等待 5 秒而不是立即 `SQLITE_BUSY`；
- `close()` 正确释放连接，进程退出时由 `index.ts` 调用。

### 4.2 存储：`FileSystemR2Adapter`

- 键 → 文件路径映射，附件本体存磁盘，元数据（contentType、customMetadata 等）存 `<basePath>/.metadata/*.json`；
- 实现 R2 接口子集：`put/get/delete/list/head`，`R2ObjectBody` 提供 `arrayBuffer/text/json/blob`；
- **路径穿越防护**：
  - `sanitizeKey` 移除 `..` 与前导 `/`；
  - `validatePath` 使用 `basePath + path.sep` 前缀校验，避免 `/attachments-evil` 被误判为合法；
- `list()` 递归扫描目录，跳过 `.metadata`。

### 4.3 实时通知：`NotificationsHubServer`

替代 Cloudflare Durable Object，兼容 Bitwarden 客户端的 **SignalR** 协议：

| 能力 | 说明 |
|------|------|
| 握手 | 收到首个合法 JSON 帧后回复 `{}` + `0x1e` 记录分隔符 |
| 心跳 | `type: 6` 原样回包 |
| 广播类型 | `5` 密码库同步、`11` 登出、`12` 设备状态、`13` 备份进度 |
| 目标投递 | 支持按 `deviceIdentifier` 定向发送 |
| 在线查询 | `/internal/online` 返回在线设备标识 |

**连接认证（安全机制）**：

1. **主路径（上游 v1.8.0+）**：客户端先调用 `/notifications/hub/negotiate`，服务端签发一次性连接令牌（60 秒 TTL），WebSocket 升级时以 `?id=<token>` 传入；服务端在 `/internal/ws-token` 存储、在 `/internal/ws-token/consume` 消费，**用后即焚**；
2. **兼容路径**：仍支持旧式 `?access_token=` 或 `Authorization: Bearer`（便于旧客户端）；
3. 过期令牌清理：按时间节流，每 60 秒最多清理一次。

**内部端点一览**（`NotificationsHubStub.fetch`）：

| 端点 | 行为 |
|------|------|
| `/internal/ws-token` | 存储一次性令牌，返回 204 |
| `/internal/ws-token/consume` | 消费令牌并返回 `{ userId, deviceIdentifier }` |
| `/internal/notify` | 广播消息，返回 204 |
| `/internal/online` | 返回在线设备列表 |
| `/internal/auth-request-response` | 返回 204（自托管不支持匿名 auth-request 连接，静默跳过） |

### 4.4 HTTP 入口：`index.ts`

- 将 Node `IncomingMessage` 转换为标准 `Request`（保留 headers、method、body），响应再流式写回；
- 路径规范化：去掉末尾多余 `/`；
- 请求分流：
  1. 若是 `GET/HEAD` 且非 Worker 路径（`/api/`、`/identity/`、`/icons/`、`/notifications/`、`/.well-known/` 等），尝试静态资源；
  2. 其余交给上游 `handleRequest` 路由；
- 所有响应统一经过 `applyCors`；
- 启动后注册 **node-cron 定时任务**：每 5 分钟执行一次 `runScheduledBackupIfDue`（备份中心定时备份）；
- 收到 `SIGINT/SIGTERM` 时：先关闭数据库 → 再优雅关闭 HTTP Server（10 秒超时兜底）→ `exit(0)`。

### 4.5 静态资源与 Web Vault

`createAssetsHandler(frontendPath)`：

- 仅在设置了 `FRONTEND_PATH` 且目录存在时启用；
- `/` 映射到 `index.html`；
- 命中文件返回对应 MIME，HTML 使用 `no-cache`，静态资源使用长缓存；
- 未命中时回退到 `index.html`（SPA 路由）；
- 越界路径返回 403。

### 4.6 Cloudflare 模块桥接

- `cloudflare-workers-loader.mjs` 通过 `import.meta.url` **相对解析** stub 路径，避免硬编码绝对路径导致 Docker 内失效；
- `cloudflare-workers-stub.mjs` 提供 `DurableObject` 与 `waitUntil` 的空实现；
- `cache-polyfill.ts` 提供内存版 `caches`（含 `max-age` 解析）。

---

## 五、环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `JWT_SECRET` | **是** | — | JWT 签名密钥，**至少 32 字符**，不足会启动失败 |
| `DATABASE_PATH` | 否 | `./data/nodewarden.db` | SQLite 文件路径 |
| `STORAGE_PATH` | 否 | `./data/attachments` | 附件目录 |
| `PORT` | 否 | `3000` | HTTP 端口 |
| `HOST` | 否 | `0.0.0.0` | 监听地址 |
| `FRONTEND_PATH` | 否 | — | Web Vault 静态文件目录（如 `./dist`） |
| `HIDE_WEB_VAULT` | 否 | — | 设为 `1` 隐藏 Web Vault（API 仍可用） |

> 说明：`TOTP_SECRET`、`YUBICO_CLIENT_ID`、`YUBICO_SECRET_KEY` 等**不是**环境变量。TOTP 密钥按用户存数据库，Yubico 配置从 `app_config` 表读取。

---

## 六、构建与发布

### 6.1 本地构建

```bash
# 安装依赖（.npmrc 已配置 legacy-peer-deps）
npm ci

# 构建前端（产物在 dist/）
npm run build

# 本地运行（开启 Web Vault）
export JWT_SECRET="your-secret-at-least-32-chars"
export FRONTEND_PATH=./dist
npx tsx --loader ./src/selfhosted/cloudflare-workers-loader.mjs ./src/selfhosted/index.ts
```

### 6.2 Docker

```bash
docker build -f Dockerfile.selfhosted -t flexvault:latest .

docker run -d --name flexvault -p 3000:3000 \
  -e JWT_SECRET="your-secret-at-least-32-chars" \
  -v flexvault-data:/app/data \
  --restart unless-stopped flexvault:latest
```

Dockerfile 流程（`node:22-alpine`）：

```text
COPY package*.json + .npmrc
COPY tsconfig*.json / src / shared / migrations
RUN npm ci
mkdir /app/data
ENV DATABASE_PATH=/app/data/nodewarden.db
ENV STORAGE_PATH=/app/data/attachments
CMD npx tsx --loader ... src/selfhosted/index.ts
```

### 6.3 GitHub Actions → 阿里云 ACR

工作流：`.github/workflows/docker.yml`（手动触发 `workflow_dispatch`）

| 配置项 | 值 |
|--------|----|
| 平台 | `linux/amd64`, `linux/arm64`（QEMU） |
| 镜像标签 | `latest` + 手动输入的 `tag` |
| 仓库地址 | `${ALIYUN_REGISTRY}/${ALIYUN_NAMESPACE}/flexvault` |
| 必需 Secrets | `ALIYUN_REGISTRY`、`ALIYUN_USERNAME`、`ALIYUN_PASSWORD`、`ALIYUN_NAMESPACE` |
| Attestation | `provenance: false`、`sbom: false`（阿里云 ACR 不支持 OCI empty manifest） |

触发命令：

```bash
gh workflow run "Build and Push Docker Image to Aliyun ACR" \
  --repo lj5645/FlexVault --ref main -f tag=1.8.1
```

### 6.4 镜像发布记录

| 日期 | Run ID | tag | 结果 | 备注 |
|------|--------|-----|------|------|
| 2026-09-07 | `34127812115` | `latest` + `1.8.0` | ✅ 2m15s | 首次成功推送 v1.8.0 |
| 2026-09-27 | `36300490602` | `latest` | ❌ | `npm ci` 报 lock 缺 `@emnapi/runtime@1.11.3` |
| 2026-09-27 | `36300914376` | `latest` | ✅ 8m32s | 修复 lock 后成功 |
| 2026-09-27 | `36301457690` | `latest` + `1.8.0.2` | ✅ 13m12s | 补推版本标签 |
| 2026-10-09 | `37920179111` | `latest` + `1.8.1` | ✅ 2m26s | 同步上游 v1.8.1 后首推 |

---

## 七、问题与修复记录

### 7.1 CI / Docker 类

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | ACR 推送报 `denied: unknown manifest class for application/vnd.oci.empty.v1+json` | `docker/build-push-action@v5` 默认生成 provenance/SBOM attestation | 工作流加 `provenance: false`、`sbom: false` |
| 2 | Docker `npm ci` 报 lock 与 package.json 不同步（缺 `@emnapi/runtime@1.11.3`） | 本地 npm 11.x 增量解析，`@img/sharp-wasm32` 的依赖未写入 lock | 用 **npm 10.9.8** 执行 `--package-lock-only` 重新生成 |
| 3 | Docker `npm ci` 报 `wrangler` 与 `@cloudflare/workers-types` peer 冲突（v5 vs v4） | wrangler 4.146+ 的 `peerOptional` 要求 types v5，而上游声明 v4 | 新增 `.npmrc`（`legacy-peer-deps=true`）并在 Dockerfile 复制该文件；types 为纯类型包，无运行时影响 |
| 4 | 镜像内基础 Node 版本过低导致 `EBADENGINE` | `node:20-alpine` | 升级为 `node:22-alpine`，并同步重生成 lock |

### 7.2 自托管功能类

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 5 | 设置 `FRONTEND_PATH` 后 Web Vault 返回 500 | `env.ts` 对 `Request` 调 `input.toString()` 得到 `[object Request]`，`new URL` 抛 `Invalid URL` | 改为按类型分支：string / URL / Request.url（commit `7ce1b0a`） |
| 6 | Docker 内 stub 找不到 | loader 中硬编码 `file:///d:/Exp/nodewarden/...` | 改用 `new URL('./cloudflare-workers-stub.mjs', import.meta.url)` |
| 7 | `/notifications/hub/negotiate` 返回 500 | 上游 v1.8.0 引入一次性 ws 令牌，Stub 未实现 `/internal/ws-token` | 补齐 ws-token 存储/消费端点 |
| 8 | `dump()` 返回 JSON 文本而非数据库文件 | 误用了 libsql 的结果序列化 | 直接读取 SQLite 文件字节 |
| 9 | 路径校验可被同前缀目录绕过 | `startsWith(basePath)` 使 `attachments-evil` 通过 | 改为 `startsWith(basePath + path.sep)` |
| 10 | `batch()` 通过 `(ps as any)['sql']` 访问私有字段 | 类型设计问题 | `sql`/`values` 改为 `readonly` 公有字段 + `instanceof` 校验 |
| 11 | 关闭时在途请求被强制中断 | `server.close()` 未 await 就 `exit(0)` | 优雅关闭 + 10 秒超时兜底 |
| 12 | 关闭时数据库未释放 | shutdown 未调用 `db.close()` | 先关 DB 再关 HTTP Server |
| 13 | ws 令牌过期条目堆积 | 仅在数量 > 1000 时清理 | 改为每 60 秒定时清理（节流） |
| 14 | `Cache.put()` 缺 `return` | 实现遗漏 | 补 `return` |
| 15 | `HIDE_WEB_VAULT` 不生效 | `SelfHostedEnv` 缺少该字段，`isWebVaultHidden()` 恒为 false | 补字段并透传 env |
| 16 | `notifyAuthRequestResponse` 持续打 404 错误日志 | Stub 未实现该端点 | 返回 204 静默处理 |
| 17 | 并发写抛 `SQLITE_BUSY` | 未启用 WAL / busy_timeout | 启用 WAL + `busy_timeout=5000` |
| 18 | `caches.default` 未定义 | Node 无 Cache API | 新增内存 polyfill |

### 7.3 环境 / 网络类（本地开发）

| # | 问题 | 处理 |
|---|------|------|
| 19 | git push 报 `schannel: failed to receive handshake` | 经本地代理访问 GitHub 时启用 `git config --global http.version HTTP/1.1`；并确认代理端口（当前 xray 混合端口 `127.0.0.1:10808`） |
| 20 | 仓库级代理配置覆盖全局配置 | `.git/config` 中残留旧端口时，用 `git config --unset http.proxy` 清除 |

---

## 八、验证与测试

### 8.1 自动化测试

| 命令 | 用例数 | 覆盖内容 |
|------|--------|----------|
| `npm run test:config-compatibility` | 1 | `/api/config` 响应结构 |
| `npm run test:notifications-security` | 5 | WebSocket 令牌安全（不可用查询串直接带 JWT） |
| `npm run test:web-crypto` | 4 | 浏览器加密能力降级 |
| `npm run test:vault-compatibility` | 20 | 密码库字段与 Bitwarden 客户端兼容 |
| `npm run test:webauthn-connectors` | 21 | WebAuthn 桌面/移动 Connector |

> 2026-10-09 同步 v1.8.1 后全部通过（合计 51 个用例）。

### 8.2 构建验证

```bash
npm run build     # 期望：✓ built（Tailwind 4 下约 2s）
npm ci            # 期望：exit 0（模拟 Docker 严格安装）
```

### 8.3 自托管冒烟测试

```bash
JWT_SECRET="smoke-test-secret-at-least-32-chars-long!" \
FRONTEND_PATH=./dist PORT=3001 \
npx tsx --loader ./src/selfhosted/cloudflare-workers-loader.mjs ./src/selfhosted/index.ts
```

| 检查项 | 期望 |
|--------|------|
| `GET /` | 200，返回 HTML |
| `GET /assets/*.css` | 200 |
| `GET /assets/*.js` | 200 |
| `GET /some/spa/route` | 200，回退 index.html |
| `GET /api/config` | 200 |
| `GET /api/version` | 200 |

---

## 九、已知问题与待办

> 除第 5 项外，下列问题已在自托管修复中处理。

| # | 事项 | 状态 |
|---|------|------|
| 1 | README 镜像名与实际仓库不一致 | **已修复**：README / README_ZH 统一为 `flexvault:latest` |
| 2 | Docker 镜像默认不含 Web Vault | **已修复**：`Dockerfile.selfhosted` 分阶段构建 `dist/` 并设置 `FRONTEND_PATH=/app/dist`；工作流新增容器冒烟测试 |
| 3 | `selfhosted.package.json` 已过期 | **已删除**：不再维护独立的过期包配置 |
| 4 | 启动脚本依赖编译产物 | **已修复**：`start-selfhosted.*` 与 Docker 一致，使用 `tsx` 直接运行源码 |
| 5 | 残留无引用文件 | 待确认：`src/worker.ts`、`src/durable/notifications.ts`、`webapp/src/lib/passkey.ts` |
| 6 | `.env.selfhosted.example` 保留 `TOTP_SECRET` | **已修复**：示例文件已清理并补充 `TRUST_PROXY`、`MAX_UPLOAD_BYTES` 等变量 |

---

## 十、上游同步标准流程（SOP）

### 10.1 同步步骤

```bash
# 0. 确认工作区干净、代理可用
git status
git fetch upstream

# 1. 查看差异
git log --oneline $(git merge-base HEAD upstream/main)..upstream/main
git diff --stat $(git merge-base HEAD upstream/main)..upstream/main

# 2. 合并（不自动提交）
git merge upstream/main --no-ff --no-commit

# 3. 解决冲突（固定策略）
#    - README.md / README_ZH.md → 保留本地（--ours）
#    - package.json → 采纳上游依赖版本，额外保留自托管依赖：
#        @libsql/client, dotenv, node-cron, ws,
#        @types/node-cron, @types/ws
#    - package-lock.json → 丢弃冲突结果，重新生成
git checkout --ours README.md README_ZH.md
# 手动编辑 package.json 后：
git checkout --ours package-lock.json
git add <已解决文件>
git commit -m "merge: sync upstream nodewarden vX.Y.Z ..."

# 4. 重新生成 lock（必须使用与 Docker 相同的 npm）
npx npm@10.9.8 install --package-lock-only
npm ci   # 必须 exit 0

# 5. 验证
npm run build
npm run test:config-compatibility
npm run test:notifications-security
npm run test:web-crypto
npm run test:vault-compatibility
npm run test:webauthn-connectors
# 自托管冒烟测试（见 8.3）

# 6. 记录与发布
#    - 更新 CHANGELOG.md（同步内容 + 修复 + commit hash）
#    - git push origin main
#    - 触发 Actions，tag 使用与上游/项目一致的版本号
```

### 10.2 冲突处理原则

1. **品牌与文档**：README 永远保留 FlexVault 版本，不被上游覆盖；
2. **依赖**：上游版本优先，但**自托管必需依赖不能丢**；
3. **自托管适配层**：`src/selfhosted/` 若上游改动相关接口（如 `Env`、通知内部端点），必须同步适配；
4. **lock 文件**：永远以 npm 10.9.8 重新生成，不手工合并；
5. **验证优先**：测试 + 构建 + 冒烟全部通过后才推送/发版。

### 10.3 常见坑

| 现象 | 应对 |
|------|------|
| `npm ci` 报 lock 不同步 | 用 npm 10.9.8 重生成；不要用本机 npm 11.x 生成后直接提交 |
| `npm ci` 报 peer 冲突 | 确认 `.npmrc` 存在且 Dockerfile 已 `COPY .npmrc` |
| 上游新增内部端点导致自托管 500 | 检查 `NotificationsHubStub` / `BackupTransferRunnerStub` 是否需补实现 |
| git push SSL handshake 失败 | 设置 `http.version=HTTP/1.1`，确认代理端口 |
| 上游 force push 导致历史差异 | 以 `merge-base` 为准计算差异，不要用固定 tag 比较 |

---

## 十一、快速命令速查

```bash
# 依赖与构建
npm ci
npm run build

# 本地自托管运行
JWT_SECRET=... FRONTEND_PATH=./dist npx tsx --loader ./src/selfhosted/cloudflare-workers-loader.mjs ./src/selfhosted/index.ts

# Docker
docker build -f Dockerfile.selfhosted -t flexvault:latest .
docker compose -f docker-compose.selfhosted.yml up -d

# 测试
npm run test:config-compatibility
npm run test:notifications-security
npm run test:web-crypto
npm run test:vault-compatibility
npm run test:webauthn-connectors

# 触发镜像构建
gh workflow run "Build and Push Docker Image to Aliyun ACR" --repo lj5645/FlexVault --ref main -f tag=1.8.1

# 查看构建结果
gh run list --repo lj5645/FlexVault --workflow "Build and Push Docker Image to Aliyun ACR" --limit 3
gh run view <RUN_ID> --repo lj5645/FlexVault
```

---

## 十二、版本时间线

| 版本 | 日期 | 关键 commit | 主要内容 |
|------|------|-------------|----------|
| 1.4.0 | 2026-04-02 | `3d3ef87` | 首次完成 Node.js 自托管适配（8 个核心文件 + Docker/Compose/脚本） |
| 1.4.1 | 2026-04-27 | `f63c1be` | 新增阿里云 ACR 构建工作流，README 补充镜像说明 |
| 1.7.1 | 2026-06-26 | `c154565` → `18bbc70` → `27f4a19` | 同步上游 v1.7.1 并适配；创建 CHANGELOG |
| 1.7.4 | 2026-07-13 | `d51fbc6` → `ad4ccdb` → `89fe9b9` | 同步 v1.7.4；Cloudflare stub/Loader；Node 22；lock 修复 |
| 1.8.0 | 2026-08-31 | `6400fc9` → `c0e2862` → `61014f7` → `47e56ea` → `c4766f9` | 同步 v1.8.0；WebSocket 一次性令牌；代码审查修复；HIDE_WEB_VAULT |
| — | 2026-09-07 | `4fe653d` | 修复 ACR attestation 推送失败 |
| — | 2026-09-27 | `a2a7b54` / `7ce1b0a` / `ad22ba2` / `bf8ab6b` | 同步上游 25 提交；修复 Web Vault 500；lock 修复 |
| 1.8.1 | 2026-10-09 | `5148fb0` / `8dd1b56` / `241feeb` | 同步上游 v1.8.1；Tailwind 4；`.npmrc` peer 修复；镜像发布 |

---

## 十三、维护约定

1. **每次同步上游后**：更新 `CHANGELOG.md` 与本文档的「问题与修复记录」「版本时间线」；
2. **依赖变更后**：用 npm 10.9.8 重生成 lock，并本地跑一次 `npm ci`；
3. **接口变更后**：务必跑自托管冒烟测试，重点关注 `/api/config`、`/notifications/hub/negotiate`、Web Vault 静态资源；
4. **发布镜像后**：在「镜像发布记录」追加 Run ID 与结果；
5. **README 保持独立**：不随上游覆盖，镜像地址/版本号与工作流保持一致。
