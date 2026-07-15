[CmdletBinding()]
param(
    [string]$PythonVersion = '3.12.10',
    [string]$RuntimeDir = 'frontend\src-tauri\resources\python'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent
$Runtime = [IO.Path]::GetFullPath((Join-Path $RepoRoot $RuntimeDir))
$Resources = [IO.Path]::GetFullPath((Join-Path $RepoRoot 'frontend\src-tauri\resources'))
if (-not $Runtime.StartsWith($Resources, [StringComparison]::OrdinalIgnoreCase)) {
    throw "RuntimeDir must stay inside $Resources"
}

$Tools = Join-Path $RepoRoot '.tools'
New-Item $Tools -ItemType Directory -Force | Out-Null
if (Test-Path $Runtime) { Remove-Item $Runtime -Recurse -Force }
New-Item "$Runtime\Lib\site-packages" -ItemType Directory -Force | Out-Null

$EmbedZip = Join-Path $Tools "python-$PythonVersion-embed-amd64.zip"
if (-not (Test-Path $EmbedZip)) {
    Invoke-WebRequest "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip" -OutFile $EmbedZip
}
Expand-Archive $EmbedZip $Runtime -Force
Add-Content "$Runtime\python312._pth" "`nLib/site-packages`nimport site"

$Python = Join-Path $Runtime 'python.exe'
$Uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
if (-not $Uv) { throw 'uv is required to build the OpenJarvis wheel.' }
$WheelDir = Join-Path $Tools 'wheels'
New-Item $WheelDir -ItemType Directory -Force | Out-Null
& $Uv build --wheel --out-dir $WheelDir $RepoRoot
if ($LASTEXITCODE -ne 0) { throw "OpenJarvis wheel build failed: $LASTEXITCODE" }
$Wheel = Get-ChildItem $WheelDir -Filter 'openjarvis-*.whl' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Wheel) { throw 'OpenJarvis wheel was not created.' }
# Install the application wheel without its research/evaluation dependency set.
# The desktop runtime deliberately carries only what the native app starts.
& $Uv pip install --python $Python --target "$Runtime\Lib\site-packages" --no-deps $Wheel.FullName
if ($LASTEXITCODE -ne 0) { throw "OpenJarvis wheel installation failed: $LASTEXITCODE" }
$RuntimeDependencies = @(
    'anthropic>=0.30',
    'click>=8',
    'ddgs>=9.11.4',
    'fastapi>=0.110',
    'faster-whisper>=1.0',
    'httpx>=0.27',
    'joblib>=1.3',
    'noisereduce>=3',
    'nvidia-ml-py>=12.560.30',
    'openai>=1.30',
    'openwakeword>=0.6',
    'playwright>=1.40',
    'posthog>=3.0',
    'pydantic>=2.0',
    'python-multipart>=0.0.9',
    'rich>=13',
    'scikit-learn>=1.4',
    'sounddevice>=0.5',
    'soundfile>=0.12',
    'tavily-python>=0.3',
    'tomlkit>=0.12',
    'uvicorn>=0.30',
    'websockets>=15.0.1',
    'kokoro>=0.9.4',
    'google-genai>=1.0'
)
& $Uv pip install --python $Python --target "$Runtime\Lib\site-packages" $RuntimeDependencies
if ($LASTEXITCODE -ne 0) { throw "Portable runtime dependency installation failed: $LASTEXITCODE" }

& $Python -c "import openjarvis, faster_whisper, openwakeword; print('Portable Jarvis runtime OK')"
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $Runtime 'ms-playwright'
& $Python -m playwright install chromium --no-shell
if ($LASTEXITCODE -ne 0) { throw "Playwright browser installation failed: $LASTEXITCODE" }

New-Item (Join-Path $Runtime '.gitkeep') -ItemType File -Force | Out-Null
