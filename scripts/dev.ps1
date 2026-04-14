# Run FastAPI (reload) and the Vite dev server. Requires: pip install -r requirements.txt, npm install in frontend/
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "envelope-python.ps1")
$PythonExe = Get-EnvelopePythonExe
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
$port = if ($env:PORT) { $env:PORT } else { "8000" }

$uv = Start-Process -FilePath $PythonExe -ArgumentList @(
  "-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", $port
) -PassThru -WindowStyle Hidden

try {
  if (-not (Test-Path "frontend/node_modules")) {
    Write-Host "Installing frontend dependencies..."
    Push-Location frontend
    npm install
    Pop-Location
  }
  Push-Location (Join-Path $Root "frontend")
  npm run dev
}
finally {
  if ($uv -and -not $uv.HasExited) {
    Stop-Process -Id $uv.Id -Force -ErrorAction SilentlyContinue
  }
}
