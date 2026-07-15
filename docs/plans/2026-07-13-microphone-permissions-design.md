# Jarvis microphone permission fix

## Cause

The page served by Docker sends `Permissions-Policy: microphone=()`. This
explicitly blocks `getUserMedia()` for the page itself, so the browser raises
`NotAllowedError` before the wake-word WebSocket can open.

## Design

- Allow microphone capture only for the same origin with
  `Permissions-Policy: microphone=(self)`; keep the other restrictions.
- Start automatically only when permission is already granted. Otherwise the
  user-facing activation button performs the browser-required user gesture.
- Preserve the native media error name, message, and constraint in the UI.
- Install cleanup as soon as a stream is acquired and make it idempotent, so a
  retry cannot leave a previous track, audio graph, or socket alive.
- Keep the existing flow unchanged: microphone, local Jarvis detector, command
  recording, Whisper transcription, response.

## Verification

- Assert the security header allows only same-origin microphone access.
- Assert native media error details remain visible.
- Run the focused frontend and middleware tests, then the frontend build.
- Verify the rebuilt server response header and wake-word WebSocket connection.
