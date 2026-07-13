param(
  [ValidateSet("darwin", "windows")]
  [string]$Platform = $(if ($IsWindows -or $env:OS -eq "Windows_NT") { "windows" } else { "darwin" }),
  [string]$Arch = "amd64"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$manifestPath = Join-Path $root "tools\git-runtime\manifest.json"
$out = Join-Path $root "third_party\git"

if ($Arch -in @("x64", "x86_64")) {
  $Arch = "amd64"
}
if ($Arch -notin @("amd64", "arm64")) {
  throw "Unsupported arch: $Arch"
}

$key = "$Platform-$Arch"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$artifact = $manifest.artifacts.PSObject.Properties[$key].Value
if (-not $artifact) {
  throw "No git runtime artifact configured for $key"
}

$cacheDir = Join-Path $root "tools\git-runtime\cache"
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
$cache = Join-Path $cacheDir $artifact.filename

if (-not (Test-Path $cache)) {
  Write-Host "Downloading $($artifact.url)"
  Invoke-WebRequest -Uri $artifact.url -OutFile $cache
}

$actual = (Get-FileHash -Algorithm SHA256 $cache).Hash.ToLowerInvariant()
$expected = [string]$artifact.sha256
if ($actual -ne $expected.ToLowerInvariant()) {
  throw "SHA256 mismatch: expected $expected got $actual"
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("forkly-git-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  tar -xzf $cache -C $tmp

  if (Test-Path $out) {
    Remove-Item -Recurse -Force $out
  }
  New-Item -ItemType Directory -Force -Path $out | Out-Null

  $probeName = if ($Platform -eq "windows") { "cmd" } else { "bin" }
  $probe = Get-ChildItem -Path $tmp -Recurse -Directory -Filter $probeName | Select-Object -First 1
  if (-not $probe) {
    throw "Cannot locate git runtime layout in archive"
  }
  $runtimeRoot = Split-Path $probe.FullName -Parent
  Copy-Item -Recurse -Force (Join-Path $runtimeRoot "*") $out

  $licenseDir = Join-Path $out "licenses"
  New-Item -ItemType Directory -Force -Path $licenseDir | Out-Null
  @"
This application bundles Git from desktop/dugite-native ($key).
Git is licensed under GPL-2.0.
Source: https://github.com/git/git
Bundled via: https://github.com/desktop/dugite-native
See tools/git-runtime/manifest.json for exact version and checksums.
"@ | Set-Content -Encoding UTF8 (Join-Path $licenseDir "NOTICE.txt")

  Write-Host "Git runtime ready at $out (key=$key)"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
