import { NetworkEvent, FilterCriteria, WebSocketConnection, WebSocketFrameDto } from '../types/inspector';

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
      const st = token.slice(7).toLowerCase();
      if (st === 'gql-error' || st === 'gql-err' || st === 'gqlerr') {
        criteria.hasGraphQlError = true;
      } else {
        criteria.status = st;
      }
    } else if (token.startsWith('op:') || token.startsWith('operation:')) {
      criteria.operation = token.slice(token.indexOf(':') + 1).toLowerCase();
    } else if (token.startsWith('type:')) {
      criteria.operationType = token.slice(5).toLowerCase();
    } else if (token === 'gql' || token === 'graphql' || token === 'is:gql' || token === 'is:graphql') {
      criteria.isGraphQl = true;
    } else if (token === 'has:gql-errors' || token === 'gql-error') {
      criteria.hasGraphQlError = true;
    } else if (token === 'ws' || token === 'websocket' || token === 'is:ws' || token === 'is:websocket' || token === 'type:ws' || token === 'type:websocket') {
      criteria.isWebSocket = true;
    } else if (token === 'ws:tx' || token === 'dir:tx') {
      criteria.wsDirection = 'tx';
    } else if (token === 'ws:rx' || token === 'dir:rx') {
      criteria.wsDirection = 'rx';
    } else if (token.startsWith('opcode:')) {
      criteria.wsOpcode = token.slice(7).toLowerCase();
    } else if (token.startsWith('device:')) {
      criteria.device = token.slice(7).toLowerCase();
    } else if (token.startsWith('protocol:')) {
      criteria.protocol = token.slice(9).toLowerCase();
    } else if (token.startsWith('proto:')) {
      criteria.protocol = token.slice(6).toLowerCase();
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

  // Filter by protocol (reads response protocol once arrived, or request protocol)
  if (criteria.protocol) {
    const activeProtocol = (event.response?.protocol || event.request.protocol || '').toLowerCase();
    if (!activeProtocol.includes(criteria.protocol)) {
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

  // Filter by GraphQL operation name
  if (criteria.operation) {
    const op = event.request.operationName?.toLowerCase() || '';
    if (!op.includes(criteria.operation)) {
      return false;
    }
  }

  // Filter by GraphQL operation type (query, mutation, subscription)
  if (criteria.operationType) {
    const type = event.request.operationType?.toLowerCase() || '';
    if (!type.includes(criteria.operationType)) {
      return false;
    }
  }

  // Filter by isGraphQl flag
  if (criteria.isGraphQl) {
    const isGql = Boolean(
      event.request.operationName ||
      event.request.clientType === 'apollo' ||
      event.request.url.includes('/graphql')
    );
    if (!isGql) return false;
  }

  // Filter by hasGraphQlError flag
  if (criteria.hasGraphQlError) {
    let hasGqlErr = false;
    if (event.response?.body?.content) {
      try {
        const parsed = JSON.parse(event.response.body.content);
        if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
          hasGqlErr = true;
        }
      } catch {}
    }
    if (!hasGqlErr) return false;
  }

  // Filter by general search string across URL, headers, operation, and body
  if (criteria.search) {
    const term = criteria.search;
    const urlMatch = event.request.url.toLowerCase().includes(term);
    if (urlMatch) return true;

    // Check operation name and type
    if (event.request.operationName && event.request.operationName.toLowerCase().includes(term)) {
      return true;
    }
    if (event.request.operationType && event.request.operationType.toLowerCase().includes(term)) {
      return true;
    }

    // Check protocol (response protocol or request protocol)
    const activeProto = (event.response?.protocol || event.request.protocol || '').toLowerCase();
    if (activeProto.includes(term)) return true;

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

export function matchesWebSocketFilter(conn: WebSocketConnection, criteria: FilterCriteria): boolean {
  if (!criteria.raw) return true;

  // Filter by host
  if (criteria.host && !conn.host.toLowerCase().includes(criteria.host)) {
    return false;
  }

  // Filter by status (open, closed, error)
  if (criteria.status && conn.status !== criteria.status) {
    return false;
  }

  // Filter by platform / device
  if (criteria.device) {
    const dev = criteria.device;
    const matchName = conn.deviceName?.toLowerCase().includes(dev);
    const matchId = conn.clientId?.toLowerCase().includes(dev);
    const matchApp = conn.appName?.toLowerCase().includes(dev);
    if (!matchName && !matchId && !matchApp) return false;
  }

  // Filter by search query
  if (criteria.search) {
    const term = criteria.search;
    if (conn.url.toLowerCase().includes(term)) return true;
    if (conn.host.toLowerCase().includes(term)) return true;
    if (conn.path.toLowerCase().includes(term)) return true;
    if (conn.clientType.toLowerCase().includes(term)) return true;

    // Check headers
    const headerMatch = Object.entries(conn.headers || {}).some(
      ([k, v]) => k.toLowerCase().includes(term) || v.toLowerCase().includes(term)
    );
    if (headerMatch) return true;

    // Check frames content
    if (conn.frames && conn.frames.some(f => f.payload?.content?.toLowerCase().includes(term))) {
      return true;
    }

    return false;
  }

  return true;
}

export function matchesWebSocketFrame(frame: WebSocketFrameDto, filterTerm: string, directionFilter: 'all' | 'tx' | 'rx' = 'all'): boolean {
  if (directionFilter !== 'all' && frame.direction !== directionFilter) {
    return false;
  }
  if (!filterTerm) return true;
  const term = filterTerm.toLowerCase();
  if (frame.opcode.toLowerCase().includes(term)) return true;
  if (frame.direction.toLowerCase().includes(term)) return true;
  if (frame.payload?.content?.toLowerCase().includes(term)) return true;
  if (frame.payload?.hexPreview?.toLowerCase().includes(term)) return true;
  return false;
}

