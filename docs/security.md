# Privacy and security

## Data handling

- **Local only.** Documents are opened, analysed, rendered and exported in the
  app. There are no network calls: the Content Security Policy restricts
  `connect-src` to the app itself and Tauri IPC, and no external services exist.
- **No telemetry.** There is no analytics, crash reporting or update pinging.
- **No content in logs.** Errors are logged by code and type only. Form values,
  signatures, extracted text and file contents are never logged. Error messages
  shown to the user mention the file name only.
- **Stored on this device (IndexedDB):**
  - in-progress sessions;
  - recents (with a small first-page thumbnail);
  - in the browser build only, cached bytes of up to four recent files;
  - signatures, only when "Remember on this device" is ticked.

  **Settings → Clear local data** deletes all of it, including the desktop app's
  list of granted paths.
- **Passwords** for protected PDFs are used only to decrypt in memory, and are
  never stored.

## Desktop hardening (Tauri)

- **Capabilities** (`src-tauri/capabilities/main-window.json`): only
  `core:event:allow-listen`, `core:event:allow-unlisten` and `core:window:allow-destroy`.
  - There is no `fs` plugin, no shell, and no HTTP plugin.
  - The dialog and opener plugins are called from Rust only, and are not exposed to JS.
- **File access** goes through five commands in `src-tauri/src/files.rs`:
  - **Reading** works only for paths the user chose in the native open dialog (or
    reopened from recents, which were chosen that way).
  - **Path checks:** paths are canonicalised, must be regular files with a `.pdf`
    extension, and must be ≤ 512 MB.
  - **Content check:** a `%PDF-` header is required.
  - **Saving** works only to a path the user chose in the native save dialog. The
    extension is forced to `.pdf`, and directories and the source file are refused.
  - **Writes** are atomic: the file is written to a temp file, then renamed.
  - **Revealing** a file in Finder or Explorer is allowed only for files saved in
    this session.
- **CSP:**
  - `default-src 'self'`; scripts `'self' 'wasm-unsafe-eval'` (pdf.js), with no
    remote scripts.
  - `object-src`, `base-uri`, `form-action` and `frame-ancestors` are `'none'`.
- **Other settings:** the CSP has no `'unsafe-eval'`, and pdf.js 5 has no
  eval-based font compilation. `freezePrototype` is **off**: fontkit assigns
  `valueOf` on its own prototypes, which throws once `Object.prototype` is frozen
  (the "override mistake") and stops the app loading. The WebView only ever runs
  the bundled code, so the CSP and capability limits are the protections here.
- **Dev mode** (`npm run app:dev`) uses a separate `devCsp` that also allows
  Vite's inline hot-reload script and its WebSocket. Release builds use the strict
  policy above.

## Limits worth knowing

- **Signatures** are images. They are not cryptographic, and the exported file is
  not certified.
- **Removed content:** an exported PDF keeps the original's content. Text drawn
  over something does not delete what is underneath, so use a dedicated redaction
  tool to remove information.
