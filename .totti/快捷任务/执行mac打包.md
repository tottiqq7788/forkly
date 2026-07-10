# 任务：执行 Forkly macOS 打包

## 目标

把 Forkly 打包为 macOS `.app` 和 `.dmg` 文件。

## 项目信息

- 项目名称：forkly
- 项目路径：`/Users/totti/个人/project/mod/forkly`
- 默认版本：`0.1.0`
- 默认架构：`arm64`
- 远程地址：`https://github.com/tottiqq7788/forkly.git`

## 普通本地打包

1. 进入项目根目录：

   ```bash
   cd /Users/totti/个人/project/mod/forkly
   ```

2. 打包当前 Mac 架构：

   ```bash
   make package-macos ARCH=arm64
   ```

3. 如需打包 x64：

   ```bash
   make package-macos ARCH=amd64
   ```

4. 查看产物：

   ```bash
   ls -lh dist/*.dmg
   file dist/Forkly.app/Contents/MacOS/forkly
   dist/Forkly.app/Contents/Resources/git/bin/git --version
   ```

## 签名与公证打包

如果已经配置 Apple Developer ID 和 `notarytool` 凭据：

```bash
export FORKLY_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export FORKLY_NOTARY_PROFILE="forkly-notary"
make package-macos ARCH=arm64
```

验证：

```bash
codesign --verify --deep --strict dist/Forkly.app
spctl --assess --type open --verbose dist/Forkly-0.1.0-macOS-arm64.dmg
```

## 输出要求

- 全程使用中文。
- 打包前先运行：

  ```bash
  go test ./...
  cd web && npm run build && cd ..
  ```

- 如果缺少完整 Xcode、签名证书或 `notarytool`，说明只能产出未公证本地包。
- 打包失败时说明失败命令、错误摘要和下一步建议。
