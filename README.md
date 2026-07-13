# Forkly

Forkly 是一套基于标准 Git 的项目文件版本协作工具。它希望让不熟悉 Git 命令的人，也能像使用普通文件夹一样修改代码、Markdown 和项目资料，并用清晰的界面理解“改了什么、保存到哪里、是否已经进入可信主线”。

当前仓库落地 macOS 本地客户端（当前版本见仓库根目录 `VERSION`）：菜单栏常驻进程 + 浏览器本地控制台，用来验证可视化 Git 的核心体验。

## 产品定位

Forkly 不打算重新实现 Git，也不打算复制 GitLab 或 GitHub 的完整研发平台。它的核心目标是：

- 用普通用户能理解的语言包装 Git 操作。
- 让本地文件夹拥有清晰、可追溯的版本历史。
- 让用户明确区分“文件已保存”和“版本已保存”。
- 在未来多人协作版本中，让负责人通过可视化审查保护唯一可信的 `main` 主线。
- 保持标准 Git 兼容，避免把企业数据锁进专有格式。

长期产品会包含本地客户端和企业自托管服务端。当前本地客户端不包含服务端和多人协作能力。

## 本地客户端功能范围

当前版本是 macOS 本地可视化 Git 管理工具。

包含：

- macOS 菜单栏常驻应用。
- 使用系统默认浏览器打开本地 Web 控制台。
- 首页数据概览：跨项目版本活动与待保存变更统计。
- 新建或添加本地项目文件夹。
- 对普通文件夹初始化 Git 仓库。
- 查看新增、修改、删除、重命名、未跟踪和冲突状态。
- 按目录和状态筛选变更文件；变更页左侧文件树支持折叠，并通过右键菜单查看差异、加入/移出本次保存、复制路径与在访达中显示。
- 查看工作区文本统一差异、图片前后预览，以及对二进制文件显示元数据。
- 浏览项目文件：默认进入「文件」页；目录（磁盘当前内容）与版本（最近一次保存）对照，左侧目录树、右侧预览；目录视图支持通过右键菜单新建、重命名、删除空文件夹/文件、复制路径和在访达中显示，版本视图保持只读。Markdown 在文件树底部可切换预览/源码。
- Markdown 安全预览与独立编辑：工作区可编辑的 Markdown 通过文件行悬停「编辑」在浏览器新标签打开全屏编辑页（目录、所见即所得编辑区、分类格式工具栏）；左侧标题目录底部可切换「预览 / 源码」（源码为可编辑 CodeMirror）；目录支持折叠与右键菜单（定位、复制标题/安全锚点/Markdown 链接、复制大纲）；自动保存与冲突保护；版本（HEAD）与不可编辑文件保持预览/源码只读。支持仓库内相对图片/链接与 HTTPS 远程图片。
- macOS 可将 Forkly 设为 Markdown 的打开方式：访达双击 `.md` 等文件时，在浏览器打开与项目无关的独立本地编辑页（不创建项目、不要求 Git）；首次需在「打开方式」中选择 Forkly，应用不会强制改写系统默认关联。
- 选择一个或多个文件保存版本；首次保存前引导设置 Git 身份。
- 查看提交历史与提交详情，并支持查看历史中某个文件的文本差异；历史页左侧时间线支持折叠，并通过右键菜单复制 SHA/说明、查看详情与刷新。
- 项目维护：在访达中显示、重新定位已移动的文件夹、配置文件树隐藏规则（默认隐藏 `*.DS*`）、从 Forkly 移除登记（不删磁盘文件）。
- 本地分支管理：查看、搜索、切换、新建并切换、重命名与安全删除；工作区有未保存修改时禁止切换。
- 检测未完成 merge、rebase、cherry-pick、revert、detached HEAD 和 `index.lock` 等阻断状态。
- 嵌入 dugite-native Git 运行时，避免依赖用户预装 Git。
- 打包 macOS `.app` / `.dmg` 与 Windows 安装包。

不包含：

- 企业服务端。
- 账号、组织、权限、审计后台。
- Clone、Fetch、Pull、Push 等远端同步。
- 分支合并、强制删除、自动 stash / 强制切换。
- 内置冲突解决器。
- 丢弃修改、reset、revert 等高风险写操作。
- PlantUML 远端渲染（首期从快捷插入隐藏）。
- Git LFS。
- AI 功能。
- 自动更新。
- 强制改写系统默认 Markdown 打开方式（仅声明可编辑，由用户首次在「打开方式」中选择 Forkly）。

更细的裁剪边界见 [docs/roadmap/Forkly-0.1-范围.md](docs/roadmap/Forkly-0.1-范围.md)。

## 核心使用流程

```text
本地项目文件夹
    ↓ 添加到 Forkly
查看文件变化
    ↓ 选择文件
保存版本
    ↓
查看历史与差异
```

在 `0.1.0` 中，“保存版本”就是创建一个 Git commit。它不会自动上传，不会自动合并，也不会修改远程仓库。

