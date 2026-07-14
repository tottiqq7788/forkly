param(
  [string]$Version = "",
  [ValidateSet("x64", "amd64", "arm64")]
  [string]$Arch = "x64"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = (Get-Content (Join-Path $root "VERSION") -Raw).Trim()
}

$goArch = if ($Arch -eq "arm64") { "arm64" } else { "amd64" }
$label = if ($goArch -eq "arm64") { "arm64" } else { "x64" }
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "windows-$label"
$appDir = Join-Path $stage "Forkly"
$installer = Join-Path $dist "Forkly-$Version-windows-$label.exe"

New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path $stage) {
  Remove-Item -Recurse -Force $stage
}
New-Item -ItemType Directory -Force -Path $appDir | Out-Null

Write-Host "== Build web UI =="
Push-Location (Join-Path $root "web")
npm install
npm run build
Pop-Location

Write-Host "== Fetch Windows Git runtime =="
& (Join-Path $root "scripts\fetch-git-runtime.ps1") -Platform windows -Arch $goArch

Write-Host "== Build Forkly.exe =="
$env:GOOS = "windows"
$env:GOARCH = $goArch
$env:CGO_ENABLED = "1"
$ldflags = "-H windowsgui -X github.com/forkly-app/forkly/internal/app.Version=$Version -X github.com/forkly-app/forkly/internal/github.ClientID=$env:FORKLY_GITHUB_CLIENT_ID"
go build -ldflags $ldflags -o (Join-Path $appDir "Forkly.exe") .\cmd\forkly
go build -o (Join-Path $appDir "forkly-askpass.exe") .\cmd\forkly-askpass
$ctlLdflags = "-X github.com/forkly-app/forkly/internal/cli.Version=$Version"
go build -ldflags $ctlLdflags -o (Join-Path $appDir "forklyctl.exe") .\cmd\forklyctl

Write-Host "== Stage runtime files =="
Copy-Item -Recurse -Force (Join-Path $root "third_party\git") (Join-Path $appDir "git")
Copy-Item -Force (Join-Path $root "LICENSE") (Join-Path $appDir "LICENSE.txt")
Copy-Item -Force (Join-Path $root "VERSION") (Join-Path $appDir "VERSION")
@"
Forkly $Version for Windows ($label)

This package installs per-user to:
%LOCALAPPDATA%\Programs\Forkly

The application uses the Windows system tray. Markdown files can be opened with
Forkly via Windows "Open with" after installation.
"@ | Set-Content -Encoding UTF8 (Join-Path $appDir "README-Windows.txt")

Write-Host "== Build Inno Setup installer =="
if (Test-Path $installer) {
  Remove-Item -Force $installer
}

$iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if (-not $iscc) {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      $iscc = Get-Item $candidate
      break
    }
  }
}
if (-not $iscc) {
  throw "ISCC.exe not found. Install Inno Setup 6 first, for example: winget install --id JRSoftware.InnoSetup -e"
}
$isccPath = if ($iscc.Source) { $iscc.Source } else { $iscc.FullName }

$iss = Join-Path $root "packaging\windows\Forkly.iss"
& $isccPath `
  "/DMyAppVersion=$Version" `
  "/DMyAppArch=$label" `
  "/DMyAppStage=$appDir" `
  $iss

Write-Host "Built $installer"
