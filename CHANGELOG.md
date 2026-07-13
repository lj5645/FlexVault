# 更新日志 / Changelog

本项目 (FlexVault) 的所有重要变更记录于此。

本仓库在 [NodeWarden](https://github.com/shuaiplus/nodewarden) 基础上新增了 Node.js 自托管部署能力，并保持与 Cloudflare Workers 部署模式完全兼容。

## [Unreleased]

### 新增
- 同步上游 NodeWarden v1.7.4（对应 Bitwarden Server 2026.4.1）
- 新增 `BackupTransferRunnerStub`，在自托管模式下作为 Cloudflare Durable Object `BACKUP_TRANSFER_RUNNER` 的占位实现
- 新增 `cloudflare:workers` 模块的 Node.js ESM Loader，使上游代码无需改动即可在 Node.js 中运行
- 新增 `cloudflare-workers-stub.mjs`，提供 `DurableObject` 与 `waitUntil` 的空实现

### 变更
- 更新 `package.json`，补充自托管模式依赖（`@libsql/client`、`dotenv`、`node-cron`、`ws` 等）以及对应类型声明
- 更新 `Dockerfile.selfhosted`，启动命令增加 `--loader src/selfhosted/cloudflare-workers-loader.mjs` 参数
- 更新 `src/selfhosted/env.ts`，`SelfHostedEnv` 接口补充 `BACKUP_TRANSFER_RUNNER`、`ATTACHMENTS_KV`、`WEBAUTHN_*`、`YUBICO_*` 等字段以匹配上游 `Env` 类型
- 更新 `tsconfig.selfhosted.json`，使用 `module: ESNext` + `moduleResolution: Bundler` 以兼容 TypeScript 6.0 并支持 tsx 运行
- 更新 `src/selfhosted/index.ts`，`applyCors` 调用增加 `env` 参数以匹配上游签名变更

### 修复
- 修复 `caches.default` 在 Node.js 自托管模式下未定义的问题，新增 `default` getter 返回默认 Cache 实例
- 修复 `BackupTransferRunnerStub` 在定时任务调用时抛出错误导致日志噪音的问题，对 `/internal/run-scheduled-backups` 路径返回 409 让调用方静默跳过
- 修复 `package-lock.json` 与 `package.json` 不同步导致 Docker 构建 `npm ci` 失败的问题
- 修复 Docker 镜像 Node.js 版本过低（v20）导致 `miniflare`、`undici`、`wrangler` 等依赖触发 EBADENGINE 警告的问题，升级 `Dockerfile.selfhosted` 基础镜像至 `node:22-alpine`

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

## [1.7.1] - 2025-XX-XX

### 同步上游
- 同步 NodeWarden v1.7.1 全部功能（详见上游提交历史）
- 主要新功能：
  - SSH Key 支持与指纹规范化
  - Import / Export（Bitwarden JSON / 加密 JSON / ZIP / NodeWarden JSON）
  - TOTP 双因素认证及恢复码
  - 备份中心（远程备份、定时备份、恢复）
  - WebAuthn / Passkey 支持
  - 国际化（中英文等）
  - 公开 Send（文本 / 文件）
  - 设备管理与登录通知

### 自托管
- 保留并适配 self-hosted 部署能力，所有核心 API（注册、登录、同步、附件、WebSocket）均测试通过

## [1.4.x] - 早期版本

- 完成 Cloudflare Workers → Node.js 自托管适配
- 实现 SQLite D1 适配器
- 实现文件系统 R2 适配器
- 实现 WebSocket 通知服务（替代 Durable Object）
- 添加 Docker 构建与 GitHub Actions 推送至阿里云 ACR 流程
