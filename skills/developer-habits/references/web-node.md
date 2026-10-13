# TypeScript, Node Daemon & Web Console Architecture Reference

This reference documents the Node.js server daemon, ADB port-forwarding bridge, and React 19 terminal TUI console patterns in BlameBackend.

---

## 1. Node Daemon Architecture (`server.ts`)

The host server performs three primary roles:
1. **Raw TCP Socket Listener (`net.Server`)**: Listens on `127.0.0.1:10245` for incoming connections from multiplatform clients (Android USB port forward, JVM desktop, iOS simulator, emulators).
2. **Server-Sent Events (SSE) Broadcast Hub**: Streams parsed `NetworkEvent` objects in real-time to active browser sessions (`/api/stream`).
3. **Vite Development & Static Production Server**: Serves the React 19 frontend on port 3000.

### 1.1 Wire Stream Framing & Chunk Reassembly
Because TCP streams are byte-oriented and packets may arrive fragmented across chunk boundaries, the Node server accumulates buffer chunks and splits by newline delimiter (`\n`):

```typescript
let buffer = '';
socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  const lines = buffer.split('\n');
  buffer = lines.pop() || ''; // Keep incomplete trailing fragment in buffer

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const envelope: WireEnvelope = JSON.parse(line);
      handleEnvelope(envelope, clientSession);
    } catch (err) {
      console.warn('Failed to parse incoming wire envelope chunk', err);
    }
  }
});
```

---

## 2. ADB Port Forwarding Management (`adbManager.ts`)

When an Android device or emulator connects over USB, Android prevents direct host-to-device socket connections unless port forwarding is established.

### 2.1 Forwarding Mechanism
The `adbManager` automates this process:
```typescript
// Discovers attached devices
const output = execSync('adb devices -l').toString();

// Configures reverse/forward TCP rule on port 10245
execSync(`adb -s ${sanitizedSerial} forward tcp:10245 tcp:10245`);
```

### 2.2 Security Rule: Shell Injection Prevention
Device serial IDs from user inputs or API parameters must always be strictly validated with a regex (`/^[a-zA-Z0-9.:_-]+$/`) before being passed to shell commands.

---

## 3. React 19 Web Console (`src/`)

### 3.1 Terminal TUI Ergonomics
The console is designed to replicate high-speed terminal multiplexers (such as tmux or lazygit):
- **Split-Pane Layout**: Resizable split view with request list on the left and full inspect panels (Headers, Body, Timing, Hex Preview, cURL) on the right.
- **Fast Search & Filter Engine**: Token-based query syntax supporting filters such as `status:200`, `method:POST`, `domain:api.github.com`, or plain text substring matches.
- **Keyboard Shortcuts**:
  - `j` / `ArrowDown`: Move selection down
  - `k` / `ArrowUp`: Move selection up
  - `/`: Focus search input
  - `Escape`: Clear search focus or close modal
  - `Tab`: Cycle between inspector tabs
  - `c`: Clear captured events buffer

### 3.2 State Management & Buffer Limits
- The event list is maintained in React state with a maximum bounded size (default 500 events) to prevent DOM bloat during high-throughput stress tests.
- Uses `useMemo` for real-time filter computation.

---

## 4. Headless Shell CLI (`desktop-cli.ts`)

For developers running in headless environments, CI pipelines, or pure shell windows:
- Connects directly to the daemon's TCP port or SSE stream.
- Outputs formatted ANSI colored lines:
  - Cyan: HTTP Method
  - Green / Yellow / Red: HTTP Status Codes (2xx / 4xx / 5xx)
  - Gray: Timing in milliseconds (`142ms`)
  - Monospace URI path and host summary.
