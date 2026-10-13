/**
 * Resolves API URL for browser context.
 */
export function getApiBaseUrl(): string {
  return '';
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
