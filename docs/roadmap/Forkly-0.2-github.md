# Forkly 0.2 — GitHub 远端连接与同步

相对 `0.1` 增加直连 `github.com` 的 HTTPS 同步能力（不含企业服务端）。

## 做

- GitHub 账号：Device Flow（GitHub App 用户授权）为主，细粒度 PAT 备用
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

## 配置

构建时注入公开 Client ID（无 secret）：

```bash
FORKLY_GITHUB_CLIENT_ID=Iv1... make build
```

未注入时 Device Flow 不可用，PAT 入口仍可用。

打包需同时产出 `forkly-askpass`（macOS `.app/Contents/MacOS/`，Windows 与 exe 同目录）。

## 验收要点

- 旧 config 自动迁移到 v2
- Token 不出现在配置、URL、进程参数、API 响应、日志
- Pull 仅在干净工作区且可快进时允许；脏工作区可 Push 但提示未保存修改不会被上传
- remote 被改成非 github.com HTTPS 时拒绝注入凭据
