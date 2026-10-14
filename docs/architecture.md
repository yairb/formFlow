# Architecture

FormFlow is a Tauri 2 desktop app. The UI is React + strict TypeScript; a small Rust
backend owns everything that touches the file system. The same frontend also runs
in a browser (`npm run dev`), which is what the end-to-end tests drive.

```
┌──────────────────────────── WebView (React) ────────────────────────────┐
│ shell/       Header, Toolbar, Sidebar, Inspector, GuidedPanel, dialogs   │
│ workspace/   virtualised page list, overlays, inline editors, gestures   │
│     │ reads                          │ dispatches                        │
│ state/       Zustand stores: document, editor (model + undo), ui, prefs  │
│ app/         actions: open / export / fields / edits / sessions          │
│     │                     │                        │                     │
│ pdf/ (pdf.js)       detect/ (pure TS)        export/ (pdf-lib)           │
│ render + text       field detection          flattened output            │
│     └──────────── model/ (document model, geometry in display space) ────┘
│ platform/  ── tauri.ts (invoke) │ web.ts (File System Access / <input>)  │
└──────────────────────────────────┼───────────────────────────────────────┘
                                   │ 5 IPC commands, no fs plugin
┌──────────────────────────── Rust (src-tauri) ───────────────────────────┐
│ files.rs  pick_pdf · read_pdf · save_pdf · reveal_file · forget_path     │
│           path validation, %PDF header check, grants, atomic writes      │
└──────────────────────────────────────────────────────────────────────────┘
```

## Rendering and export stay separate

- **pdf.js** (`src/pdf`) renders pages, extracts text and vector primitives for
  detection, reads AcroForm widgets, and re-opens every exported file as validation.
- **pdf-lib** (`src/export`) writes output. It is loaded lazily on the first export.
- Neither library's objects leak into the model. The model (`src/model/types.ts`)
  stores plain data: fields, annotations, signatures, page geometry.

## One coordinate system

All model geometry is in **display space**: PDF points, origin at the top-left of
the page *as displayed* (after `/Rotate` and the CropBox). `src/pdf/geometry.ts`
builds the display → PDF user-space matrix from the page's view box and rotation,
the same transform pdf.js uses on screen. Export wraps every annotation in one
`cm` with that matrix, so rotated, cropped and offset-MediaBox pages need no
special cases. `tests/integration/geometry-pdfjs.test.ts` and `tests/integration/export-placement.test.ts`
cover all four rotations, crop boxes and non-zero origins by rendering the
exported PDF and locating the ink.

## State

| Store | Contents |
| --- | --- |
| `document` | opened file (bytes, hash, name, path), pdf.js document, page geometry, load status |
| `editor` | the `DocModel`, undo/redo stacks, gesture grouping (a drag is one undo step) |
| `ui` | tool, selection, editing target, guided mode, active field, zoom, panels, dialogs |
| `prefs` | theme, date format, panel visibility (persisted, no document content) |
| `signatures` | saved signatures, only when "Remember on this device" was ticked |
| `feedback` | toasts, confirm and password prompts as promises |

Every edit goes through `editor.commit(label, fn)`. `fn` is a pure model → model
function from `src/model`, which is what the unit tests exercise.

## Text

Text is laid out once (`src/text/layout.ts`) with fontkit metrics for the bundled
Noto fonts, and the same line breaks are used on screen and in the PDF. Mixed
Hebrew/Latin lines are reordered with the Unicode Bidirectional Algorithm
(`bidi-js`) before drawing, and fonts are chosen per run by script, so exported
text is real, extractable Unicode in the right visual order.

## Desktop backend

The frontend never receives a general file system capability. `src-tauri/capabilities/main-window.json`
grants only event listen/unlisten and window destroy; the dialog and opener plugins
are used from Rust, not exposed to JS. `files.rs`:

- `pick_pdf` shows the native open dialog and *grants* the chosen path.
- `read_pdf` reads only granted paths (recent files persist across launches),
  after canonicalising, checking it is a regular `.pdf` under 512 MB with a `%PDF-`
  header.
- `save_pdf` shows the native save dialog, forces a `.pdf` extension, refuses to
  overwrite the source file (compared by canonical path and inode/volume), and
  writes atomically via a temp file and rename.
- `reveal_file` works only for files saved in this session.

## Persistence

`src/app/sessions.ts` autosaves the model to IndexedDB 700 ms after the last
change, keyed by the SHA-256 of the source file. Reopening the same file offers
**Restore** or **Start fresh**. The browser build also caches the bytes of up to
four recent files (40 MB each) because it cannot reopen by path.
