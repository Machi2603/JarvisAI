# Voice reliability and supervised self-patching

## Voice activation

- Keep the local wake-word detector as the first gate.
- Require two consecutive high detector scores before declaring a wake event.
- After the event, require Whisper to transcribe `Jarvis` (including common
  phonetic variants) before dispatching the following command.
- Ignore detector input while Jarvis is speaking and reset it afterwards so
  synthesized speech cannot wake the assistant.
- Add a short cooldown after accepted commands.

## Speech playback

- Resume the Web Audio context before starting the synthesized WAV.
- Reject playback failures instead of resolving them as success, allowing the
  existing browser-voice fallback to run and exposing a useful error.

## Supervised self-patching

- Give Jarvis read-only diagnostic access to the mounted workspace and safe
  test commands.
- A code change is submitted as a patch proposal to the existing approval
  queue; it does not modify source immediately.
- The existing Approve action applies the patch only inside allowlisted source
  directories. Deny discards it.
- Do not expose unrestricted shell or arbitrary file writes.

## Verification

- Unit-test wake confirmation, consecutive scoring, playback rejection, and
  patch path validation.
- Rebuild Docker and verify speech health, TTS, authenticated wake WebSocket,
  deployed frontend markers, and approval behavior.
