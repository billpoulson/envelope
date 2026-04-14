# Run the Python test suite from the repo root.
# Prefer: pip install pytest. Fallback: unittest discover (same as CI).
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "envelope-python.ps1")
$PythonExe = Get-EnvelopePythonExe
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$pytestOk = $false
try {
  & $PythonExe -m pytest --version 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $pytestOk = $true }
} catch {
  $pytestOk = $false
}

if ($pytestOk) {
  & $PythonExe -m pytest -q --tb=short @args
  exit $LASTEXITCODE
}
& $PythonExe -m unittest discover -s tests -v
exit $LASTEXITCODE
