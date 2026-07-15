# Windows Audio Satellite Design

## Goal

Replace browser-owned microphone and speaker handling with an invisible Windows
process that starts automatically and provides a reliable Alexa-style flow:

`Hey Jarvis -> command -> transcription -> LLM -> spoken response`.

The existing web application remains the visual interface for the orb, chat,
camera, and system state.

## Architecture

The Windows satellite is the only owner of the microphone and speakers. It
captures 16 kHz mono PCM, applies noise suppression and automatic gain, and
runs the pretrained openWakeWord `hey_jarvis` model continuously. Whisper is
not used for always-on detection.

After activation, the satellite plays a short acknowledgement, pauses wake-word
detection, and records the command until Silero VAD detects the end of speech.
It then transcribes only the command with Faster-Whisper `large-v3` using CUDA
and float16. The wake phrase is never sent to Whisper and does not need to be
recognized twice.

The satellite exposes a loopback-only WebSocket. It opens the Jarvis web page
when needed, sends the transcript to the connected page, and briefly queues one
command while the page starts. The web page submits the transcript through its
existing chat path. When the assistant response finishes, the page sends the
response text to the satellite. The satellite requests Kokoro audio from the
existing Docker endpoint and plays the WAV through the Windows output device.

## Lifecycle and safety

- Bind only to `127.0.0.1`; reject non-loopback clients.
- Keep exactly one microphone stream and one daemon instance.
- Pause wake detection during acknowledgement and TTS playback.
- Add a refractory period after activation and playback.
- Recover the audio device and reconnect the web client without restarting.
- Never fall back to Windows browser speech synthesis.
- Start at user login without an administrative Windows service.
- Provide a foreground diagnostic mode using the same runtime code.

## Audio processing

- 16 kHz, mono, signed 16-bit PCM throughout wake word and VAD stages.
- Pretrained `hey_jarvis` openWakeWord model.
- Silero VAD controls speech start and end, with maximum-command timeout.
- Noise suppression and automatic gain are configurable because microphones
  and rooms require calibration.
- Faster-Whisper `large-v3`, CUDA, float16; startup health reports a clear error
  if the GPU configuration is unavailable instead of silently using `base`.
- Kokoro remains the TTS backend and `em_alex` remains the configured voice.

## Integration

The frontend replaces `getUserMedia`, browser wake-word streaming, and browser
audio playback with one small satellite client. Existing chat submission and
orb state logic are reused. The satellite reports `idle`, `listening`,
`transcribing`, `thinking`, `speaking`, and actionable errors.

If the frontend is closed when the wake phrase is detected, the satellite opens
`http://127.0.0.1:8000`, queues the resulting transcript, and delivers it after
the WebSocket connects.

## Verification

- Unit tests for state transitions, command queueing, VAD boundaries, and
  loopback-only access.
- Frontend tests for transcript submission, response forwarding, and state
  display.
- Ruff and Python tests for the satellite.
- TypeScript lint, Vitest, and production build for the frontend.
- Diagnostic checks for microphone capture, wake detection, CUDA Whisper,
  authenticated Kokoro synthesis, native playback, reconnect, and autostart.
- Manual acceptance: unrelated conversation does not activate Jarvis; saying
  “Hey Jarvis” opens the page, captures a natural Spanish command, displays the
  correct transcript, and plays the Kokoro response through Windows.
