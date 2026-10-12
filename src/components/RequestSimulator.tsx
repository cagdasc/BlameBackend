import React, { useState } from 'react';
import { simulator } from '../engine/mockClient';
import {
  Play,
  ShieldCheck,
  Clock,
  AlertTriangle,
  FileCode,
  Image as ImageIcon,
  Layers,
  Sparkles,
  CheckCircle2
} from 'lucide-react';

interface RequestSimulatorProps {
  onEventTriggered: () => void;
}

export const RequestSimulator: React.FC<RequestSimulatorProps> = ({ onEventTriggered }) => {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [lastExecuted, setLastExecuted] = useState<string | null>(null);

  const runScenario = async (name: string, action: () => Promise<any>) => {
    setRunningId(name);
    try {
      await action();
      setLastExecuted(name);
      onEventTriggered();
    } finally {
      setRunningId(null);
    }
  };

  const runAllScenarios = async () => {
    setRunningId('all');
    try {
      await simulator.triggerOkHttpUserList();
      await simulator.triggerOkHttpPayment();
      await simulator.triggerKtorNotFound();
      await simulator.triggerOkHttpBinary();
      await simulator.triggerKtorSlow();
      await simulator.triggerOkHttpDnsFailure();
      await simulator.triggerKtorLargeResponse();
      await simulator.triggerConcurrentBatch();
      setLastExecuted('all');
      onEventTriggered();
    } finally {
      setRunningId(null);
    }
  };

  const scenarios = [
    {
      id: 'okhttp-get-users',
      title: 'OkHttp: GET Users List',
      client: 'OkHttp 4.12',
      method: 'GET',
      url: 'https://api.example.com/v1/users?page=1&limit=5',
      badge: 'Normal 200 OK',
      description: 'Standard JSON response with pagination metadata and HTTP/2 protocol observation.',
      icon: Play,
      action: () => simulator.triggerOkHttpUserList()
    },
    {
      id: 'okhttp-post-redact',
      title: 'OkHttp: POST Payment & Header Redaction',
      client: 'OkHttp 4.12',
      method: 'POST',
      url: 'https://api.example.com/v1/payments/charges',
      badge: 'Security / Redaction',
      description: 'Tests deterministic redaction of Authorization, X-API-Key, and Cookie headers to <redacted>.',
      icon: ShieldCheck,
      action: () => simulator.triggerOkHttpPayment()
    },
    {
      id: 'ktor-404-not-found',
      title: 'Ktor: GET Profile (404 Not Found)',
      client: 'Ktor Client 3.0',
      method: 'GET',
      url: 'https://api.example.com/v1/profile/usr_unknown_884',
      badge: 'Client Error 404',
      description: 'Native Ktor plugin capturing structured 404 Not Found error payload and status.',
      icon: AlertTriangle,
      action: () => simulator.triggerKtorNotFound()
    },
    {
      id: 'ktor-slow-flight',
      title: 'Ktor: POST Analytics (1.5s In-Flight)',
      client: 'Ktor Client 3.0',
      method: 'POST',
      url: 'https://api.example.com/v1/analytics/heavy-aggregation',
      badge: 'Slow / In-Flight',
      description: 'Emits request immediately as pending, tests asynchronous response resolution via UUID.',
      icon: Clock,
      action: () => simulator.triggerKtorSlow()
    },
    {
      id: 'okhttp-dns-error',
      title: 'OkHttp: UnknownHostException DNS Error',
      client: 'OkHttp 4.12',
      method: 'GET',
      url: 'https://nonexistent.telemetry-backend.internal/v2/events',
      badge: 'Network Exception',
      description: 'Captures Java network exception & stack trace without swallowing or crashing the host app.',
      icon: AlertTriangle,
      action: () => simulator.triggerOkHttpDnsFailure()
    },
    {
      id: 'okhttp-binary-png',
      title: 'OkHttp: Binary Image Content (avatar.png)',
      client: 'OkHttp 4.12',
      method: 'GET',
      url: 'https://cdn.example.com/assets/avatar-user-42.png',
      badge: 'Safe Binary Handling',
      description: 'Safely buffers image/png payload without garbling terminal output, displays hex dump preview.',
      icon: ImageIcon,
      action: () => simulator.triggerOkHttpBinary()
    },
    {
      id: 'ktor-large-truncated',
      title: 'Ktor: Large Audit Logs (>64KB Truncation)',
      client: 'Ktor Client 3.0',
      method: 'GET',
      url: 'https://api.example.com/v1/export/audit-logs',
      badge: 'Memory Safety',
      description: 'Exceeds maxBodySizeBytes. Bounded memory buffers truncate payload and flag truncated: true.',
      icon: FileCode,
      action: () => simulator.triggerKtorLargeResponse()
    },
    {
      id: 'concurrent-batch',
      title: 'Batch: 5 Concurrent Out-of-Order Requests',
      client: 'Mixed (OkHttp + Ktor)',
      method: 'CONCURRENT',
      url: 'Dispatches 5 parallel HTTP calls with varied latencies (60ms - 380ms)',
      badge: 'Concurrency & Correlated IDs',
      description: 'Verifies requests arrive and resolve out-of-order without cross-talk or race conditions.',
      icon: Layers,
      action: () => simulator.triggerConcurrentBatch()
    }
  ];

  return (
    <div className="flex flex-col h-full bg-[#0a0c10] text-neutral-200 overflow-y-auto p-6 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-800">
        <div>
          <h2 className="text-lg font-bold text-neutral-100 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <span>Kotlin Multiplatform Test Scenarios &amp; Interactive Simulation</span>
          </h2>
          <p className="text-neutral-400 text-xs mt-1">
            Simulate realistic network traffic from Kotlin Multiplatform (Ktor &amp; OkHttp across Android, iOS, Desktop) to verify all inspector requirements.
          </p>
        </div>

        <button
          onClick={runAllScenarios}
          disabled={runningId !== null}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold rounded text-xs transition-colors flex items-center gap-2 shrink-0 shadow-lg shadow-cyan-950/40"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{runningId === 'all' ? 'Simulating All...' : 'Run All Scenarios'}</span>
        </button>
      </div>

      {/* Scenario Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scenarios.map((sc) => {
          const isRunning = runningId === sc.id;
          const isJustExecuted = lastExecuted === sc.id;

          return (
            <div
              key={sc.id}
              className="bg-[#0e121a] border border-neutral-800 hover:border-neutral-700 rounded p-4 flex flex-col justify-between transition-colors space-y-3"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-neutral-300">{sc.title}</span>
                  </div>
                  <span className="text-[11px] text-neutral-500 font-mono">
                    {sc.client}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[11px] font-mono">
                  <span
                    className={
                      sc.method === 'GET'
                        ? 'text-cyan-400 font-semibold'
                        : sc.method === 'POST'
                        ? 'text-emerald-400 font-semibold'
                        : sc.method === 'CONCURRENT'
                        ? 'text-purple-400 font-semibold'
                        : 'text-amber-400 font-semibold'
                    }
                  >
                    {sc.method}
                  </span>
                  <span className="text-neutral-400 truncate">{sc.url}</span>
                </div>

                <p className="text-neutral-400 text-xs leading-relaxed">
                  {sc.description}
                </p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-neutral-800/80">
                <span className="text-[11px] text-neutral-400 font-mono">
                  {sc.badge}
                </span>

                <button
                  onClick={() => runScenario(sc.id, sc.action)}
                  disabled={runningId !== null}
                  className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-neutral-200 rounded text-xs transition-colors flex items-center gap-1.5 font-medium border border-neutral-700"
                >
                  {isRunning ? (
                    <>
                      <span className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                      <span>Sending...</span>
                    </>
                  ) : isJustExecuted ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Sent!</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3 text-cyan-400 fill-cyan-400" />
                      <span>Trigger Call</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
