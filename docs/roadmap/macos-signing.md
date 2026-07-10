# macOS 打包与公证

## 本地未签名包

```bash
make package-macos ARCH=arm64
# 或
make package-macos ARCH=amd64
```

产物：`dist/Forkly-0.1.0-macOS-arm64.dmg` / `dist/Forkly-0.1.0-macOS-x64.dmg`

## 签名与公证

需要：

1. 完整 Xcode（不仅是 Command Line Tools）
2. Apple Developer Program
3. Developer ID Application 证书
4. `notarytool` keychain profile

```bash
export FORKLY_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export FORKLY_NOTARY_PROFILE="forkly-notary"
make package-macos ARCH=arm64
make package-macos ARCH=amd64
```

脚本会：

1. 校验并嵌入 dugite-native Git
2. 从内到外签名 Git 可执行文件与主程序
3. 签名 `.app` 与 DMG
4. 对 DMG 提交 notarytool 并 staple

## 验证

```bash
codesign --verify --deep --strict dist/Forkly.app
spctl --assess --type open --verbose dist/Forkly-0.1.0-macOS-arm64.dmg
```
