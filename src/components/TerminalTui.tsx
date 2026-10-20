import React, { useState, useEffect, useRef } from 'react';
import {
  NetworkEvent,
  HttpMethod,
  FilterCriteria,
  DeviceInfo
} from '../types/inspector';
import { parseFilterQuery, matchesFilter } from '../engine/filterEngine';
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
  Zap
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
}

export const TerminalTui: React.FC<TerminalTuiProps> = ({
  events,
  selectedId,
  onSelectEvent,
  onClear,
  connectedDevices = [],
  selectedDeviceId = 'all',
  onSelectDeviceFilter,
  totalEventCount
}) => {
  const [filterText, setFilterText] = useState('');
  const [activeDetailTab, setActiveDetailTab] = useState<'overview' | 'headers' | 'body' | 'timing'>('overview');
  const [bodyFormat, setBodyFormat] = useState<'pretty' | 'raw'>('pretty');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [activeTheme, setActiveTheme] = useState<'matrix' | 'cyan' | 'amber'>('cyan');

  const filterInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);

  const criteria: FilterCriteria = parseFilterQuery(filterText);
  const filteredEvents = events.filter(e => matchesFilter(e, criteria));

  // Determine current selected event
  const selectedEvent = events.find(e => e.id === selectedId) || filteredEvents[0] || null;

  const currentFilteredDevice = connectedDevices.find(d => d.id === selectedDeviceId);

  // Keyboard navigation handler
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

      if (filteredEvents.length === 0) return;

      const currentIndex = filteredEvents.findIndex(ev => ev.id === (selectedEvent?.id ?? ''));

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const nextIndex = Math.min(filteredEvents.length - 1, (currentIndex >= 0 ? currentIndex + 1 : 0));
        onSelectEvent(filteredEvents[nextIndex].id);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const prevIndex = Math.max(0, (currentIndex >= 0 ? currentIndex - 1 : 0));
        onSelectEvent(filteredEvents[prevIndex].id);
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
  }, [filteredEvents, selectedEvent, onSelectEvent, onClear]);

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
              placeholder="Filter e.g. host:api.example.com method:POST status:4xx search:payment"
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
            onClick={() => setFilterText('')}
            className={`px-2 py-0.5 rounded transition-colors ${
              filterText === '' ? 'bg-neutral-800 text-cyan-300 font-semibold' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterText('method:GET')}
            className={`px-2 py-0.5 rounded transition-colors ${
              filterText === 'method:GET' ? 'bg-neutral-800 text-cyan-300 font-semibold' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            GET
          </button>
          <button
            onClick={() => setFilterText('method:POST')}
            className={`px-2 py-0.5 rounded transition-colors ${
              filterText === 'method:POST' ? 'bg-neutral-800 text-cyan-300 font-semibold' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            POST
          </button>
          <button
            onClick={() => setFilterText('gql')}
            className={`px-2 py-0.5 rounded transition-colors ${
              filterText === 'gql' ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/60 font-semibold' : 'text-indigo-400/80 hover:text-indigo-200'
            }`}
          >
            GQL
          </button>
          <button
            onClick={() => setFilterText('type:mutation')}
            className={`px-2 py-0.5 rounded transition-colors ${
              filterText === 'type:mutation' ? 'bg-amber-950 text-amber-300 border border-amber-700/60 font-semibold' : 'text-amber-400/80 hover:text-amber-200'
            }`}
          >
            Mutations
          </button>
          <button
            onClick={() => setFilterText('status:4xx')}
            className={`px-2 py-0.5 rounded transition-colors ${
              filterText === 'status:4xx' ? 'bg-neutral-800 text-amber-300 font-semibold' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            4xx
          </button>
          <button
            onClick={() => setFilterText('status:error')}
            className={`px-2 py-0.5 rounded transition-colors ${
              filterText === 'status:error' ? 'bg-neutral-800 text-rose-300 font-semibold' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Errors
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

      {/* Main Split-Pane View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pane: Request List (45% width on desktop) */}
        <div
          ref={listContainerRef}
          className="w-full md:w-[48%] lg:w-[45%] flex flex-col border-r border-neutral-800 bg-[#07090e] overflow-y-auto"
        >
          {filteredEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center text-neutral-500">
              <Filter className="w-8 h-8 mb-3 text-neutral-600" />
              <p className="font-semibold text-neutral-400 mb-1">
                {events.length === 0 ? 'No HTTP traffic captured yet' : 'No requests match current filter'}
              </p>
              <p className="text-neutral-600 text-[11px] max-w-xs">
                {events.length === 0
                  ? 'Connect your Kotlin Multiplatform app (Android, iOS, Desktop) and trigger HTTP requests to inspect traffic in real time.'
                  : `Clear filter or search with different query tokens.`}
              </p>
              {filterText && (
                <button
                  onClick={() => setFilterText('')}
                  className="mt-3 px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-xs transition-colors"
                >
                  Clear Filter
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-neutral-800/60">
              {filteredEvents.map((event, idx) => {
                const isSelected = selectedEvent?.id === event.id;
                const gql = extractGraphQlDetails(event);
                return (
                  <div
                    key={event.id}
                    onClick={() => onSelectEvent(event.id)}
                    className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-neutral-800/90 text-white border-l-2 border-cyan-400 pl-[10px]'
                        : 'hover:bg-neutral-900/70 text-neutral-300'
                    }`}
                  >
                    {/* Index */}
                    <span className="text-neutral-500 w-5 text-right tabular-nums shrink-0">
                      {idx + 1}
                    </span>

                    {/* Method */}
                    <span className={`w-14 shrink-0 ${getMethodBadgeClass(event.request.method)}`}>
                      {event.request.method}
                    </span>

                    {/* Status Code */}
                    <div className="w-14 shrink-0 flex items-center gap-1">
                      <span className={`tabular-nums ${gql.hasErrors ? 'text-amber-400 font-semibold' : getStatusClass(event)}`}>
                        {event.status === 'pending'
                          ? '...'
                          : event.status === 'error'
                          ? 'ERR'
                          : event.response?.statusCode}
                      </span>
                      {gql.hasErrors && (
                        <span
                          className="text-[9px] font-bold px-1 py-0.2 rounded bg-rose-950/90 text-rose-300 border border-rose-700/80 shrink-0"
                          title="GraphQL resolver returned errors in HTTP 200 payload"
                        >
                          ERR
                        </span>
                      )}
                    </div>

                    {/* Host & Path or GraphQL Operation */}
                    <div className="flex-1 min-w-0 truncate flex items-center gap-1.5">
                      {gql.isGraphQl ? (
                        <>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.2 rounded tracking-wide border shrink-0 ${
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
                          <span className="text-neutral-500 text-[10px] truncate hidden xl:inline">
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
                    <span className={`text-[10px] shrink-0 ${event.request.clientType === 'apollo' ? 'text-indigo-400 font-semibold' : 'text-neutral-500'}`}>
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
                    <span className="w-14 text-right tabular-nums text-neutral-400 shrink-0 text-[11px]">
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

        {/* Right Pane: Request Details View */}
        <div className="hidden md:flex flex-1 flex-col bg-[#0b0e14] overflow-y-auto">
          {selectedEvent ? (() => {
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
                      <div className="space-y-2">
                        <h4 className="text-cyan-400 uppercase tracking-wider text-[11px] font-semibold flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-cyan-400" />
                          <span>GraphQL Operation</span>
                        </h4>
                        <div className="bg-[#0e121a] rounded border border-indigo-900/60 p-3 space-y-2 text-xs">
                          <div className="grid grid-cols-4 gap-2">
                            <span className="text-neutral-500">Operation Name:</span>
                            <span className="col-span-3 text-cyan-300 font-bold font-mono text-sm">
                              {selectedGql.operationName || 'Anonymous Operation'}
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            <span className="text-neutral-500">Operation Type:</span>
                            <span className="col-span-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
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
                            <span className="text-neutral-500">Endpoint:</span>
                            <span className="col-span-3 text-neutral-300 font-mono">
                              {selectedEvent.request.path}
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            <span className="text-neutral-500">Resolver Health:</span>
                            <span className="col-span-3 font-semibold">
                              {selectedGql.hasErrors ? (
                                <span className="text-rose-400">Failed ({selectedGql.errors?.length} resolver errors)</span>
                              ) : (
                                <span className="text-emerald-400">Clean (0 resolver errors)</span>
                              )}
                            </span>
                          </div>
                        </div>
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
