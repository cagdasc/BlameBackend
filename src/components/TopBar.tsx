import React, { useState, useRef, useEffect } from 'react';
import { Smartphone, Monitor, Trash2, Terminal, ChevronDown, Check, Layers, Settings2 } from 'lucide-react';
import { DeviceInfo } from '../types/inspector';

interface TopBarProps {
  activeTab: 'tui' | 'scenarios' | 'dispatcher' | 'devices';
  onSelectTab: (tab: 'tui' | 'scenarios' | 'dispatcher' | 'devices') => void;
  connectedDevices: DeviceInfo[];
  selectedDeviceId: string;
  onSelectDevice: (deviceId: string) => void;
  isConnected: boolean;
  eventCount: number;
  totalEventCount: number;
  onClearEvents: () => void;
  eventsByDevice: Record<string, number>;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  connectedDevices,
  selectedDeviceId,
  onSelectDevice,
  isConnected,
  eventCount,
  totalEventCount,
  onClearEvents,
  eventsByDevice,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  const selectedDevice = connectedDevices.find(d => d.id === selectedDeviceId);

  const getDeviceIcon = (dev?: DeviceInfo) => {
    if (!dev) return <Layers className="w-3.5 h-3.5 text-cyan-400" />;
    const os = (dev.osVersion || '').toLowerCase();
    const name = (dev.deviceName || '').toLowerCase();
    if (os.includes('mac') || os.includes('linux') || os.includes('win') || name.includes('desktop') || name.includes('jvm')) {
      return <Monitor className="w-3.5 h-3.5 text-cyan-400" />;
    }
    return <Smartphone className="w-3.5 h-3.5 text-cyan-400" />;
  };

