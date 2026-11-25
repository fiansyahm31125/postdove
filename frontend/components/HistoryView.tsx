import { useMemo, useState } from 'react';
import { Clock, ExternalLink, Search, Trash2 } from 'lucide-react';
import type { HistoryEntry, HttpMethod } from '../types/api';
import { formatBytes } from '../utils/httpUtils';
import { getStatusColorClasses, MethodBadge } from './MethodBadge';
import { JsonViewer } from './JsonViewer';

interface HistoryViewProps {
  history: HistoryEntry[];
  onClearHistory: () => void;
  onOpenRequest: (requestId: string) => void;
}

export function HistoryView({ history, onClearHistory, onOpenRequest }: HistoryViewProps) {
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<'ALL' | HttpMethod>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | '2xx' | '4xx' | '5xx'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(history[0]?.id || null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter((item) => {
      if (methodFilter !== 'ALL' && item.method !== methodFilter) return false;
      if (statusFilter === '2xx' && (item.response.status < 200 || item.response.status >= 300))
        return false;
      if (statusFilter === '4xx' && (item.response.status < 400 || item.response.status >= 500))
        return false;
      if (statusFilter === '5xx' && item.response.status < 500 && !item.response.error)
        return false;
      if (!q) return true;
      return (
        item.requestName.toLowerCase().includes(q) ||
        item.resolvedUrl.toLowerCase().includes(q) ||
        String(item.response.status).includes(q)
      );
    });
  }, [history, search, methodFilter, statusFilter]);

  const selectedEntry =
    filtered.find((h) => h.id === selectedId) || filtered[0] || null;

  return (
    <div className="flex h-full min-h-0 bg-ui-canvas">
      {/* Left History Feed */}
      <aside className="w-[340px] bg-ui-surface border-r border-ui-border flex flex-col shrink-0">
        <div className="flex items-center justify-between px-3.5 h-[42px] border-b border-ui-border shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold text-ui-ink">Execution History</h2>
            <span className="font-mono text-[11px] text-ui-muted tabular-nums">
              ({history.length})
            </span>
          </div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-ui-secondary hover:text-ui-danger bg-ui-elevated border border-ui-border rounded-[4px] cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="p-2.5 border-b border-ui-border space-y-2 shrink-0">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-ui-muted absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search URL, name, or status..."
              className="w-full h-[28px] pl-8 pr-2.5 bg-ui-canvas border border-ui-border rounded-[4px] text-[12px] text-ui-ink placeholder-ui-muted focus:outline-none focus:border-ui-accent"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as 'ALL' | HttpMethod)}
              className="flex-1 h-[26px] px-2 bg-ui-canvas border border-ui-border rounded-[4px] font-mono text-[11px] text-ui-ink focus:outline-none focus:border-ui-accent"
            >
              <option value="ALL">All Methods</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | '2xx' | '4xx' | '5xx')}
              className="flex-1 h-[26px] px-2 bg-ui-canvas border border-ui-border rounded-[4px] font-mono text-[11px] text-ui-ink focus:outline-none focus:border-ui-accent"
            >
              <option value="ALL">All Statuses</option>
              <option value="2xx">2xx Success</option>
              <option value="4xx">4xx Client Err</option>
              <option value="5xx">5xx / Net Err</option>
            </select>
          </div>
        </div>

        {/* Feed Rows */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center space-y-1.5">
              <Clock className="w-5 h-5 text-ui-muted mx-auto" />
              <p className="text-[12px] font-medium text-ui-secondary">No execution logs yet</p>
              <p className="text-[11px] text-ui-muted">
                Send requests from the Workbench to capture full payload snapshots here.
              </p>
            </div>
          ) : (
            filtered.map((item) => {
              const isSelected = selectedEntry?.id === item.id;
              const statusStyle = item.response.error
                ? { text: 'text-ui-danger', bg: 'bg-ui-danger/12' }
                : getStatusColorClasses(item.response.status);
              const timeStr = new Date(item.response.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`relative px-3 py-2.5 border-b border-ui-border cursor-pointer transition-colors ${
                    isSelected ? 'bg-ui-elevated' : 'hover:bg-ui-elevated/50'
                  }`}
                >
                  {isSelected && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-0 bottom-0 w-[2px] bg-ui-accent"
                    />
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <MethodBadge method={item.method} compact />
                      <span className="text-[12px] font-medium text-ui-ink truncate">
                        {item.requestName}
                      </span>
                    </div>
                    <span
                      className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-[4px] tabular-nums shrink-0 ${statusStyle.bg} ${statusStyle.text}`}
                    >
                      {item.response.error ? 'ERR' : item.response.status}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-ui-secondary truncate">
                    {item.resolvedUrl}
                  </div>
                  <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-ui-muted tabular-nums">
                    <span>{timeStr}</span>
                    <span>
                      {item.response.durationMs} ms · {formatBytes(item.response.sizeBytes)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Right Payload Inspector */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-ui-canvas">
        {selectedEntry ? (
          <>
            <div className="flex items-center justify-between gap-3 px-5 py-3 bg-ui-surface border-b border-ui-border shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <MethodBadge method={selectedEntry.method} />
                  <span className="font-mono text-[13px] text-ui-ink truncate">
                    {selectedEntry.resolvedUrl}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-ui-secondary font-mono tabular-nums">
                  <span>Env: {selectedEntry.environmentName}</span>
                  <span>·</span>
                  <span>
                    Status: {selectedEntry.response.status} {selectedEntry.response.statusText}
                  </span>
                  <span>·</span>
                  <span>Latency: {selectedEntry.response.durationMs} ms</span>
                  <span>·</span>
                  <span>Size: {formatBytes(selectedEntry.response.sizeBytes)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenRequest(selectedEntry.requestId)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ui-elevated hover:bg-ui-hover border border-ui-border rounded-[4px] text-[12px] font-medium text-ui-ink cursor-pointer whitespace-nowrap shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open in Workbench
              </button>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-ui-border overflow-hidden">
              {/* Historical Request Snapshot */}
              <div className="flex flex-col min-h-0 overflow-hidden bg-ui-surface">
                <div className="px-3.5 py-2 border-b border-ui-border text-[11px] font-semibold text-ui-secondary bg-ui-elevated">
                  Request Snapshot
                </div>
                <div className="flex-1 overflow-auto p-3.5 space-y-4">
                  <div>
                    <h4 className="text-[11px] font-semibold text-ui-secondary mb-1.5">
                      Headers Sent ({Object.keys(selectedEntry.requestHeaders).length})
                    </h4>
                    <div className="border border-ui-border rounded-[4px] bg-ui-canvas divide-y divide-ui-border font-mono text-[12px]">
                      {Object.keys(selectedEntry.requestHeaders).length === 0 ? (
                        <div className="px-3 py-2 text-ui-muted">No headers sent</div>
                      ) : (
                        Object.entries(selectedEntry.requestHeaders).map(([k, v]) => (
                          <div key={k} className="px-3 py-1.5 flex gap-2">
                            <span className="text-ui-key shrink-0">{k}:</span>
                            <span className="text-ui-ink break-all">{v}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[11px] font-semibold text-ui-secondary mb-1.5">
                      Request Body
                    </h4>
                    {selectedEntry.requestBody ? (
                      <div className="border border-ui-border rounded-[4px] overflow-hidden">
                        <JsonViewer
                          body={selectedEntry.requestBody}
                          viewMode="pretty"
                          wrapLines={true}
                          searchQuery=""
                        />
                      </div>
                    ) : (
                      <div className="px-3 py-3 rounded-[4px] border border-ui-border bg-ui-canvas text-[12px] text-ui-muted">
                        Empty request body
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Historical Response Snapshot */}
              <div className="flex flex-col min-h-0 overflow-hidden bg-ui-surface">
                <div className="px-3.5 py-2 border-b border-ui-border text-[11px] font-semibold text-ui-secondary bg-ui-elevated">
                  Response Body
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  {selectedEntry.response.error ? (
                    <div className="p-4 font-mono text-[12px] text-ui-danger">
                      {selectedEntry.response.error}
                    </div>
                  ) : (
                    <JsonViewer
                      body={selectedEntry.response.body}
                      viewMode="pretty"
                      wrapLines={false}
                      searchQuery=""
                    />
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[12px] text-ui-muted">
            Select an execution record from the left to inspect its payload.
          </div>
        )}
      </main>
    </div>
  );
}
