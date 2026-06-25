# 更新日志 / Changelog

本项目 (FlexVault) 的所有重要变更记录于此。

本仓库在 [NodeWarden](https://github.com/shuaiplus/nodewarden) 基础上新增了 Node.js 自托管部署能力，并保持与 Cloudflare Workers 部署模式完全兼容。

## [Unreleased]

### 新增
- 同步上游 NodeWarden v1.7.1（对应 Bitwarden Server 2026.4.1）
- 新增 `BackupTransferRunnerStub`，在自托管模式下作为 Cloudflare Durable Object `BACKUP_TRANSFER_RUNNER` 的占位实现
- 新增 `cloudflare:workers` 模块的 Node.js ESM Loader，使上游代码无需改动即可在 Node.js 中运行
- 新增 `cloudflare-workers-stub.mjs`，提供 `DurableObject` 与 `waitUntil` 的空实现

### 变更
- 更新 `package.json`，补充自托管模式依赖（`@libsql/client`、`dotenv`、`node-cron`、`ws` 等）以及对应类型声明
- 更新 `Dockerfile.selfhosted`，启动命令增加 `--loader src/selfhosted/cloudflare-workers-loader.mjs` 参数
- 更新 `src/selfhosted/env.ts`，`SelfHostedEnv` 接口补充 `BACKUP_TRANSFER_RUNNER`、`ATTACHMENTS_KV`、`WEBAUTHN_*` 等字段以匹配上游 `Env` 类型

### 修复
- 修复 `caches.default` 在 Node.js 自托管模式下未定义的问题，新增 `default` getter 返回默认 Cache 实例

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
