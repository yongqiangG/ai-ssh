[CmdletBinding()]
param(
    [string]$PythonCommand = 'python',
    [switch]$Development
)

$ErrorActionPreference = 'Stop'
$venvPath = Join-Path $PSScriptRoot '.venv'
$venvPython = Join-Path $venvPath 'Scripts\python.exe'

if (-not (Test-Path -LiteralPath $venvPython)) {
    & $PythonCommand -c "import struct, sys; sys.exit(0 if sys.version_info >= (3, 10) and struct.calcsize('P') == 8 else 'Python 3.10+ (64-bit) is required')"
    if ($LASTEXITCODE -ne 0) { throw 'Python version check failed.' }
    & $PythonCommand -m venv $venvPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the virtual environment.' }
}

$requirementsFile = if ($Development) { 'requirements-dev.txt' } else { 'requirements.txt' }
& $venvPython -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot $requirementsFile)
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check the network and retry.' }

Write-Output 'Workload environment is ready. Configure accounts once with:'
Write-Output "& '$venvPython' -X utf8 '$(Join-Path $PSScriptRoot 'workload_mcp.py')' setup"
