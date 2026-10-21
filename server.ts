import express, { Request, Response } from 'express';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { adbManager } from './src/server/adbManager.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const HOST = '127.0.0.1';

interface ConnectedClientSession {
  id: string;
  socket: net.Socket;
  remoteAddress: string;
  remotePort: number;
  connectedAt: number;
  deviceInfo: any | null;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Connected SSE clients for live browser UI streaming
  const sseClients: Response[] = [];

  // Active connected client platforms (Desktop JVM, Android USB, Emulator, iOS, etc.)
  const connectedClients = new Map<string, ConnectedClientSession>();
  let clientIdCounter = 1;

  // In-memory WebSocket sessions storage (bounded ring buffer of frames per connection)
  interface StoredWsSession {
    connection: any;
    frames: any[];
  }
  const wsSessions = new Map<string, StoredWsSession>();
  const MAX_WS_FRAMES_PER_CONNECTION = 500;

  let tcpServer: net.Server | null = null;
  let isTcpServerListening = false;
  let tcpServerError: string | null = null;

  function broadcastSse(data: any) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (let i = sseClients.length - 1; i >= 0; i--) {
      try {
        sseClients[i].write(payload);
      } catch {
        sseClients.splice(i, 1);
      }
    }
  }

  function getActiveDevicesList() {
    return Array.from(connectedClients.values()).map(client => ({
      id: client.id,
      remoteAddress: client.remoteAddress,
      remotePort: client.remotePort,
      connectedAt: client.connectedAt,
      port: adbManager.getConfig().port,
      ...(client.deviceInfo || {
        deviceName: `Client ${client.id}`,
        osVersion: 'Unknown OS',
        appName: 'Unknown App',
        appVersion: '1.0.0'
      })
    }));
  }

  function getPrimaryDevice() {
    const list = getActiveDevicesList();
    return list.length > 0 ? list[list.length - 1] : null;
  }

  // --- TCP Server Socket for receiving incoming connections from Kotlin Multiplatform clients (Android, iOS, Desktop, Server) ---
  function startOrRestartTcpServer(targetPort: number = adbManager.getConfig().port) {
    if (tcpServer) {
      try {
        tcpServer.close();
      } catch (err: any) {
        console.warn('[BlameBackend Server] Error closing previous TCP server:', err.message);
      }
      tcpServer = null;
    }

    tcpServer = net.createServer((socket) => {
      const clientId = `client_${clientIdCounter++}_${socket.remotePort}`;
      const remoteAddress = socket.remoteAddress || '127.0.0.1';
      const remotePort = socket.remotePort || 0;

      socket.setNoDelay(true);
      socket.setKeepAlive(true, 5000);

      const session: ConnectedClientSession = {
        id: clientId,
        socket,
        remoteAddress,
        remotePort,
        connectedAt: Date.now(),
        deviceInfo: null
      };

      connectedClients.set(clientId, session);
      console.log(`[BlameBackend Server] Client connected from ${remoteAddress}:${remotePort} [ID: ${clientId}] (Total clients: ${connectedClients.size})`);

      // Notify web clients that a new platform connected
      broadcastSse({
        type: 'STATUS',
        connected: true,
        port: targetPort,
        activeClientsCount: connectedClients.size,
        devices: getActiveDevicesList(),
        device: getPrimaryDevice()
      });

      let buffer = '';

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete fragment

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const envelope = JSON.parse(line);

            if (envelope.type === 'HELLO') {
              const helloData = JSON.parse(envelope.payloadJson);
              session.deviceInfo = {
                ...helloData,
                id: clientId,
                port: targetPort,
                connectedAt: session.connectedAt
              };
              console.log(`[BlameBackend Server] Handshake from ${helloData.deviceName || 'Device'} (${helloData.appName || 'App'}) [${clientId}]`);

              broadcastSse({
                type: 'DEVICE_INFO',
                device: session.deviceInfo,
                devices: getActiveDevicesList()
              });
              broadcastSse({
                type: 'STATUS',
                connected: true,
                port: targetPort,
                activeClientsCount: connectedClients.size,
                devices: getActiveDevicesList(),
                device: session.deviceInfo
              });
            } else if (envelope.type === 'NETWORK_EVENT') {
              const event = JSON.parse(envelope.payloadJson);
              // Tag event with client and device context
              event.clientId = clientId;
              event.deviceName = session.deviceInfo?.deviceName || clientId;
              event.appName = session.deviceInfo?.appName || '';
              event.osVersion = session.deviceInfo?.osVersion || '';

              // Auto-enrich GraphQL operation name and type if not already populated on wire
              if (event.request && !event.request.operationName) {
                const headerOp = Object.entries(event.request.headers || {}).find(
                  ([k]) => k.toLowerCase() === 'x-apollo-operation-name'
                )?.[1];
                if (headerOp) {
                  event.request.operationName = headerOp;
                } else if (event.request.body?.content) {
                  try {
                    const parsed = JSON.parse(event.request.body.content);
                    if (parsed.operationName) {
                      event.request.operationName = parsed.operationName;
                    }
                    if (!event.request.operationType && parsed.query) {
                      const q = String(parsed.query).trim();
                      if (q.startsWith('mutation')) event.request.operationType = 'mutation';
                      else if (q.startsWith('subscription')) event.request.operationType = 'subscription';
                      else if (q.startsWith('query') || q.startsWith('{')) event.request.operationType = 'query';
                    }
                  } catch {}
                }
              }

              broadcastSse({
                type: 'NETWORK_EVENT',
                event,
                clientId,
                device: session.deviceInfo
              });
            } else if (envelope.type === 'WS_OPEN') {
              const wsConn = JSON.parse(envelope.payloadJson);
              wsConn.clientId = clientId;
              wsConn.deviceName = session.deviceInfo?.deviceName || clientId;
              wsConn.appName = session.deviceInfo?.appName || '';
              wsConn.osVersion = session.deviceInfo?.osVersion || '';
              wsConn.status = 'open';
              wsConn.totalTxFrames = wsConn.totalTxFrames || 0;
              wsConn.totalRxFrames = wsConn.totalRxFrames || 0;
              wsConn.totalTxBytes = wsConn.totalTxBytes || 0;
              wsConn.totalRxBytes = wsConn.totalRxBytes || 0;

              const stored: StoredWsSession = {
                connection: wsConn,
                frames: []
              };
              wsSessions.set(wsConn.id, stored);
              console.log(`[BlameBackend Server] WebSocket connection opened: ${wsConn.url} [ID: ${wsConn.id}]`);
              broadcastSse({
                type: 'WS_CONNECTION',
                connection: wsConn,
                clientId,
                device: session.deviceInfo
              });
            } else if (envelope.type === 'WS_FRAME') {
              const frame = JSON.parse(envelope.payloadJson);
              const stored = wsSessions.get(frame.connectionId);
              if (stored) {
                const conn = stored.connection;
                const size = Number(frame.payload?.sizeBytes || 0);
                if (frame.direction === 'tx') {
                  conn.totalTxFrames = (conn.totalTxFrames || 0) + 1;
                  conn.totalTxBytes = (conn.totalTxBytes || 0) + size;
                } else {
                  conn.totalRxFrames = (conn.totalRxFrames || 0) + 1;
                  conn.totalRxBytes = (conn.totalRxBytes || 0) + size;
                }
                conn.durationMs = Date.now() - conn.timestamp;
                stored.frames.push(frame);
                if (stored.frames.length > MAX_WS_FRAMES_PER_CONNECTION) {
                  stored.frames.shift();
                }
                broadcastSse({
                  type: 'WS_FRAME',
                  frame,
                  connection: conn,
                  clientId
                });
              }
            } else if (envelope.type === 'WS_CLOSE') {
              const closeData = JSON.parse(envelope.payloadJson);
              const connId = closeData.connectionId || closeData.id;
              const stored = wsSessions.get(connId);
              if (stored) {
                stored.connection.status = 'closed';
                stored.connection.closeCode = closeData.closeCode ?? 1000;
                stored.connection.closeReason = closeData.closeReason ?? 'Normal Closure';
                stored.connection.durationMs = Date.now() - stored.connection.timestamp;
                console.log(`[BlameBackend Server] WebSocket connection closed: ${stored.connection.url} (Code: ${stored.connection.closeCode})`);
                broadcastSse({
                  type: 'WS_CONNECTION',
                  connection: stored.connection,
                  clientId
                });
              }
            } else if (envelope.type === 'WS_ERROR') {
              const errData = JSON.parse(envelope.payloadJson);
              const connId = errData.connectionId || errData.id;
              const stored = wsSessions.get(connId);
              if (stored) {
                stored.connection.status = 'error';
                stored.connection.error = errData.error || {
                  errorType: 'WebSocketException',
                  message: errData.message || 'WebSocket connection error'
                };
                stored.connection.durationMs = Date.now() - stored.connection.timestamp;
                console.warn(`[BlameBackend Server] WebSocket error on ${stored.connection.url}`);
                broadcastSse({
                  type: 'WS_CONNECTION',
                  connection: stored.connection,
                  clientId
                });
              }
            } else if (envelope.type === 'PING') {
              // Bidirectional PONG reply
              socket.write(JSON.stringify({
                type: 'PONG',
                version: 1,
                timestamp: Date.now(),
                payloadJson: '{}'
              }) + '\n');
            }
          } catch (e: any) {
            console.error(`[BlameBackend Server] Failed to parse message from ${clientId}:`, e.message);
          }
        }
      });

      socket.on('error', (err: any) => {
        console.warn(`[BlameBackend Server] Socket error on ${clientId}:`, err.message);
      });

      socket.on('close', () => {
        console.log(`[BlameBackend Server] Client disconnected: ${clientId} (Remaining: ${connectedClients.size - 1})`);
        connectedClients.delete(clientId);

        broadcastSse({
          type: 'CLIENT_DISCONNECTED',
          clientId,
          activeClientsCount: connectedClients.size,
          devices: getActiveDevicesList()
        });

        if (connectedClients.size === 0) {
          broadcastSse({
            type: 'STATUS',
            connected: false,
            port: targetPort,
            activeClientsCount: 0,
            devices: [],
            device: null
          });
        }
      });
    });

    tcpServer.on('error', (err: any) => {
      isTcpServerListening = false;
      tcpServerError = err.message;
      console.error(`[BlameBackend Server] TCP Server socket error on port ${targetPort}:`, err.message);
      broadcastSse({
        type: 'SERVER_ERROR',
        error: err.message,
        port: targetPort
      });
    });

    tcpServer.listen(targetPort, '0.0.0.0', () => {
      isTcpServerListening = true;
      tcpServerError = null;
      console.log(`[BlameBackend Server] TCP Server Socket listening on 0.0.0.0:${targetPort} for incoming client connections (Kotlin Multiplatform: Android, iOS, Desktop, Server)`);
    });
  }

  // Start the TCP server socket listener on configured port
  startOrRestartTcpServer();

  // --- ADB Management REST Endpoints ---

  // Get current status, config, active client platforms, and adb rules
  app.get('/api/adb/status', async (req: Request, res: Response) => {
    const config = adbManager.getConfig();
    const adbCheck = await adbManager.checkAdb();
    const reverses = await adbManager.listReverses();
    const forwards = await adbManager.listForwards();

    res.json({
      connected: connectedClients.size > 0,
      clientCount: connectedClients.size,
      tcpServerListening: isTcpServerListening,
      tcpServerError,
      port: config.port,
      host: HOST,
      device: getPrimaryDevice(),
      devices: getActiveDevicesList(),
      adbAvailable: adbCheck.ok,
      adbVersion: adbCheck.version,
      adbError: adbCheck.error,
      config,
      reverses,
      forwards
    });
  });

  // Update Config (custom path, default port, device serial)
  app.post('/api/adb/config', (req: Request, res: Response) => {
    const { adbPath, port, selectedSerial } = req.body;
    const currentConfig = adbManager.getConfig();
    const newPort = port ? Number(port) : currentConfig.port;

    adbManager.setConfig({
      ...(adbPath ? { adbPath } : {}),
      ...(port ? { port: newPort } : {}),
      ...(selectedSerial !== undefined ? { selectedSerial } : {})
    });

    if (port && newPort !== currentConfig.port) {
      startOrRestartTcpServer(newPort);
    }

    res.json({ success: true, config: adbManager.getConfig() });
  });

  // Auto-detect ADB location on local system
  app.post('/api/adb/detect-path', async (req: Request, res: Response) => {
    const detected = await adbManager.autoDetectAdbPath();
    if (detected) {
      adbManager.setConfig({ adbPath: detected });
      const check = await adbManager.checkAdb();
      res.json({ success: true, path: detected, version: check.version });
    } else {
      res.json({ success: false, message: 'Could not auto-detect adb binary in default SDK paths.' });
    }
  });

  // Get list of attached devices from `adb devices -l`
  app.get('/api/adb/devices', async (req: Request, res: Response) => {
    try {
      const devices = await adbManager.getDevices();
      res.json({ success: true, devices });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.stderr || err.message });
    }
  });

  // Perform `adb reverse tcp:<port> tcp:<port>` so Android routes to host TCP server
  app.post('/api/adb/reverse', async (req: Request, res: Response) => {
    const port = Number(req.body.port) || adbManager.getConfig().port;
    const serial = req.body.serial || adbManager.getConfig().selectedSerial;
    if (serial !== undefined) {
      adbManager.setConfig({ selectedSerial: serial });
    }

    try {
      const result = await adbManager.reversePort(port, serial);
      res.json({ ...result, port, serial });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Remove `adb reverse --remove tcp:<port>`
  app.post('/api/adb/remove-reverse', async (req: Request, res: Response) => {
    const port = Number(req.body.port) || adbManager.getConfig().port;
    const serial = req.body.serial || adbManager.getConfig().selectedSerial;
    try {
      const result = await adbManager.removeReverse(port, serial);
      res.json({ ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Backwards-compatible `adb forward` endpoint
  app.post('/api/adb/forward', async (req: Request, res: Response) => {
    const port = Number(req.body.port) || adbManager.getConfig().port;
    const serial = req.body.serial || adbManager.getConfig().selectedSerial;
    if (serial !== undefined) {
      adbManager.setConfig({ selectedSerial: serial });
    }

    try {
      const result = await adbManager.forwardPort(port, serial);
      res.json({ ...result, port, serial });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Remove `adb forward --remove tcp:<port>`
  app.post('/api/adb/remove-forward', async (req: Request, res: Response) => {
    const port = Number(req.body.port) || adbManager.getConfig().port;
    try {
      const result = await adbManager.removeForward(port);
      res.json({ ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Kill and restart ADB server: adb kill-server && adb start-server
  app.post('/api/adb/restart-server', async (req: Request, res: Response) => {
    try {
      const result = await adbManager.restartServer();
      const devices = await adbManager.getDevices();
      res.json({ ...result, devices });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Restart/rebind TCP server socket
  app.post('/api/adb/reconnect', (req: Request, res: Response) => {
    const port = Number(req.body.port) || adbManager.getConfig().port;
    startOrRestartTcpServer(port);
    res.json({ success: true, message: `TCP server restarted on port ${port}` });
  });

  // List all currently connected client platforms
  app.get('/api/clients', (req: Request, res: Response) => {
    res.json({
      success: true,
      count: connectedClients.size,
      clients: getActiveDevicesList()
    });
  });

  // Compatibility endpoint
  app.get('/api/adb-status', (req: Request, res: Response) => {
    res.json({
      connected: connectedClients.size > 0,
      clientCount: connectedClients.size,
      port: adbManager.getConfig().port,
      host: HOST,
      device: getPrimaryDevice(),
      devices: getActiveDevicesList()
    });
  });

  // --- WebSocket Inspection REST Endpoints ---

  // Get all active / stored WebSocket connections
  app.get('/api/ws-connections', (req: Request, res: Response) => {
    const list = Array.from(wsSessions.values()).map(s => ({
      ...s.connection,
      frameCount: s.frames.length
    }));
    res.json({ success: true, count: list.length, connections: list });
  });

  // Get specific WebSocket connection with its buffered frames
  app.get('/api/ws-connections/:id', (req: Request, res: Response) => {
    const session = wsSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ success: false, error: 'WebSocket session not found' });
    }
    res.json({ success: true, connection: session.connection, frames: session.frames });
  });

  // Clear WebSocket sessions
  app.post('/api/ws-connections/clear', (req: Request, res: Response) => {
    wsSessions.clear();
    broadcastSse({ type: 'WS_CLEAR' });
    res.json({ success: true });
  });

  // Simulate WebSocket event (for UI testing & demo without external device)
  app.post('/api/simulate-ws', (req: Request, res: Response) => {
    const { type, connection, frame, closeCode, closeReason, error } = req.body;
    if (type === 'WS_OPEN' && connection) {
      const stored: StoredWsSession = {
        connection: {
          ...connection,
          status: 'open',
          totalTxFrames: 0,
          totalRxFrames: 0,
          totalTxBytes: 0,
          totalRxBytes: 0
        },
        frames: []
      };
      wsSessions.set(connection.id, stored);
      broadcastSse({ type: 'WS_CONNECTION', connection: stored.connection });
      return res.json({ success: true, connection: stored.connection });
    } else if (type === 'WS_FRAME' && frame) {
      const stored = wsSessions.get(frame.connectionId);
      if (stored) {
        const size = Number(frame.payload?.sizeBytes || 0);
        if (frame.direction === 'tx') {
          stored.connection.totalTxFrames = (stored.connection.totalTxFrames || 0) + 1;
          stored.connection.totalTxBytes = (stored.connection.totalTxBytes || 0) + size;
        } else {
          stored.connection.totalRxFrames = (stored.connection.totalRxFrames || 0) + 1;
          stored.connection.totalRxBytes = (stored.connection.totalRxBytes || 0) + size;
        }
        stored.connection.durationMs = Date.now() - stored.connection.timestamp;
        stored.frames.push(frame);
        if (stored.frames.length > MAX_WS_FRAMES_PER_CONNECTION) stored.frames.shift();
        broadcastSse({ type: 'WS_FRAME', frame, connection: stored.connection });
        return res.json({ success: true });
      }
      return res.status(404).json({ error: 'Connection not found' });
    } else if (type === 'WS_CLOSE') {
      const connId = req.body.connectionId || connection?.id;
      const stored = wsSessions.get(connId);
      if (stored) {
        stored.connection.status = 'closed';
        stored.connection.closeCode = closeCode ?? 1000;
        stored.connection.closeReason = closeReason ?? 'Normal Closure';
        stored.connection.durationMs = Date.now() - stored.connection.timestamp;
        broadcastSse({ type: 'WS_CONNECTION', connection: stored.connection });
        return res.json({ success: true, connection: stored.connection });
      }
    } else if (type === 'WS_ERROR') {
      const connId = req.body.connectionId || connection?.id;
      const stored = wsSessions.get(connId);
      if (stored) {
        stored.connection.status = 'error';
        stored.connection.error = error || {
          errorType: 'WebSocketException',
          message: 'Simulated WebSocket error'
        };
        stored.connection.durationMs = Date.now() - stored.connection.timestamp;
        broadcastSse({ type: 'WS_CONNECTION', connection: stored.connection });
        return res.json({ success: true, connection: stored.connection });
      }
    }
    res.json({ success: true });
  });

  // Live SSE event stream for browser
  app.get('/api/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const config = adbManager.getConfig();
    // Send initial status with full device list & active WebSocket connections
    res.write(`data: ${JSON.stringify({
      type: 'STATUS',
      connected: connectedClients.size > 0,
      port: config.port,
      activeClientsCount: connectedClients.size,
      devices: getActiveDevicesList(),
      device: getPrimaryDevice(),
      wsConnections: Array.from(wsSessions.values()).map(s => ({
        ...s.connection,
        frameCount: s.frames.length
      }))
    })}\n\n`);

    sseClients.push(res);

    req.on('close', () => {
      const idx = sseClients.indexOf(res);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
  });

  const clientDist = path.resolve(__dirname, 'client');
  const hasBuiltClient = fs.existsSync(path.join(clientDist, 'index.html'));

  if (hasBuiltClient) {
    // Production mode: Serve pre-built static client files
    app.use(express.static(clientDist));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    // Development mode: Dynamically load Vite middleware
    const isCloudPreview = Boolean(
      process.env.APPLET_ID ||
      process.env.K_SERVICE ||
      process.env.CNB_STACK_ID ||
      process.env.DISABLE_HMR === 'true'
    );

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: isCloudPreview ? false : undefined,
        watch: {
          ignored: [
            '**/client/**',
            '**/client/**/*',
            path.resolve(__dirname, 'client/**'),
            path.resolve(__dirname, 'client/**/*'),
          ],
        },
      },
      appType: 'spa'
    });

    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    const config = adbManager.getConfig();
    console.log(`[BlameBackend Server] Running on http://localhost:${PORT}`);
    console.log(`[BlameBackend Server] Hosting TCP Server Socket on 0.0.0.0:${config.port} (accepting Kotlin Multiplatform clients: Android, iOS, Desktop, Server)`);
  });
}

startServer().catch((err) => {
  console.error('[BlameBackend Server] Failed to start:', err);
  process.exit(1);
});
