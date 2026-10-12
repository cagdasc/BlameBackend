/**
 * Resolves API URL for browser vs native desktop (Tauri) contexts.
 * When running inside Tauri, assets load from tauri://localhost,
 * so API calls route to the background BlameBackend server on 127.0.0.1:3000.
 */
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    if (window.location.protocol === 'tauri:' || window.location.hostname === 'tauri.localhost') {
      return 'http://127.0.0.1:3000';
    }
  }
  return '';
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
