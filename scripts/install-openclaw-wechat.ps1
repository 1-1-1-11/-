param(
  [switch]$Login
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$AsciiProjectRoot = Join-Path $HOME ".openclaw\coffee-price-project"
$GatewayPort = "18789"
$CoffeeConfigPath = Join-Path $AsciiProjectRoot "config\coffee-price.config.json"
$CoffeeExampleConfigPath = Join-Path $AsciiProjectRoot "config\coffee-price.config.example.json"
$CoffeeSnapshotPath = Join-Path $AsciiProjectRoot "config\snapshots\meituan.json"
$CoffeeExampleSnapshotPath = Join-Path $AsciiProjectRoot "config\snapshots\meituan.example.json"
$NetworkPreloadPath = Join-Path $AsciiProjectRoot "scripts\openclaw-network-preload.mjs"
$NetworkPreloadUrl = ([System.Uri]$NetworkPreloadPath).AbsoluteUri
$OpenClawWeixinNodeOptions = "--import=$NetworkPreloadUrl"

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-OpenClaw {
  if (Test-Command "openclaw") {
    & openclaw @args
  } else {
    & npx openclaw @args
  }
}

function Invoke-OpenClawWithNetworkPreload {
  $previousNodeOptions = $env:NODE_OPTIONS
  if ($previousNodeOptions) {
    $env:NODE_OPTIONS = "$OpenClawWeixinNodeOptions $previousNodeOptions"
  } else {
    $env:NODE_OPTIONS = $OpenClawWeixinNodeOptions
  }
  try {
    Invoke-OpenClaw @args
  } finally {
    if ($null -eq $previousNodeOptions) {
      Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
    } else {
      $env:NODE_OPTIONS = $previousNodeOptions
    }
  }
}

function Ensure-AsciiProjectJunction {
  if (Test-Path -LiteralPath $AsciiProjectRoot) {
    $item = Get-Item -LiteralPath $AsciiProjectRoot
    if ($item.LinkType -eq "Junction") {
      return
    }
    throw "$AsciiProjectRoot exists but is not a junction. Refusing to overwrite it."
  }
  New-Item -ItemType Junction -Path $AsciiProjectRoot -Target $ProjectRoot | Out-Null
}

function Repair-GatewayWrapper {
  $gatewayScript = Join-Path $HOME ".openclaw\gateway.cmd"
  $openclawEntry = Join-Path $AsciiProjectRoot "node_modules\openclaw\dist\index.js"
  $content = @"
@echo off
rem OpenClaw Gateway (v2026.6.8)
set "HOME=$HOME"
set "TMPDIR=$env:LOCALAPPDATA\Temp"
set "OPENCLAW_GATEWAY_PORT=$GatewayPort"
set "OPENCLAW_SYSTEMD_UNIT=openclaw-gateway.service"
set "OPENCLAW_WINDOWS_TASK_NAME=OpenClaw Gateway"
set "OPENCLAW_SERVICE_MARKER=openclaw"
set "OPENCLAW_SERVICE_KIND=gateway"
set "OPENCLAW_SERVICE_VERSION=2026.6.8"
set "OPENCLAW_WEIXIN_NODE_OPTIONS=$OpenClawWeixinNodeOptions"
set "NODE_OPTIONS=$OpenClawWeixinNodeOptions"
"C:\Program Files\nodejs\node.exe" "$openclawEntry" gateway --port $GatewayPort
"@
  Set-Content -LiteralPath $gatewayScript -Value $content -Encoding ascii
}

Write-Host "Checking Node and npm..."
if (-not (Test-Command "node")) {
  throw "Node.js is required. OpenClaw requires Node 22.19+; Node 24 is recommended."
}
if (-not (Test-Command "npm")) {
  throw "npm is required."
}

$nodeVersion = (& node --version).Trim()
Write-Host "Node: $nodeVersion"

Write-Host "OpenClaw:"
Invoke-OpenClaw --version

Write-Host "Preparing ASCII project path for Windows Scheduled Task..."
Ensure-AsciiProjectJunction

if (-not (Test-Path -LiteralPath $CoffeeConfigPath) -and (Test-Path -LiteralPath $CoffeeExampleConfigPath)) {
  Write-Host "Creating coffee-price.config.json from example..."
  Copy-Item -LiteralPath $CoffeeExampleConfigPath -Destination $CoffeeConfigPath
}
if (-not (Test-Path -LiteralPath $CoffeeSnapshotPath) -and (Test-Path -LiteralPath $CoffeeExampleSnapshotPath)) {
  Write-Host "Creating sample meituan snapshot from example..."
  Copy-Item -LiteralPath $CoffeeExampleSnapshotPath -Destination $CoffeeSnapshotPath
}

Write-Host "Installing coffee-price OpenClaw plugin from ASCII project path..."
Push-Location $AsciiProjectRoot
try {
  Invoke-OpenClaw plugins install . --force
} finally {
  Pop-Location
}
Invoke-OpenClaw config set plugins.entries.coffee-price.enabled true
Invoke-OpenClaw config set plugins.entries.coffee-price.config.configPath $CoffeeConfigPath
Invoke-OpenClaw config set plugins.entries.coffee-price.config.snapshotPaths.meituan $CoffeeSnapshotPath

Write-Host "Installing Tencent Weixin channel plugin..."
npx -y @tencent-weixin/openclaw-weixin-cli install
Invoke-OpenClaw config set plugins.entries.openclaw-weixin.enabled true
Invoke-OpenClaw config set session.dmScope per-account-channel-peer

Write-Host "Installing OpenClaw Gateway scheduled task..."
Push-Location $AsciiProjectRoot
try {
  Invoke-OpenClaw gateway install --force --port $GatewayPort
} finally {
  Pop-Location
}
Repair-GatewayWrapper
schtasks /Run /TN "OpenClaw Gateway"

Write-Host "Weixin channel status:"
Invoke-OpenClaw plugins list
Invoke-OpenClaw channels status --probe

if ($Login) {
  Write-Host "Starting Weixin QR login..."
  Invoke-OpenClawWithNetworkPreload channels login --channel openclaw-weixin
} else {
  Write-Host "Run this when ready to scan QR login:"
  Write-Host "`$env:NODE_OPTIONS='$OpenClawWeixinNodeOptions'; openclaw channels login --channel openclaw-weixin"
}

Write-Host "If Windows cannot find openclaw after npm install, run:"
Write-Host "npm config get prefix"
Write-Host "Then add that folder to the user PATH and reopen Windows PowerShell or PowerShell."
