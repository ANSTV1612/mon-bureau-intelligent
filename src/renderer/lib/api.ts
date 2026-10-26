// Accès typé à l'API exposée par le preload.

import type { MbiApi } from '../../shared/api';

declare global {
  interface Window {
    mbi: MbiApi;
  }
}

export const api: MbiApi = window.mbi;
