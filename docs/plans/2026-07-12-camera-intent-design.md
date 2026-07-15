# Camera intent detection

## Goal

Activate camera mode from the meaning of a Spanish voice or typed command,
rather than one exact spelling.

## Design

A local scikit-learn character n-gram classifier is trained in memory from a
small curated set of `open_camera` and `none` Spanish utterances. Character
features tolerate Whisper spelling, accents and small phrasing changes without
calling a cloud model. The detector returns `open_camera` only at confidence
0.82 or above; otherwise the message continues to Jarvis unchanged.

The frontend calls one local `/v1/intents/detect` endpoint before routing a
chat or voice command. This keeps the classifier reusable for future intents
without duplicating model logic in the browser.

## Checks

Unit tests cover paraphrases that should open the camera and ordinary camera
questions that must not activate it. The frontend type-check and build remain
the integration check.
