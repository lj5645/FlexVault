# 更新日志 / Changelog

本项目 (FlexVault) 的所有重要变更记录于此。

本仓库在 [NodeWarden](https://github.com/shuaiplus/nodewarden) 基础上新增了 Node.js 自托管部署能力，并保持与 Cloudflare Workers 部署模式完全兼容。

## [1.8.0] - 2026-08-31

> 对应 commit: `d3098ae`(2026-08-29 上游快照) → `5c7adf1`(2026-08-31 合并) → `6400fc9`(2026-08-31 适配) → `c0e2862` → `61014f7` → `47e56ea` → `c4766f9`

### 同步上游 v1.7.4 → v1.8.0 主要功能
- WebSocket 连接令牌（一次性、签名、60 秒 TTL），替代原来直接在 URL 携带 access JWT 的方式
- SSH Key 生成器
- WebAuthn 移动端 Connector 与桌面端 Connector（`/webauthn-connector.html`、`/webauthn-mobile-connector.html`）
- Yubico OTP 服务端配置（`src/services/yubico-config.ts`）
- Cipher 全量更新时清空被省略的可空字段（修复陈旧加密 notes 被回滚的问题）
- Config 响应独立模块（`src/config-response.ts`）
- Web Vault 可见性控制（`src/web-vault-visibility.ts`）
- 新增多个测试脚本（config-compatibility、notifications-security、web-crypto-availability、webauthn-connector 等）

### 新增（2026-08-31 00:26, commit `6400fc9`）
- 同步上游 NodeWarden v1.8.0（对应 Bitwarden Server 2026.6.0）
- 自托管 `NotificationsHubStub` 新增 `/internal/ws-token` 与 `/internal/ws-token/consume` 内部端点，对齐上游 WebSocket 连接令牌签发/消费安全机制
- 自托管 WebSocket 升级流程支持 `?id=<connectionToken>` 一次性令牌认证，同时保留 `?access_token=` 旧方式向后兼容

### 变更（2026-08-31 00:26, commit `6400fc9`）
- 更新 `src/selfhosted/websocket.ts`，`NotificationsHubServer` 新增 `wsConnectionTokens` 存储与 `storeWsConnectionToken` / `consumeWsConnectionToken` 方法，承载上游 Durable Object 的令牌存储职责

### 修复（2026-08-31 00:32, commit `c0e2862`）
- 修复自托管模式下 `/notifications/hub/negotiate` 返回 500 的问题（上游新增 WebSocket 连接令牌机制后，`NotificationsHubStub` 未实现 `/internal/ws-token` 端点导致 `issueWebSocketConnectionToken` 抛错）
- 修复 `cloudflare-workers-loader.mjs` 硬编码绝对路径 `file:///d:/Exp/nodewarden/...` 导致 Docker 容器内运行时找不到 stub 文件的问题，改用 `import.meta.url` 相对解析

### 修复（2026-08-31 00:39, commit `61014f7`）
- 修复 `SQLiteD1Adapter.dump()` 返回 JSON 文本而非 SQLite 二进制数据库内容的问题，改为直接读取数据库文件
- 修复 `FileSystemR2Adapter.validatePath()` 路径前缀边界问题（`/app/data/attachments-evil` 会被 `startsWith('/app/data/attachments')` 误判为合法），改为 `startsWith(basePath + path.sep)`
- 修复 `SQLiteD1Adapter.batch()` 用 `(ps as any)['sql']` 绕过 private 访问私有字段的问题，将 `sql`/`values` 改为 readonly 公开字段并增加 `instanceof` 类型检查
- 修复 `startServer()` 的 shutdown 流程未 `await server.close()` 直接 `process.exit(0)` 导致在途请求被强制中断的问题，改为优雅关闭并加 10 秒超时兜底
- 修复 `NotificationsHubServer.storeWsConnectionToken()` 仅在 token 数量超过 1000 时才清理过期条目的问题，改为基于时间间隔（每 60 秒最多一次）的主动清理
- 修复 `cache-polyfill.ts` 的 `Cache.put()` 方法缺少 `return` 语句的问题（虽不影响功能，但不符合 Cache API 规范）

### 变更（2026-08-31 00:48, commit `47e56ea`）
- 禁用 Dependabot PR 创建（`.github/dependabot.yml` 中 `open-pull-requests-limit` 设为 0），防止 Dependabot 自动创建依赖更新分支

### 修复（2026-08-31 00:57, commit `c4766f9`）
- 修复 `SelfHostedEnv` 缺少 `HIDE_WEB_VAULT` 字段导致 `isWebVaultHidden()` 永远返回 false 的问题，现在自托管模式支持通过环境变量 `HIDE_WEB_VAULT=1` 隐藏 Web Vault
- 修复 `NotificationsHubStub` 缺少 `/internal/auth-request-response` 端点导致 `notifyAuthRequestResponse()` 收到 404 并打印错误日志的问题，返回 204 静默跳过（自托管模式不支持 anonymous-auth-request WebSocket 连接）
- 清理 `SelfHostedEnv` 中上游 `Env` 接口不存在的多余字段：`TOTP_SECRET`、`YUBICO_CLIENT_ID`、`YUBICO_SECRET_KEY`、`globalSettings__yubico__clientId`、`globalSettings__yubico__key`（Yubico clientId/key 从数据库 `app_config` 表读取，TOTP secret 是每用户字段存在数据库中，均非环境变量）
- 修复 `SQLiteD1Adapter` 缺少 `busy_timeout` 配置导致并发写入时抛出 `SQLITE_BUSY` 错误的问题，设置 5 秒等待超时
- 修复 `SQLiteD1Adapter` 未显式启用 WAL 模式的问题，WAL 模式允许并发读取不阻塞写入
- 修复 `SQLiteD1Adapter.close()` 方法未调用 `this.db.close()` 的问题，之前只返回 undefined，现在正确关闭数据库连接
- 修复 `index.ts` 的 shutdown 流程未关闭数据库连接的问题，现在在关闭 HTTP 服务器前先关闭数据库

## [1.7.4] - 2026-07-13

> 对应 commit: `d51fbc6`(2026-07-13 03:34 同步) → `ad4ccdb`(2026-07-13 08:32 Docker 修复) → `89fe9b9`(2026-07-13 08:40 lock 修复)

### 同步上游 v1.7.2 → v1.7.4 主要功能
- 密码生成器（Password Generator）功能
- 密码安全扫描（Password Security）与报告
- 重复密码项检测与去重
- Fill-assist 自动填充助手
- 新增多语言：德语、法语、意大利语、瑞典语、芬兰语
- WebAuthn / FIDO2 直接解锁与 origins 配置改进
- 移动端设置 UI 与导航布局优化
- 修复意外会话登出问题
- 修复 admin / wipe-device 操作需要主密码验证
- 修复备份目标 URL 检查中 IPv6 loopback 拦截
- 离线模式提示

### 新增（2026-07-13 03:34, commit `d51fbc6`）
- 同步上游 NodeWarden v1.7.4（对应 Bitwarden Server 2026.4.1）
- 新增 `BackupTransferRunnerStub`，在自托管模式下作为 Cloudflare Durable Object `BACKUP_TRANSFER_RUNNER` 的占位实现
- 新增 `cloudflare:workers` 模块的 Node.js ESM Loader，使上游代码无需改动即可在 Node.js 中运行
- 新增 `cloudflare-workers-stub.mjs`，提供 `DurableObject` 与 `waitUntil` 的空实现

### 变更（2026-07-13 03:34, commit `d51fbc6`）
- 更新 `package.json`，补充自托管模式依赖（`@libsql/client`、`dotenv`、`node-cron`、`ws` 等）以及对应类型声明
- 更新 `Dockerfile.selfhosted`，启动命令增加 `--loader src/selfhosted/cloudflare-workers-loader.mjs` 参数
- 更新 `src/selfhosted/env.ts`，`SelfHostedEnv` 接口补充 `BACKUP_TRANSFER_RUNNER`、`ATTACHMENTS_KV`、`WEBAUTHN_*`、`YUBICO_*` 等字段以匹配上游 `Env` 类型
- 更新 `tsconfig.selfhosted.json`，使用 `module: ESNext` + `moduleResolution: Bundler` 以兼容 TypeScript 6.0 并支持 tsx 运行
- 更新 `src/selfhosted/index.ts`，`applyCors` 调用增加 `env` 参数以匹配上游签名变更

### 修复（2026-07-13 03:34, commit `d51fbc6`）
- 修复 `caches.default` 在 Node.js 自托管模式下未定义的问题，新增 `default` getter 返回默认 Cache 实例
- 修复 `BackupTransferRunnerStub` 在定时任务调用时抛出错误导致日志噪音的问题，对 `/internal/run-scheduled-backups` 路径返回 409 让调用方静默跳过

### Docker 修复（2026-07-13 08:32, commit `ad4ccdb`）
- 修复 `package-lock.json` 与 `package.json` 不同步导致 Docker 构建 `npm ci` 失败的问题
- 修复 Docker 镜像 Node.js 版本过低（v20）导致 `miniflare`、`undici`、`wrangler` 等依赖触发 EBADENGINE 警告的问题，升级 `Dockerfile.selfhosted` 基础镜像至 `node:22-alpine`

### Docker 修复（2026-07-13 08:40, commit `89fe9b9`）
- 修复 `package-lock.json` 在 Docker 容器内（npm 10.9.8）仍报 missing 包的问题，使用 npm 10.9.8 重新生成 lock 文件以确保与 Docker 环境完全一致

## [1.7.1] - 2026-06-26

> 对应 commit: `c154565`(2026-06-26 00:08 合并上游) → `18bbc70`(2026-06-26 00:27 适配自托管) → `27f4a19`(2026-06-26 00:46 创建 CHANGELOG)

### 同步上游（2026-06-26 00:08, commit `c154565`）
- Merge remote-tracking branch 'upstream/main'，同步 NodeWarden v1.7.1 全部功能（对应 Bitwarden Server 2026.4.1）
- 主要新功能：
  - SSH Key 支持与指纹规范化
  - Import / Export（Bitwarden JSON / 加密 JSON / ZIP / NodeWarden JSON）
  - TOTP 双因素认证及恢复码
  - 备份中心（远程备份、定时备份、恢复）
  - WebAuthn / Passkey 支持
  - 国际化（中英文等）
  - 公开 Send（文本 / 文件）
  - 设备管理与登录通知

### 自托管适配（2026-06-26 00:27, commit `18bbc70`）
- 同步上游 v1.7.1 后适配自托管模式，所有核心 API（注册、登录、同步、附件、WebSocket）均测试通过
- 新增 `src/selfhosted/backup-transfer-stub.ts`（31 行），`BackupTransferRunnerStub` 作为 Cloudflare Durable Object `BACKUP_TRANSFER_RUNNER` 的占位实现
- 新增 `src/selfhosted/cloudflare-workers-loader.mjs`（15 行），Node.js ESM Loader，使上游代码无需改动即可在 Node.js 中 import `cloudflare:workers` 模块
- 新增 `src/selfhosted/cloudflare-workers-stub.mjs`（12 行），提供 `DurableObject` 基类与 `waitUntil` 的空实现
- 更新 `Dockerfile.selfhosted`，启动命令增加 `--loader src/selfhosted/cloudflare-workers-loader.mjs` 参数
- 更新 `package.json`，补充自托管模式依赖

### 文档（2026-06-26 00:46, commit `27f4a19`）
- 创建 `CHANGELOG.md`，开始记录项目所有变更

## [1.4.1] - 2026-04-27

> 对应 commit: `f63c1be`

### 新增（2026-04-27 07:47, commit `f63c1be`）
- 新增 `.github/workflows/docker.yml`（52 行），手动触发的 GitHub Actions 工作流，支持 `linux/amd64` 和 `linux/arm64` 双平台 Docker 镜像构建并推送到阿里云 ACR（`registry.cn-guangzhou.aliyuncs.com/myskyts`）
- 更新 `README.md` 和 `README_EN.md`，添加阿里云镜像拉取说明

## [1.4.0] - 2026-04-02

> 对应 commit: `3d3ef87`

### 新增（2026-04-02 06:47, commit `3d3ef87`）
- **完成 Cloudflare Workers → Node.js 自托管适配**，支持 Cloudflare Workers 和 Node.js 双部署模式
- 新增 `src/selfhosted/` 目录，包含 8 个核心适配文件：
  - `src/selfhosted/database.ts`（159 行）— SQLite D1 适配器，基于 `@libsql/client`，实现 D1 兼容 API（`prepare`、`batch`、`dump`、`exec`）
  - `src/selfhosted/storage.ts`（375 行）— 文件系统 R2 适配器，实现 R2 兼容 API（`put`、`get`、`delete`、`list`、`head`），支持路径遍历防护
  - `src/selfhosted/websocket.ts`（341 行）— WebSocket 通知服务，替代 Cloudflare Durable Object，实现 SignalR 协议兼容的消息广播
  - `src/selfhosted/cache-polyfill.ts`（45 行）— `caches.default` 与 `caches.open` 的 Node.js polyfill，实现 Cache API（`match`、`put`、`delete`）
  - `src/selfhosted/env.ts`（162 行）— 环境变量配置加载器，`SelfHostedEnv` 接口与 `createEnv()` 工厂函数
  - `src/selfhosted/index.ts`（222 行）— HTTP 服务器入口，`http.createServer` + 路由分发 + 静态资源服务
  - `src/selfhosted/types.ts`（18 行）— 自托管专用类型定义
  - `src/selfhosted/global-types.d.ts`（11 行）— 全局类型声明
- 新增 `Dockerfile.selfhosted`（35 行），基于 `node:20-alpine`（后升级为 `node:22-alpine`）的 Docker 镜像配置
- 新增 `docker-compose.selfhosted.yml`（28 行），Docker Compose 编排配置
- 新增 `.env.selfhosted.example`（23 行），环境变量示例文件
- 新增 `tsconfig.selfhosted.json`（29 行），TypeScript 编译配置
- 新增 `selfhosted.package.json`（36 行），自托管独立包配置
- 新增 `start-selfhosted.bat`（24 行）和 `start-selfhosted.sh`（21 行），Windows/Linux 启动脚本
- 新增 `migrations/0001_init.sql`（217 行），初始数据库迁移脚本（SQLite 方言）
- 新增 `.github/workflows/security.yml`（142 行）和 `.github/scripts/security.cjs`（467 行），安全扫描工作流
- 新增 `.github/workflows/sync-upstream.yml`（34 行），上游同步工作流
- 新增 `README.md`（499 行）和 `README_EN.md`（140 行），项目文档
- 新增 `LICENSE`（162 行），MIT 许可证
