# Forkly 0.3 — 命令行客户端（forklyctl）

`forklyctl` 是随 Forkly 安装包分发的命令行客户端，供终端用户、脚本和 AI 编码工具（Cursor、Codex 等）调用本地 Forkly API，在不打开 Web 控制台的情况下完成项目登记、文件读写、保存版本、分支与 GitHub 同步等操作。

## 安装与发现

| 平台 | 二进制路径 |
|------|------------|
| macOS | `/Applications/Forkly.app/Contents/MacOS/forklyctl` |
| Windows | `%LOCALAPPDATA%\Programs\Forkly\forklyctl.exe`（安装时写入用户 PATH） |
| 开发构建 | `make build` → `bin/forklyctl` |

**前提：** Forkly 主进程必须正在运行（菜单栏 / 系统托盘）。CLI 通过数据目录下的 `runtime/api.json` 发现 Local API 地址（仅 loopback），并要求 `/health` 返回的 `pid`/`nonce` 与发现文件一致，且配对后绑定可信实例；实例变更需重新 `pair`。配对领取需 `deviceSecret`（仅 `pair/start` 返回，status 不返回配对码）。

```bash
forklyctl doctor --json
```

`doctor` 会报告：CLI 版本、数据目录、安装路径提示、运行时发现文件、健康检查。

## 配对与权限域（Scopes）

首次使用需与 Forkly 配对，在应用 **设置 → 命令行与 AI 工具** 中核对并批准配对码：

```bash
forklyctl pair --preset collaborate --name "Cursor"
```

预设（`capabilities` 可查看完整列表）：

| 预设 | 典型用途 | 包含能力 |
|------|----------|----------|
| `readonly` | 只读巡检 | `read` |
| `collaborate` | 日常协作（默认） | 读、写文件、提交、分支、远端 |
| `full_control` | 完全控制 | 含账号管理、UI 控制等全部域 |

撤销本地令牌：

```bash
forklyctl auth revoke --yes
```

## 打包说明

- **Makefile `build`**：产出 `bin/forklyctl`（`CGO_ENABLED=0`）。
- **macOS `.app`**：`Contents/MacOS/forklyctl`，与 `forkly` 一同签名（`FORKLY_SIGN_IDENTITY` 设置时）。
- **Windows 安装包**：`forklyctl.exe` 使用普通控制台子系统（非 `windowsgui`）；Inno Setup 将 `{app}` 加入用户级 PATH，卸载时清理。

macOS 不自动修改 PATH；可直接调用完整路径，或将该目录加入 shell 配置。

## Agent 使用示例

推荐始终加 `--json`，输出为稳定 envelope（`ok` / `data` / `error`），便于工具解析。

### Cursor / Codex 典型流程

```bash
# 1. 确认 Forkly 在线
forklyctl doctor --json

# 2. 一次性配对（需用户在 GUI 批准）
forklyctl pair --preset collaborate --name "Cursor" --json

# 3. 列出项目
forklyctl projects list --json

# 4. 在当前 Git 工作树查看状态
forklyctl status --json

# 5. 读取并修改文件后保存版本
forklyctl files read --path README.md --json
forklyctl files write --path README.md --content "# Updated" --json
forklyctl commit --paths README.md --message "docs: update readme" --json

# 6. 推送到 GitHub（需已关联远端且工作区允许）
forklyctl remote push --json
```

### 项目与分支

```bash
forklyctl project add --path ~/Projects/my-repo --json
forklyctl project current --json
forklyctl branches list --json
forklyctl branches create feature/cli-demo --json
```

### GitHub

```bash
forklyctl github account --json
forklyctl github device start --json
forklyctl clone --url https://github.com/org/repo.git --parent ~/Projects --json
```

### 错误处理

退出码约定（见 `internal/cli/client.go`）：

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 用户参数错误 |
| 2 | Forkly 未运行 / 不可达 |
| 3 | API 版本不兼容 |
| 4 | 未配对 |
| 5 | 权限不足 |

`--json` 模式下错误同样写入 stdout envelope，便于 Agent 统一处理。

## 能力边界

CLI 遵循与 GUI 相同的产品裁剪：不提供 reset、force push、自动 merge/rebase/stash、删除磁盘项目等操作。完整对照见 [cli-parity.md](../integrations/cli-parity.md)。

## 相关文件

- `cmd/forklyctl/` — 入口
- `internal/cli/` — 命令实现与 HTTP 客户端
- `internal/agentauth/` — 配对与 scope
- `internal/runtimeinfo/` — API 发现与版本协商
