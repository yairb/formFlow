import { createTauriPlatform } from './tauri';
import type { Platform } from './types';
import { createWebPlatform } from './web';

export type { Platform, PickedFile, SavedFile } from './types';
export { PlatformError } from './types';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let instance: Platform | null = null;

export function platform(): Platform {
  instance ??= isTauri ? createTauriPlatform() : createWebPlatform();
  return instance;
}
