import type { PreloadApi } from '@shared/types/api';

declare global {
  interface Window {
    api: PreloadApi;
  }
}

export {};
