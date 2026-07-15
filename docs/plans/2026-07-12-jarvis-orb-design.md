# Jarvis orb and voice interface

## Goal

Make the desktop app's main screen feel like a voice-first Jarvis assistant:
a living neural orb is the primary visual, with chat available as a compact
overlay.

## Scope

- Add a full-screen WebGL scene to the existing React/Tauri frontend.
- Render a cyan/blue neural orb with roughly 1,200 point nodes and a sparse,
  precomputed network of nearby connections.
- Drive four visual states from the assistant lifecycle: idle, listening,
  thinking, and speaking.
- Keep the chat composer and recent response as a compact lower-left overlay.
- Listen for the local wake word `Jarvis` while the desktop app is running
  (including minimized), retain a small audio pre-roll, transcribe the command
  after silence, submit it to the existing chat path, then play local TTS.

## Architecture

The React frontend owns one Three.js scene directly, without a React Three
wrapper. Geometry and connection indices are created once; animation updates
only uniforms/transforms and avoids per-frame neighbour searches. A small
state mapping translates voice/chat events into orb modes.

Audio remains local-first. The frontend captures PCM from the active
microphone and streams it to a local wake-word/STT pipeline. Wake detection
starts a command capture that ends after silence; the existing Whisper and TTS
backends perform transcription and speech synthesis. The feature requires the
desktop app to be running; it does not claim to work while the app is closed.

## Deferred

- Obsidian-style memory graph.
- Hand/camera interaction.
- System-wide mouse control.
- Cloud speech services.

## Verification

- Unit-test the pure orb-state mapping and generated graph bounds/counts.
- Build the frontend successfully.
- Manually verify idle, listening, thinking, and speaking transitions with the
  desktop app.
- Manually verify a spoken `Jarvis, ...` command is transcribed, submitted,
  and spoken back with a local speech configuration.
