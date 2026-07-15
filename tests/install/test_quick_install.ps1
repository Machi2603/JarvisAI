$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\install.ps1')

$https = Get-GhcrImageFromRemote 'https://github.com/Example/Jarvis.git'
$ssh = Get-GhcrImageFromRemote 'git@github.com:Example/Jarvis.git'
if ($https -ne 'ghcr.io/example/jarvis:latest') { throw "Unexpected HTTPS image: $https" }
if ($ssh -ne $https) { throw "SSH and HTTPS remotes differ: $ssh" }

$config = New-RuntimeConfig 'key-with-"-quote'
if ($config -notmatch 'window\.__JARVIS_CONFIG__') { throw 'Runtime global missing' }
if ($config -notmatch '\\"') { throw 'Runtime key was not JSON escaped' }

Write-Host 'quick installer checks passed'
