export interface PickedFile {
  name: string;
  /** Absolute path on desktop; null when the file came from a browser picker or drop. */
  path: string | null;
  bytes: Uint8Array;
}

export interface SavedFile {
  name: string;
  path: string | null;
}

export class PlatformError extends Error {
  constructor(
    readonly code: 'same-as-source' | 'not-pdf' | 'not-found' | 'not-allowed' | 'io',
    message: string,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

/**
 * Everything FormFlow needs from the host. The web build uses browser APIs; the
 * desktop build talks to a small set of Rust commands that only touch files the
 * user picked in a native dialog (see src-tauri/src/files.rs).
 */
export interface Platform {
  kind: 'web' | 'desktop';
  /** Shows an open dialog for one PDF; null if cancelled. */
  pickPdf(): Promise<PickedFile | null>;
  /** Whether recent documents can be reopened by path (desktop only). */
  canOpenPaths: boolean;
  /** Reopens a previously picked file by path. */
  openPath(path: string): Promise<PickedFile>;
  /**
   * Shows a save dialog and writes the bytes; null if cancelled.
   * Implementations refuse to overwrite `sourcePath`.
   */
  savePdf(bytes: Uint8Array, suggestedName: string, sourcePath: string | null): Promise<SavedFile | null>;
  /** Stops remembering a path (or every path, for null) so it can no longer be reopened without the Open dialog. */
  forgetPath?(path: string | null): Promise<void>;
  /** Shows a saved file in Finder / Explorer, when supported. */
  revealFile?(path: string): Promise<void>;
  /**
   * Registers a handler that is asked before the window closes. Returning false
   * keeps the window open. Returns an unsubscribe function.
   */
  onCloseRequested(shouldClose: () => boolean | Promise<boolean>, hasUnsaved: () => boolean): () => void;
  /** Platform name for keyboard hints. */
  isMac: boolean;
}
