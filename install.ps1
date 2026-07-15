[CmdletBinding()]
param(
    [switch]$Doctor,
    [switch]$ForceBuild,
    [string]$GroqApiKey
)

$ErrorActionPreference = 'Stop'
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}
$RepoRoot = $PSScriptRoot
$ComposeFile = Join-Path $RepoRoot 'deploy\docker\docker-compose.groq.yml'
$EnvFile = Join-Path $RepoRoot 'deploy\docker\.env'
$RuntimeConfig = Join-Path $RepoRoot 'deploy\docker\runtime-config.js'
$SatellitePython = Join-Path $RepoRoot '.venv-satellite\Scripts\python.exe'

function Write-Step($Message) { Write-Host "[Jarvis] $Message" -ForegroundColor Cyan }
function Write-Ok($Message) { Write-Host "[OK] $Message" -ForegroundColor Green }

function Get-EnvValue([string]$Path, [string]$Name) {
    if (-not (Test-Path $Path)) { return '' }
    $line = Get-Content $Path | Where-Object { $_ -like "$Name=*" } | Select-Object -First 1
    if ($line) { return $line.Substring($Name.Length + 1) }
    return ''
}

function Get-GhcrImageFromRemote([string]$Remote) {
    if ($Remote -match 'github\.com[/:](?<owner>[^/]+)/(?<repo>[^/.]+)(?:\.git)?$') {
        return "ghcr.io/$($Matches.owner)/$($Matches.repo):latest".ToLowerInvariant()
    }
    return ''
}

function New-RuntimeConfig([string]$ApiKey) {
    $json = @{ apiKey = $ApiKey } | ConvertTo-Json -Compress
    return "window.__JARVIS_CONFIG__ = $json;"
}

function Test-JarvisImage([string]$Image) {
    try {
        $info = docker image inspect $Image 2>$null | ConvertFrom-Json
        return $info[0].Config.Labels.'io.jarvis.voice-satellite' -eq 'true'
    } catch { return $false }
}

