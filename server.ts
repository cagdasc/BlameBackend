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

              broadcastSse({
                type: 'NETWORK_EVENT',
                event,
                clientId,
                device: session.deviceInfo
              });
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

  // Live SSE event stream for browser
  app.get('/api/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const config = adbManager.getConfig();
    // Send initial status with full device list
    res.write(`data: ${JSON.stringify({
      type: 'STATUS',
      connected: connectedClients.size > 0,
      port: config.port,
      activeClientsCount: connectedClients.size,
      devices: getActiveDevicesList(),
      device: getPrimaryDevice()
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
