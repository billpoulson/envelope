# Resolve a Python 3.10+ executable. On Windows, `python` often points at an old install; prefer `py -3.12` etc.
function Get-EnvelopePythonExe {
  # `py -3.13` writes "No suitable Python" to stderr; under $ErrorActionPreference = Stop that would throw.
  $savedEA = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try {
    $check = 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'
    if (Get-Command py -ErrorAction SilentlyContinue) {
      foreach ($suffix in @("3.13", "3.12", "3.11", "3.10")) {
        $null = & py "-$suffix" -c $check 2>&1
        if ($LASTEXITCODE -eq 0) {
          $exe = (& py "-$suffix" -c "import sys; print(sys.executable)" 2>&1).Trim()
          if ($exe) { return $exe }
        }
      }
    }
    foreach ($name in @("python3", "python")) {
      if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { continue }
      $null = & $name -c $check 2>&1
      if ($LASTEXITCODE -eq 0) {
        return (Get-Command $name).Source
      }
    }
  } finally {
    $ErrorActionPreference = $savedEA
  }
  throw @"
Envelope requires Python 3.10 or newer (your default 'python' may be 3.8).

Install Python 3.12 from https://www.python.org/downloads/windows/ (check "Add to PATH" and the py launcher), then run this script again.
Or: py -3.12 -m pip install -r requirements.txt
"@
}