function Read-Secret([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Invoke-JarvisDoctor {
    $checks = @(
        @{ Name = 'Docker Desktop'; Ok = [bool](Get-Command docker -ErrorAction SilentlyContinue) },
        @{ Name = 'NVIDIA driver'; Ok = [bool](Get-Command nvidia-smi -ErrorAction SilentlyContinue) },
        @{ Name = 'Satellite Python'; Ok = Test-Path $SatellitePython },
        @{ Name = 'Whisper large-v3'; Ok = Test-Path (Join-Path $RepoRoot '.satellite-models\models--Systran--faster-whisper-large-v3') }
    )
    try {
        $null = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8000/' -TimeoutSec 3
        $checks += @{ Name = 'Jarvis web'; Ok = $true }
    } catch { $checks += @{ Name = 'Jarvis web'; Ok = $false } }
    try {
        $tcp = [Net.Sockets.TcpClient]::new()
        $tcp.Connect('127.0.0.1', 8765)
        $tcp.Dispose()
        $checks += @{ Name = 'Audio satellite'; Ok = $true }
    } catch { $checks += @{ Name = 'Audio satellite'; Ok = $false } }

    foreach ($check in $checks) {
        $mark = if ($check.Ok) { '[OK]' } else { '[FAIL]' }
        $color = if ($check.Ok) { 'Green' } else { 'Red' }
        Write-Host "$mark $($check.Name)" -ForegroundColor $color
    }
    if ($checks.Ok -contains $false) { return 1 }
    return 0
}

function Invoke-JarvisInstall {
    if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') {
        throw 'This quick installer supports Windows 10/11 only.'
    }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker Desktop is required: https://www.docker.com/products/docker-desktop/'
    }
    docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop and run install.ps1 again.' }
    if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
        throw 'An NVIDIA GPU and current NVIDIA driver are required for the supported quick install.'
    }

    $uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
    if (-not $uv) {
        Write-Step 'Installing uv and managed Python...'
        Invoke-RestMethod 'https://astral.sh/uv/install.ps1' | Invoke-Expression
        $uv = Join-Path $env:USERPROFILE '.local\bin\uv.exe'
    }
    if (-not (Test-Path $uv)) { throw 'uv installation failed.' }

    if (-not $GroqApiKey) { $GroqApiKey = $env:GROQ_API_KEY }
    if (-not $GroqApiKey) { $GroqApiKey = Get-EnvValue $EnvFile 'GROQ_API_KEY' }
    if (-not $GroqApiKey) { $GroqApiKey = Read-Secret 'Groq API key' }
    if (-not $GroqApiKey -or $GroqApiKey -match "[\r\n]") { throw 'A valid Groq API key is required.' }

    $localKey = Get-EnvValue $EnvFile 'OPENJARVIS_API_KEY'
    if (-not $localKey) { $localKey = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N') }
    Set-Content $EnvFile "OPENJARVIS_API_KEY=$localKey`nGROQ_API_KEY=$GroqApiKey" -Encoding ASCII
    Set-Content $RuntimeConfig (New-RuntimeConfig $localKey) -Encoding ASCII
    Write-Ok 'Local configuration written without embedding secrets in the image'

    Push-Location $RepoRoot
    try {
        if (-not (Test-Path $SatellitePython)) {
            Write-Step 'Creating the isolated audio satellite...'
            & $uv venv --python 3.12 .venv-satellite
        }
        & $uv pip install --python $SatellitePython --upgrade faster-whisper httpx noisereduce openwakeword sounddevice soundfile websockets
        & $uv pip install --python $SatellitePython --no-deps -e .
        if ($LASTEXITCODE -ne 0) { throw 'Satellite dependency installation failed.' }

        Write-Step 'Preparing Hey Jarvis and Whisper large-v3 on CUDA...'
        & $SatellitePython -m openjarvis.windows_satellite --repo-root $RepoRoot --prepare
        if ($LASTEXITCODE -ne 0) { throw 'Speech model preparation failed.' }

        $remote = (& git config --get remote.origin.url 2>$null)
        $image = if ($env:JARVIS_IMAGE) { $env:JARVIS_IMAGE } else { Get-GhcrImageFromRemote $remote }
        $useImage = $false
        if ($image -and -not $ForceBuild) {
            $useImage = Test-JarvisImage $image
            if (-not $useImage) {
                Write-Step "Trying prebuilt image $image..."
                docker pull $image
                if ($LASTEXITCODE -eq 0) {
                    $useImage = Test-JarvisImage $image
                }
            }
        }
        if ($useImage) {
            $env:JARVIS_IMAGE = $image
            docker compose --env-file $EnvFile -f $ComposeFile up -d --no-build
        } else {
            $env:JARVIS_IMAGE = 'jarvis-local'
            Write-Step 'No compatible release image found; building the contributor image once...'
            docker compose --env-file $EnvFile -f $ComposeFile up -d --build
        }
        if ($LASTEXITCODE -ne 0) { throw 'Jarvis container startup failed.' }
        Add-Content $EnvFile "JARVIS_IMAGE=$env:JARVIS_IMAGE" -Encoding ASCII

        & (Join-Path $RepoRoot 'scripts\install_jarvis_satellite.ps1')
        Write-Ok 'Invisible Hey Jarvis satellite registered at logon'
    } finally { Pop-Location }

    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $null = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8000/' -TimeoutSec 2
            break
        } catch { Start-Sleep -Seconds 1 }
    }
    Start-Process 'http://127.0.0.1:8000/'
    Write-Ok 'Jarvis is ready. Say: Hey Jarvis, que hora es'
    if ((Invoke-JarvisDoctor) -ne 0) { throw 'Installation finished with failed checks.' }
}

if ($MyInvocation.InvocationName -ne '.') {
    if ($Doctor) { exit (Invoke-JarvisDoctor) }
    Invoke-JarvisInstall
}
