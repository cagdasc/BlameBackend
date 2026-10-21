import { NetworkEvent, NetworkRequest, NetworkResponse, HttpMethod, WebSocketConnection, WebSocketFrameDto } from '../types/inspector';
import { defaultRedactor } from './redactor';
import { createPayload } from './payload';
import { apiUrl } from './apiConfig';

export type EventCallback = (event: NetworkEvent) => void;
export type WsEventCallback = (data: { type: 'open' | 'frame' | 'close' | 'error'; connection?: WebSocketConnection; frame?: WebSocketFrameDto }) => void;

function generateId(): string {
  return 'req_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).slice(-4);
}

function parseUrl(fullUrl: string): { host: string; path: string } {
  try {
    const parsed = new URL(fullUrl);
    return {
      host: parsed.hostname,
      path: parsed.pathname + parsed.search
    };
  } catch {
    const parts = fullUrl.replace(/^(https?:\/\/)/, '').split('/');
    const host = parts[0] || 'localhost';
    const path = '/' + parts.slice(1).join('/');
    return { host, path };
  }
}

export class AndroidNetworkSimulator {
  private listeners: EventCallback[] = [];
  private wsListeners: WsEventCallback[] = [];

  public subscribe(cb: EventCallback): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  public subscribeWs(cb: WsEventCallback): () => void {
    this.wsListeners.push(cb);
    return () => {
      this.wsListeners = this.wsListeners.filter(l => l !== cb);
    };
  }

  private emit(event: NetworkEvent) {
    this.listeners.forEach(cb => cb(event));
  }

