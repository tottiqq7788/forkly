# Forkly

Forkly 是一套基于标准 Git 的本地项目文件版本协作工具。

## 0.1.0 范围

本版本是 **macOS 本地客户端**：菜单栏常驻进程 + 浏览器本地控制台，完成安全的可视化 Git 闭环。

包含：

- 添加 / 新建本地项目并初始化 Git
- 查看变更状态、目录与状态筛选
- 文本差异、图片前后预览、二进制元数据
- 按文件保存版本、历史与提交详情
- 内置 Git 运行时、Developer ID 签名与公证 DMG

不做：企业服务端、远端同步、分支操作、Markdown、自动更新、Windows 发布物。

详细边界见 [docs/roadmap/Forkly-0.1-范围.md](docs/roadmap/Forkly-0.1-范围.md)。

## 开发

要求：Go 1.26+、Node 20+、macOS。

```bash
# 安装依赖并启动开发模式（Go API + Vite）
make dev

# 仅构建 Go 二进制（开发用，可回退系统 Git）
make build

# 下载内置 Git 并打包 .app / DMG（需完整 Xcode 与签名证书才能公证）
make package-macos ARCH=arm64
```

## 许可证

应用代码见 [LICENSE](LICENSE)。内置 Git 遵循 GPLv2，见 `third_party/git/`。
