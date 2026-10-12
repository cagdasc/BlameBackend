/**
 * Browser-side client that connects to the server's real TCP ADB bridge stream.
 * Automatically ingests live HTTP requests and device metadata.
 */

import { NetworkEvent, DeviceInfo } from '../types/inspector';
import { apiUrl } from './apiConfig';

export type LiveStreamCallback = (event: NetworkEvent) => void;
export type DeviceCallback = (device: DeviceInfo) => void;
export type DeviceListCallback = (devices: DeviceInfo[]) => void;
export type StatusCallback = (connected: boolean) => void;

class LiveSocketClient {
  private eventSource: EventSource | null = null;
  private onEventListeners: LiveStreamCallback[] = [];
  private onDeviceListeners: DeviceCallback[] = [];
  private onDeviceListListeners: DeviceListCallback[] = [];
  private onStatusListeners: StatusCallback[] = [];
  private isConnected = false;

  public connect() {
    if (this.eventSource) return;

    try {
      this.eventSource = new EventSource(apiUrl('/api/stream'));

      this.eventSource.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);

          if (msg.type === 'STATUS') {
            this.isConnected = Boolean(msg.connected);
            this.onStatusListeners.forEach(cb => cb(this.isConnected));
            if (msg.device) {
              this.onDeviceListeners.forEach(cb => cb(msg.device));
            }
            if (Array.isArray(msg.devices)) {
              this.onDeviceListListeners.forEach(cb => cb(msg.devices));
            }
          } else if (msg.type === 'DEVICE_INFO') {
            if (msg.device) {
              this.onDeviceListeners.forEach(cb => cb(msg.device));
            }
            if (Array.isArray(msg.devices)) {
              this.onDeviceListListeners.forEach(cb => cb(msg.devices));
            }
          } else if (msg.type === 'CLIENT_DISCONNECTED') {
            if (Array.isArray(msg.devices)) {
              this.onDeviceListListeners.forEach(cb => cb(msg.devices));
            }
          } else if (msg.type === 'NETWORK_EVENT') {
            this.onEventListeners.forEach(cb => cb(msg.event));
          }
        } catch (err) {
          console.warn('[LiveSocketClient] Error parsing stream message:', err);
        }
      };

      this.eventSource.onerror = () => {
        this.isConnected = false;
        this.onStatusListeners.forEach(cb => cb(false));
      };
    } catch (e) {
      console.warn('[LiveSocketClient] SSE connection unavailable (running purely in client mode)');
    }
  }

  public onNetworkEvent(cb: LiveStreamCallback): () => void {
    this.onEventListeners.push(cb);
    return () => {
      this.onEventListeners = this.onEventListeners.filter(l => l !== cb);
    };
  }

  public onDevice(cb: DeviceCallback): () => void {
    this.onDeviceListeners.push(cb);
    return () => {
      this.onDeviceListeners = this.onDeviceListeners.filter(l => l !== cb);
    };
  }

  public onDeviceList(cb: DeviceListCallback): () => void {
    this.onDeviceListListeners.push(cb);
    return () => {
      this.onDeviceListListeners = this.onDeviceListListeners.filter(l => l !== cb);
    };
  }

  public onStatus(cb: StatusCallback): () => void {
    this.onStatusListeners.push(cb);
    return () => {
      this.onStatusListeners = this.onStatusListeners.filter(l => l !== cb);
    };
  }
}

export const liveSocketClient = new LiveSocketClient();
