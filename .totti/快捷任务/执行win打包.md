# 任务：执行 Forkly Windows 打包

## 目标

把 Forkly 打包为 Windows 标准安装向导 `.exe`，并验证安装后托盘、内置 Git、Markdown 打开方式都可用。

## 项目信息

- 项目名称：forkly
- 项目路径：`E:\forkly`
- 默认版本：读取根目录 `VERSION`
- 默认架构：`x64`
- 远程地址：`https://github.com/tottiqq7788/forkly.git`
- 安装包产物：`dist\Forkly-版本-windows-x64.exe`
- 安装目录：`%LOCALAPPDATA%\Programs\Forkly`
- 打包工具：Inno Setup 6

## 必须注意的问题

1. Windows 托盘图标必须使用 `.ico`
   - `fyne.io/systray` 在 Windows 下要求传入 `.ico` 内容。
   - 不要把 macOS 的 PNG template icon 直接用于 Windows，否则托盘可能显示为空白。
   - 代码应保持：Windows 使用 `systray.SetIcon(tray_icon_windows.ico)`，macOS 使用 `systray.SetTemplateIcon(...)`。

2. 安装器必须是标准向导
   - 不要再使用静默自解压安装器作为正式产物。
   - 必须使用 Inno Setup 生成有“下一步 / 安装位置 / 任务选择 / 完成”的安装向导。

3. Markdown 打开方式必须在向导中提供选项
   - 安装任务中必须有“将 Markdown 文件（.md 等）默认使用 Forkly 打开”。
   - 该选项默认勾选。
   - 需要写入 `HKCU\Software\Classes\Forkly.Markdown` 和 `.md` 等扩展名关联。
   - Windows 11 可能保护用户已选默认应用；若系统要求用户确认，需要在最终说明中指出。

4. 刷新文件关联不能直接调用 `ie4uinit.exe`
   - 必须使用 Inno 常量：`{sys}\ie4uinit.exe`
   - 必须加 `skipifdoesntexist`
   - 否则部分环境会在安装末尾提示：`Unable to execute file: ie4uinit.exe`

5. 内置 Git 必须是 Windows 版本
   - 使用 `scripts\fetch-git-runtime.ps1 -Platform windows -Arch amd64`
   - 打包后验证：`git\cmd\git.exe --version`
   - 期望类似：`git version 2.53.0.windows.3`

## 首次准备

1. 确认 Inno Setup 6 是否可用：

   ```powershell
   Get-Command ISCC.exe -ErrorAction SilentlyContinue
   Test-Path "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
   Test-Path "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
   Test-Path "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
   ```

2. 如未安装，执行：

   ```powershell
   winget install --id JRSoftware.InnoSetup -e --accept-package-agreements --accept-source-agreements --disable-interactivity
   ```

3. 安装后如果当前 Shell 找不到 `ISCC.exe`，不要失败退出；打包脚本应自动查找：

   ```text
   %LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe
   %ProgramFiles(x86)%\Inno Setup 6\ISCC.exe
   %ProgramFiles%\Inno Setup 6\ISCC.exe
   ```

## 打包前检查

1. 进入项目根目录：

   ```powershell
   Set-Location E:\forkly
   ```

2. 检查当前状态：

   ```powershell
   git status --short --branch
   git diff --stat
   ```

3. 运行后端测试：

   ```powershell
   go test ./...
   ```

4. 运行前端构建：

   ```powershell
   Set-Location E:\forkly\web
   npm install
   npm run build
   Set-Location E:\forkly
   ```

## 正式打包

推荐直接执行：

```powershell
Set-Location E:\forkly
powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1 -Arch x64
```

