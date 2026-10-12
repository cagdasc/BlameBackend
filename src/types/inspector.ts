export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export interface Payload {
  contentType: string | null;
  sizeBytes: number;
  content: string | null;
  truncated: boolean;
  isBinary: boolean;
  hexPreview?: string;
}

export interface NetworkRequest {
  id: string;
  timestamp: number;
  method: HttpMethod;
  url: string;
  host: string;
  path: string;
  protocol: string;
  headers: Record<string, string>;
  body: Payload | null;
  clientType: 'okhttp' | 'ktor';
}

export interface NetworkResponse {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body: Payload | null;
  durationMs: number;
  sizeBytes: number;
  protocol: string;
}

export interface NetworkError {
  errorType: string;
  message: string;
  stackTrace?: string;
}

export interface NetworkTiming {
  dnsMs?: number;
  connectMs?: number;
  tlsMs?: number;
  sendMs?: number;
  waitMs?: number;
  receiveMs?: number;
}

export interface NetworkEvent {
  id: string;
  timestamp: number;
  request: NetworkRequest;
  response: NetworkResponse | null;
  durationMs: number | null;
  error: NetworkError | null;
  timing?: NetworkTiming;
  status: 'pending' | 'completed' | 'error';
  clientId?: string;
  deviceName?: string;
  appName?: string;
  osVersion?: string;
}

export type WireMessageType =
  | 'HELLO'
  | 'NETWORK_EVENT_START'
  | 'NETWORK_EVENT_RESPONSE'
  | 'NETWORK_EVENT_ERROR'
  | 'PING'
  | 'PONG'
  | 'GOODBYE';

export interface WireMessage {
  type: WireMessageType;
  version: number;
  sessionId?: string;
  timestamp: number;
  payload: any;
}

export interface DeviceInfo {
  id?: string;
  deviceName: string;
  osVersion: string;
  appName: string;
  appVersion: string;
  connectedAt: number;
  port: number;
  capabilities?: string[];
  clientType?: string;
}

export interface FilterCriteria {
  raw: string;
  host?: string;
  method?: string;
  status?: string;
  device?: string;
  protocol?: string;
  search?: string;
}
