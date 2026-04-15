# Thin wrapper: keep envelope_run.py next to this file.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $ScriptDir 'envelope_run.py'
& python3 $py @args
exit $LASTEXITCODE
