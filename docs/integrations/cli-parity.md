# forklyctl 能力对照表

本文档对照 Forkly **本地 API / Web 控制台** 的用户可见操作与 **`forklyctl` 命令行** 的覆盖情况。状态标记含义：

| 状态 | 含义 |
|------|------|
| `cli_supported` | CLI 可直接完成，参数与 GUI 等价或更明确 |
| `gui_adapted` | CLI 支持，但需显式路径参数、`--yes` 确认，或 `ui open\|reveal` 等替代 GUI 选择器 |
| `intentionally_blocked` | Forkly 产品本身不支持（GUI 与 CLI 均不提供） |

## Coverage

下表按功能域列出主要操作。CLI 命令映射见 `internal/cli/commands.go`。

### 仪表盘（Dashboard）

| 操作 | Local API | Web | CLI | 状态 |
|------|-----------|-----|-----|------|
| 跨项目活动概览 | `GET /dashboard/activity` | 首页活动图表 | `dashboard activity [--days N]` | `cli_supported` |

### 项目生命周期（Project lifecycle）

| 操作 | Local API | Web | CLI | 状态 |
|------|-----------|-----|-----|------|
| 列出已登记项目 | `GET /projects` | 项目列表 | `projects list` | `cli_supported` |
| 解析当前目录所属项目 | — | 自动 | `project current` | `cli_supported` |
| 检查路径是否可登记 | `POST /projects/inspect` | 添加前检查 | `project inspect [path]` | `cli_supported` |
| 添加已有文件夹 | `POST /projects` | 文件夹选择器 | `project add [--path P]` | `gui_adapted` |
| 新建项目文件夹 | `POST /projects` (`create`) | 新建向导 | `project create [--path P] [--name N]` | `gui_adapted` |
| 查看项目元数据 | `GET /projects/{id}` | 项目设置 | `projects list` / `project inspect` | `cli_supported` |
| 重新定位已移动目录 | `POST /projects/{id}/relocate` | 选择新路径 | `project relocate <id> <newPath>` | `gui_adapted` |
| 配置隐藏规则 | `PUT /projects/{id}` | 设置表单 | `project hide-rules <id> --set a,b` | `gui_adapted` |
| 取消登记（不删磁盘） | `DELETE /projects/{id}` | 确认对话框 | `project remove <id> --yes` | `gui_adapted` |
| 删除磁盘上的项目文件夹 | — | — | — | `intentionally_blocked` |
| 从 GitHub 克隆 | `POST /projects/clone` | 克隆向导 | `clone --url U --parent P [--name N]` | `gui_adapted` |

### 文件（Files）

| 操作 | Local API | Web | CLI | 状态 |
|------|-----------|-----|-----|------|
| 浏览文件树（工作区/HEAD） | `GET /projects/{id}/tree` | 文件页目录树 | `files tree [--source worktree\|head]` | `cli_supported` |
| 读取文件内容 | `GET /projects/{id}/content` | 预览/编辑 | `files read --path P` | `gui_adapted` |
| 写入文件内容 | `PUT /projects/{id}/content` | 编辑器保存 | `files write --path P [--content C]` | `gui_adapted` |
| 新建目录 | `POST /projects/{id}/entries` (`dir`) | 右键新建 | `files mkdir --path P` | `gui_adapted` |
| 新建空文件 | `POST /projects/{id}/entries` (`file`) | 右键新建 | `files create --path P` | `gui_adapted` |
| 重命名 | `PATCH /projects/{id}/entries` | 右键重命名 | `files rename --from A --to B` | `gui_adapted` |
| 删除条目 | `DELETE /projects/{id}/entries` | 右键删除 | `files delete --path P --yes` | `gui_adapted` |
| 上传图片资源 | `POST /projects/{id}/assets` | Markdown 插入 | `files upload-asset --markdown <md> --file <image>` | `gui_adapted` |
| 读取二进制资源 | `GET /projects/{id}/asset` | 图片预览 | —（由编辑器/路径参数消费） | `gui_adapted` |

### 版本流（Version flow）

