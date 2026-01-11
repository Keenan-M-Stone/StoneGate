// Runtime configuration hook for installers / deployed bundles.
// This file is loaded by `frontend/index.html` before the app bootstraps.
//
// The app will use these values as *defaults* only. Users can still override
// the backend endpoint in the UI (stored in localStorage).
//
// Installers may overwrite this file inside `frontend/dist/`.

globalThis.__STONEGATE_CONFIG__ = {
  // Default WebSocket endpoint used when localStorage has no override.
  // Example: "ws://localhost:8080/status" or "ws://backend-host:8080/status"
  ws_url: 'ws://localhost:8080/status',

  // Optional feature flags (used as defaults when localStorage has no value).
  build_mode: false,
  auto_backend_schematic: false,
}
