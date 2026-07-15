# Jarvis agent and visual browser

## Goal

Turn the current chat into a local agent that can answer the current time,
search the web and operate a visual browser panel from voice or chat.

## Chosen approach

Use the existing `native_react` agent and the existing tool registry. It gets
only these tools initially:

- `current_time`: local date and time, no network.
- `web_search`: existing DuckDuckGo fallback, with Tavily optional.
- `browser_navigate`, `browser_click`, `browser_type`, `browser_screenshot`
  and `browser_extract`: existing Playwright tools.

The server's default chat agent becomes `native_react`; its initial tool list
is deliberately small. Mutating actions remain outside this list and require
the existing approval flow when added later.

## Visual browser

Playwright owns one headless Chromium session. A new authenticated endpoint
returns the current page screenshot and URL after each browser action. The UI
renders it in a HUD-styled browser window beside/above chat, with a minimal
address bar and status. The agent acts through Playwright; it never embeds a
third-party website in an iframe, since most sites disallow that and it would
not be controllable safely.

## Flow

1. Voice transcription or chat submits a request.
2. Native ReAct selects a permitted tool.
3. Browser actions update the shared Playwright page.
4. The browser panel refreshes its screenshot and shows the active URL.
5. Chat receives the resulting answer and existing TTS reads it aloud.

## Failure handling and checks

- If Playwright/Chromium is unavailable, show a clear local setup error.
- Keep the browser route loopback-authenticated and preserve existing SSRF
  validation in browser navigation.
- Test the time tool and browser state endpoint; type-check and build the UI.
