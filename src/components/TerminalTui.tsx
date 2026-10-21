import React, { useState, useEffect, useRef } from 'react';
import {
  NetworkEvent,
  HttpMethod,
  FilterCriteria,
  DeviceInfo,
  WebSocketConnection,
  WebSocketFrameDto
} from '../types/inspector';
import { parseFilterQuery, matchesFilter, matchesWebSocketFilter, matchesWebSocketFrame } from '../engine/filterEngine';
import { formatBytes } from '../engine/payload';
import {
  Search,
  X,
  Copy,
  Check,
  AlertTriangle,
  Clock,
  ArrowUpDown,
  Filter,
  Eye,
  Code,
  Terminal,
  Zap,
  Radio,
  ArrowUpRight,
  ArrowDownLeft,
  Wifi,
  ChevronRight,
  ChevronDown as ChevronDownIcon
} from 'lucide-react';

export interface GraphQlDetails {
  isGraphQl: boolean;
  operationName: string | null;
  operationType: string;
  query: string | null;
  variables: Record<string, any> | null;
  hasErrors: boolean;
  errors: Array<{ message: string; locations?: any[]; path?: any[]; extensions?: any }> | null;
}

export function extractGraphQlDetails(event: NetworkEvent): GraphQlDetails {
  let operationName = event.request.operationName || null;
  let operationType = event.request.operationType || null;
  let query: string | null = null;
  let variables: Record<string, any> | null = null;

  if (event.request.body?.content) {
    try {
      const parsed = JSON.parse(event.request.body.content);
      if (parsed.operationName) operationName = operationName || parsed.operationName;
      if (parsed.query) query = parsed.query;
      if (parsed.variables) variables = parsed.variables;
      if (!operationType && query) {
        const q = String(query).trim();
        if (q.startsWith('mutation')) operationType = 'mutation';
        else if (q.startsWith('subscription')) operationType = 'subscription';
        else if (q.startsWith('query') || q.startsWith('{')) operationType = 'query';
      }
    } catch {}
  }

  if (!operationName) {
    const headerOp = Object.entries(event.request.headers || {}).find(
      ([k]) => k.toLowerCase() === 'x-apollo-operation-name'
    )?.[1];
    if (headerOp) operationName = headerOp;
  }

  let hasErrors = false;
  let errors: any = null;
  if (event.response?.body?.content) {
    try {
      const res = JSON.parse(event.response.body.content);
      if (Array.isArray(res.errors) && res.errors.length > 0) {
        hasErrors = true;
        errors = res.errors;
      }
    } catch {}
  }

  const isGraphQl = Boolean(
    operationName ||
    event.request.clientType === 'apollo' ||
    event.request.url.includes('/graphql')
  );

  return {
    isGraphQl,
    operationName,
    operationType: operationType || 'query',
    query,
    variables,
    hasErrors,
    errors
  };
}

interface TerminalTuiProps {
  events: NetworkEvent[];
  selectedId: string | null;
  onSelectEvent: (id: string) => void;
  onClear: () => void;
  connectedDevices?: DeviceInfo[];
  selectedDeviceId?: string;
  onSelectDeviceFilter?: (deviceId: string) => void;
  totalEventCount?: number;
  wsConnections?: WebSocketConnection[];
  selectedWsId?: string | null;
  onSelectWsConnection?: (id: string) => void;
}

