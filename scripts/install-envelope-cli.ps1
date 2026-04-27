# Install envelope-cli from a git checkout: .\scripts\install-envelope-cli.ps1 [-Editable]
$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$CliDir = Join-Path $RepoRoot 'cli'
if (-not (Test-Path (Join-Path $CliDir 'pyproject.toml'))) {
    Write-Error "Expected CLI at $CliDir (run from repo clone)"
}
$pyExe = $null
$pyArg = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
    try { & py -3 -c "import sys; sys.exit(0)" 2>$null; $pyExe = 'py'; $pyArg = '-3' } catch { }
}
if (-not $pyExe) {
    foreach ($name in @('python3', 'python')) {
        if (Get-Command $name -ErrorAction SilentlyContinue) {
            $pyExe = $name
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

function Test-UserPathContains {
    param([string]$Dir)
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ([string]::IsNullOrEmpty($userPath)) { return $false }
    $norm = $Dir.TrimEnd('\')
    foreach ($seg in $userPath -split ';') {
        if ($seg.TrimEnd('\') -eq $norm) { return $true }
    }
    return $false
}

Write-Host ""
if ($inVenv) {
    $venvScripts = Join-Path $env:VIRTUAL_ENV 'Scripts'
    if (Get-Command envelope -ErrorAction SilentlyContinue) {
        Write-Host "The 'envelope' command is available in this session."
    } else {
        Write-Host "Activate this virtualenv so PATH includes:"
        Write-Host "  $venvScripts"
        Write-Host "  Example:  & '$venvScripts\Activate.ps1'"
    }
} else {
    $scripts = Join-Path $userBase 'Scripts'
    if (Get-Command envelope -ErrorAction SilentlyContinue) {
        Write-Host "The 'envelope' command is on your current PATH."
    } elseif (Test-UserPathContains $scripts) {
        Write-Host "User PATH already lists: $scripts"
        Write-Host "Open a new PowerShell window, then run: envelope --help"
    } else {
        Write-Host "The 'envelope' script is installed under:"
        Write-Host "  $scripts"
        Write-Host "That folder is not on your user PATH (and may not be on this session's PATH)."
        $doAdd = $false
        $canPrompt = -not [Console]::IsInputRedirected
        if ($canPrompt) {
            $resp = Read-Host "Add this folder to your user PATH for future terminals? [y/N]"
            $doAdd = ($resp -eq 'y' -or $resp -eq 'Y' -or $resp -eq 'yes')
        }
        if ($doAdd) {
            $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
            if ([string]::IsNullOrEmpty($userPath)) {
                $newPath = $scripts
            } else {
                $newPath = "$userPath;$scripts"
            }
            [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
            Write-Host "Updated user PATH. Open a new PowerShell window, then run: envelope --help"
            Write-Host "For this window only, run:"
            Write-Host "  `$env:Path = '$scripts;' + `$env:Path"
        } else {
            Write-Host "Add it yourself: Settings > System > About > Advanced system settings > Environment Variables,"
            Write-Host "  and append to your user Path: $scripts"
            Write-Host "Or for this session only:"
            Write-Host "  `$env:Path = '$scripts;' + `$env:Path"
        }
    }
}

Write-Host ""
Write-Host "Try: envelope --help"