| 操作 | Local API | Web | CLI | 状态 |
|------|-----------|-----|-----|------|
| 工作区状态 / 变更列表 | `GET /projects/{id}/status` | 变更页 | `status [id]` / `changes list [id]` | `cli_supported` |
| 单文件工作区差异 | `GET /projects/{id}/diff` | 差异面板 | `diff [id] --path P` | `gui_adapted` |
| 保存版本（提交） | `POST /projects/{id}/commit` | 保存版本 | `commit [id] --paths a,b --message M` | `gui_adapted` |
| 提交历史列表 | `GET /projects/{id}/history` | 历史时间线 | `history list [id]` | `cli_supported` |
| 提交详情 | `GET /projects/{id}/commits/{sha}` | 历史详情 | `history show <sha> [id]` | `cli_supported` |
| 历史中文件差异 | `GET /projects/{id}/commits/{sha}/diff` | 历史文件 diff | `history show <sha> --path P` | `gui_adapted` |
| Reset / Revert / 丢弃修改 | — | — | — | `intentionally_blocked` |
| 自动 merge / rebase / stash | — | — | — | `intentionally_blocked` |

### 分支（Branches）

| 操作 | Local API | Web | CLI | 状态 |
|------|-----------|-----|-----|------|
| 列出分支 | `GET /projects/{id}/branches` | 分支列表 | `branches list [--q Q]` | `cli_supported` |
| 新建并切换 | `POST /projects/{id}/branches/create` | 新建分支 | `branches create <name>` | `cli_supported` |
| 切换分支 | `POST /projects/{id}/branches/switch` | 切换 | `branches switch <name>` | `cli_supported` |
| 重命名 | `POST /projects/{id}/branches/rename` | 重命名 | `branches rename <old> <new>` | `cli_supported` |
| 安全删除 | `POST /projects/{id}/branches/delete` | 确认删除 | `branches delete <name> --yes` | `gui_adapted` |
| 合并分支 | — | — | — | `intentionally_blocked` |
| 强制删除 / 脏工作区强制切换 | — | — | — | `intentionally_blocked` |

### GitHub 账号（GitHub account）

| 操作 | Local API | Web | CLI | 状态 |
|------|-----------|-----|-----|------|
| 查看已连接账号 | `GET /settings/github` | 设置页 | `github account` | `cli_supported` |
| 搜索可关联仓库 | `GET /github/repos` | 关联向导 | `github repos [--q Q]` | `cli_supported` |
| Device Flow 登录 | `POST /github/device/*` | 浏览器授权 | `github device start\|status\|cancel` | `gui_adapted` |
| PAT 登录 | `POST /github/pat` | 设置粘贴 | `github pat`（stdin） | `gui_adapted` |
| 退出 GitHub | `DELETE /settings/github` | 确认 | `github logout --yes` | `gui_adapted` |

### GitHub 远端同步（Remote sync）

| 操作 | Local API | Web | CLI | 状态 |
|------|-----------|-----|-----|------|
| 远端状态 | `GET /projects/{id}/remote` | 远端面板 | `remote status [id]` | `cli_supported` |
| 关联仓库 | `PUT /projects/{id}/remote` | 关联向导 | `remote link [--url U] [--replace] [--use-existing]` | `gui_adapted` |
| 解除关联 | `DELETE /projects/{id}/remote` | 确认 | `remote unlink [id] --yes [--delete-git-remote]` | `gui_adapted` |
| Fetch | `POST /projects/{id}/remote/fetch` | 同步按钮 | `remote fetch [id] [--no-wait]` | `cli_supported` |
| 快进 Pull | `POST /projects/{id}/remote/pull` | 拉取 | `remote pull [id] [--no-wait]` | `cli_supported` |
| Push | `POST /projects/{id}/remote/push` | 推送 | `remote push [id] [--no-wait]` | `cli_supported` |
| 创建远端空仓库 | `POST /projects/{id}/remote/create-repo` | 创建向导 | `remote create-repo [--name N] [--description D]` | `gui_adapted` |
| 强制推送 | — | — | — | `intentionally_blocked` |
| 查询/取消长操作 | `GET/DELETE /operations/{id}` | 进度条 | `ops status\|cancel <id>` | `cli_supported` |

### 设置（Settings）

