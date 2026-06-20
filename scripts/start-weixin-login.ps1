$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$AsciiProjectRoot = Join-Path $HOME ".openclaw\coffee-price-project"
$NetworkPreloadPath = Join-Path $AsciiProjectRoot "scripts\openclaw-network-preload.mjs"
$NetworkPreloadUrl = ([System.Uri]$NetworkPreloadPath).AbsoluteUri

if (-not (Test-Path -LiteralPath $NetworkPreloadPath)) {
  throw "Network preload not found at $NetworkPreloadPath. Run .\scripts\install-openclaw-wechat.ps1 first."
}

$previousNodeOptions = $env:NODE_OPTIONS
if ($previousNodeOptions) {
  $env:NODE_OPTIONS = "--import=$NetworkPreloadUrl $previousNodeOptions"
} else {
  $env:NODE_OPTIONS = "--import=$NetworkPreloadUrl"
}

try {
  Push-Location $ProjectRoot
  try {
    npx openclaw channels login --channel openclaw-weixin --verbose
  } finally {
    Pop-Location
  }
} finally {
  if ($null -eq $previousNodeOptions) {
    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
  } else {
    $env:NODE_OPTIONS = $previousNodeOptions
  }
}