## 技术架构

```text
macOS Menu Bar / Windows System Tray
    ↓
Go Client Process
    ├── Local HTTP API
    ├── Embedded React Web UI
    ├── Git Operation Executor
    ├── Project Registry
    ├── File Watcher
    ├── Config Store
    └── Diagnostics Logger
            ↓
      Bundled Git Runtime
```

主要技术选择：

- 后端 / 本地进程：Go。
- 菜单栏：`fyne.io/systray`。
- 文件监听：`fsnotify`。
- Web 前端：React、TypeScript、Vite、Tailwind CSS v4。
- 图标：Phosphor Icons。
- 数据请求：TanStack Query。
- Git 运行时：`desktop/dugite-native`。

本地 API 只绑定 `127.0.0.1`，并使用短期浏览器会话、CSRF 请求头、Host / Origin 校验、CSP 和 Go `http.CrossOriginProtection` 降低本地端口被恶意网页调用的风险。

## 目录结构

```text
cmd/forkly/                 Go 程序入口
internal/app/               应用生命周期、菜单栏和启动编排
internal/localapi/          本地 HTTP API
internal/session/           本地浏览器会话和 CSRF
internal/gitexec/           Git 参数化执行、状态、差异、提交、历史
internal/project/           项目登记、添加、初始化、重新定位
internal/watcher/           文件变化监听
internal/config/            本地配置存储
internal/diagnostics/       日志与诊断
internal/platform/          平台适配层
internal/webui/             嵌入式前端产物
web/                        React/Vite 前端源码
packaging/macos/            macOS 打包脚本
scripts/                    工具脚本
tools/git-runtime/          内置 Git manifest 和缓存目录
docs/                       架构、路线图与打包说明
.totti/                     产品文档和快捷任务
```

## 开发环境

要求：

- macOS
- Go 1.26+
- Node.js 20+
- npm
- Git

首次安装前端依赖：

```bash
cd web
npm install
cd ..
```

运行测试：

```bash
go test ./...
```

构建前端：

```bash
cd web
npm run build
cd ..
```

构建 Go 二进制：

```bash
make build
```

## 开发预览

推荐双终端（无需菜单栏）：

```bash
# 终端 1：本地 API（固定 :8787，开启 dev-login）
FORKLY_DEV=1 go run ./cmd/forkly

# 终端 2：Vite
cd web && npm run dev -- --host 127.0.0.1
```

或使用 `make preview-api` / `make preview-web`。

打开 `http://127.0.0.1:5173/`，前端会在开发模式下自动建立会话。

正式 App 流程仍是：

```bash
go run ./cmd/forkly
```

然后点击 macOS 菜单栏里的 Forkly 图标，选择「打开控制台」。

## macOS 打包

打包当前 Mac 架构：

```bash
make package-macos ARCH=arm64
```

打包 x64：

```bash
make package-macos ARCH=amd64
```

产物位于：

```text
dist/Forkly-0.1.0-macOS-arm64.dmg
dist/Forkly-0.1.0-macOS-x64.dmg
```

签名和公证需要完整 Xcode、Apple Developer Program、Developer ID Application 证书和 `notarytool` profile。详见 [docs/roadmap/macos-signing.md](docs/roadmap/macos-signing.md)。

## 安全原则

- Git 操作使用明确参数调用，不通过 Shell 拼接命令。
- 每个仓库的写操作串行执行。
- 写接口必须经过本地会话和 CSRF 校验。
- API 不接受任意绝对路径读取项目文件。
- 路径需要规范化，符号链接不能逃逸项目根目录。
- 不自动执行 reset、abort 等破坏性修复；分支切换仅在工作区干净时允许，且不做强制 checkout / stash。
- 不修改用户全局 Git 配置。
- 日志不得记录 Token、密码、文件正文或远程凭据。

## 当前状态

`0.1.0` 已具备首个本地客户端基线：

- 本地提交：`062bef7 初始化 Forkly 本地客户端`
- GitHub 远程：`https://github.com/tottiqq7788/forkly.git`
- 默认分支：`main`

远程仓库信息见 [.totti/文档/GitHub远程仓库信息.md](.totti/文档/GitHub远程仓库信息.md)。

## 路线图

后续方向来自产品文档：

- 恢复远端同步、隔离工作区和服务端主线保护。
- 合并申请、审查、评论和负责人合并流程。
- PlantUML 授权渲染。
- Git LFS、大文件锁和对象存储。
- 备份、恢复、审计和管理后台。
- AI 修改来源声明、提交说明建议和审查辅助。

完整产品需求见 [.totti/文档/产品文档.md](.totti/文档/产品文档.md)。

## 许可证

应用代码见 [LICENSE](LICENSE)。

Forkly 打包时会嵌入 Git 运行时。Git 遵循 GPLv2，相关说明见 [third_party/NOTICE.md](third_party/NOTICE.md) 和 [tools/git-runtime/manifest.json](tools/git-runtime/manifest.json)。
