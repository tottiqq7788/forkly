# Forkly 0.2 — GitHub 远端连接与同步

相对 `0.1` 增加直连 `github.com` 的 HTTPS 同步能力（不含企业服务端）。

## 做

- GitHub 账号：浏览器 OAuth（Authorization Code + PKCE + loopback）为主；Device Flow / 细粒度 PAT 为降级
- 项目设置「连接 GitHub 并关联」：授权后自动关联现有 GitHub HTTPS `origin` 并触发一次 Fetch
- 令牌写入系统 Keychain / Credential Manager，不进入 `config.json` / `.git/config` / 日志
- 项目设置中关联 / 解除 GitHub 仓库（默认 `origin`）
- Fetch / 快进-only Pull / 非强制 Push（含首次 `-u`）
- 从 GitHub 克隆、在 GitHub 创建空仓库并连接
- 项目列表 / 首页 / 托盘显示 ahead/behind 摘要
- 可选后台轻量 Fetch（尊重「后台检查」；永不自动 Pull/Push）

## 不做

- SSH 密钥托管、通用 Git 托管、LFS、submodule
- 自动 merge / rebase / stash / force push
- PR / Issue / Actions UI
- 企业自托管 Forkly Server

## OAuth App 注册（维护者一次性）

1. 在 GitHub → Settings → Developer settings → OAuth Apps 创建应用。
2. **Authorization callback URL** 填：`http://127.0.0.1/local-api/v1/github/oauth/callback`（实际端口由本地 API 动态分配，GitHub loopback 规范允许）。
3. 授权范围请求 `repo`（覆盖私有仓库读写与创建仓库）。
4. 将 Client ID 与 Client Secret 通过构建变量注入，**不要**写入仓库或日志。

短期按桌面 **public client** 处理：Client ID 可公开；Secret 通过 CI / 本机环境注入，但可从二进制提取——安全边界依赖 **PKCE、一次性 state、loopback**，而非 Secret 保密。后续云端中转见 [.totti/后续工作/GitHub-OAuth-云端中转.md](../../.totti/后续工作/GitHub-OAuth-云端中转.md)。

## 配置

```bash
# 复制模板并填写本地凭据（.env.local 已 gitignore）
cp .env.example .env.local

# 正式构建
FORKLY_GITHUB_CLIENT_ID=Ov23... FORKLY_GITHUB_CLIENT_SECRET=... make build

# 开发预览（另一终端 make preview-web）
make preview-api

# Release 校验 webOAuthConfigured=true
FORKLY_GITHUB_CLIENT_ID=... FORKLY_GITHUB_CLIENT_SECRET=... make verify-oauth
```

仅注入 Client ID、无 Secret 时：Web OAuth 不可用，Device Flow 仍可用；完全未注入时仅 PAT。

打包需同时产出 `forkly-askpass`（macOS `.app/Contents/MacOS/`，Windows 与 exe 同目录）。

## 验收要点

- 旧 config 自动迁移到 v2
- Token / code / secret 不出现在配置、URL、进程参数、API 响应、日志
- OAuth `state` 10 分钟 TTL、单次消费；`returnTo` 仅可信本地 Origin
- 403 / 404 / SSO 不会静默关联远端
- Pull 仅在干净工作区且可快进时允许；脏工作区可 Push 但提示未保存修改不会被上传
- remote 被改成非 github.com HTTPS 时拒绝注入凭据
