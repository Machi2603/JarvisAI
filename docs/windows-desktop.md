# Jarvis for Windows

Jarvis Desktop is the recommended Windows distribution. It is a Tauri application, not a browser wrapper, and the release installer includes the Python runtime and native speech dependencies it needs.

## Install in under ten minutes

1. Download `Jarvis_*_x64-setup.exe` from the latest stable GitHub release.
2. Run the installer. It proposes `C:\Program Files\Jarvis`; use the folder selector if you prefer another location.
3. Open **Jarvis**.
4. Paste a [Groq API key](https://console.groq.com/keys) into the first-run screen.
5. Allow the first speech-model download to finish. Say **“Hey Jarvis”**, then your command.

Docker Desktop, Ollama, Git, Python, `uv`, Node.js and Rust are not required for the installed application. An NVIDIA GPU is recommended for Whisper large-v3. Its model cache is stored in the user's profile and is not deleted or downloaded again when Jarvis updates.

## Window and background behavior

- Closing the main window hides Jarvis in the Windows notification area.
- **Hey Jarvis** restores and focuses the main window before recording the command.
- Jarvis starts hidden when the user signs in to Windows.
- **Salir de Jarvis** in the tray menu stops the voice satellite and backend before exiting.
- Only one instance can run at once. Opening Jarvis again restores the existing window.

The microphone stream stays in the native Windows audio process. The wake-word detector runs before Whisper, so background speech is not continuously transcribed.

## Updates

Stable builds check the repository's `desktop-latest/latest.json` release channel. Downloads are signature-verified before installation. Models and user data live outside the application directory, so an update replaces application files without resetting them.

Maintainers must configure these repository secrets before publishing:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `VITE_SUPABASE_ANON_KEY`

The matching updater public key belongs in `frontend/src-tauri/tauri.conf.json`. Push a `desktop-vX.Y.Z` tag to publish a stable installer and refresh the stable update channel.

## Developer build

Developers need Windows 10/11, Node.js 22, Rust stable with the MSVC toolchain, and Python 3.12:

```powershell
git clone <your-repository-url>
cd OpenJarvis\frontend
npm install
npm run tauri dev
```

Production installers are built by `.github/workflows/desktop.yml`. The workflow creates a portable Python 3.12 runtime, installs the Groq, browser, Kokoro, Whisper and wake-word dependencies into it, bundles that runtime, then publishes the signed Windows installer and updater manifest.

The older `install.ps1` Docker/browser flow remains available for contributors while the desktop release matures; it is no longer the recommended end-user route.
