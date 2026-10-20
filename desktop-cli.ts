/**
 * Standalone TypeScript Terminal CLI for BlameBackend
 * (Kotlin Multiplatform Network Inspector)
 * 
 * Directly opens a raw TCP socket connection or connects to existing server:
 * • Android: adb reverse tcp:10245 tcp:10245
 * • iOS Simulator / Desktop / Local JVM: connects directly to 127.0.0.1:10245
 * 
 * Run with:
 * npx tsx desktop-cli.ts
 */

import net from 'net';
import readline from 'readline';

const ADB_HOST = '127.0.0.1';
const ADB_PORT = 10245;

interface WireEnvelope {
  type: 'HELLO' | 'NETWORK_EVENT' | 'PING' | 'PONG' | 'GOODBYE';
  version: number;
  timestamp: number;
  payloadJson: string;
}

interface NetworkEventDto {
  id: string;
  timestamp: number;
  request: {
    id: string;
    method: string;
    url: string;
    host: string;
    path: string;
    protocol: string;
    headers: Record<string, string>;
    clientType: string;
    operationName?: string | null;
    operationType?: string | null;
    body?: {
      contentType: string | null;
      sizeBytes: number;
      content: string | null;
      truncated: boolean;
      isBinary: boolean;
    };
  };
  response?: {
    statusCode: number;
    statusMessage: string;
    headers: Record<string, string>;
    durationMs: number;
    sizeBytes: number;
    protocol: string;
    body?: {
      content: string | null;
      truncated: boolean;
      isBinary: boolean;
    };
  };
  durationMs?: number;
  error?: {
    errorType: string;
    message: string;
  };
}

console.log('==================================================');
console.log('  BlameBackend CLI (TypeScript/Node.js Engine)');
console.log('  TCP Server Socket Host for Multi-Platform Traffic');
console.log('==================================================');

function startTcpServer() {
  const server = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`\x1b[32m[DEVICE CONNECTED]\x1b[0m Inbound connection from ${remote}`);

    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        handleRawWireMessage(line);
      }
    });

    socket.on('error', (err) => {
      console.log(`\x1b[33m[SOCKET NOTICE]\x1b[0m ${err.message}`);
    });

    socket.on('close', () => {
      console.log(`\x1b[33m[DEVICE DISCONNECTED]\x1b[0m Disconnected: ${remote}`);
    });
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`\x1b[33m[PORT 10245 IN USE]\x1b[0m BlameBackend web server is likely already running on port 10245.`);
      console.log(`Hooking into server stream at http://127.0.0.1:3000/api/stream...\n`);
      connectToHttpSseStream();
    } else {
      console.error(`\x1b[31m[TCP SERVER ERROR]\x1b[0m ${err.message}`);
    }
  });

  server.listen(ADB_PORT, '0.0.0.0', () => {
    console.log(`\x1b[32m[SERVER LISTENING]\x1b[0m Hosting TCP Server Socket on 0.0.0.0:${ADB_PORT}`);
    console.log(`• Android: Run \x1b[33madb reverse tcp:${ADB_PORT} tcp:${ADB_PORT}\x1b[0m`);
    console.log(`• iOS Simulator / Desktop / JVM: Connects directly to \x1b[33m127.0.0.1:${ADB_PORT}\x1b[0m`);
    console.log('Waiting for incoming Kotlin Multiplatform client connections...\n');
  });
}

async function connectToHttpSseStream() {
  try {
    const http = await import('http');
    const req = http.get('http://127.0.0.1:3000/api/stream', (res) => {
      console.log(`\x1b[32m[ATTACHED]\x1b[0m Tailing live stream from BlameBackend web server:\n`);
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (line.startsWith('data:')) {
            try {
              const msg = JSON.parse(line.substring(5).trim());
              if (msg.type === 'DEVICE_INFO') {
                console.log(`\x1b[36m[DEVICE DETECTED]\x1b[0m ${msg.device?.deviceName || 'Device'} (${msg.device?.osVersion}) - App: ${msg.device?.appName}`);
              } else if (msg.type === 'NETWORK_EVENT' && msg.event) {
                renderTerminalEvent(msg.event);
              }
            } catch {}
          }
        }
      });
    });

    req.on('error', () => {
      console.error(`\x1b[31m[FAILED]\x1b[0m Could not connect to BlameBackend server at http://127.0.0.1:3000.`);
    });
  } catch (err: any) {
    console.error(`\x1b[31m[STREAM ERROR]\x1b[0m ${err.message}`);
  }
}

startTcpServer();

function handleRawWireMessage(rawJson: string) {
  try {
    const envelope: WireEnvelope = JSON.parse(rawJson);

    if (envelope.type === 'HELLO') {
      const hello = JSON.parse(envelope.payloadJson);
      const os = hello.osVersion || hello.androidVersion || 'Multiplatform';
      console.log(`\x1b[36m[DEVICE DETECTED]\x1b[0m ${hello.deviceModel} (${os}) - App: ${hello.appPackage}`);
      console.log('─────────────────────────────────────────────────────────────────────────────\n');
      return;
    }

    if (envelope.type === 'NETWORK_EVENT') {
      const event: NetworkEventDto = JSON.parse(envelope.payloadJson);
      renderTerminalEvent(event);
    }
  } catch (err: any) {
    console.error(`[PARSE ERROR] Invalid wire message: ${err.message}`);
  }
}

function renderTerminalEvent(event: NetworkEventDto) {
  const method = event.request.method.padEnd(7);
  const status = event.error
    ? '\x1b[31mERR\x1b[0m'
    : event.response
    ? event.response.statusCode >= 400
      ? `\x1b[33m${event.response.statusCode}\x1b[0m`
      : `\x1b[32m${event.response.statusCode}\x1b[0m`
    : '\x1b[33m...\x1b[0m';

  const hostAndPath = `${event.request.host}${event.request.path}`;
  const duration = event.durationMs !== undefined ? `${event.durationMs}ms` : 'pending';
  const protocol = event.response?.protocol || (event.response ? 'HTTP/1.1' : (event.request.protocol || '...'));
  const protoBadge = `\x1b[35m${protocol.padEnd(8)}\x1b[0m`;
  const client = `[${event.request.clientType}]`;

  const gqlBadge = event.request.operationName
    ? ` \x1b[36m[GQL ${event.request.operationType || 'query'}: \x1b[1m${event.request.operationName}\x1b[0m\x1b[36m]\x1b[0m`
    : '';

  console.log(`${method} ${status}  ${protoBadge} ${hostAndPath.padEnd(36)}${gqlBadge} \x1b[90m${client}\x1b[0m \x1b[36m${duration}\x1b[0m`);

  // If there's an error, print it
  if (event.error) {
    console.log(`  \x1b[31m↳ ${event.error.errorType}: ${event.error.message}\x1b[0m`);
  }
}
