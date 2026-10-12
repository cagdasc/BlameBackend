import { NetworkEvent, FilterCriteria } from '../types/inspector';

export function parseFilterQuery(raw: string): FilterCriteria {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { raw: '' };
  }

  const criteria: FilterCriteria = { raw: trimmed };
  const tokens = trimmed.split(/\s+/);
  const generalTerms: string[] = [];

  for (const token of tokens) {
    if (token.startsWith('host:')) {
      criteria.host = token.slice(5).toLowerCase();
    } else if (token.startsWith('method:')) {
      criteria.method = token.slice(7).toUpperCase();
    } else if (token.startsWith('status:')) {
      criteria.status = token.slice(7).toLowerCase();
    } else if (token.startsWith('device:')) {
      criteria.device = token.slice(7).toLowerCase();
    } else if (token.startsWith('search:')) {
      generalTerms.push(token.slice(7));
    } else {
      generalTerms.push(token);
    }
  }

  if (generalTerms.length > 0) {
    criteria.search = generalTerms.join(' ').toLowerCase();
  }

  return criteria;
}

export function matchesFilter(event: NetworkEvent, criteria: FilterCriteria): boolean {
  if (!criteria.raw) return true;

  // Filter by host
  if (criteria.host) {
    if (!event.request.host.toLowerCase().includes(criteria.host)) {
      return false;
    }
  }

  // Filter by method
  if (criteria.method) {
    if (event.request.method !== criteria.method) {
      return false;
    }
  }

  // Filter by source device / platform
  if (criteria.device) {
    const dev = criteria.device;
    const matchName = event.deviceName?.toLowerCase().includes(dev);
    const matchId = event.clientId?.toLowerCase().includes(dev);
    const matchApp = event.appName?.toLowerCase().includes(dev);
    if (!matchName && !matchId && !matchApp) {
      return false;
    }
  }

  // Filter by status (e.g. "200", "4xx", "5xx", "error")
  if (criteria.status) {
    const s = criteria.status;
    if (s === 'error') {
      if (event.status !== 'error') return false;
    } else if (s.endsWith('xx')) {
      const prefix = parseInt(s[0], 10);
      if (isNaN(prefix) || !event.response) return false;
      const codeGroup = Math.floor(event.response.statusCode / 100);
      if (codeGroup !== prefix) return false;
    } else {
      const targetCode = parseInt(s, 10);
      if (!isNaN(targetCode)) {
        if (!event.response || event.response.statusCode !== targetCode) {
          return false;
        }
      }
    }
  }

  // Filter by general search string across URL, headers, and body
  if (criteria.search) {
    const term = criteria.search;
    const urlMatch = event.request.url.toLowerCase().includes(term);
    if (urlMatch) return true;

    // Check request headers
    const reqHeadersMatch = Object.entries(event.request.headers).some(
      ([k, v]) => k.toLowerCase().includes(term) || v.toLowerCase().includes(term)
    );
    if (reqHeadersMatch) return true;

    // Check request body
    if (event.request.body?.content && event.request.body.content.toLowerCase().includes(term)) {
      return true;
    }

    // Check response headers
    if (event.response?.headers) {
      const resHeadersMatch = Object.entries(event.response.headers).some(
        ([k, v]) => k.toLowerCase().includes(term) || v.toLowerCase().includes(term)
      );
      if (resHeadersMatch) return true;
    }

    // Check response body
    if (event.response?.body?.content && event.response.body.content.toLowerCase().includes(term)) {
      return true;
    }

    // Check error
    if (event.error) {
      if (
        event.error.errorType.toLowerCase().includes(term) ||
        event.error.message.toLowerCase().includes(term)
      ) {
        return true;
      }
    }

    return false;
  }

  return true;
}
