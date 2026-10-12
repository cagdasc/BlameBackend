/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { TerminalTui } from './components/TerminalTui';
import { RequestSimulator } from './components/RequestSimulator';
import { CustomDispatcher } from './components/CustomDispatcher';
import { DeviceManager } from './components/DeviceManager';
import { NetworkEvent, DeviceInfo } from './types/inspector';
import { liveSocketClient } from './engine/liveSocketClient';
import { simulator } from './engine/mockClient';
import { apiUrl } from './engine/apiConfig';

export default function App() {
  const [activeTab, setActiveTab] = useState<'tui' | 'scenarios' | 'dispatcher' | 'devices'>('tui');
  const [events, setEvents] = useState<NetworkEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectedDevices, setConnectedDevices] = useState<DeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('all');
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>({
    deviceName: 'Waiting for device...',
    osVersion: '',
    appName: '',
    appVersion: '',
    connectedAt: Date.now(),
    port: 10245
  });

  // Calculate event count per device/client
  const eventsByDevice: Record<string, number> = {};
  for (const event of events) {
    if (event.clientId) {
      eventsByDevice[event.clientId] = (eventsByDevice[event.clientId] || 0) + 1;
    }
    if (event.deviceName) {
      eventsByDevice[event.deviceName] = (eventsByDevice[event.deviceName] || 0) + 1;
    }
  }

  // Filter events by selected device
  const selectedDevice = connectedDevices.find(d => d.id === selectedDeviceId);
  const displayedEvents = selectedDeviceId === 'all'
    ? events
    : events.filter(e => {
        if (e.clientId && e.clientId === selectedDeviceId) return true;
        if (selectedDevice && e.deviceName && e.deviceName === selectedDevice.deviceName) return true;
        return false;
      });

  // Listen to live ADB TCP socket stream AND local simulator/dispatcher events
  useEffect(() => {
    let isMounted = true;

    const handleNewEvent = (event: NetworkEvent) => {
      if (!isMounted) return;

      // Ensure device is known in connectedDevices if not already registered
      if (event.clientId || event.deviceName) {
        setConnectedDevices((prev) => {
          const exists = prev.some(
            d => (event.clientId && d.id === event.clientId) || (event.deviceName && d.deviceName === event.deviceName)
          );
          if (!exists) {
            return [
              ...prev,
              {
                id: event.clientId || `dev-${Date.now()}`,
                deviceName: event.deviceName || 'Client Device',
                appName: event.appName || 'App',
                osVersion: event.osVersion || 'Unknown OS',
                appVersion: '1.0.0',
                connectedAt: Date.now(),
                port: 10245
              }
            ];
          }
          return prev;
        });
      }

      setEvents((prev) => {
        const index = prev.findIndex((e) => e.id === event.id);
        if (index >= 0) {
          const updated = [...prev];
          const resolvedProtocol = event.response?.protocol || event.request?.protocol || updated[index].request?.protocol;
          updated[index] = {
            ...updated[index],
            ...event,
            request: {
              ...updated[index].request,
              ...event.request,
              protocol: resolvedProtocol
            }
          };
          return updated;
        } else {
          return [...prev, event];
        }
      });
    };

    // 1. Subscribe to Custom Dispatcher & Scenario simulator
    const unsubSim = simulator.subscribe(handleNewEvent);

    // 2. Connect to real ADB TCP bridge
    liveSocketClient.connect();
    const unsubLiveEvents = liveSocketClient.onNetworkEvent(handleNewEvent);

    const unsubLiveDevice = liveSocketClient.onDevice((dev: any) => {
      if (!isMounted) return;
      const newDev: DeviceInfo = {
        id: dev.id,
        deviceName: dev.deviceName || 'Connected Device',
        osVersion: dev.osVersion || 'Multiplatform',
        appName: dev.appName || 'com.cacaosd.blamebackend',
        appVersion: dev.appVersion || 'debug',
        connectedAt: dev.connectedAt || Date.now(),
        port: dev.port || 10245
      };

      setDeviceInfo(newDev);
      setIsConnected(true);

      setConnectedDevices((prev) => {
        const existingIdx = prev.findIndex(d => (dev.id && d.id === dev.id) || d.deviceName === dev.deviceName);
        if (existingIdx >= 0) {
          const copy = [...prev];
          copy[existingIdx] = { ...copy[existingIdx], ...newDev };
          return copy;
        }
        return [...prev, newDev];
      });
    });

    const unsubLiveDeviceList = liveSocketClient.onDeviceList((list: any[]) => {
      if (!isMounted) return;
      if (Array.isArray(list)) {
        setConnectedDevices(list);
        if (list.length > 0) {
          setIsConnected(true);
        } else {
          setIsConnected(false);
        }
      }
    });

    const unsubLiveStatus = liveSocketClient.onStatus((status: boolean) => {
      if (!isMounted) return;
      setIsConnected(status);
    });

    return () => {
      isMounted = false;
      unsubSim();
      unsubLiveEvents();
      unsubLiveDevice();
      unsubLiveDeviceList();
      unsubLiveStatus();
    };
  }, []);

  const handleClear = () => {
    if (selectedDeviceId === 'all') {
      setEvents([]);
    } else {
      // Clear only events from current selected device
      setEvents(prev => prev.filter(e => {
        if (e.clientId && e.clientId === selectedDeviceId) return false;
        if (selectedDevice && e.deviceName && e.deviceName === selectedDevice.deviceName) return false;
        return true;
      }));
    }
    setSelectedId(null);
  };

  const handleReconnectSocket = async () => {
    try {
      await fetch(apiUrl('/api/adb/reconnect'), { method: 'POST' });
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0c0e14] text-neutral-100 font-sans">
      {/* 3-Zone Top Bar with Multi-Device Filter Switcher */}
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        connectedDevices={connectedDevices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={setSelectedDeviceId}
        isConnected={isConnected}
        eventCount={displayedEvents.length}
        totalEventCount={events.length}
        onClearEvents={handleClear}
        eventsByDevice={eventsByDevice}
      />

      {/* Main Viewport Content */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'tui' && (
          <TerminalTui
            events={displayedEvents}
            selectedId={selectedId}
            onSelectEvent={setSelectedId}
            onClear={handleClear}
            connectedDevices={connectedDevices}
            selectedDeviceId={selectedDeviceId}
            onSelectDeviceFilter={setSelectedDeviceId}
            totalEventCount={events.length}
          />
        )}

        {activeTab === 'scenarios' && (
          <RequestSimulator
            onEventTriggered={() => {
              // Optionally user can view dispatched requests in TUI
            }}
          />
        )}

        {activeTab === 'dispatcher' && (
          <CustomDispatcher
            onDispatched={(dispatchedId) => {
              if (dispatchedId) {
                setSelectedId(dispatchedId);
              }
              setActiveTab('tui');
            }}
          />
        )}

        {activeTab === 'devices' && (
          <DeviceManager
            currentDeviceInfo={deviceInfo}
            isSocketConnected={isConnected}
            onRefreshSocket={handleReconnectSocket}
            onSelectDeviceFilter={(devId) => {
              setSelectedDeviceId(devId);
              setActiveTab('tui');
            }}
          />
        )}
      </main>
    </div>
  );
}
