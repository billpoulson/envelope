# Production-style API server (same defaults as the container CMD).
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "envelope-python.ps1")
$PythonExe = Get-EnvelopePythonExe
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
if (-not (Test-Path (Join-Path $Root ".env"))) {
  Write-Host "No .env in repo root. Copy .env.example to .env and set ENVELOPE_MASTER_KEY and ENVELOPE_SESSION_SECRET." -ForegroundColor Yellow
}
$port = if ($env:PORT) { $env:PORT } else { "8080" }
$hostBind = if ($env:HOST) { $env:HOST } else { "0.0.0.0" }
$fwd = if ($env:FORWARDED_ALLOW_IPS) { $env:FORWARDED_ALLOW_IPS } else { "127.0.0.1" }
$uvicornArgs = @(
  "app.main:app",
  "--host", $hostBind,
  "--port", $port,
  "--forwarded-allow-ips", $fwd
)
if ($env:ENVELOPE_ROOT_PATH) {
  $uvicornArgs += @("--root-path", $env:ENVELOPE_ROOT_PATH)
}
& $PythonExe -m uvicorn @uvicornArgs