  const getButtonLabel = () => {
    if (!isConnected || connectedDevices.length === 0) {
      return 'Waiting for device...';
    }
    if (selectedDeviceId === 'all') {
      return connectedDevices.length > 1
        ? `All Platforms (${connectedDevices.length})`
        : connectedDevices[0]?.deviceName || 'All Devices';
    }
    return selectedDevice?.deviceName || 'Selected Device';
  };

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-neutral-800 bg-[#0e1117] select-none relative z-50">
      {/* Zone 1: Single text element wordmark */}
      <div className="flex items-center gap-3">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('tui');
          }}
          className="text-base font-semibold tracking-tight text-neutral-100 hover:text-cyan-400 transition-colors flex items-center gap-2"
        >
          <Terminal className="w-5 h-5 text-cyan-400" />
          <span>BlameBackend</span>
        </a>
      </div>

      {/* Zone 2: Clean text navigation links */}
      <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
        <button
          onClick={() => onSelectTab('tui')}
          className={`transition-colors pb-0.5 ${
            activeTab === 'tui'
              ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          TUI Console
        </button>

        <button
          onClick={() => onSelectTab('scenarios')}
          className={`transition-colors pb-0.5 ${
            activeTab === 'scenarios'
              ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Test Scenarios
        </button>

        <button
          onClick={() => onSelectTab('dispatcher')}
          className={`transition-colors pb-0.5 ${
            activeTab === 'dispatcher'
              ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Dispatcher
        </button>

        <button
          onClick={() => onSelectTab('devices')}
          className={`transition-colors pb-0.5 flex items-center gap-1.5 ${
            activeTab === 'devices'
              ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>Devices</span>
          {connectedDevices.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 bg-cyan-950 text-cyan-300 rounded-full border border-cyan-800">
              {connectedDevices.length}
            </span>
          )}
        </button>
      </nav>

      {/* Zone 3: Device Selector Dropdown & Actions */}
      <div className="flex items-center gap-3">
        {/* Device Switcher Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => {
              if (connectedDevices.length === 0) {
                onSelectTab('devices');
              } else {
                setIsDropdownOpen(prev => !prev);
              }
            }}
            title="Switch inspecting device or manage connections"
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono transition-colors border ${
              isConnected
                ? 'bg-neutral-900 border-emerald-900/70 text-emerald-300 hover:border-emerald-600'
                : 'bg-neutral-900 border-amber-900/60 text-amber-400 hover:border-amber-700'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
              }`}
            />
            {getDeviceIcon(selectedDevice)}
            <span className="max-w-[140px] sm:max-w-[190px] truncate">
              {getButtonLabel()}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown Menu */}
          {isDropdownOpen && (
            <div className="absolute right-0 mt-2 w-72 bg-[#0d1017] border border-neutral-800 rounded-lg shadow-2xl p-1.5 text-xs font-sans animate-in fade-in zoom-in-95 duration-150 z-50">
              <div className="px-3 py-2 text-[11px] font-semibold text-neutral-400 border-b border-neutral-800/80 flex items-center justify-between">
                <span>FILTER TRAFFIC BY DEVICE</span>
                <span className="font-mono text-cyan-400 text-[10px]">
                  {connectedDevices.length} connected
                </span>
              </div>

              <div className="py-1 space-y-0.5">
                {/* Option: All Devices */}
                <button
                  onClick={() => {
                    onSelectDevice('all');
                    setIsDropdownOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded text-left transition-colors ${
                    selectedDeviceId === 'all'
                      ? 'bg-neutral-800/90 text-cyan-300 font-medium'
                      : 'text-neutral-300 hover:bg-neutral-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div className="truncate">
                      <div className="font-semibold text-neutral-100">All Platforms</div>
                      <div className="text-[10px] text-neutral-500">Collect events from all devices</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-mono text-neutral-400">
                      {totalEventCount}
                    </span>
                    {selectedDeviceId === 'all' && (
                      <Check className="w-4 h-4 text-cyan-400" />
                    )}
                  </div>
                </button>

                <div className="my-1 border-t border-neutral-800/60" />

                {/* Individual Device Options */}
                {connectedDevices.map((dev) => {
                  const isCurSelected = selectedDeviceId === dev.id;
                  const devCount = (dev.id && eventsByDevice[dev.id]) || 0;

                  return (
                    <button
                      key={dev.id}
                      onClick={() => {
                        if (dev.id) {
                          onSelectDevice(dev.id);
                        }
                        setIsDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded text-left transition-colors ${
                        isCurSelected
                          ? 'bg-neutral-800/90 text-cyan-300 font-medium'
                          : 'text-neutral-300 hover:bg-neutral-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {getDeviceIcon(dev)}
                        <div className="truncate">
                          <div className="font-semibold text-neutral-100 truncate">
                            {dev.deviceName}
                          </div>
                          <div className="text-[10px] text-neutral-500 truncate font-mono">
                            {dev.appName} {dev.osVersion ? `· ${dev.osVersion}` : ''}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-mono text-neutral-400">
                          {devCount}
                        </span>
                        {isCurSelected && (
                          <Check className="w-4 h-4 text-cyan-400" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Footer link to manage devices */}
              <div className="pt-1 mt-1 border-t border-neutral-800/80">
                <button
                  onClick={() => {
                    setIsDropdownOpen(false);
                    onSelectTab('devices');
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-neutral-400 hover:text-cyan-300 hover:bg-neutral-800/40 rounded transition-colors"
                >
                  <Settings2 className="w-3.5 h-3.5 text-neutral-500" />
                  <span>Manage ADB rules &amp; Port Settings</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Clear captured events button */}
        <button
          onClick={onClearEvents}
          title="Clear current event buffer"
          disabled={eventCount === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-300 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 disabled:hover:bg-neutral-800 rounded border border-neutral-700 transition-colors whitespace-nowrap"
        >
          <Trash2 className="w-3.5 h-3.5 text-neutral-400" />
          <span>Clear</span>
          <span className="font-mono text-neutral-400 tabular-nums">
            ({eventCount}{selectedDeviceId !== 'all' && totalEventCount !== eventCount ? ` / ${totalEventCount}` : ''})
          </span>
        </button>
      </div>
    </header>
  );
};