export const TerminalTui: React.FC<TerminalTuiProps> = ({
  events,
  selectedId,
  onSelectEvent,
  onClear,
  connectedDevices = [],
  selectedDeviceId = 'all',
  onSelectDeviceFilter,
  totalEventCount,
  wsConnections = [],
  selectedWsId = null,
  onSelectWsConnection
}) => {
  const [filterText, setFilterText] = useState('');
  const [protocolFilter, setProtocolFilter] = useState<'all' | 'http' | 'graphql' | 'websocket' | 'error'>('all');

  // Sub-filter states
  const [httpMethodFilter, setHttpMethodFilter] = useState<'all' | 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>('all');
  const [httpStatusFilter, setHttpStatusFilter] = useState<'all' | '2xx' | '3xx' | '4xx' | '5xx' | 'error'>('all');

  const [gqlOpFilter, setGqlOpFilter] = useState<'all' | 'query' | 'mutation' | 'subscription'>('all');
  const [gqlHealthFilter, setGqlHealthFilter] = useState<'all' | 'clean' | 'errors'>('all');

  const [wsStateFilter, setWsStateFilter] = useState<'all' | 'open' | 'closed' | 'error'>('all');
  const [wsOpcodeSubFilter, setWsOpcodeSubFilter] = useState<'all' | 'text' | 'binary' | 'pingpong'>('all');

  const [errorTypeSubFilter, setErrorTypeSubFilter] = useState<'all' | '4xx' | '5xx' | 'graphql' | 'websocket' | 'network'>('all');

  // Chronological sort order: 'asc' = oldest first (1, 2, 3...), 'desc' = newest first
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const [activeDetailTab, setActiveDetailTab] = useState<'overview' | 'headers' | 'body' | 'timing'>('overview');
  const [bodyFormat, setBodyFormat] = useState<'pretty' | 'raw'>('pretty');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [activeTheme, setActiveTheme] = useState<'matrix' | 'cyan' | 'amber'>('cyan');

  // WebSocket inspection state
  const [wsDirectionFilter, setWsDirectionFilter] = useState<'all' | 'tx' | 'rx'>('all');
  const [wsFrameSearch, setWsFrameSearch] = useState('');
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [wsPayloadFormat, setWsPayloadFormat] = useState<'pretty' | 'raw' | 'hex'>('pretty');
  const [isWsHeadersExpanded, setIsWsHeadersExpanded] = useState(false);

  const filterInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  // Sub-filter counts calculation for live badges
  const httpEventsAll = events.filter(e => !extractGraphQlDetails(e).isGraphQl);
  const httpGetCount = httpEventsAll.filter(e => e.request.method === 'GET').length;
  const httpPostCount = httpEventsAll.filter(e => e.request.method === 'POST').length;
  const httpPutCount = httpEventsAll.filter(e => e.request.method === 'PUT').length;
  const handleDeleteCount = httpEventsAll.filter(e => e.request.method === 'DELETE').length;
  const httpPatchCount = httpEventsAll.filter(e => e.request.method === 'PATCH').length;
  const http2xxCount = httpEventsAll.filter(e => e.response?.statusCode && e.response.statusCode >= 200 && e.response.statusCode < 300).length;
  const http3xxCount = httpEventsAll.filter(e => e.response?.statusCode && e.response.statusCode >= 300 && e.response.statusCode < 400).length;
  const http4xxCount = httpEventsAll.filter(e => e.response?.statusCode && e.response.statusCode >= 400 && e.response.statusCode < 500).length;
  const http5xxCount = httpEventsAll.filter(e => e.response?.statusCode && e.response.statusCode >= 500).length;
  const httpErrCount = httpEventsAll.filter(e => e.status === 'error' || Boolean(e.error)).length;

  const gqlEventsAll = events.filter(e => extractGraphQlDetails(e).isGraphQl);
  const gqlQueryCount = gqlEventsAll.filter(e => extractGraphQlDetails(e).operationType === 'query').length;
  const gqlMutationCount = gqlEventsAll.filter(e => extractGraphQlDetails(e).operationType === 'mutation').length;
  const gqlSubCount = gqlEventsAll.filter(e => extractGraphQlDetails(e).operationType === 'subscription').length;
  const gqlCleanCount = gqlEventsAll.filter(e => !extractGraphQlDetails(e).hasErrors).length;
  const gqlErrorsCount = gqlEventsAll.filter(e => extractGraphQlDetails(e).hasErrors).length;

  const wsOpenCount = wsConnections.filter(c => c.status === 'open').length;
  const wsClosedCount = wsConnections.filter(c => c.status === 'closed').length;
  const wsErrorCount = wsConnections.filter(c => c.status === 'error' || Boolean(c.error)).length;
  const wsTextCount = wsConnections.filter(c => c.frames.some(f => f.opcode === 'text')).length;
  const wsBinaryCount = wsConnections.filter(c => c.frames.some(f => f.opcode === 'binary')).length;
  const wsPingPongCount = wsConnections.filter(c => c.frames.some(f => f.opcode === 'ping' || f.opcode === 'pong')).length;

  const err4xxCount = events.filter(e => e.response && e.response.statusCode >= 400 && e.response.statusCode < 500).length;
  const err5xxCount = events.filter(e => e.response && e.response.statusCode >= 500).length;
  const errGqlCount = gqlErrorsCount;
  const errWsCount = wsErrorCount;
  const errNetCount = events.filter(e => e.status === 'error' || Boolean(e.error)).length;
  const totalAllErrors = err4xxCount + err5xxCount + errGqlCount + errWsCount + errNetCount;

  const criteria: FilterCriteria = parseFilterQuery(filterText);

  // Apply Primary and Sub-Filters to HTTP / GraphQL events
  const filteredEvents = events.filter(e => {
    const gql = extractGraphQlDetails(e);

    if (protocolFilter === 'graphql') {
      if (!gql.isGraphQl) return false;
      if (gqlOpFilter !== 'all' && gql.operationType !== gqlOpFilter) return false;
      if (gqlHealthFilter === 'clean' && gql.hasErrors) return false;
      if (gqlHealthFilter === 'errors' && !gql.hasErrors) return false;
    } else if (protocolFilter === 'http') {
      if (gql.isGraphQl) return false;
      if (httpMethodFilter !== 'all' && e.request.method !== httpMethodFilter) return false;
      if (httpStatusFilter !== 'all') {
        const code = e.response?.statusCode ?? 0;
        if (httpStatusFilter === '2xx' && (code < 200 || code >= 300)) return false;
        if (httpStatusFilter === '3xx' && (code < 300 || code >= 400)) return false;
        if (httpStatusFilter === '4xx' && (code < 400 || code >= 500)) return false;
        if (httpStatusFilter === '5xx' && code < 500) return false;
        if (httpStatusFilter === 'error' && e.status !== 'error' && !e.error) return false;
      }
    } else if (protocolFilter === 'websocket') {
      return false;
    } else if (protocolFilter === 'error') {
      const is4xx = Boolean(e.response && e.response.statusCode >= 400 && e.response.statusCode < 500);
      const is5xx = Boolean(e.response && e.response.statusCode >= 500);
      const isGql = gql.hasErrors;
      const isNet = e.status === 'error' || Boolean(e.error);

      if (errorTypeSubFilter === '4xx' && !is4xx) return false;
      if (errorTypeSubFilter === '5xx' && !is5xx) return false;
      if (errorTypeSubFilter === 'graphql' && !isGql) return false;
      if (errorTypeSubFilter === 'network' && !isNet) return false;
      if (errorTypeSubFilter === 'websocket') return false;
      if (errorTypeSubFilter === 'all' && !is4xx && !is5xx && !isGql && !isNet) return false;
    }

    return matchesFilter(e, criteria);
  });

  // Apply Primary and Sub-Filters to WebSockets
  const filteredWsConnections = wsConnections.filter(c => {
    if (protocolFilter === 'http' || protocolFilter === 'graphql') return false;

    if (protocolFilter === 'websocket') {
      if (wsStateFilter !== 'all' && c.status !== wsStateFilter) return false;
      if (wsOpcodeSubFilter === 'text' && !c.frames.some(f => f.opcode === 'text')) return false;
      if (wsOpcodeSubFilter === 'binary' && !c.frames.some(f => f.opcode === 'binary')) return false;
      if (wsOpcodeSubFilter === 'pingpong' && !c.frames.some(f => f.opcode === 'ping' || f.opcode === 'pong')) return false;
    } else if (protocolFilter === 'error') {
      const isWsErr = c.status === 'error' || Boolean(c.error);
      if (errorTypeSubFilter !== 'all' && errorTypeSubFilter !== 'websocket') return false;
      if (!isWsErr) return false;
    }

    return matchesWebSocketFilter(c, criteria);
  });

  // UNIFIED TIMELINE: HTTP + WebSockets interleaved in exact chronological order
  type TimelineItem =
    | { id: string; type: 'http'; timestamp: number; event: NetworkEvent }
    | { id: string; type: 'websocket'; timestamp: number; connection: WebSocketConnection };

  const timelineItems: TimelineItem[] = [
    ...filteredEvents.map(e => ({
      id: e.id,
      type: 'http' as const,
      timestamp: e.timestamp,
      event: e
    })),
    ...filteredWsConnections.map(c => ({
      id: c.id,
      type: 'websocket' as const,
      timestamp: c.timestamp,
      connection: c
    }))
  ].sort((a, b) => {
    return sortOrder === 'desc'
      ? b.timestamp - a.timestamp
      : a.timestamp - b.timestamp;
  });

  // Determine current selected item: WebSocket or HTTP Event
  const selectedWs = selectedWsId
    ? wsConnections.find(w => w.id === selectedWsId) || null
    : (!selectedId && timelineItems.length > 0 && timelineItems[0].type === 'websocket')
    ? timelineItems[0].connection
    : null;

  const selectedEvent = (!selectedWs && selectedId)
    ? events.find(e => e.id === selectedId) || null
    : (!selectedWs && timelineItems.length > 0 && timelineItems[0].type === 'http')
    ? timelineItems[0].event
    : null;

  const currentFilteredDevice = connectedDevices.find(d => d.id === selectedDeviceId);

  // Keyboard navigation handler for unified timeline
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If user is typing in filter or custom inputs, don't intercept unless it's Escape
      if (document.activeElement === filterInputRef.current) {
        if (e.key === 'Escape') {
          filterInputRef.current?.blur();
        }
        return;
      }

      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        filterInputRef.current?.focus();
        return;
      }

      if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
        onClear();
        return;
      }

      if (timelineItems.length === 0) return;

      const currentIndex = timelineItems.findIndex(item =>
        (selectedWs && item.type === 'websocket' && item.id === selectedWs.id) ||
        (selectedEvent && item.type === 'http' && item.id === selectedEvent.id)
      );

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const nextIndex = Math.min(timelineItems.length - 1, (currentIndex >= 0 ? currentIndex + 1 : 0));
        const nextItem = timelineItems[nextIndex];
        if (nextItem) {
          if (nextItem.type === 'http') {
            onSelectEvent(nextItem.event.id);
          } else if (nextItem.type === 'websocket' && onSelectWsConnection) {
            onSelectWsConnection(nextItem.connection.id);
          }
        }
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const prevIndex = Math.max(0, (currentIndex >= 0 ? currentIndex - 1 : 0));
        const prevItem = timelineItems[prevIndex];
        if (prevItem) {
          if (prevItem.type === 'http') {
            onSelectEvent(prevItem.event.id);
          } else if (prevItem.type === 'websocket' && onSelectWsConnection) {
            onSelectWsConnection(prevItem.connection.id);
          }
        }
      } else if (e.key === '1') {
        setActiveDetailTab('overview');
      } else if (e.key === '2') {
        setActiveDetailTab('headers');
      } else if (e.key === '3') {
        setActiveDetailTab('body');
      } else if (e.key === '4') {
        setActiveDetailTab('timing');
      } else if (e.key === 'y' && selectedEvent) {
        e.preventDefault();
        copyToClipboard(formatRequestJson(selectedEvent), 'json');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [timelineItems, selectedEvent, selectedWs, onSelectEvent, onSelectWsConnection, onClear]);

  // Copy helper
  const copyToClipboard = (text: string, section: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 1800);
  };

  const formatRequestJson = (event: NetworkEvent): string => {
    let parsedReqBody: any = event.request.body?.content;
    if (parsedReqBody && typeof parsedReqBody === 'string') {
      try {
        parsedReqBody = JSON.parse(parsedReqBody);
      } catch {
        // preserve string
      }
    }

    let parsedResBody: any = event.response?.body?.content;
    if (parsedResBody && typeof parsedResBody === 'string') {
      try {
        parsedResBody = JSON.parse(parsedResBody);
      } catch {
        // preserve string
      }
    }

    const payload = {
      id: event.id,
      timestamp: new Date(event.timestamp).toISOString(),
      durationMs: event.durationMs,
      request: {
        method: event.request.method,
        url: event.request.url,
        host: event.request.host,
        path: event.request.path,
        protocol: event.response?.protocol || event.request.protocol,
        client: event.request.clientType,
        operationName: event.request.operationName || null,
        operationType: event.request.operationType || null,
        headers: event.request.headers,
        body: parsedReqBody ?? null
      },
      response: event.response ? {
        statusCode: event.response.statusCode,
        statusMessage: event.response.statusMessage,
        protocol: event.response.protocol,
        headers: event.response.headers,
        body: parsedResBody ?? null
      } : null,
      error: event.error ?? null
    };

    return JSON.stringify(payload, null, 2);
  };

  const generateCurl = (event: NetworkEvent): string => {
    let curl = `curl -X ${event.request.method} "${event.request.url}"`;
    Object.entries(event.request.headers).forEach(([k, v]) => {
      curl += ` \\\n  -H "${k}: ${v}"`;
    });
    if (event.request.body?.content) {
      curl += ` \\\n  -d '${event.request.body.content.replace(/'/g, "'\\''")}'`;
    }
    return curl;
  };

  const formatWsJson = (conn: WebSocketConnection): string => {
    return JSON.stringify({
      id: conn.id,
      type: 'websocket',
      timestamp: new Date(conn.timestamp).toISOString(),
      url: conn.url,
      host: conn.host,
      path: conn.path,
      status: conn.status,
      clientType: conn.clientType,
      framesCount: conn.frames.length,
      txFrames: conn.totalTxFrames ?? 0,
      rxFrames: conn.totalRxFrames ?? 0,
      txBytes: conn.totalTxBytes ?? 0,
      rxBytes: conn.totalRxBytes ?? 0,
      closeCode: conn.closeCode ?? null,
      closeReason: conn.closeReason ?? null,
      headers: conn.headers
    }, null, 2);
  };

  // Method color map
  const getMethodBadgeClass = (method: HttpMethod | string) => {
    switch (method) {
      case 'GET':
        return 'text-cyan-400 font-semibold';
      case 'POST':
        return 'text-emerald-400 font-semibold';
      case 'PUT':
        return 'text-amber-400 font-semibold';
      case 'DELETE':
        return 'text-rose-400 font-semibold';
      case 'PATCH':
        return 'text-purple-400 font-semibold';
      default:
        return 'text-neutral-300 font-semibold';
    }
  };

  // Status color map
  const getStatusClass = (event: NetworkEvent) => {
    if (event.status === 'error' || (event.response && event.response.statusCode >= 500)) {
      return 'text-rose-400 font-semibold';
    }
    if (event.status === 'pending') {
      return 'text-amber-400 font-mono animate-pulse';
    }
    if (!event.response) return 'text-neutral-400';
    const code = event.response.statusCode;
    if (code >= 200 && code < 300) return 'text-emerald-400 font-semibold';
    if (code >= 300 && code < 400) return 'text-sky-400 font-semibold';
    if (code >= 400 && code < 500) return 'text-amber-400 font-semibold';
    return 'text-rose-400 font-semibold';
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0c10] text-neutral-200 font-mono text-xs select-text">
      {/* TUI Top Header & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-[#0e121a] border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <span className="font-bold text-neutral-300 tracking-wider">blamebackend</span>
          <span className="text-neutral-600">|</span>
          <span className="text-neutral-400">
            events: <span className="text-cyan-400 tabular-nums">{filteredEvents.length}</span>
            {filteredEvents.length !== events.length && (
              <span className="text-neutral-500"> (of {events.length})</span>
            )}
            {wsConnections.length > 0 && (
              <>
                <span className="text-neutral-600 mx-1">·</span>
                ws: <span className="text-cyan-300 tabular-nums font-semibold">{wsConnections.length}</span>
              </>
            )}
          </span>
          <span className="text-neutral-600">|</span>
          <span className="text-neutral-500 hidden sm:inline">
            keys: <kbd className="text-neutral-300 bg-neutral-800 px-1 rounded">j/k</kbd> select{' '}
            <kbd className="text-neutral-300 bg-neutral-800 px-1 rounded">/</kbd> filter{' '}
            <kbd className="text-neutral-300 bg-neutral-800 px-1 rounded">c</kbd> clear
          </span>
        </div>

        {/* Active Device Filter Chip if specific device selected */}
        {selectedDeviceId && selectedDeviceId !== 'all' && currentFilteredDevice && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-cyan-950/70 border border-cyan-800 rounded text-cyan-300 text-xs font-mono shrink-0">
            <span className="text-neutral-400 text-[11px]">Device:</span>
            <span className="font-semibold">{currentFilteredDevice.deviceName}</span>
            {onSelectDeviceFilter && (
              <button
                onClick={() => onSelectDeviceFilter('all')}
                title="Show all devices"
                className="ml-1 text-cyan-400 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* Filter input */}
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              ref={filterInputRef}
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter e.g. host:api.com method:POST status:4xx type:ws search:chat"
              className="w-full bg-[#07090d] border border-neutral-700 focus:border-cyan-500 rounded px-2.5 pl-8 py-1 text-xs text-neutral-200 placeholder-neutral-600 outline-none font-mono transition-colors"
            />
            {filterText && (
              <button
                onClick={() => setFilterText('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Quick Filter Segments */}
        <div className="hidden lg:flex items-center gap-1 bg-[#07090d] p-0.5 rounded border border-neutral-800">
          <button
            onClick={() => {
              setFilterText('');
              setProtocolFilter('all');
              setHttpMethodFilter('all');
              setHttpStatusFilter('all');
              setGqlOpFilter('all');
              setGqlHealthFilter('all');
              setWsStateFilter('all');
              setWsOpcodeSubFilter('all');
              setErrorTypeSubFilter('all');
            }}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              protocolFilter === 'all' && filterText === ''
                ? 'bg-neutral-800 text-cyan-300 font-bold border border-neutral-700'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            All Traffic <span className="opacity-70 text-[10px]">({events.length + wsConnections.length})</span>
          </button>
          <button
            onClick={() => {
              setFilterText('');
              setProtocolFilter('http');
            }}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              protocolFilter === 'http'
                ? 'bg-neutral-800 text-cyan-300 font-bold border border-cyan-800/60'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            HTTP <span className="opacity-70 text-[10px]">({httpEventsAll.length})</span>
          </button>
          <button
            onClick={() => {
              setFilterText('');
              setProtocolFilter('graphql');
            }}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              protocolFilter === 'graphql'
                ? 'bg-indigo-950 text-indigo-300 border border-indigo-700 font-bold'
                : 'text-indigo-400/80 hover:text-indigo-200'
            }`}
          >
            GraphQL <span className="opacity-70 text-[10px]">({gqlEventsAll.length})</span>
          </button>
          <button
            onClick={() => {
              setFilterText('');
              setProtocolFilter('websocket');
              if (filteredWsConnections.length > 0 && onSelectWsConnection) {
                onSelectWsConnection(filteredWsConnections[0].id);
              }
            }}
            className={`px-2.5 py-1 rounded text-xs transition-colors flex items-center gap-1.5 ${
              protocolFilter === 'websocket'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-700 font-bold'
                : 'text-cyan-400/80 hover:text-cyan-200'
            }`}
          >
            <Radio className="w-3 h-3 text-cyan-400 animate-pulse" />
            <span>WebSockets</span>
            <span className="opacity-70 text-[10px]">({wsConnections.length})</span>
          </button>
          <button
            onClick={() => {
              setFilterText('');
              setProtocolFilter('error');
            }}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              protocolFilter === 'error'
                ? 'bg-rose-950 text-rose-300 border border-rose-700 font-bold'
                : 'text-neutral-400 hover:text-rose-300'
            }`}
          >
            Errors <span className="opacity-70 text-[10px]">({totalAllErrors})</span>
          </button>
        </div>

        {/* Shortcuts & Terminal CLI hint */}
        <div className="hidden xl:flex items-center gap-3 ml-auto text-[11px] text-neutral-400 font-mono">
          <span className="text-neutral-500">
            Hotkey: <kbd className="px-1 py-0.5 bg-neutral-800 text-neutral-300 rounded border border-neutral-700">y</kbd> Copy JSON
          </span>
          <span className="text-neutral-600">·</span>
          <div className="flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            <span>CLI Stream:</span>
            <code className="text-cyan-300 bg-[#07090d] px-1.5 py-0.5 rounded border border-neutral-800">npm run cli</code>
          </div>
        </div>
      </div>

      {/* Sub-Filter Toolbar: Automatically appears when user selects any protocol/category apart from All Traffic */}
      {protocolFilter !== 'all' && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 bg-[#0b0e14] border-b border-neutral-800 text-[11px] font-mono">
          {protocolFilter === 'http' && (
            <div className="flex flex-wrap items-center gap-3">
              {/* Method Sub-filters */}
              <div className="flex items-center gap-1">
                <span className="text-neutral-500 uppercase tracking-wider text-[10px] font-semibold mr-1">Method:</span>
                {(['all', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const).map(m => {
                  const count = m === 'all'
                    ? httpEventsAll.length
                    : m === 'GET' ? httpGetCount
                    : m === 'POST' ? httpPostCount
                    : m === 'PUT' ? httpPutCount
                    : m === 'DELETE' ? handleDeleteCount
                    : httpPatchCount;
                  const isActive = httpMethodFilter === m;
                  return (
                    <button
                      key={m}
                      onClick={() => setHttpMethodFilter(m)}
                      className={`px-2 py-0.5 rounded transition-colors ${
                        isActive
                          ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/80 font-bold'
                          : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
                      }`}
                    >
                      {m.toUpperCase()} <span className="opacity-70 text-[10px]">({count})</span>
                    </button>
                  );
                })}
              </div>

              <span className="text-neutral-700">|</span>

              {/* Status Sub-filters */}
              <div className="flex items-center gap-1">
                <span className="text-neutral-500 uppercase tracking-wider text-[10px] font-semibold mr-1">Status:</span>
                {(['all', '2xx', '3xx', '4xx', '5xx', 'error'] as const).map(s => {
                  const count = s === 'all'
                    ? httpEventsAll.length
                    : s === '2xx' ? http2xxCount
                    : s === '3xx' ? http3xxCount
                    : s === '4xx' ? http4xxCount
                    : s === '5xx' ? http5xxCount
                    : httpErrCount;
                  const isActive = httpStatusFilter === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setHttpStatusFilter(s)}
                      className={`px-2 py-0.5 rounded transition-colors ${
                        isActive
                          ? 'bg-neutral-800 text-cyan-300 border border-neutral-700 font-bold'
                          : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
                      }`}
                    >
                      {s.toUpperCase()} <span className="opacity-70 text-[10px]">({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {protocolFilter === 'graphql' && (
            <div className="flex flex-wrap items-center gap-3">
              {/* Operation Sub-filters */}
              <div className="flex items-center gap-1">
                <span className="text-neutral-500 uppercase tracking-wider text-[10px] font-semibold mr-1">Operation:</span>
                {(['all', 'query', 'mutation', 'subscription'] as const).map(op => {
                  const count = op === 'all'
                    ? gqlEventsAll.length
                    : op === 'query' ? gqlQueryCount
                    : op === 'mutation' ? gqlMutationCount
                    : gqlSubCount;
                  const isActive = gqlOpFilter === op;
                  return (
                    <button
                      key={op}
                      onClick={() => setGqlOpFilter(op)}
                      className={`px-2 py-0.5 rounded transition-colors uppercase ${
                        isActive
                          ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/80 font-bold'
                          : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
                      }`}
                    >
                      {op} <span className="opacity-70 text-[10px]">({count})</span>
                    </button>
                  );
                })}
              </div>

              <span className="text-neutral-700">|</span>

              {/* Health Sub-filters */}
              <div className="flex items-center gap-1">
                <span className="text-neutral-500 uppercase tracking-wider text-[10px] font-semibold mr-1">Resolver:</span>
                <button
                  onClick={() => setGqlHealthFilter('all')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    gqlHealthFilter === 'all'
                      ? 'bg-neutral-800 text-white font-bold border border-neutral-700'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  ALL <span className="opacity-70 text-[10px]">({gqlEventsAll.length})</span>
                </button>
                <button
                  onClick={() => setGqlHealthFilter('clean')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    gqlHealthFilter === 'clean'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/80 font-bold'
                      : 'text-neutral-400 hover:text-emerald-300'
                  }`}
                >
                  CLEAN OK <span className="opacity-70 text-[10px]">({gqlCleanCount})</span>
                </button>
                <button
                  onClick={() => setGqlHealthFilter('errors')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    gqlHealthFilter === 'errors'
                      ? 'bg-rose-950 text-rose-300 border border-rose-700/80 font-bold'
                      : 'text-neutral-400 hover:text-rose-300'
                  }`}
                >
                  RESOLVER ERRORS <span className="opacity-70 text-[10px]">({gqlErrorsCount})</span>
                </button>
              </div>
            </div>
          )}

          {protocolFilter === 'websocket' && (
            <div className="flex flex-wrap items-center gap-3">
              {/* State Sub-filters */}
              <div className="flex items-center gap-1">
                <span className="text-neutral-500 uppercase tracking-wider text-[10px] font-semibold mr-1">State:</span>
                {(['all', 'open', 'closed', 'error'] as const).map(st => {
                  const count = st === 'all'
                    ? wsConnections.length
                    : st === 'open' ? wsOpenCount
                    : st === 'closed' ? wsClosedCount
                    : wsErrorCount;
                  const isActive = wsStateFilter === st;
                  return (
                    <button
                      key={st}
                      onClick={() => setWsStateFilter(st)}
                      className={`px-2 py-0.5 rounded transition-colors uppercase ${
                        isActive
                          ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/80 font-bold'
                          : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
                      }`}
                    >
                      {st} <span className="opacity-70 text-[10px]">({count})</span>
                    </button>
                  );
                })}
              </div>

              <span className="text-neutral-700">|</span>

              {/* Opcode Sub-filters */}
              <div className="flex items-center gap-1">
                <span className="text-neutral-500 uppercase tracking-wider text-[10px] font-semibold mr-1">Frames:</span>
                <button
                  onClick={() => setWsOpcodeSubFilter('all')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    wsOpcodeSubFilter === 'all'
                      ? 'bg-neutral-800 text-white font-bold border border-neutral-700'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  ALL
                </button>
                <button
                  onClick={() => setWsOpcodeSubFilter('text')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    wsOpcodeSubFilter === 'text'
                      ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/80 font-bold'
                      : 'text-neutral-400 hover:text-cyan-300'
                  }`}
                >
                  TEXT <span className="opacity-70 text-[10px]">({wsTextCount})</span>
                </button>
                <button
                  onClick={() => setWsOpcodeSubFilter('binary')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    wsOpcodeSubFilter === 'binary'
                      ? 'bg-amber-950 text-amber-300 border border-amber-700/80 font-bold'
                      : 'text-neutral-400 hover:text-amber-300'
                  }`}
                >
                  BINARY <span className="opacity-70 text-[10px]">({wsBinaryCount})</span>
                </button>
                <button
                  onClick={() => setWsOpcodeSubFilter('pingpong')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    wsOpcodeSubFilter === 'pingpong'
                      ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/80 font-bold'
                      : 'text-neutral-400 hover:text-indigo-300'
                  }`}
                >
                  PING/PONG <span className="opacity-70 text-[10px]">({wsPingPongCount})</span>
                </button>
              </div>
            </div>
          )}

          {protocolFilter === 'error' && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="text-neutral-500 uppercase tracking-wider text-[10px] font-semibold mr-1">Error Type:</span>
                {(['all', '4xx', '5xx', 'graphql', 'websocket', 'network'] as const).map(et => {
                  const count = et === 'all'
                    ? totalAllErrors
                    : et === '4xx' ? err4xxCount
                    : et === '5xx' ? err5xxCount
                    : et === 'graphql' ? errGqlCount
                    : et === 'websocket' ? errWsCount
                    : errNetCount;
                  const isActive = errorTypeSubFilter === et;
                  return (
                    <button
                      key={et}
                      onClick={() => setErrorTypeSubFilter(et)}
                      className={`px-2 py-0.5 rounded transition-colors uppercase ${
                        isActive
                          ? 'bg-rose-950 text-rose-300 border border-rose-700/80 font-bold'
                          : 'text-neutral-400 hover:text-rose-300 hover:bg-neutral-900'
                      }`}
                    >
                      {et} <span className="opacity-70 text-[10px]">({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Reset Sub-filters button */}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => {
                setHttpMethodFilter('all');
                setHttpStatusFilter('all');
                setGqlOpFilter('all');
                setGqlHealthFilter('all');
                setWsStateFilter('all');
                setWsOpcodeSubFilter('all');
                setErrorTypeSubFilter('all');
              }}
              className="text-[10px] text-neutral-400 hover:text-white flex items-center gap-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 px-2 py-0.5 rounded transition-colors"
            >
              <X className="w-3 h-3 text-neutral-400" />
              <span>Reset Sub-filters</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Split-Pane View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pane: Request List (45% width on desktop) */}
        <div
          ref={listContainerRef}
          className="w-full md:w-[48%] lg:w-[45%] flex flex-col border-r border-neutral-800 bg-[#07090e] overflow-y-auto"
        >
          {/* Table Column Header & Sort Order Toggle */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0a0d14] border-b border-neutral-800 text-[10px] text-neutral-500 uppercase tracking-wider font-semibold select-none sticky top-0 z-10 font-mono">
            <span className="w-6 text-right">#</span>
            <span className="w-14">Method</span>
            <span className="w-14">Status</span>
            <span className="flex-1">Target Path / URL</span>
            <span className="shrink-0 w-12 text-center">Proto</span>
            <span className="shrink-0 w-12">Client</span>
            <div className="w-16 flex items-center justify-end">
              <button
                onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="flex items-center gap-1 text-neutral-400 hover:text-cyan-300 transition-colors"
                title={sortOrder === 'asc' ? 'Order: Oldest first (click for newest first)' : 'Order: Newest first (click for oldest first)'}
              >
                <span>Time</span>
                <ArrowUpDown className="w-3 h-3 text-cyan-400" />
              </button>
            </div>
          </div>

          {timelineItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center text-neutral-500">
              <Filter className="w-8 h-8 mb-3 text-neutral-600" />
              <p className="font-semibold text-neutral-400 mb-1">
                {events.length === 0 && wsConnections.length === 0 ? 'No network traffic captured yet' : 'No items match current filter'}
              </p>
              <p className="text-neutral-600 text-[11px] max-w-xs">
                {events.length === 0 && wsConnections.length === 0
                  ? 'Connect your Kotlin Multiplatform app (Android, iOS, Desktop) or run Test Scenarios to inspect HTTP and WebSocket traffic.'
                  : `Clear filter or adjust your sub-filters to see traffic.`}
              </p>
              {(filterText || protocolFilter !== 'all') && (
                <button
                  onClick={() => {
                    setFilterText('');
                    setProtocolFilter('all');
                    setHttpMethodFilter('all');
                    setHttpStatusFilter('all');
                    setGqlOpFilter('all');
                    setGqlHealthFilter('all');
                    setWsStateFilter('all');
                    setWsOpcodeSubFilter('all');
                    setErrorTypeSubFilter('all');
                  }}
                  className="mt-3 px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-xs transition-colors"
                >
                  Reset All Filters
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-neutral-800/60">
              {/* INTERLEAVED UNIFIED TIMELINE: HTTP + WebSockets in exact chronological order */}
              {timelineItems.map((item, idx) => {
                const displayIdx = idx + 1;

                if (item.type === 'websocket') {
                  const conn = item.connection;
                  const isSelected = selectedWs?.id === conn.id;

                  return (
                    <div
                      key={`ws-${conn.id}`}
                      onClick={() => onSelectWsConnection && onSelectWsConnection(conn.id)}
                      className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-neutral-800/90 text-white border-l-2 border-cyan-400 pl-[10px]'
                          : 'hover:bg-neutral-900/70 text-neutral-300'
                      }`}
                    >
                      <span className="text-neutral-500 w-6 text-right tabular-nums shrink-0 font-mono">
                        {displayIdx}
                      </span>

                      <span className="w-14 shrink-0 text-cyan-400 font-bold flex items-center gap-1 font-mono">
                        <Radio className="w-3 h-3 text-cyan-400 animate-pulse" />
                        WS
                      </span>

                      <div className="w-14 shrink-0 flex items-center gap-1">
                        <span className={`text-[10px] font-bold uppercase tracking-wider font-mono ${
                          conn.status === 'open'
                            ? 'text-emerald-400'
                            : conn.status === 'error'
                            ? 'text-rose-400'
                            : 'text-neutral-500'
                        }`}>
                          {conn.status}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0 truncate flex items-center gap-1.5">
                        <span className="text-cyan-300 font-semibold truncate font-mono text-xs">
                          {conn.url}
                        </span>
                        <span className="text-neutral-500 text-[10px] truncate hidden xl:inline font-mono">
                          (TX: {conn.totalTxFrames || 0} · RX: {conn.totalRxFrames || 0})
                        </span>
                      </div>

                      <span className="text-[10px] font-mono shrink-0 px-1 py-0.5 rounded bg-neutral-800 text-cyan-300 border border-neutral-700/60">
                        WSS
                      </span>

                      <span className="text-[10px] shrink-0 text-neutral-400 font-semibold font-mono w-12 truncate">
                        {conn.clientType}
                      </span>

                      {conn.deviceName && (
                        <span
                          className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-[#0c1018] text-cyan-300 border border-neutral-800 shrink-0 max-w-[85px] truncate hidden sm:inline-block"
                          title={`Device: ${conn.deviceName}`}
                        >
                          {conn.deviceName}
                        </span>
                      )}

                      <span className="w-14 text-right tabular-nums text-neutral-400 shrink-0 text-[11px] font-mono">
                        {conn.durationMs ? `${Math.round(conn.durationMs / 1000)}s` : 'active'}
                      </span>

                      {/* Quick JSON Copy Button on Hover */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(formatWsJson(conn), `row-json-ws-${conn.id}`);
                        }}
                        title="Copy WebSocket session as JSON"
                        className="opacity-0 group-hover:opacity-100 p-1 text-neutral-500 hover:text-cyan-400 transition-all shrink-0 rounded hover:bg-neutral-800"
                      >
                        {copiedSection === `row-json-ws-${conn.id}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  );
                }

                // HTTP / GraphQL item
                const event = item.event;
                const isSelected = !selectedWs && selectedEvent?.id === event.id;
                const gql = extractGraphQlDetails(event);

                return (
                  <div
                    key={`http-${event.id}`}
                    onClick={() => onSelectEvent(event.id)}
                    className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-neutral-800/90 text-white border-l-2 border-cyan-400 pl-[10px]'
                        : 'hover:bg-neutral-900/70 text-neutral-300'
                    }`}
                  >
                    {/* Index */}
                    <span className="text-neutral-500 w-6 text-right tabular-nums shrink-0 font-mono">
                      {displayIdx}
                    </span>

                    {/* Method */}
                    <span className={`w-14 shrink-0 font-mono ${getMethodBadgeClass(event.request.method)}`}>
                      {event.request.method}
                    </span>

                    {/* Status Code */}
                    <div className="w-14 shrink-0 flex items-center gap-1 font-mono">
                      <span className={`tabular-nums ${gql.hasErrors ? 'text-amber-400 font-semibold' : getStatusClass(event)}`}>
                        {event.status === 'pending'
                          ? '...'
                          : event.status === 'error'
                          ? 'ERR'
                          : event.response?.statusCode}
                      </span>
                      {gql.hasErrors && (
                        <span
                          className="text-[9px] font-bold px-1 py-0.2 rounded bg-rose-950/90 text-rose-300 border border-rose-700/80 shrink-0 font-mono"
                          title="GraphQL resolver returned errors in HTTP 200 payload"
                        >
                          ERR
                        </span>
                      )}
                    </div>

                    {/* Host & Path or GraphQL Operation */}
                    <div className="flex-1 min-w-0 truncate flex items-center gap-1.5 font-mono">
                      {gql.isGraphQl ? (
                        <>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.2 rounded tracking-wide border shrink-0 font-mono ${
                              gql.operationType === 'mutation'
                                ? 'bg-amber-950/80 text-amber-300 border-amber-700/60'
                                : gql.operationType === 'subscription'
                                ? 'bg-purple-950/80 text-purple-300 border-purple-700/60'
                                : 'bg-indigo-950/80 text-indigo-300 border-indigo-700/60'
                            }`}
                          >
                            GQL {gql.operationType.toUpperCase()}
                          </span>
                          <span className="text-cyan-300 font-semibold truncate font-mono text-xs">
                            {gql.operationName || 'Anonymous'}
                          </span>
                          <span className="text-neutral-500 text-[10px] truncate hidden xl:inline font-mono">
                            ({event.request.host}{event.request.path})
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-neutral-400">{event.request.host}</span>
                          <span className="text-neutral-200">{event.request.path}</span>
                        </>
                      )}
                    </div>

                    {/* Protocol badge */}
                    <span
                      className={`text-[10px] font-mono shrink-0 px-1 py-0.5 rounded ${
                        event.response?.protocol
                          ? 'bg-neutral-800 text-cyan-300 border border-neutral-700/60'
                          : 'text-neutral-500'
                      }`}
                      title={event.response?.protocol ? `Negotiated Protocol: ${event.response.protocol}` : 'Protocol negotiating...'}
                    >
                      {event.response?.protocol || (event.status === 'pending' ? '...' : event.request.protocol || 'HTTP')}
                    </span>

                    {/* Client engine badge */}
                    <span className={`text-[10px] shrink-0 font-mono w-12 truncate ${event.request.clientType === 'apollo' ? 'text-indigo-400 font-semibold' : 'text-neutral-500'}`}>
                      {event.request.clientType}
                    </span>

                    {/* Device source badge */}
                    {event.deviceName && (
                      <span
                        className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-[#0c1018] text-cyan-300 border border-neutral-800 shrink-0 max-w-[85px] truncate hidden sm:inline-block"
                        title={`Device: ${event.deviceName} (${event.appName || ''})`}
                      >
                        {event.deviceName}
                      </span>
                    )}

                    {/* Duration */}
                    <span className="w-14 text-right tabular-nums text-neutral-400 shrink-0 text-[11px] font-mono">
                      {event.durationMs !== null ? `${event.durationMs}ms` : 'in-flight'}
                    </span>

                    {/* Quick JSON Copy Button on Hover */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(formatRequestJson(event), `row-json-${event.id}`);
                      }}
                      title="Copy request as JSON"
                      className="opacity-0 group-hover:opacity-100 p-1 text-neutral-500 hover:text-cyan-400 transition-all shrink-0 rounded hover:bg-neutral-800"
                    >
                      {copiedSection === `row-json-${event.id}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Pane: Request / WebSocket Details View */}
        <div className="hidden md:flex flex-1 flex-col bg-[#0b0e14] overflow-y-auto">
          {selectedWs ? (() => {
            const filteredWsFrames = selectedWs.frames.filter(f => {
              if (wsDirectionFilter === 'tx' && f.direction !== 'tx') return false;
              if (wsDirectionFilter === 'rx' && f.direction !== 'rx') return false;
              if (wsFrameSearch) {
                const s = wsFrameSearch.toLowerCase();
                const opcodeMatch = f.opcode.toLowerCase().includes(s);
                const payloadMatch = f.payload?.content && f.payload.content.toLowerCase().includes(s);
                if (!opcodeMatch && !payloadMatch) return false;
              }
              return true;
            });

            const activeFrame = selectedWs.frames.find(f => f.id === selectedFrameId)
              || (filteredWsFrames.length > 0 ? filteredWsFrames[filteredWsFrames.length - 1] : null);

            const subprotocol = selectedWs.headers['sec-websocket-protocol'] || selectedWs.headers['Sec-WebSocket-Protocol'];

            return (
              <div className="flex flex-col h-full">
                {/* WS Detail Header Bar */}
                <div className="p-4 border-b border-neutral-800 bg-[#0e121a]">
                  <div className="text-neutral-500 text-[11px] mb-1 font-mono">
                    ────────────────────────────────────────────────────────────────
                  </div>

                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className="text-sm font-bold px-2 py-0.5 rounded border uppercase tracking-wider bg-emerald-950 text-emerald-300 border-emerald-700/80 font-mono">
                          WEBSOCKET
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider font-mono ${
                          selectedWs.status === 'open'
                            ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600 animate-pulse'
                            : selectedWs.status === 'closed'
                            ? 'bg-neutral-900 text-neutral-400 border-neutral-700'
                            : selectedWs.status === 'connecting'
                            ? 'bg-amber-950 text-amber-300 border-amber-700'
                            : 'bg-rose-950 text-rose-300 border-rose-700'
                        }`}>
                          {selectedWs.status}
                        </span>
                        <span className="text-white text-base font-bold font-mono tracking-tight select-all break-all">
                          {selectedWs.url}
                        </span>
                        {subprotocol && (
                          <span className="text-[10px] text-cyan-400 bg-cyan-950/60 border border-cyan-800/80 px-2 py-0.5 rounded font-mono">
                            proto: {subprotocol}
                          </span>
                        )}
                        <span className="text-[10px] text-neutral-400 bg-neutral-900 border border-neutral-800 px-2 py-0.5 rounded font-mono">
                          client: {selectedWs.clientType}
                        </span>
                      </div>

                      {/* Connection Stats Bar */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400 font-mono mt-2">
                        <span className="flex items-center gap-1.5">
                          <Radio className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Total: <strong className="text-white">{selectedWs.frames.length}</strong> frames</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-cyan-400">
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          <span>TX: <strong>{selectedWs.totalTxFrames ?? 0}</strong> ({formatBytes(selectedWs.totalTxBytes ?? 0)})</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-purple-400">
                          <ArrowDownLeft className="w-3.5 h-3.5" />
                          <span>RX: <strong>{selectedWs.totalRxFrames ?? 0}</strong> ({formatBytes(selectedWs.totalRxBytes ?? 0)})</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-neutral-400">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Duration: <strong className="text-neutral-200">{selectedWs.durationMs !== undefined && selectedWs.durationMs !== null ? `${selectedWs.durationMs}ms` : 'active'}</strong></span>
                        </span>
                        {selectedWs.closeCode !== undefined && selectedWs.closeCode !== null && (
                          <span className="text-neutral-300">
                            Close: <strong className="text-amber-400 font-bold">{selectedWs.closeCode}</strong> {selectedWs.closeReason ? `(${selectedWs.closeReason})` : ''}
                          </span>
                        )}
                      </div>

                      {selectedWs.error && (
                        <div className="mt-2.5 p-2 bg-rose-950/50 border border-rose-800 rounded text-xs text-rose-300 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                          <span>{selectedWs.error.message || selectedWs.error.errorType}</span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => copyToClipboard(selectedWs.url, 'ws-url')}
                        className="p-1.5 text-neutral-400 hover:text-white bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded text-xs flex items-center gap-1.5 transition-colors"
                        title="Copy WebSocket URL"
                      >
                        {copiedSection === 'ws-url' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400 font-mono">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span className="font-mono">URL</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => setIsWsHeadersExpanded(!isWsHeadersExpanded)}
                        className={`p-1.5 border rounded text-xs flex items-center gap-1.5 transition-colors ${
                          isWsHeadersExpanded
                            ? 'bg-neutral-800 text-cyan-300 border-cyan-800'
                            : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:border-neutral-700 hover:text-white'
                        }`}
                        title="Toggle Handshake Headers"
                      >
                        {isWsHeadersExpanded ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        <span className="font-mono">Handshake Headers</span>
                      </button>
                    </div>
                  </div>

                  {/* Collapsible Handshake Headers Drawer */}
                  {isWsHeadersExpanded && (
                    <div className="mt-3 pt-3 border-t border-neutral-800 text-xs">
                      <div className="bg-[#080b10] p-2.5 rounded border border-neutral-800">
                        <div className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider mb-2 font-mono">
                          Captured Handshake Headers
                        </div>
                        {selectedWs.headers && Object.keys(selectedWs.headers).length > 0 ? (
                          <div className="space-y-1 font-mono text-[11px]">
                            {Object.entries(selectedWs.headers).map(([k, v]) => (
                              <div key={k} className="flex gap-2">
                                <span className="text-neutral-500 shrink-0">{k}:</span>
                                <span className="text-neutral-300 break-all select-all">{String(v)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-neutral-600 text-xs italic font-mono">No headers captured</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Duplex Frame Stream & Selected Frame Viewer */}
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Frame Filter Toolbar */}
                  <div className="px-4 py-2 border-b border-neutral-800 bg-[#0c0f16] flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-neutral-500 mr-2 uppercase text-[10px] tracking-wider font-semibold font-mono">Direction:</span>
                      <button
                        onClick={() => setWsDirectionFilter('all')}
                        className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                          wsDirectionFilter === 'all'
                            ? 'bg-neutral-800 text-white font-semibold border border-neutral-700'
                            : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        ALL ({selectedWs.frames.length})
                      </button>
                      <button
                        onClick={() => setWsDirectionFilter('tx')}
                        className={`px-2.5 py-1 rounded text-xs font-mono flex items-center gap-1 transition-colors ${
                          wsDirectionFilter === 'tx'
                            ? 'bg-cyan-950/80 text-cyan-300 font-semibold border border-cyan-800'
                            : 'text-neutral-400 hover:text-cyan-300'
                        }`}
                      >
                        <ArrowUpRight className="w-3 h-3 text-cyan-400" />
                        TX ({selectedWs.totalTxFrames ?? 0})
                      </button>
                      <button
                        onClick={() => setWsDirectionFilter('rx')}
                        className={`px-2.5 py-1 rounded text-xs font-mono flex items-center gap-1 transition-colors ${
                          wsDirectionFilter === 'rx'
                            ? 'bg-purple-950/80 text-purple-300 font-semibold border border-purple-800'
                            : 'text-neutral-400 hover:text-purple-300'
                        }`}
                      >
                        <ArrowDownLeft className="w-3 h-3 text-purple-400" />
                        RX ({selectedWs.totalRxFrames ?? 0})
                      </button>
                    </div>

                    <div className="relative w-48 sm:w-64">
                      <input
                        type="text"
                        placeholder="Filter frames (e.g. ping, json)..."
                        value={wsFrameSearch}
                        onChange={(e) => setWsFrameSearch(e.target.value)}
                        className="w-full bg-[#080b10] border border-neutral-800 rounded px-2.5 py-1 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-cyan-500 font-mono"
                      />
                      {wsFrameSearch && (
                        <button
                          onClick={() => setWsFrameSearch('')}
                          className="absolute right-2 top-1.5 text-neutral-500 hover:text-neutral-300"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Split: Frames Timeline (Upper) & Frame Payload Inspector (Lower) */}
                  <div className="flex-1 flex flex-col md:flex-row min-h-0">
                    {/* Frames Timeline Feed */}
                    <div className="flex-1 overflow-y-auto border-b md:border-b-0 md:border-r border-neutral-800 divide-y divide-neutral-900/80 bg-[#080b10]">
                      {filteredWsFrames.length === 0 ? (
                        <div className="p-8 text-center text-neutral-600 text-xs font-mono">
                          No WebSocket frames match the current filter.
                        </div>
                      ) : (
                        filteredWsFrames.map((frame) => {
                          const isSelected = activeFrame?.id === frame.id;
                          const elapsed = frame.timestamp - selectedWs.timestamp;
                          const isTx = frame.direction === 'tx';

                          return (
                            <div
                              key={frame.id}
                              onClick={() => setSelectedFrameId(frame.id)}
                              className={`p-2.5 cursor-pointer text-xs font-mono transition-colors flex items-center gap-3 ${
                                isSelected
                                  ? 'bg-[#141b27] border-l-2 border-cyan-400'
                                  : 'hover:bg-[#0d1219]'
                              }`}
                            >
                              {/* Direction Icon & Label */}
                              <div className="flex items-center gap-1 w-14 shrink-0">
                                {isTx ? (
                                  <>
                                    <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />
                                    <span className="text-cyan-400 font-bold text-[11px]">TX</span>
                                  </>
                                ) : (
                                  <>
                                    <ArrowDownLeft className="w-3.5 h-3.5 text-purple-400" />
                                    <span className="text-purple-400 font-bold text-[11px]">RX</span>
                                  </>
                                )}
                              </div>

                              {/* Opcode Badge */}
                              <div className="w-16 shrink-0">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${
                                  frame.opcode === 'text'
                                    ? 'bg-cyan-950/70 text-cyan-300 border-cyan-800'
                                    : frame.opcode === 'binary'
                                    ? 'bg-amber-950/70 text-amber-300 border-amber-800'
                                    : frame.opcode === 'ping'
                                    ? 'bg-blue-950/70 text-blue-300 border-blue-800'
                                    : frame.opcode === 'pong'
                                    ? 'bg-indigo-950/70 text-indigo-300 border-indigo-800'
                                    : 'bg-rose-950/70 text-rose-300 border-rose-800'
                                }`}>
                                  {frame.opcode}
                                </span>
                              </div>

                              {/* Payload Snippet Preview */}
                              <div className="flex-1 min-w-0 truncate text-neutral-300 text-xs font-mono">
                                {frame.payload?.content || (frame.payload?.hexPreview ? `[Binary: ${frame.payload.hexPreview.slice(0, 40)}...]` : `[${frame.opcode}]`)}
                              </div>

                              {/* Size */}
                              <div className="text-neutral-500 text-[11px] tabular-nums shrink-0 w-16 text-right font-mono">
                                {formatBytes(frame.payload?.sizeBytes ?? 0)}
                              </div>

                              {/* Timestamp / Elapsed */}
                              <div className="text-neutral-500 text-[11px] tabular-nums shrink-0 w-16 text-right font-mono" title={new Date(frame.timestamp).toLocaleTimeString()}>
                                +{elapsed}ms
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Frame Payload Inspector (Right / Lower pane) */}
                    <div className="w-full md:w-[48%] flex flex-col bg-[#0b0e14] overflow-hidden">
                      {activeFrame ? (() => {
                        const isTx = activeFrame.direction === 'tx';
                        const content = activeFrame.payload?.content || '';
                        const hexPreview = activeFrame.payload?.hexPreview || null;
                        const isJson = (() => {
                          if (!content) return false;
                          try {
                            JSON.parse(content);
                            return true;
                          } catch {
                            return false;
                          }
                        })();

                        let displayPayload = '';
                        if (wsPayloadFormat === 'pretty' && isJson) {
                          try {
                            displayPayload = JSON.stringify(JSON.parse(content), null, 2);
                          } catch {
                            displayPayload = content;
                          }
                        } else if (wsPayloadFormat === 'hex') {
                          displayPayload = formatHexDump(content, hexPreview);
                        } else {
                          displayPayload = content || hexPreview || '';
                        }

                        return (
                          <div className="flex flex-col h-full">
                            {/* Frame Inspector Header */}
                            <div className="p-3 border-b border-neutral-800 bg-[#0e121a] flex items-center justify-between gap-2 shrink-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider font-mono ${
                                  isTx
                                    ? 'bg-cyan-950 text-cyan-300 border-cyan-800'
                                    : 'bg-purple-950 text-purple-300 border-purple-800'
                                }`}>
                                  {isTx ? 'TX (Client → Server)' : 'RX (Server → Client)'}
                                </span>
                                <span className="text-white text-xs font-mono font-bold uppercase">
                                  {activeFrame.opcode}
                                </span>
                                <span className="text-neutral-500 text-xs font-mono">
                                  ({formatBytes(activeFrame.payload?.sizeBytes ?? 0)})
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5">
                                {/* Format Switcher */}
                                <div className="flex bg-[#080b10] border border-neutral-800 rounded p-0.5 text-[11px] font-mono">
                                  {isJson && (
                                    <button
                                      onClick={() => setWsPayloadFormat('pretty')}
                                      className={`px-2 py-0.5 rounded transition-colors ${
                                        wsPayloadFormat === 'pretty'
                                          ? 'bg-cyan-950 text-cyan-300 font-bold'
                                          : 'text-neutral-400 hover:text-white'
                                      }`}
                                    >
                                      JSON
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setWsPayloadFormat('raw')}
                                    className={`px-2 py-0.5 rounded transition-colors ${
                                      wsPayloadFormat === 'raw'
                                        ? 'bg-cyan-950 text-cyan-300 font-bold'
                                        : 'text-neutral-400 hover:text-white'
                                    }`}
                                  >
                                    Raw
                                  </button>
                                  <button
                                    onClick={() => setWsPayloadFormat('hex')}
                                    className={`px-2 py-0.5 rounded transition-colors ${
                                      wsPayloadFormat === 'hex'
                                        ? 'bg-cyan-950 text-cyan-300 font-bold'
                                        : 'text-neutral-400 hover:text-white'
                                    }`}
                                  >
                                    Hex
                                  </button>
                                </div>

                                <button
                                  onClick={() => copyToClipboard(displayPayload, `ws-frame-${activeFrame.id}`)}
                                  className="p-1 text-neutral-400 hover:text-cyan-400 rounded hover:bg-neutral-800 transition-colors"
                                  title="Copy Frame Payload"
                                >
                                  {copiedSection === `ws-frame-${activeFrame.id}` ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>

                            {/* Frame Metadata Strip */}
                            <div className="px-3 py-1.5 bg-[#090c12] border-b border-neutral-800 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-neutral-500 shrink-0">
                              <span>ID: <strong className="text-neutral-300 select-all">{activeFrame.id}</strong></span>
                              <span>Time: <strong className="text-neutral-300">{new Date(activeFrame.timestamp).toLocaleTimeString()}.{String(activeFrame.timestamp % 1000).padStart(3, '0')}</strong></span>
                              <span>Masked: <strong className="text-neutral-300">{isTx ? 'true' : 'false'}</strong></span>
                            </div>

                            {/* Frame Payload Display */}
                            <div className="flex-1 p-3 overflow-auto bg-[#07090e]">
                              <pre className={`text-xs font-mono whitespace-pre leading-relaxed select-all ${
                                wsPayloadFormat === 'hex'
                                  ? 'text-amber-200/90 font-mono text-[11px]'
                                  : isTx
                                  ? 'text-cyan-200/90'
                                  : 'text-purple-200/90'
                              }`}>
                                {displayPayload || '<Empty payload>'}
                              </pre>
                            </div>
                          </div>
                        );
                      })() : (
                        <div className="flex flex-col items-center justify-center h-full p-8 text-neutral-600 text-xs font-mono">
                          <Radio className="w-8 h-8 mb-2 text-neutral-700" />
                          <span>Select a WebSocket frame to inspect payload details</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })() : selectedEvent ? (() => {
            const selectedGql = extractGraphQlDetails(selectedEvent);
            return (
            <div className="flex flex-col h-full">
              {/* Detail Header Bar */}
              <div className="p-4 border-b border-neutral-800 bg-[#0e121a]">
                <div className="text-neutral-500 text-[11px] mb-1 font-mono">
                  ────────────────────────────────────────────────────────────────
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className={`text-sm ${getMethodBadgeClass(selectedEvent.request.method)}`}>
                        {selectedEvent.request.method}
                      </span>
                      {selectedGql.isGraphQl ? (
                        <>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                            selectedGql.operationType === 'mutation'
                              ? 'bg-amber-950 text-amber-300 border-amber-700/80'
                              : selectedGql.operationType === 'subscription'
                              ? 'bg-purple-950 text-purple-300 border-purple-700/80'
                              : 'bg-indigo-950 text-indigo-300 border-indigo-700/80'
                          }`}>
                            GQL {selectedGql.operationType}
                          </span>
                          <span className="text-white text-base font-bold font-mono tracking-tight select-all">
                            {selectedGql.operationName || 'Anonymous Operation'}
                          </span>
                          <span className="text-neutral-500 text-xs font-mono break-all">
                            ({selectedEvent.request.url})
                          </span>
                          {selectedGql.hasErrors && (
                            <span className="text-[10px] text-rose-300 bg-rose-950/90 border border-rose-700/80 px-2 py-0.5 rounded font-bold">
                              Resolver Errors ({selectedGql.errors?.length})
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-neutral-200 text-sm break-all font-semibold select-all">
                          {selectedEvent.request.url}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-neutral-400 text-[11px]">
                      <span>
                        Status:{' '}
                        <span className={getStatusClass(selectedEvent)}>
                          {selectedEvent.status === 'pending'
                            ? 'Pending (In-flight)'
                            : selectedEvent.status === 'error'
                            ? `Failed (${selectedEvent.error?.errorType || 'Error'})`
                            : `${selectedEvent.response?.statusCode} ${selectedEvent.response?.statusMessage}`}
                        </span>
                      </span>
                      <span>·</span>
                      <span>
                        Duration:{' '}
                        <span className="text-neutral-200 tabular-nums">
                          {selectedEvent.durationMs !== null ? `${selectedEvent.durationMs} ms` : 'In progress...'}
                        </span>
                      </span>
                      <span>·</span>
                      <span>
                        Protocol:{' '}
                        <span className="text-cyan-300 font-semibold font-mono">
                          {selectedEvent.response?.protocol || selectedEvent.request.protocol || (selectedEvent.status === 'pending' ? 'Pending' : 'HTTP')}
                        </span>
                      </span>
                      <span>·</span>
                      <span>
                        Client: <span className={selectedEvent.request.clientType === 'apollo' ? 'text-indigo-400 font-semibold' : 'text-cyan-400'}>{selectedEvent.request.clientType}</span>
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => copyToClipboard(formatRequestJson(selectedEvent), 'json')}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded border border-neutral-700 transition-colors text-[11px]"
                      title="Copy request as formatted JSON (Hotkey: y)"
                    >
                      {copiedSection === 'json' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400 font-semibold">Copied JSON!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Copy JSON</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => copyToClipboard(generateCurl(selectedEvent), 'curl')}
                      className="flex items-center gap-1 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded border border-neutral-700 transition-colors text-[11px]"
                      title="Copy request as cURL command"
                    >
                      {copiedSection === 'curl' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>cURL</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="text-neutral-500 text-[11px] mt-2 font-mono">
                  ────────────────────────────────────────────────────────────────
                </div>

                {/* Sub-Tabs: Overview, Headers, Body, Timing */}
                <div className="flex items-center gap-1 mt-3">
                  <button
                    onClick={() => setActiveDetailTab('overview')}
                    className={`px-3 py-1 rounded text-xs transition-colors ${
                      activeDetailTab === 'overview'
                        ? 'bg-neutral-800 text-cyan-400 font-semibold'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    [1] Overview
                  </button>
                  <button
                    onClick={() => setActiveDetailTab('headers')}
                    className={`px-3 py-1 rounded text-xs transition-colors ${
                      activeDetailTab === 'headers'
                        ? 'bg-neutral-800 text-cyan-400 font-semibold'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    [2] Headers{' '}
                    <span className="text-neutral-500 tabular-nums">
                      (
                      {Object.keys(selectedEvent.request.headers).length +
                        (selectedEvent.response ? Object.keys(selectedEvent.response.headers).length : 0)}
                      )
                    </span>
                  </button>
                  <button
                    onClick={() => setActiveDetailTab('body')}
                    className={`px-3 py-1 rounded text-xs transition-colors ${
                      activeDetailTab === 'body'
                        ? 'bg-neutral-800 text-cyan-400 font-semibold'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    [3] Body
                    {selectedEvent.response?.body && (
                      <span className="text-neutral-500 ml-1 tabular-nums">
                        ({formatBytes(selectedEvent.response.body.sizeBytes)})
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setActiveDetailTab('timing')}
                    className={`px-3 py-1 rounded text-xs transition-colors ${
                      activeDetailTab === 'timing'
                        ? 'bg-neutral-800 text-cyan-400 font-semibold'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    [4] Timing
                  </button>
                </div>
              </div>

              {/* Tab Content */}
              <div className="flex-1 p-5 overflow-y-auto space-y-6">
                {/* 1. OVERVIEW TAB */}
                {activeDetailTab === 'overview' && (
                  <div className="space-y-6">
                    {/* Error Banner if request failed */}
                    {selectedEvent.error && (
                      <div className="p-3.5 bg-rose-950/40 border border-rose-800/80 rounded text-rose-200 space-y-2">
                        <div className="flex items-center gap-2 font-semibold">
                          <AlertTriangle className="w-4 h-4 text-rose-400" />
                          <span>{selectedEvent.error.errorType}</span>
                        </div>
                        <p className="text-rose-300 text-xs">{selectedEvent.error.message}</p>
                        {selectedEvent.error.stackTrace && (
                          <pre className="text-[10px] bg-black/40 p-2.5 rounded overflow-x-auto text-rose-200/90 font-mono">
                            {selectedEvent.error.stackTrace}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* GraphQL Resolver Error Banner */}
                    {selectedGql.hasErrors && (
                      <div className="p-3.5 bg-rose-950/40 border border-rose-800 rounded text-rose-200 space-y-2">
                        <div className="flex items-center gap-2 font-semibold">
                          <AlertTriangle className="w-4 h-4 text-rose-400" />
                          <span>GraphQL Resolver Errors ({selectedGql.errors?.length})</span>
                        </div>
                        <p className="text-rose-300 text-xs">
                          HTTP response status was {selectedEvent.response?.statusCode || 200}, but the GraphQL server returned execution errors.
                        </p>
                        <div className="space-y-1.5 pt-1">
                          {selectedGql.errors?.map((err, i) => (
                            <div key={i} className="text-xs bg-black/40 p-2 rounded border border-rose-900/60 font-mono">
                              <div className="text-rose-200 font-semibold">{err.message}</div>
                              {err.path && <div className="text-rose-400 text-[10px]">Path: {JSON.stringify(err.path)}</div>}
                              {err.locations && <div className="text-rose-400 text-[10px]">Locations: {JSON.stringify(err.locations)}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* GraphQL Operation Details Card */}
                    {selectedGql.isGraphQl && (
                      <div className="space-y-3">
                        <h4 className="text-cyan-400 uppercase tracking-wider text-[11px] font-semibold flex items-center gap-1.5 font-mono">
                          <Zap className="w-3.5 h-3.5 text-cyan-400" />
                          <span>GraphQL Operation (v0.0.3)</span>
                        </h4>
                        <div className="bg-[#0e121a] rounded border border-indigo-900/60 p-3 space-y-2 text-xs">
                          <div className="grid grid-cols-4 gap-2">
                            <span className="text-neutral-500 font-mono">Operation Name:</span>
                            <span className="col-span-3 text-cyan-300 font-bold font-mono text-sm">
                              {selectedGql.operationName || 'Anonymous Operation'}
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            <span className="text-neutral-500 font-mono">Operation Type:</span>
                            <span className="col-span-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border font-mono ${
                                selectedGql.operationType === 'mutation'
                                  ? 'bg-amber-950 text-amber-300 border-amber-700'
                                  : selectedGql.operationType === 'subscription'
                                  ? 'bg-purple-950 text-purple-300 border-purple-700'
                                  : 'bg-indigo-950 text-indigo-300 border-indigo-700'
                              }`}>
                                {selectedGql.operationType}
                              </span>
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            <span className="text-neutral-500 font-mono">Endpoint:</span>
                            <span className="col-span-3 text-neutral-300 font-mono">
                              {selectedEvent.request.path}
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            <span className="text-neutral-500 font-mono">Resolver Health:</span>
                            <span className="col-span-3 font-semibold font-mono">
                              {selectedGql.hasErrors ? (
                                <span className="text-rose-400">Failed ({selectedGql.errors?.length} resolver errors)</span>
                              ) : (
                                <span className="text-emerald-400">Clean (0 resolver errors)</span>
                              )}
                            </span>
                          </div>
                        </div>

                        {/* GraphQL Query Document Section */}
                        {selectedGql.query && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 font-mono">
                                <Code className="w-3.5 h-3.5 text-indigo-400" />
                                GraphQL Query Document
                              </span>
                              <button
                                onClick={() => copyToClipboard(selectedGql.query || '', 'gql-query')}
                                className="text-neutral-400 hover:text-cyan-400 text-[11px] flex items-center gap-1 transition-colors font-mono"
                              >
                                {copiedSection === 'gql-query' ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-400" />
                                    <span className="text-emerald-400">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copy Query</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <div className="relative bg-[#07090e] border border-neutral-800 rounded p-3 overflow-x-auto">
                              <pre className="text-xs font-mono text-cyan-200/90 whitespace-pre leading-relaxed select-all">
                                {selectedGql.query}
                              </pre>
                            </div>
                          </div>
                        )}

                        {/* GraphQL Variables Section */}
                        {selectedGql.variables && Object.keys(selectedGql.variables).length > 0 && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-400 text-xs font-semibold uppercase tracking-wider font-mono">
                                Variables (JSON)
                              </span>
                              <button
                                onClick={() => copyToClipboard(JSON.stringify(selectedGql.variables, null, 2), 'gql-vars')}
                                className="text-neutral-400 hover:text-cyan-400 text-[11px] flex items-center gap-1 transition-colors font-mono"
                              >
                                {copiedSection === 'gql-vars' ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-400" />
                                    <span className="text-emerald-400">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copy Vars</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <div className="relative bg-[#07090e] border border-neutral-800 rounded p-3 overflow-x-auto">
                              <pre className="text-xs font-mono text-amber-200/90 whitespace-pre select-all">
                                {JSON.stringify(selectedGql.variables, null, 2)}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* General Metadata Table */}
                    <div className="space-y-2">
                      <h4 className="text-neutral-400 uppercase tracking-wider text-[11px] font-semibold">
                        General
                      </h4>
                      <div className="bg-[#0e121a] rounded border border-neutral-800 p-3 space-y-2 text-xs">
                        <div className="grid grid-cols-4 gap-2">
                          <span className="text-neutral-500">Request ID:</span>
                          <span className="col-span-3 text-neutral-300 font-mono select-all">
                            {selectedEvent.id}
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <span className="text-neutral-500">Timestamp:</span>
                          <span className="col-span-3 text-neutral-300 tabular-nums">
                            {new Date(selectedEvent.timestamp).toLocaleTimeString()} ({selectedEvent.timestamp})
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <span className="text-neutral-500">Host:</span>
                          <span className="col-span-3 text-neutral-300">{selectedEvent.request.host}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <span className="text-neutral-500">Path:</span>
                          <span className="col-span-3 text-neutral-300">{selectedEvent.request.path}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <span className="text-neutral-500">Protocol:</span>
                          <span className="col-span-3 text-cyan-300 font-mono flex items-center gap-1.5">
                            <span>{selectedEvent.response?.protocol || selectedEvent.request.protocol || (selectedEvent.status === 'pending' ? 'Pending (negotiating)' : 'HTTP')}</span>
                            {selectedEvent.response?.protocol ? (
                              <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 rounded">
                                Negotiated on response
                              </span>
                            ) : selectedEvent.status === 'pending' ? (
                              <span className="text-[10px] text-amber-400 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.5 rounded animate-pulse">
                                Awaiting response handshake
                              </span>
                            ) : null}
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <span className="text-neutral-500">Client Integration:</span>
                          <span className="col-span-3 text-cyan-400 uppercase font-semibold">
                            {selectedEvent.request.clientType}
                          </span>
                        </div>
                        {selectedEvent.deviceName && (
                          <div className="grid grid-cols-4 gap-2">
                            <span className="text-neutral-500">Source Device:</span>
                            <span className="col-span-3 text-cyan-300 font-semibold flex items-center gap-2">
                              <span>{selectedEvent.deviceName}</span>
                              {selectedEvent.appName && (
                                <span className="text-[10px] text-neutral-400 font-mono px-1.5 py-0.2 bg-neutral-800 rounded">
                                  {selectedEvent.appName} {selectedEvent.osVersion ? `· ${selectedEvent.osVersion}` : ''}
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                        {selectedEvent.response && (
                          <div className="grid grid-cols-4 gap-2">
                            <span className="text-neutral-500">Response Size:</span>
                            <span className="col-span-3 text-neutral-300 tabular-nums">
                              {formatBytes(selectedEvent.response.sizeBytes)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Quick Preview of Headers */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-neutral-400 uppercase tracking-wider text-[11px] font-semibold">
                          Request Headers (Preview)
                        </h4>
                        <button
                          onClick={() => setActiveDetailTab('headers')}
                          className="text-cyan-400 hover:underline text-[11px]"
                        >
                          View all headers →
                        </button>
                      </div>
                      <div className="bg-[#0e121a] rounded border border-neutral-800 p-3 space-y-1 font-mono text-[11px]">
                        {Object.entries(selectedEvent.request.headers)
                          .slice(0, 4)
                          .map(([key, val]) => (
                            <div key={key} className="flex gap-2">
                              <span className="text-neutral-400">{key}:</span>
                              <span
                                className={
                                  val === '<redacted>'
                                    ? 'text-amber-400 bg-amber-950/40 px-1 rounded'
                                    : 'text-neutral-200 break-all'
                                }
                              >
                                {val}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* Quick Preview of Response Body */}
                    {selectedEvent.response?.body && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-neutral-400 uppercase tracking-wider text-[11px] font-semibold">
                            Response Body (Preview)
                          </h4>
                          <button
                            onClick={() => setActiveDetailTab('body')}
                            className="text-cyan-400 hover:underline text-[11px]"
                          >
                            Inspect full body →
                          </button>
                        </div>
                        <div className="bg-[#07090e] rounded border border-neutral-800 p-3 font-mono text-[11px] max-h-40 overflow-y-auto">
                          {selectedEvent.response.body.isBinary ? (
                            <span className="text-neutral-500 italic">[Binary content: {selectedEvent.response.body.contentType}]</span>
                          ) : (
                            <pre className="text-neutral-300 whitespace-pre-wrap">
                              {selectedEvent.response.body.content?.slice(0, 300)}
                              {(selectedEvent.response.body.content?.length || 0) > 300 && '...'}
                            </pre>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. HEADERS TAB */}
                {activeDetailTab === 'headers' && (
                  <div className="space-y-6">
                    {/* Request Headers */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-neutral-400 uppercase tracking-wider text-[11px] font-semibold">
                          Request Headers ({Object.keys(selectedEvent.request.headers).length})
                        </h4>
                        <button
                          onClick={() =>
                            copyToClipboard(
                              JSON.stringify(selectedEvent.request.headers, null, 2),
                              'req-headers'
                            )
                          }
                          className="text-neutral-400 hover:text-neutral-200 text-[11px] flex items-center gap-1"
                        >
                          {copiedSection === 'req-headers' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>Copy</span>
                        </button>
                      </div>
                      <div className="bg-[#0e121a] rounded border border-neutral-800 divide-y divide-neutral-800/60 font-mono text-xs">
                        {Object.entries(selectedEvent.request.headers).map(([key, val]) => (
                          <div key={key} className="p-2.5 flex items-start justify-between gap-4">
                            <span className="text-neutral-400 shrink-0">{key}</span>
                            <span
                              className={`break-all text-right ${
                                val === '<redacted>'
                                  ? 'text-amber-400 bg-amber-950/40 px-1.5 py-0.5 rounded font-semibold'
                                  : 'text-neutral-200 select-all'
                              }`}
                            >
                              {val}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Response Headers */}
                    {selectedEvent.response && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-neutral-400 uppercase tracking-wider text-[11px] font-semibold">
                            Response Headers ({Object.keys(selectedEvent.response.headers).length})
                          </h4>
                          <button
                            onClick={() =>
                              copyToClipboard(
                                JSON.stringify(selectedEvent.response?.headers, null, 2),
                                'res-headers'
                              )
                            }
                            className="text-neutral-400 hover:text-neutral-200 text-[11px] flex items-center gap-1"
                          >
                            {copiedSection === 'res-headers' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            <span>Copy</span>
                          </button>
                        </div>
                        <div className="bg-[#0e121a] rounded border border-neutral-800 divide-y divide-neutral-800/60 font-mono text-xs">
                          {Object.entries(selectedEvent.response.headers).map(([key, val]) => (
                            <div key={key} className="p-2.5 flex items-start justify-between gap-4">
                              <span className="text-neutral-400 shrink-0">{key}</span>
                              <span
                                className={`break-all text-right ${
                                  val === '<redacted>'
                                    ? 'text-amber-400 bg-amber-950/40 px-1.5 py-0.5 rounded font-semibold'
                                    : 'text-neutral-200 select-all'
                                }`}
                              >
                                {val}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. BODY TAB */}
                {activeDetailTab === 'body' && (
                  <div className="space-y-6">
                    {/* Request Body */}
                    {selectedEvent.request.body && (
                      <div className="space-y-4">
                        {/* If GraphQL Query Document is detected */}
                        {selectedGql.isGraphQl && selectedGql.query && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <h4 className="text-cyan-400 uppercase tracking-wider text-[11px] font-semibold flex items-center gap-1.5">
                                  <Code className="w-3.5 h-3.5 text-cyan-400" />
                                  <span>GraphQL Query Document</span>
                                </h4>
                                <span className="text-[10px] text-neutral-500 font-mono">
                                  [{selectedGql.operationType} {selectedGql.operationName || 'Anonymous'}]
                                </span>
                              </div>
                              <button
                                onClick={() => copyToClipboard(selectedGql.query || '', 'gql-query')}
                                className="text-neutral-400 hover:text-neutral-200 text-[11px] flex items-center gap-1"
                                title="Copy GraphQL Query string"
                              >
                                {copiedSection === 'gql-query' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                <span>Copy Query</span>
                              </button>
                            </div>
                            <div className="bg-[#07090e] rounded border border-indigo-950 p-3.5 font-mono text-xs overflow-x-auto">
                              <pre className="text-cyan-200 whitespace-pre-wrap">{selectedGql.query}</pre>
                            </div>
                          </div>
                        )}

                        {/* If GraphQL Variables are detected */}
                        {selectedGql.isGraphQl && selectedGql.variables && Object.keys(selectedGql.variables).length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h4 className="text-neutral-400 uppercase tracking-wider text-[11px] font-semibold">
                                GraphQL Variables
                              </h4>
                              <button
                                onClick={() => copyToClipboard(JSON.stringify(selectedGql.variables, null, 2), 'gql-vars')}
                                className="text-neutral-400 hover:text-neutral-200 text-[11px] flex items-center gap-1"
                              >
                                {copiedSection === 'gql-vars' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                <span>Copy Variables</span>
                              </button>
                            </div>
                            <div className="bg-[#07090e] rounded border border-neutral-800 p-3 font-mono text-xs overflow-x-auto">
                              <pre className="text-neutral-300">{JSON.stringify(selectedGql.variables, null, 2)}</pre>
                            </div>
                          </div>
                        )}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <h4 className="text-neutral-400 uppercase tracking-wider text-[11px] font-semibold">
                                {selectedGql.isGraphQl && selectedGql.query ? 'Raw Request JSON' : 'Request Body'}
                              </h4>
                              <span className="text-neutral-500 tabular-nums text-[11px]">
                                ({formatBytes(selectedEvent.request.body.sizeBytes)})
                              </span>
                              {selectedEvent.request.body.contentType && (
                                <span className="text-neutral-400 text-[11px]">
                                  · {selectedEvent.request.body.contentType}
                                </span>
                              )}
                            </div>
                            {selectedEvent.request.body.content && (
                              <button
                                onClick={() =>
                                  copyToClipboard(
                                    formatJsonOrRaw(selectedEvent.request.body?.content || ''),
                                    'req-body'
                                  )
                                }
                                className="text-neutral-400 hover:text-neutral-200 text-[11px] flex items-center gap-1"
                                title="Copy Request Body as JSON"
                              >
                                {copiedSection === 'req-body' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                <span>Copy JSON</span>
                              </button>
                            )}
                          </div>

                          <div className="bg-[#07090e] rounded border border-neutral-800 p-3.5 font-mono text-xs overflow-x-auto">
                            <pre className="text-neutral-200">{formatJsonOrRaw(selectedEvent.request.body.content)}</pre>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Response Body */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h4 className="text-neutral-400 uppercase tracking-wider text-[11px] font-semibold">
                            Response Body
                          </h4>
                          {selectedEvent.response?.body && (
                            <span className="text-neutral-500 tabular-nums text-[11px]">
                              ({formatBytes(selectedEvent.response.body.sizeBytes)})
                            </span>
                          )}
                        </div>

                        {selectedEvent.response?.body?.content && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setBodyFormat(bodyFormat === 'pretty' ? 'raw' : 'pretty')}
                              className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-[11px] transition-colors"
                            >
                              {bodyFormat === 'pretty' ? 'Raw View' : 'Format JSON'}
                            </button>
                            <button
                              onClick={() =>
                                copyToClipboard(selectedEvent.response?.body?.content || '', 'res-body')
                              }
                              className="text-neutral-400 hover:text-neutral-200 text-[11px] flex items-center gap-1"
                            >
                              {copiedSection === 'res-body' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              <span>Copy</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Truncation warning if applicable */}
                      {selectedEvent.response?.body?.truncated && (
                        <div className="flex items-center gap-2 p-2.5 bg-amber-950/40 border border-amber-800/80 rounded text-amber-300 text-xs">
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>
                            Body truncated: exceeded maxBodySizeBytes configured limit. Captured first{' '}
                            {formatBytes(selectedEvent.response.body.sizeBytes)}.
                          </span>
                        </div>
                      )}

                      {/* Content rendering */}
                      {selectedEvent.response?.body ? (
                        selectedEvent.response.body.isBinary ? (
                          <div className="bg-[#07090e] rounded border border-neutral-800 p-4 space-y-3 font-mono text-xs">
                            <div className="flex items-center gap-2 text-cyan-400">
                              <Code className="w-4 h-4" />
                              <span>Binary Content ({selectedEvent.response.body.contentType})</span>
                            </div>
                            <p className="text-neutral-500 text-[11px]">
                              To prevent memory overhead and terminal garbling, binary payloads are not decoded as text.
                            </p>
                            {selectedEvent.response.body.hexPreview && (
                              <div className="bg-black/50 p-3 rounded overflow-x-auto text-neutral-400 text-[11px] leading-relaxed">
                                <pre>{selectedEvent.response.body.hexPreview}</pre>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="bg-[#07090e] rounded border border-neutral-800 p-3.5 font-mono text-xs overflow-x-auto max-h-[460px]">
                            <pre className="text-neutral-200 whitespace-pre-wrap">
                              {bodyFormat === 'pretty'
                                ? formatJsonOrRaw(selectedEvent.response.body.content)
                                : selectedEvent.response.body.content}
                            </pre>
                          </div>
                        )
                      ) : (
                        <div className="bg-[#07090e] rounded border border-neutral-800 p-6 text-center text-neutral-500">
                          {selectedEvent.status === 'pending'
                            ? 'Waiting for response stream...'
                            : selectedEvent.status === 'error'
                            ? 'No response received due to network failure.'
                            : 'No response body returned.'}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 4. TIMING TAB */}
                {activeDetailTab === 'timing' && (
                  <div className="space-y-4">
                    <h4 className="text-neutral-400 uppercase tracking-wider text-[11px] font-semibold">
                      Network Timings Breakdown
                    </h4>

                    <div className="bg-[#0e121a] rounded border border-neutral-800 p-4 space-y-4">
                      <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
                        <span className="text-neutral-400">Total Request Duration:</span>
                        <span className="text-base text-cyan-400 font-bold tabular-nums">
                          {selectedEvent.durationMs !== null ? `${selectedEvent.durationMs} ms` : 'Pending'}
                        </span>
                      </div>

                      {selectedEvent.timing ? (
                        <div className="space-y-3">
                          {selectedEvent.timing.dnsMs !== undefined && (
                            <TimingRow label="DNS Lookup" ms={selectedEvent.timing.dnsMs} total={selectedEvent.durationMs || 100} />
                          )}
                          {selectedEvent.timing.connectMs !== undefined && (
                            <TimingRow label="TCP Connect" ms={selectedEvent.timing.connectMs} total={selectedEvent.durationMs || 100} />
                          )}
                          {selectedEvent.timing.tlsMs !== undefined && (
                            <TimingRow label="TLS Handshake" ms={selectedEvent.timing.tlsMs} total={selectedEvent.durationMs || 100} />
                          )}
                          {selectedEvent.timing.sendMs !== undefined && (
                            <TimingRow label="Request Send" ms={selectedEvent.timing.sendMs} total={selectedEvent.durationMs || 100} />
                          )}
                          {selectedEvent.timing.waitMs !== undefined && (
                            <TimingRow label="Server Processing (TTFB)" ms={selectedEvent.timing.waitMs} total={selectedEvent.durationMs || 100} />
                          )}
                          {selectedEvent.timing.receiveMs !== undefined && (
                            <TimingRow label="Content Download" ms={selectedEvent.timing.receiveMs} total={selectedEvent.durationMs || 100} />
                          )}
                        </div>
                      ) : (
                        <p className="text-neutral-500 text-xs">
                          Granular socket timings (DNS, TLS, TTFB) are reported by OkHttp EventListener and Ktor network hooks when enabled in debug configuration.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })() : (
            <div className="flex flex-col items-center justify-center h-full p-8 text-neutral-500">
              <Eye className="w-10 h-10 mb-3 text-neutral-600" />
              <p className="font-semibold text-neutral-400 mb-1">Select a request to inspect</p>
              <p className="text-neutral-600 text-xs">
                Use your mouse or keyboard (j / k / ↑ / ↓) to inspect request and response details.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function TimingRow({ label, ms, total }: { label: string; ms: number; total: number }) {
  const percentage = Math.min(100, Math.max(2, Math.round((ms / Math.max(1, total)) * 100)));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-neutral-400">{label}</span>
        <span className="text-neutral-200 tabular-nums">{ms} ms</span>
      </div>
      <div className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden">
        <div className="bg-cyan-500 h-full rounded-full" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function formatJsonOrRaw(text: string | null): string {
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function formatHexDump(text: string, hexPreview?: string | null): string {
  if (hexPreview) return hexPreview;
  if (!text) return '<Empty payload>';
  const lines: string[] = [];
  const maxBytes = Math.min(text.length, 1024);
  for (let i = 0; i < maxBytes; i += 16) {
    const chunk = text.slice(i, i + 16);
    const hexParts: string[] = [];
    const asciiParts: string[] = [];
    for (let j = 0; j < 16; j++) {
      if (j < chunk.length) {
        const code = chunk.charCodeAt(j);
        hexParts.push(code.toString(16).padStart(2, '0'));
        asciiParts.push(code >= 32 && code <= 126 ? chunk[j] : '.');
      } else {
        hexParts.push('  ');
        asciiParts.push(' ');
      }
    }
    const offset = i.toString(16).padStart(8, '0');
    const hexGroup1 = hexParts.slice(0, 8).join(' ');
    const hexGroup2 = hexParts.slice(8, 16).join(' ');
    lines.push(`${offset}  ${hexGroup1}  ${hexGroup2}  |${asciiParts.join('')}|`);
  }
  if (text.length > maxBytes) {
    lines.push(`... truncated (${text.length - maxBytes} more bytes)`);
  }
  return lines.join('\n');
}
