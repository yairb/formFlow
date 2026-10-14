/**
 * Product branding. Change the name here (and in src-tauri/tauri.conf.json,
 * index.html <title>, and the icon files in src-tauri/icons) to rebrand the app.
 */
export const BRAND = {
  name: 'FormFlow',
  tagline: 'Fill, sign and export PDF forms — privately, on this device.',
  /** Used for local storage keys and IndexedDB database names. Changing it resets saved data. */
  storagePrefix: 'formflow',
} as const;
