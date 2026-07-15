# Jarvis Desktop Design

## Goal

Ship Jarvis as a Windows desktop application that owns its UI, backend and native audio lifecycle without requiring Docker, a browser, Ollama, Python or uv from the user.

## Architecture

- Tauri owns the WebView2 window, tray, autostart, single-instance behavior and signed updates.
- A packaged private Python runtime runs one Jarvis service containing the Groq-backed API, Hey Jarvis detector, Whisper large-v3 and Kokoro playback.
- User models live under `%LOCALAPPDATA%\Jarvis\Models` and survive application updates. Large models are downloaded and hash-checked once rather than embedded in every release.
- Groq is the only LLM engine in the first Windows release. API keys live in Windows Credential Manager.
- Closing the window hides it and pauses visual animation. Saying Hey Jarvis restores and focuses it. The tray's `Salir de Jarvis` action shuts down the service and every child process.
- Windows Job Objects provide crash-safe child cleanup. Playwright Chromium runs only while browser automation is active.

## Updates

GitHub Actions builds a signed NSIS installer plus Tauri updater metadata. The app checks GitHub Releases, installs an approved update and restarts while retaining models, credentials and conversations.

## Windows installer

- Ship the 64-bit NSIS `-setup.exe`; MSI is unnecessary for the first release.
- Install per-machine under `C:\Program Files\Jarvis` by default and let the standard installer page choose another folder.
- Request administrator rights only during installation and updates.
- Keep models, credentials and user data in the user profile, outside the replaceable application directory.

## Performance targets

- No duplicate backend or audio process.
- Near-zero UI animation work while hidden.
- Wake-word processing is the only continuous inference.
- Whisper loads in the background and is reused; it is never invoked before a wake event.
- Quit leaves no Jarvis, Python, Chromium or audio child process.

## Scope

The first release targets Windows 10/11, NVIDIA CUDA and Groq. Linux, macOS, CPU-only speech and bundled local LLMs are deferred.

## Verification

Rust lifecycle tests cover close, show and shutdown decisions. Existing satellite Python tests, frontend tests, Ruff and TypeScript remain required. A Windows smoke test installs the bundle, checks tray/wake/quit behavior and verifies the updater artifact.
