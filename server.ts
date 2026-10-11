import express, { Request, Response } from 'express';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { adbManager } from './src/server/adbManager.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const ADB_HOST = '127.0.0.1';

async function startServer() {
  const app = express();
  app.use(express.json());

  // Connected SSE clients for live web UI streaming
  const sseClients: Response[] = [];

  // Active state of real Android socket connection
  let isAdbConnected = false;
  let detectedDevice: any = null;
  let adbSocket: net.Socket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;

  function connectToAdbSocket(targetPort: number = adbManager.getConfig().port) {
    if (adbSocket) {
      adbSocket.destroy();
      adbSocket = null;
    }

    adbSocket = net.createConnection({ host: ADB_HOST, port: targetPort }, () => {
      isAdbConnected = true;
      console.log(`[BlameBackend Server] Connected to Android TCP socket at ${ADB_HOST}:${targetPort}`);
      broadcastSse({ type: 'STATUS', connected: true, port: targetPort, device: detectedDevice });
    });

    let buffer = '';

    adbSocket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const envelope = JSON.parse(line);
          if (envelope.type === 'HELLO') {
            detectedDevice = JSON.parse(envelope.payloadJson);
            broadcastSse({ type: 'DEVICE_INFO', device: detectedDevice });
          } else if (envelope.type === 'NETWORK_EVENT') {
            const event = JSON.parse(envelope.payloadJson);
            broadcastSse({ type: 'NETWORK_EVENT', event });
          }
        } catch (e: any) {
          console.error('[BlameBackend Server] Failed to parse wire message:', e.message);
        }
      }
    });

    adbSocket.on('error', (err: any) => {
      isAdbConnected = false;
      // Normal when no device is forwarded or device is sleeping; silence spam
    });

    adbSocket.on('close', () => {
      isAdbConnected = false;
      broadcastSse({ type: 'STATUS', connected: false, port: targetPort });
      // Schedule background reconnect attempt
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectToAdbSocket(targetPort);
        }, 3000);
      }
    });
  }

  // Initial attempt to connect to ADB port
  connectToAdbSocket();

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

  // --- ADB Management REST Endpoints ---

  // Get current ADB status, config, and forwards
  app.get('/api/adb/status', async (req: Request, res: Response) => {
    const config = adbManager.getConfig();
    const adbCheck = await adbManager.checkAdb();
    const forwards = await adbManager.listForwards();

    res.json({
      connected: isAdbConnected,
      port: config.port,
      host: ADB_HOST,
      device: detectedDevice,
      adbAvailable: adbCheck.ok,
      adbVersion: adbCheck.version,
      adbError: adbCheck.error,
      config,
      forwards
    });
  });

  // Update ADB Config (custom path, default port, device serial)
  app.post('/api/adb/config', (req: Request, res: Response) => {
    const { adbPath, port, selectedSerial } = req.body;
    adbManager.setConfig({
      ...(adbPath ? { adbPath } : {}),
      ...(port ? { port: Number(port) } : {}),
      ...(selectedSerial !== undefined ? { selectedSerial } : {})
    });
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

  // Perform `adb forward tcp:<port> tcp:<port>` and reconnect socket
  app.post('/api/adb/forward', async (req: Request, res: Response) => {
    const port = Number(req.body.port) || adbManager.getConfig().port;
    const serial = req.body.serial || adbManager.getConfig().selectedSerial;
    if (serial !== undefined) {
      adbManager.setConfig({ selectedSerial: serial });
    }

    try {
      const result = await adbManager.forwardPort(port, serial);
      // Immediately connect TCP socket to the forwarded port
      connectToAdbSocket(port);
      res.json({ ...result, port, serial });
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

  // Remove `adb forward --remove tcp:<port>`
  app.post('/api/adb/remove-forward', async (req: Request, res: Response) => {
    const port = Number(req.body.port) || adbManager.getConfig().port;
    try {
      const result = await adbManager.removeForward(port);
      if (adbSocket) {
        adbSocket.destroy();
        adbSocket = null;
      }
      isAdbConnected = false;
      broadcastSse({ type: 'STATUS', connected: false });
      res.json({ ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Refresh TCP socket connection
  app.post('/api/adb/reconnect', (req: Request, res: Response) => {
    const port = Number(req.body.port) || adbManager.getConfig().port;
    connectToAdbSocket(port);
    res.json({ success: true, message: `Reconnecting to ${ADB_HOST}:${port}...` });
  });

  // Compatibility endpoint
  app.get('/api/adb-status', (req: Request, res: Response) => {
    res.json({
      connected: isAdbConnected,
      port: adbManager.getConfig().port,
      host: ADB_HOST,
      device: detectedDevice
    });
  });

  // Live SSE event stream for browser
  app.get('/api/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const config = adbManager.getConfig();
    // Send initial status
    res.write(`data: ${JSON.stringify({ type: 'STATUS', connected: isAdbConnected, port: config.port, device: detectedDevice })}\n\n`);

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
        hmr: isCloudPreview ? false : undefined
      },
      appType: 'spa'
    });

    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    const config = adbManager.getConfig();
    console.log(`[BlameBackend Server] Running on http://localhost:${PORT}`);
    console.log(`[BlameBackend Server] Raw TCP socket listener targeting 127.0.0.1:${config.port}`);
  });
}

startServer().catch((err) => {
  console.error('[BlameBackend Server] Failed to start:', err);
  process.exit(1);
});
