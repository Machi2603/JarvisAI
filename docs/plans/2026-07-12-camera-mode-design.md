# Jarvis camera mode

## Activation

After the wake word, the exact normalized command `abre la camara` switches
the frontend to camera mode. This is a local UI event; no HTTP request is
needed. Other commands continue to the agent normally.

## Scene

Camera mode fills the Jarvis workspace with the live camera feed, a soft gray
edge vignette and a compact Jarvis orb in the top left. Browser and future
tool windows remain above that feed.

## Interaction

Windows share one drag implementation. Mouse down starts a drag; global mouse
move updates its position; mouse up releases it. MediaPipe maps an armed open
hand plus fist to the same mouse down/move/up events, so no second drag model
is needed. Opening the hand releases the window.

## Scope

This first pass makes Jarvis Browser movable. The window manager is kept local
to that component until a second tool window exists; then positions can move
to a shared store without changing gesture behavior.