| 操作 | Local API | Web | CLI | 状态 |
|------|-----------|-----|-----|------|
| 读取设置 | `GET /settings` | 设置页 | `settings get` | `cli_supported` |
| 更新身份 / 主题 / 后台检查 | `PUT /settings` | 表单 | `settings set [--name N] [--email E] [--theme T] ...` | `gui_adapted` |

### Agent 授权（Agent auth）

| 操作 | Local API | Web | CLI | 状态 |
|------|-----------|-----|-----|------|
| 发起配对 | `POST /agent/pair/start` | — | `pair [--preset P] [--name N]` | `cli_supported` |
| 领取令牌 | `POST /agent/pair/claim` | — | `pair`（轮询内建） | `cli_supported` |
| 批准 / 拒绝配对 | `POST /agent/pair/approve\|deny` | 设置 → 命令行与 AI 工具 | — | `gui_adapted` |
| 查看待批准列表 | `GET /agent/pair/pending` | 设置页 | — | `gui_adapted` |
| 管理已授权客户端 | `GET/DELETE /agent/clients` | 设置页 | — | `gui_adapted` |
| 本地配对状态 / 撤销 | — | — | `auth status` / `auth revoke --yes` | `cli_supported` |
| 列出能力域与预设 | — | — | `capabilities` | `cli_supported` |
| 运行时诊断 | `GET /health` + `runtime/api.json` | — | `doctor` | `cli_supported` |

### 本地文件会话（Local-files）

| 操作 | Local API | Web | CLI | 状态 |
|------|-----------|-----|-----|------|
| 打开仓库外 Markdown | `POST /local-files/open` | 系统“打开方式” | `file open --path P` | `gui_adapted` |
| 读取 / 写入内容 | `GET/PUT /local-files/{id}/content` | 本地编辑页 | `file read\|write --id ID` | `gui_adapted` |
| 查看会话元数据 | `GET /local-files/{id}` | 编辑器标题栏 | `file meta --id ID` | `cli_supported` |
| 打开相对链接 | `POST /local-files/{id}/open-relative` | 编辑器内链 | — | `gui_adapted` |
| 安装 PATH 链接 | `GET/POST /cli/install` | 设置页按钮 | `tools install-cli [--scope user\|system]` | `gui_adapted` |

### UI 辅助（UI helpers）

| 操作 | Local API | Web | CLI | 状态 |
|------|-----------|-----|-----|------|
| 在访达/资源管理器中显示 | `POST /projects/{id}/reveal` | 右键菜单 | `ui reveal --path P` | `gui_adapted` |
| 打开 Web 控制台 | 托盘 / 菜单栏 | 浏览器 | `ui open-console`（返回 `gui_only` 指引） | `gui_adapted` |
| 浏览器会话登录 | `POST /session/dev-login` | 自动 | — | `gui_adapted` |

### 对话框 / 文件夹选择（Dialog / folder picker）

| 操作 | Local API | Web | CLI | 状态 |
|------|-----------|-----|-----|------|
| 原生文件夹选择器 | `POST /dialog/folder` | 添加/克隆向导 | —（改用 `--path` / `--parent`） | `gui_adapted` |

## CLI 命令索引

| 命令 | 说明 |
|------|------|
| `projects` | 项目列表 |
| `project` | 当前项目、检查、添加、创建、重定位、移除、隐藏规则 |
| `status` | 工作区状态 |
| `changes` | 变更列表（同 status） |
| `diff` | 单文件差异 |
| `history` | 提交历史 |
| `commit` | 保存版本 |
| `branches` | 分支管理 |
| `files` | 文件树与读写、资源上传 |
| `file` | 独立 Markdown 会话（open/read/write） |
| `remote` | 远端同步 |
| `clone` | 从 GitHub 克隆 |
| `github` | GitHub 账号 |
| `settings` | 应用设置 |
| `dashboard` | 仪表盘活动 |
| `ops` | 长操作状态 |
| `ui` | 访达显示 / 控制台指引 |
| `tools` | 安装 forklyctl 到 PATH |
| `pair` | Agent 配对 |
| `doctor` | 连接诊断 |
| `capabilities` | 能力域与预设 |
| `auth` | 本地配对令牌 |

全局标志：`--json`、`-j`（机器可读输出）、`--yes`、`-y`（跳过确认）。
