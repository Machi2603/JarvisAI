# Real-time local wake word

## Goal

Replace periodic full-audio transcription with continuous local wake-word
detection. A command must not be split or lost at a recording boundary.

## Design

The browser keeps one microphone stream open. An AudioWorklet downsamples it
to 16 kHz mono PCM and sends binary frames to an authenticated local WebSocket.
The server passes 80 ms frames to openWakeWord. On detection it tells the
browser to start command capture. The browser retains a short pre-roll,
records until voice activity stops, and sends one complete WebM recording to
the existing Whisper endpoint.

The connection sends no audio to a remote service. If openWakeWord or its
model is absent, the UI reports that specific setup error and does not fall
back to periodic transcription.

## Verification

- Unit-test the server frame accumulator and detection state transitions.
- Unit-test the browser command capture state machine.
- Test the WebSocket accepts a PCM frame and returns a detection event with a
  fake wake-word model.
- Run frontend lint/build and Python pytest/ruff.
