# ADR 0001: 本地客户端架构

## 状态

已采纳（0.1.0）

## 决策

- Go 常驻进程 + 菜单栏（fyne.io/systray）
- 嵌入式 React/Vite 前端，仅绑定 127.0.0.1
- 通过参数化调用内置 dugite-native Git，不经 Shell
- 平台能力经 `internal/platform` 适配层隔离

## 后果

- 浏览器控制台需短期会话与 CSRF 防护
- 分发需签名嵌套 Git 可执行文件并公证 DMG
- Windows 可后续实现同一接口而不改业务层