  private emitWs(data: { type: 'open' | 'frame' | 'close' | 'error'; connection?: WebSocketConnection; frame?: WebSocketFrameDto }) {
    this.wsListeners.forEach(cb => cb(data));
    // Also post to server API if available so server SSE and other tabs stay in sync
    try {
      fetch(apiUrl('/api/simulate-ws'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: data.type === 'open' ? 'WS_OPEN' : data.type === 'frame' ? 'WS_FRAME' : data.type === 'close' ? 'WS_CLOSE' : 'WS_ERROR',
          connection: data.connection,
          frame: data.frame
        })
      }).catch(() => {});
    } catch {}
  }

  /**
   * Simulates an in-flight request start, followed by an asynchronous response or error.
   */
  public async executeRequest(params: {
    clientType: 'okhttp' | 'ktor' | 'apollo' | string;
    method: HttpMethod;
    url: string;
    protocol?: string;
    operationName?: string;
    operationType?: 'query' | 'mutation' | 'subscription' | string;
    requestHeaders?: Record<string, string>;
    requestBody?: string | Uint8Array;
    requestContentType?: string;
    statusCode?: number;
    statusMessage?: string;
    responseHeaders?: Record<string, string>;
    responseBody?: string | Uint8Array;
    responseContentType?: string;
    delayMs?: number;
    error?: { errorType: string; message: string; stackTrace?: string };
    timing?: { dnsMs?: number; connectMs?: number; tlsMs?: number; sendMs?: number; waitMs?: number; receiveMs?: number };
  }): Promise<string> {
    const id = generateId();
    const timestamp = Date.now();
    const { host, path } = parseUrl(params.url);

    // Apply header redaction for request
    const { redacted: safeRequestHeaders } = defaultRedactor.redactHeaders(
      params.requestHeaders || {
        'User-Agent': params.clientType === 'apollo' ? 'apollo-kotlin/4.1.0' : params.clientType === 'okhttp' ? 'okhttp/4.12.0 Android' : 'ktor-client/3.0.1 Android',
        'Accept': 'application/json',
        'Connection': 'keep-alive'
      }
    );

    const reqPayload = params.requestBody
      ? createPayload(params.requestBody, params.requestContentType || 'application/json')
      : null;

    const request: NetworkRequest = {
      id,
      timestamp,
      method: params.method,
      url: params.url,
      host,
      path,
      protocol: params.protocol || (params.clientType === 'okhttp' ? 'HTTP/2.0' : 'HTTP/1.1'),
      headers: safeRequestHeaders,
      body: reqPayload,
      clientType: params.clientType,
      operationName: params.operationName || null,
      operationType: params.operationType || null
    };

    const initialEvent: NetworkEvent = {
      id,
      timestamp,
      request,
      response: null,
      durationMs: null,
      error: null,
      timing: params.timing,
      status: 'pending'
    };

    // Emit REQUEST_START
    this.emit(initialEvent);

    // Asynchronous network simulation delay
    const delay = params.delayMs ?? Math.floor(Math.random() * 180) + 60;

    await new Promise(resolve => setTimeout(resolve, delay));

    if (params.error) {
      const errorEvent: NetworkEvent = {
        ...initialEvent,
        durationMs: delay,
        error: params.error,
        status: 'error'
      };
      this.emit(errorEvent);
      return id;
    }

    // Apply header redaction for response
    const { redacted: safeResponseHeaders } = defaultRedactor.redactHeaders(
      params.responseHeaders || {
        'Content-Type': params.responseContentType || 'application/json; charset=utf-8',
        'Server': 'cloudflare',
        'Date': new Date().toUTCString(),
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
      }
    );

    const resPayload = params.responseBody
      ? createPayload(params.responseBody, params.responseContentType || 'application/json')
      : null;

    const statusCode = params.statusCode || 200;
    const statusMessage = params.statusMessage || (statusCode === 200 ? 'OK' : statusCode === 201 ? 'Created' : statusCode === 404 ? 'Not Found' : 'Internal Server Error');

    const negotiatedProtocol = params.protocol || (params.clientType === 'okhttp' ? 'h2' : 'HTTP/2.0');

    const response: NetworkResponse = {
      statusCode,
      statusMessage,
      headers: safeResponseHeaders,
      body: resPayload,
      durationMs: delay,
      sizeBytes: resPayload?.sizeBytes ?? 0,
      protocol: negotiatedProtocol
    };

    const completedEvent: NetworkEvent = {
      ...initialEvent,
      request: {
        ...initialEvent.request,
        protocol: negotiatedProtocol
      },
      response,
      durationMs: delay,
      status: 'completed'
    };

    this.emit(completedEvent);
    return id;
  }

  // Pre-configured scenario triggers matching the requirements

  public async triggerOkHttpUserList() {
    return this.executeRequest({
      clientType: 'okhttp',
      method: 'GET',
      url: 'https://api.example.com/v1/users?page=1&limit=5',
      delayMs: 146,
      timing: { dnsMs: 14, connectMs: 38, tlsMs: 42, sendMs: 2, waitMs: 44, receiveMs: 6 },
      requestHeaders: {
        'Accept': 'application/json',
        'User-Agent': 'okhttp/4.12.0',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      statusCode: 200,
      responseHeaders: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        'ETag': 'W/"7e-K12x9a"',
        'Content-Length': '842'
      },
      responseBody: JSON.stringify({
        data: [
          { id: "usr_01", name: "Alex Mercer", role: "Staff Engineer", email: "alex@example.com", active: true },
          { id: "usr_02", name: "Elena Rostova", role: "Android Lead", email: "elena@example.com", active: true },
          { id: "usr_03", name: "Marcus Vance", role: "Product Designer", email: "marcus@example.com", active: false }
        ],
        meta: { total: 42, page: 1, pageSize: 5, totalPages: 9 }
      }, null, 2)
    });
  }

  public async triggerOkHttpPayment() {
    // Tests sensitive header redaction: Authorization, X-API-Key, Cookie
    return this.executeRequest({
      clientType: 'okhttp',
      method: 'POST',
      url: 'https://api.example.com/v1/payments/charges',
      delayMs: 384,
      timing: { dnsMs: 0, connectMs: 0, tlsMs: 0, sendMs: 4, waitMs: 372, receiveMs: 8 },
      requestHeaders: {
        'Authorization': 'Bearer sk_live_98ab71cf8432a1e0b94328',
        'X-API-Key': 'key_live_test_secret_dont_leak_882',
        'Cookie': 'session_token=usr_session_secret_99812; _ga=GA1.2.148',
        'Content-Type': 'application/json; charset=utf-8',
        'Idempotency-Key': 'idem_' + Math.random().toString(36).substring(2, 10)
      },
      requestBody: JSON.stringify({
        amount: 4999,
        currency: "USD",
        recipientId: "rec_919320",
        paymentMethod: "pm_card_visa_4242",
        description: "Dev tooling subscription license"
      }, null, 2),
      statusCode: 201,
      statusMessage: 'Created',
      responseHeaders: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'session_refresh=secret_refresh_token_abc; Secure; HttpOnly',
        'X-Charge-Id': 'ch_3M4eXk2eZvKYlo2C1',
        'Content-Length': '312'
      },
      responseBody: JSON.stringify({
        id: "ch_3M4eXk2eZvKYlo2C1",
        status: "succeeded",
        amountCaptured: 4999,
        receiptUrl: "https://pay.example.com/receipts/ch_3M4eXk2eZvKYlo2C1.pdf",
        timestamp: new Date().toISOString()
      }, null, 2)
    });
  }

  public async triggerKtorNotFound() {
    return this.executeRequest({
      clientType: 'ktor',
      method: 'GET',
      url: 'https://api.example.com/v1/profile/usr_unknown_884',
      delayMs: 98,
      requestHeaders: {
        'Accept': 'application/json',
        'X-Ktor-Version': '3.0.1'
      },
      statusCode: 404,
      statusMessage: 'Not Found',
      responseHeaders: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': '144'
      },
      responseBody: JSON.stringify({
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "Profile for ID 'usr_unknown_884' could not be found in active tenant.",
          timestamp: new Date().toISOString()
        }
      }, null, 2)
    });
  }

  public async triggerKtorSlow() {
    return this.executeRequest({
      clientType: 'ktor',
      method: 'POST',
      url: 'https://api.example.com/v1/analytics/heavy-aggregation',
      delayMs: 1450,
      requestHeaders: {
        'Content-Type': 'application/json',
        'User-Agent': 'ktor-client-android/3.0.1'
      },
      requestBody: JSON.stringify({
        metrics: ["latency_p95", "throughput_rps", "error_rate"],
        range: "30d",
        groupBy: "device_model",
        includeRawTraces: true
      }, null, 2),
      statusCode: 200,
      responseBody: JSON.stringify({
        status: "completed",
        computationTimeMs: 1412,
        buckets: 720,
        resultCount: 14209
      }, null, 2)
    });
  }

  public async triggerOkHttpDnsFailure() {
    return this.executeRequest({
      clientType: 'okhttp',
      method: 'GET',
      url: 'https://nonexistent.telemetry-backend.internal/v2/events',
      delayMs: 240,
      error: {
        errorType: 'java.net.UnknownHostException',
        message: 'Unable to resolve host "nonexistent.telemetry-backend.internal": No address associated with hostname',
        stackTrace: `java.net.UnknownHostException: Unable to resolve host "nonexistent.telemetry-backend.internal"
    at java.net.Inet6AddressImpl.lookupHostByName(Inet6AddressImpl.java:156)
    at java.net.DnsResolver.lookup(DnsResolver.java:48)
    at okhttp3.Dns$Companion$SYSTEM$1.lookup(Dns.kt:48)
    at okhttp3.internal.connection.RouteSelector.resetNextInetSocketAddress(RouteSelector.kt:164)
    at okhttp3.internal.connection.RouteSelector.next(RouteSelector.kt:70)
    at okhttp3.internal.connection.RealCall.getResponseWithInterceptorChain$okhttp(RealCall.kt:205)`
      }
    });
  }

  public async triggerOkHttpBinary() {
    // Generates fake PNG binary bytes
    const pngHeader = new Uint8Array([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x80,
      0x08, 0x06, 0x00, 0x00, 0x00, 0xC3, 0x3E, 0x61,
      0x00, 0x00, 0x01, 0x40, 0x49, 0x44, 0x41, 0x54,
      0x78, 0x9C, 0xED, 0xD7, 0xB1, 0x0D, 0x00, 0x20
    ]);

    return this.executeRequest({
      clientType: 'okhttp',
      method: 'GET',
      url: 'https://cdn.example.com/assets/avatar-user-42.png',
      delayMs: 84,
      statusCode: 200,
      responseContentType: 'image/png',
      responseHeaders: {
        'Content-Type': 'image/png',
        'Content-Length': '14280',
        'Cache-Control': 'public, max-age=31536000, immutable'
      },
      responseBody: pngHeader
    });
  }

  public async triggerKtorLargeResponse() {
    // Generate a payload that exceeds the default 64KB maxBodySizeBytes limit
    const logEntries = [];
    for (let i = 0; i < 950; i++) {
      logEntries.push({
        index: i,
        traceId: `trace_span_99_${i.toString(16).padStart(4, '0')}`,
        action: 'android.permission.INTERNET_DISPATCH',
        payloadChecksum: 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069',
        systemLoadAverage: (0.8 + Math.sin(i) * 0.4).toFixed(3),
        tags: ['audit', 'high_volume', 'compliance', 'level_verbose']
      });
    }

    const largeJson = JSON.stringify({
      auditRunId: "audit_run_2026_09_28_batch",
      timestamp: Date.now(),
      recordCount: logEntries.length,
      logs: logEntries
    }, null, 2);

    return this.executeRequest({
      clientType: 'ktor',
      method: 'GET',
      url: 'https://api.example.com/v1/export/audit-logs?scope=full&archive=false',
      delayMs: 320,
      statusCode: 200,
      responseHeaders: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': `${new TextEncoder().encode(largeJson).length}`
      },
      responseBody: largeJson
    });
  }

  public async triggerConcurrentBatch() {
    const urls = [
      { method: 'GET' as HttpMethod, url: 'https://api.example.com/v1/catalog/items/101', delay: 75, client: 'okhttp' as const },
      { method: 'GET' as HttpMethod, url: 'https://api.example.com/v1/catalog/items/102', delay: 240, client: 'ktor' as const },
      { method: 'POST' as HttpMethod, url: 'https://api.example.com/v1/heartbeat', delay: 110, client: 'okhttp' as const },
      { method: 'GET' as HttpMethod, url: 'https://api.example.com/v1/catalog/items/103', delay: 65, client: 'ktor' as const },
      { method: 'PUT' as HttpMethod, url: 'https://api.example.com/v1/user/settings/sync', delay: 380, client: 'okhttp' as const }
    ];

    return Promise.all(
      urls.map(u =>
        this.executeRequest({
          clientType: u.client,
          method: u.method,
          url: u.url,
          delayMs: u.delay,
          statusCode: 200,
          responseBody: JSON.stringify({ resource: u.url, syncedAt: Date.now() }, null, 2)
        })
      )
    );
  }

  public async triggerApolloQueryListUsers() {
    const query = `query ListUsers {
  users {
    id
    name
    username
    email
  }
}`;
    const response = {
      data: {
        users: [
          { id: "1", name: "Leanne Graham", username: "Bret", email: "Sincere@april.biz" },
          { id: "2", name: "Ervin Howell", username: "Antonette", email: "Shanna@melissa.tv" },
          { id: "3", name: "Clementine Bauch", username: "Samantha", email: "Nathan@yesenia.net" }
        ]
      }
    };

    return this.executeRequest({
      clientType: 'apollo',
      method: 'POST',
      url: 'https://graphqlplaceholder.vercel.app/graphql',
      operationName: 'ListUsers',
      operationType: 'query',
      delayMs: 140,
      statusCode: 200,
      requestHeaders: {
        'Content-Type': 'application/json',
        'X-APOLLO-OPERATION-NAME': 'ListUsers',
        'X-APOLLO-OPERATION-ID': 'b43f9a72c1d8',
        'User-Agent': 'apollo-kotlin/4.1.0'
      },
      requestBody: JSON.stringify({
        operationName: 'ListUsers',
        query,
        variables: {}
      }, null, 2),
      responseHeaders: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Cache': 'MISS'
      },
      responseBody: JSON.stringify(response, null, 2)
    });
  }

  public async triggerApolloMutationCreatePost() {
    const query = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    id
    title
    body
    userId
  }
}`;
    const variables = {
      input: {
        title: "Announcing BlameBackend GraphQL Support",
        body: "Real-time inspection with zero semantics alteration and operation names.",
        userId: 1
      }
    };
    const response = {
      data: {
        createPost: {
          id: "101",
          title: "Announcing BlameBackend GraphQL Support",
          body: "Real-time inspection with zero semantics alteration and operation names.",
          userId: 1
        }
      }
    };

    return this.executeRequest({
      clientType: 'apollo',
      method: 'POST',
      url: 'https://graphqlplaceholder.vercel.app/graphql',
      operationName: 'CreatePost',
      operationType: 'mutation',
      delayMs: 220,
      statusCode: 200,
      requestHeaders: {
        'Content-Type': 'application/json',
        'X-APOLLO-OPERATION-NAME': 'CreatePost',
        'X-APOLLO-OPERATION-ID': 'e82b71fa09cd',
        'User-Agent': 'apollo-kotlin/4.1.0'
      },
      requestBody: JSON.stringify({
        operationName: 'CreatePost',
        query,
        variables
      }, null, 2),
      responseHeaders: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      responseBody: JSON.stringify(response, null, 2)
    });
  }

  public async triggerApolloResolverError() {
    const query = `query UserBillingProfile($userId: ID!) {
  user(id: $userId) {
    id
    name
    creditCardNumber
    billingAccount
  }
}`;
    const variables = { userId: "user-404" };
    // Classic GraphQL HTTP 200 with resolver errors!
    const response = {
      data: {
        user: {
          id: "user-404",
          name: "Alex Doe",
          creditCardNumber: null,
          billingAccount: null
        }
      },
      errors: [
        {
          message: "Unauthorized: Insufficient permissions to read field 'creditCardNumber' on type 'User'",
          locations: [{ line: 5, column: 5 }],
          path: ["user", "creditCardNumber"],
          extensions: {
            code: "FORBIDDEN",
            field: "creditCardNumber"
          }
        }
      ]
    };

    return this.executeRequest({
      clientType: 'apollo',
      method: 'POST',
      url: 'https://graphqlplaceholder.vercel.app/graphql',
      operationName: 'UserBillingProfile',
      operationType: 'query',
      delayMs: 180,
      statusCode: 200,
      requestHeaders: {
        'Content-Type': 'application/json',
        'X-APOLLO-OPERATION-NAME': 'UserBillingProfile',
        'User-Agent': 'apollo-kotlin/4.1.0'
      },
      requestBody: JSON.stringify({
        operationName: 'UserBillingProfile',
        query,
        variables
      }, null, 2),
      responseHeaders: {
        'Content-Type': 'application/json; charset=utf-8'
      },
    });
  }

  /**
   * Scenario: Interactive WebSocket Chat Echo (Handshake -> Text message -> Echo Reply -> Ping/Pong)
   */
  public async triggerWebSocketEcho(): Promise<void> {
    const connId = 'ws_echo_' + Date.now().toString(36);
    const startTime = Date.now();
    const conn: WebSocketConnection = {
      id: connId,
      timestamp: startTime,
      url: 'wss://echo.websocket.org/chat',
      host: 'echo.websocket.org',
      path: '/chat',
      headers: defaultRedactor.redactHeaders({
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
        'Authorization': 'Bearer sec_token_secret_12345'
      }).redacted,
      clientType: 'okhttp',
      status: 'open',
      totalTxFrames: 0,
      totalRxFrames: 0,
      totalTxBytes: 0,
      totalRxBytes: 0,
      frames: []
    };

    // 1. Connection Open
    this.emitWs({ type: 'open', connection: conn });
    await new Promise(r => setTimeout(r, 120));

    // 2. Client sends chat greeting (TX)
    const msg1 = JSON.stringify({ type: 'join', user: 'cagdas', room: 'dev-lounge', client: 'BlameBackend-v0.0.3' }, null, 2);
    const frame1: WebSocketFrameDto = {
      id: 'frame_1_' + Date.now().toString(36),
      connectionId: connId,
      timestamp: Date.now(),
      direction: 'tx',
      opcode: 'text',
      payload: createPayload(msg1, 'application/json')
    };
    this.emitWs({ type: 'frame', connection: conn, frame: frame1 });
    await new Promise(r => setTimeout(r, 150));

    // 3. Server sends join ack (RX)
    const ack = JSON.stringify({ status: 'joined', room: 'dev-lounge', activePeers: 4, welcome: 'Welcome to BlameBackend WebSocket preview' }, null, 2);
    const frame2: WebSocketFrameDto = {
      id: 'frame_2_' + Date.now().toString(36),
      connectionId: connId,
      timestamp: Date.now(),
      direction: 'rx',
      opcode: 'text',
      payload: createPayload(ack, 'application/json')
    };
    this.emitWs({ type: 'frame', connection: conn, frame: frame2 });
    await new Promise(r => setTimeout(r, 200));

    // 4. Client sends heartbeat ping (TX)
    const pingBytes = new Uint8Array([0x09, 0x00, 0x04, 0x70, 0x69, 0x6e, 0x67]);
    const frame3: WebSocketFrameDto = {
      id: 'frame_3_' + Date.now().toString(36),
      connectionId: connId,
      timestamp: Date.now(),
      direction: 'tx',
      opcode: 'ping',
      payload: createPayload(pingBytes, 'application/octet-stream')
    };
    this.emitWs({ type: 'frame', connection: conn, frame: frame3 });
    await new Promise(r => setTimeout(r, 80));

    // 5. Server replies with pong (RX)
    const pongBytes = new Uint8Array([0x0A, 0x00, 0x04, 0x70, 0x6f, 0x6e, 0x67]);
    const frame4: WebSocketFrameDto = {
      id: 'frame_4_' + Date.now().toString(36),
      connectionId: connId,
      timestamp: Date.now(),
      direction: 'rx',
      opcode: 'pong',
      payload: createPayload(pongBytes, 'application/octet-stream')
    };
    this.emitWs({ type: 'frame', connection: conn, frame: frame4 });
  }

  /**
   * Scenario: High-Frequency Market Ticker (Ktor Client wss:// stream with rapid JSON frames)
   */
  public async triggerWebSocketTicker(): Promise<void> {
    const connId = 'ws_ticker_' + Date.now().toString(36);
    const startTime = Date.now();
    const conn: WebSocketConnection = {
      id: connId,
      timestamp: startTime,
      url: 'wss://stream.binance.com:9443/ws/btcusdt@trade',
      host: 'stream.binance.com',
      path: '/ws/btcusdt@trade',
      headers: defaultRedactor.redactHeaders({
        'Host': 'stream.binance.com:9443',
        'User-Agent': 'Ktor client 3.0.3 (Linux X64 / Android)',
        'Sec-WebSocket-Version': '13'
      }).redacted,
      clientType: 'ktor',
      status: 'open',
      totalTxFrames: 0,
      totalRxFrames: 0,
      totalTxBytes: 0,
      totalRxBytes: 0,
      frames: []
    };

    this.emitWs({ type: 'open', connection: conn });
    await new Promise(r => setTimeout(r, 100));

    // Subscription frame TX
    const sub = JSON.stringify({ method: 'SUBSCRIBE', params: ['btcusdt@trade', 'ethusdt@trade'], id: 1 }, null, 2);
    this.emitWs({
      type: 'frame',
      connection: conn,
      frame: {
        id: 'frame_sub_' + Date.now().toString(36),
        connectionId: connId,
        timestamp: Date.now(),
        direction: 'tx',
        opcode: 'text',
        payload: createPayload(sub, 'application/json')
      }
    });

    // 3 rapid price updates RX
    const prices = [68420.50, 68422.10, 68418.75];
    for (let i = 0; i < prices.length; i++) {
      await new Promise(r => setTimeout(r, 120));
      const trade = JSON.stringify({
        e: 'trade',
        E: Date.now(),
        s: 'BTCUSDT',
        t: 123456780 + i,
        p: prices[i].toFixed(2),
        q: (0.15 + i * 0.08).toFixed(4),
        b: 8877665 + i,
        a: 8877670 + i,
        T: Date.now(),
        m: i % 2 === 0
      }, null, 2);

      this.emitWs({
        type: 'frame',
        connection: conn,
        frame: {
          id: `frame_tick_${i}_` + Date.now().toString(36),
          connectionId: connId,
          timestamp: Date.now(),
          direction: 'rx',
          opcode: 'text',
          payload: createPayload(trade, 'application/json')
        }
      });
    }
  }

  /**
   * Scenario: WebSocket Handshake Failure / Network Error
   */
  public async triggerWebSocketError(): Promise<void> {
    const connId = 'ws_err_' + Date.now().toString(36);
    const startTime = Date.now();
    const conn: WebSocketConnection = {
      id: connId,
      timestamp: startTime,
      url: 'wss://secure-gateway.internal:9999/live-stream',
      host: 'secure-gateway.internal',
      path: '/live-stream',
      headers: defaultRedactor.redactHeaders({
        'Host': 'secure-gateway.internal:9999',
        'Authorization': 'Bearer expired_token_secret'
      }).redacted,
      clientType: 'okhttp',
      status: 'connecting',
      totalTxFrames: 0,
      totalRxFrames: 0,
      totalTxBytes: 0,
      totalRxBytes: 0,
      frames: []
    };

    this.emitWs({ type: 'open', connection: conn });
    await new Promise(r => setTimeout(r, 220));

    conn.status = 'error';
    conn.error = {
      errorType: 'UpgradeHttpException',
      message: 'HTTP 401 Unauthorized: Handshake failed (bad credentials or expired bearer token)'
    };
    conn.durationMs = 220;
    this.emitWs({ type: 'error', connection: conn });
  }
}

export const simulator = new AndroidNetworkSimulator();
