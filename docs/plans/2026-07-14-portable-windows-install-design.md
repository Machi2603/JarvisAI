# Portable Windows Installation

## Goal

Turn the working Jarvis prototype into a repeatable Windows + NVIDIA installation that a new user can start with one PowerShell command and diagnose without understanding Docker or Python.

## Design

- A root `install.ps1` validates Docker Desktop, NVIDIA and `uv`, writes local secrets, creates the isolated satellite environment, downloads the speech models, starts Docker and registers the invisible satellite at logon.
- `install.ps1 -Doctor` performs read-only checks for Docker, NVIDIA, the models, HTTP, the loopback WebSocket and the scheduled task.
- The frontend receives only the local Jarvis access token through a generated `runtime-config.js` mounted into the container. The Groq key remains server-side. Images therefore contain no user secrets and can be reused unchanged.
- Docker Compose uses a verified GHCR image when available and falls back to the existing Dockerfile for contributor builds.
- A GitHub Actions workflow publishes the reusable image for `main`, tags and manual releases.
- The README leads with the supported ten-minute Windows path and keeps contributor instructions separate.

## Supported scope

The first public release supports Windows 10/11, Docker Desktop and NVIDIA CUDA. CPU, Linux and macOS satellite installers are intentionally deferred until there is demand.

## Verification

PowerShell helper checks cover image-name derivation and safe runtime configuration. Existing Python satellite tests, Ruff, frontend tests, TypeScript and the production build remain required.
