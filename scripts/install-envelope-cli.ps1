# Install envelope-cli from a git checkout: .\scripts\install-envelope-cli.ps1 [-Editable]
$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$CliDir = Join-Path $RepoRoot 'cli'
if (-not (Test-Path (Join-Path $CliDir 'pyproject.toml'))) {
    Write-Error "Expected CLI at $CliDir (run from repo clone)"
}
$pyExe = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
    try { & py -3 -c "import sys; sys.exit(0)" 2>$null; $pyExe = 'py'; $pyArg = '-3' } catch { }
}
if (-not $pyExe) {
    foreach ($name in @('python3', 'python')) {
        if (Get-Command $name -ErrorAction SilentlyContinue) {
            $pyExe = $name
            $pyArg = $null
            break
        }
    }
}
if (-not $pyExe) {
    Write-Error "Python 3 not found (install from python.org or use the py launcher)"
}
$editable = @()
if ($args -contains '-Editable' -or $args -contains '-e') {
    $editable = @('--editable')
}
$inVenv = $env:VIRTUAL_ENV -and $env:VIRTUAL_ENV.Length -gt 0
$pipArgs = @('-m', 'pip', 'install') + $editable
if (-not $inVenv) {
    $pipArgs += '--user'
}
$pipArgs += $CliDir
if ($pyExe -eq 'py') {
    & py $pyArg @pipArgs
    $userBase = & py $pyArg -c "import site; print(site.USER_BASE)"
} else {
    & $pyExe @pipArgs
    $userBase = & $pyExe -c "import site; print(site.USER_BASE)"
}
if (-not $inVenv) {
    $scripts = Join-Path $userBase 'Scripts'
    Write-Host "Installed. If 'envelope' is not found, add to user PATH: $scripts"
}
Write-Host "Try: envelope --help"