如需 arm64：

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1 -Arch arm64
```

脚本必须完成以下步骤：

1. 构建 Web UI：

   ```powershell
   cd web
   npm install
   npm run build
   cd ..
   ```

2. 下载并校验 Windows dugite-native Git：

   ```powershell
   scripts\fetch-git-runtime.ps1 -Platform windows -Arch amd64
   ```

3. 构建 Windows GUI 程序：

   ```powershell
   $env:GOOS = "windows"
   $env:GOARCH = "amd64"
   $env:CGO_ENABLED = "1"
   go build -ldflags "-H windowsgui -X github.com/forkly-app/forkly/internal/app.Version=版本号" -o dist\windows-x64\Forkly\Forkly.exe .\cmd\forkly
   ```

4. 拷贝运行时文件：

   ```text
   dist\windows-x64\Forkly\Forkly.exe
   dist\windows-x64\Forkly\git\
   dist\windows-x64\Forkly\LICENSE.txt
   dist\windows-x64\Forkly\README-Windows.txt
   dist\windows-x64\Forkly\VERSION
   ```

5. 使用 Inno Setup 编译：

   ```powershell
   ISCC.exe `
     "/DMyAppVersion=版本号" `
     "/DMyAppArch=x64" `
     "/DMyAppStage=E:\forkly\dist\windows-x64\Forkly" `
     E:\forkly\packaging\windows\Forkly.iss
   ```

## 打包产物检查

1. 查看安装包：

   ```powershell
   Get-Item E:\forkly\dist\Forkly-*-windows-x64.exe
   Get-FileHash -Algorithm SHA256 E:\forkly\dist\Forkly-*-windows-x64.exe
   ```

2. 验证 staged 应用内置 Git：

   ```powershell
   E:\forkly\dist\windows-x64\Forkly\git\cmd\git.exe --version
   ```

3. 验证 staged 应用可启动本地 API：

   ```powershell
   $env:FORKLY_SERVER_ONLY = "1"
   $env:FORKLY_LISTEN = "127.0.0.1:18787"
   $env:FORKLY_DATA_DIR = "E:\forkly\.tmp-win-verify"
   $env:FORKLY_SKIP_BROWSER = "1"
   Start-Process -FilePath "E:\forkly\dist\windows-x64\Forkly\Forkly.exe"
   Invoke-WebRequest -Uri "http://127.0.0.1:18787/local-api/v1/health" -UseBasicParsing -TimeoutSec 10
   Get-Process Forkly -ErrorAction SilentlyContinue | Stop-Process -Force
   Remove-Item -Recurse -Force "E:\forkly\.tmp-win-verify" -ErrorAction SilentlyContinue
   ```

## 安装验证

1. 先关闭旧进程：

   ```powershell
   Get-Process Forkly -ErrorAction SilentlyContinue | Stop-Process -Force
   ```

2. 静默安装验证：

   ```powershell
   $installer = "E:\forkly\dist\Forkly-0.1.36-windows-x64.exe"
   $p = Start-Process -FilePath $installer -ArgumentList `
     "/VERYSILENT", `
     "/SUPPRESSMSGBOXES", `
     "/NORESTART", `
     "/TASKS=markdownassoc", `
     "/MERGETASKS=!desktopicon", `
     "/NOICONS" `
     -Wait -PassThru
   $p.ExitCode
   ```

3. 检查安装目录：

   ```powershell
   $installDir = Join-Path $env:LOCALAPPDATA "Programs\Forkly"
   Test-Path (Join-Path $installDir "Forkly.exe")
   & (Join-Path $installDir "git\cmd\git.exe") --version
   ```

4. 检查 Markdown 关联：

   ```powershell
   (Get-ItemProperty -Path Registry::HKEY_CURRENT_USER\Software\Classes\.md -ErrorAction SilentlyContinue)."(default)"
   (Get-ItemProperty -Path Registry::HKEY_CURRENT_USER\Software\Classes\Forkly.Markdown\shell\open\command -ErrorAction SilentlyContinue)."(default)"
   ```

5. 手动安装验证：

   - 双击 `dist\Forkly-版本-windows-x64.exe`
   - 确认出现标准安装向导
   - 确认能选择安装位置
   - 确认“将 Markdown 文件（.md 等）默认使用 Forkly 打开”默认勾选
   - 安装完成后启动 Forkly
   - 查看 Windows 托盘图标不是空白
   - 右键或点击托盘图标，能打开控制台
   - 双击 `.md` 文件，能用 Forkly 打开或至少出现在“打开方式”列表中

## 常见问题与处理

### 1. 安装器不像标准软件，没有“下一步”

原因：误用了旧的自解压安装器。

处理：

- 必须使用 `packaging\windows\Forkly.iss`
- 必须通过 Inno Setup `ISCC.exe` 生成安装包
- 不要把 Go 自解压安装器作为正式 Windows 安装包

### 2. 安装末尾提示 `Unable to execute file: ie4uinit.exe`

原因：安装器直接调用 `ie4uinit.exe`，PATH 中找不到。

处理：

- Inno `[Run]` 中必须写：

  ```ini
  Filename: "{sys}\ie4uinit.exe"; Parameters: "-show"; Flags: runhidden skipifdoesntexist; Tasks: markdownassoc
  ```

### 3. Windows 托盘图标为空白

原因：Windows 下传入 PNG/template icon。

处理：

- 必须存在 `internal\app\assets\tray_icon_windows.ico`
- Windows 下必须调用 `systray.SetIcon(trayWindowsIconBytes())`
- macOS 下继续调用 `systray.SetTemplateIcon(...)`
- 重新安装前先退出旧 Forkly 进程

### 4. `.md` 没有立即成为 Forkly 默认打开方式

原因：Windows 10/11 对默认应用有 UserChoice 保护，可能不会完全接受安装器强写。

处理：

- 安装器必须注册 `Forkly.Markdown`
- 安装器任务默认勾选 Markdown 关联
- 最终说明中提示：如系统仍保留旧默认程序，请在“打开方式”中选择 Forkly 并勾选始终使用。

### 5. `ISCC.exe not found`

处理：

```powershell
winget install --id JRSoftware.InnoSetup -e --accept-package-agreements --accept-source-agreements --disable-interactivity
```

安装后重新打开 PowerShell，或让脚本自动查找 `%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe`。

## 输出要求

- 全程使用中文。
- 必须说明安装包路径、大小和 SHA256。
- 必须说明 `go test ./...`、`npm run build`、Inno 编译、静默安装验证结果。
- 如果安装包未签名，必须提示 Windows SmartScreen 可能显示“未知发布者”。
- 打包失败时必须说明失败命令、错误摘要和下一步处理建议。
