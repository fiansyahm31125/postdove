import { isWriteMethod, type OperationResult } from './OperationResultDialog';
import { executeDesktop } from '../main';
import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Folder,
  Loader2,
  Play,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import type {
  ApiEnvironment,
  ApiRequest,
  CollectionFolder,
  RunnerExecutionItem,
} from '../types/api';
import {
  evaluateAssertions,
  formatBytes,
  resolveRequestPayload,
} from '../utils/httpUtils';
import { folderAncestors } from '../utils/folderTree';
import { getStatusColorClasses, MethodBadge } from './MethodBadge';

interface TestRunnerViewProps {
  folders: CollectionFolder[];
  requests: ApiRequest[];
  activeEnv: ApiEnvironment | undefined;
  reportResult: (result: OperationResult) => void;
  onOpenRequest: (requestId: string) => void;
}

export function TestRunnerView({
  folders,
  requests,
  activeEnv,
  reportResult,
  onOpenRequest,
}: TestRunnerViewProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string>(folders[0]?.id || '');
  const [delayMs, setDelayMs] = useState<number>(100);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunnerExecutionItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [progressIndex, setProgressIndex] = useState<number>(0);

  const folderById = useMemo(() => new Map(folders.map(folder => [folder.id, folder])), [folders]);
  const requestsByFolder = useMemo(() => {
    const grouped = new Map<string, ApiRequest[]>();
    for (const request of requests) {
      const ids = [request.folderId, ...folderAncestors(request.folderId, folderById).map(folder => folder.id)];
      for (const id of ids) {
        const group = grouped.get(id) ?? [];
        group.push(request);
        grouped.set(id, group);
      }
    }
    return grouped;
  }, [folderById, requests]);
  const targetRequests = requestsByFolder.get(selectedFolderId) ?? [];

  const summary = useMemo(() => {
    const total = results.length;
    const passedAssertions = results.reduce((acc, r) => acc + r.passedCount, 0);
    const failedAssertions = results.reduce((acc, r) => acc + r.failedCount, 0);
    const totalLatency = results.reduce((acc, r) => acc + r.durationMs, 0);
    const avgLatency = total > 0 ? Math.round(totalLatency / total) : 0;
    return { total, passedAssertions, failedAssertions, avgLatency };
  }, [results]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRunCollection = async () => {
    if (running || targetRequests.length === 0) return;
    setRunning(true);
    setResults([]);
    setProgressIndex(0);
    setExpandedIds(new Set());

    const collected: RunnerExecutionItem[] = [];

    for (let i = 0; i < targetRequests.length; i++) {
      const req = targetRequests[i];
      setProgressIndex(i + 1);
      try {
        const resolved = resolveRequestPayload(req, activeEnv);
        const { ok, data } = await executeDesktop(resolved);

        if (!ok || data.error) {
          collected.push({
            requestId: req.id,
            requestName: req.name,
            method: req.method,
            resolvedUrl: resolved.url,
            status: null,
            statusText: 'Error',
            durationMs: data.durationMs || 0,
            sizeBytes: 0,
            passedCount: 0,
            failedCount: req.assertions.filter((a) => a.enabled).length || 1,
            assertionResults: [],
            error: data.error || 'Proxy execution failed',
          });
        } else {
          const assertionResults = evaluateAssertions(
            req.assertions,
            data.status,
            data.durationMs,
            data.headers || {},
            data.body || ''
          );
          const passedCount = assertionResults.filter((a) => a.passed).length;
          const failedCount = assertionResults.length - passedCount;
          collected.push({
            requestId: req.id,
            requestName: req.name,
            method: req.method,
            resolvedUrl: data.finalUrl || resolved.url,
            status: data.status,
            statusText: data.statusText || 'OK',
            durationMs: data.durationMs || 0,
            sizeBytes: data.sizeBytes || 0,
            passedCount,
            failedCount,
            assertionResults,
          });
        }
      } catch (err) {
        collected.push({
          requestId: req.id,
          requestName: req.name,
          method: req.method,
          resolvedUrl: req.url,
          status: null,
          statusText: 'Network Error',
          durationMs: 0,
          sizeBytes: 0,
          passedCount: 0,
          failedCount: 1,
          assertionResults: [],
          error: err instanceof Error ? err.message : 'Network failure',
        });
      }

      setResults([...collected]);

      if (delayMs > 0 && i < targetRequests.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    setRunning(false);
    const writes = collected.filter(result => isWriteMethod(result.method));
    if (writes.length) {
      const succeeded = (result: RunnerExecutionItem) => !result.error && result.status !== null
        && result.status >= 200 && result.status < 300;
      reportResult({
        action: 'Run collection · write requests',
        ok: writes.every(succeeded),
        detail: writes.map(result => {
          const status = result.status === null ? result.error ?? 'No HTTP response' : `${result.status} ${result.statusText}`;
          return `${succeeded(result) ? 'Success' : 'Failed'} · ${result.method} ${result.requestName} · ${status}`;
        }).join('\n'),
      });
    }
  };

  const handleExportReport = () => {
    const folder = folders.find((f) => f.id === selectedFolderId);
    const payload = {
      collection: folder?.name || selectedFolderId,
      environment: activeEnv?.name || 'None',
      executedAt: new Date().toISOString(),
      summary,
      results,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-run-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full min-h-0 bg-ui-canvas">
      {/* Left Configuration Panel */}
      <aside className="w-[290px] bg-ui-surface border-r border-ui-border flex flex-col shrink-0">
        <div className="px-3.5 h-[42px] flex items-center border-b border-ui-border">
          <h2 className="text-[13px] font-semibold text-ui-ink">Collection Runner</h2>
        </div>

        <div className="p-3.5 space-y-4 flex-1 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-ui-secondary">
              Collection or folder
            </label>
            <div className="space-y-1.5">
              {folders.map((f) => {
                const count = requestsByFolder.get(f.id)?.length ?? 0;
                const active = f.id === selectedFolderId;
                const path = [...folderAncestors(f.id, folderById), f].map(folder => folder.name).join(' / ');
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setSelectedFolderId(f.id);
                      setResults([]);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-[6px] border text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-ui-elevated border-ui-accent/70 text-ui-ink'
                        : 'bg-ui-canvas border-ui-border text-ui-secondary hover:text-ui-ink hover:bg-ui-elevated/60'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <Folder className="w-3.5 h-3.5 shrink-0 text-ui-secondary" />
                      <span title={path} className="text-[12px] font-medium truncate">{path}</span>
                    </span>
                    <span className="font-mono text-[11px] text-ui-muted tabular-nums shrink-0">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-ui-secondary">
              Inter-Request Delay (ms)
            </label>
            <input
              type="number"
              min={0}
              max={5000}
              step={50}
              value={delayMs}
              onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
              className="w-full h-[32px] px-2.5 bg-ui-canvas border border-ui-border rounded-[4px] font-mono text-[12px] text-ui-ink tabular-nums focus:outline-none focus:border-ui-accent"
            />
          </div>

          <div className="p-3 rounded-[8px] bg-ui-canvas border border-ui-border space-y-1">
            <div className="text-[11px] font-semibold text-ui-secondary">Active Environment</div>
            <div className="text-[12px] font-medium text-ui-ink">
              {activeEnv?.name || 'None'}
            </div>
            <div className="text-[11px] text-ui-muted">
              {targetRequests.length} endpoints queued with{' '}
              {targetRequests.reduce(
                (acc, r) => acc + r.assertions.filter((a) => a.enabled).length,
                0
              )}{' '}
              assertions
            </div>
          </div>

          <button
            type="button"
            disabled={running || targetRequests.length === 0}
            onClick={handleRunCollection}
            className="w-full h-[34px] inline-flex items-center justify-center gap-2 bg-ui-accent hover:bg-ui-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-[4px] transition-colors cursor-pointer"
          >
            {running ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Running ({progressIndex}/{targetRequests.length})...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                Run Collection
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Right Execution Results */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Top Action Bar */}
        <div className="flex items-center justify-between px-5 h-[42px] bg-ui-surface border-b border-ui-border shrink-0">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="font-semibold text-ui-ink">Execution Report</span>
            <span className="text-ui-muted">·</span>
            <span className="text-ui-secondary">
              {folders.find((f) => f.id === selectedFolderId)?.name}
            </span>
          </div>
          {results.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setResults([])}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-ui-elevated hover:bg-ui-hover border border-ui-border rounded-[4px] text-[11px] font-medium text-ui-secondary hover:text-ui-ink cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
              <button
                type="button"
                onClick={handleExportReport}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-ui-elevated hover:bg-ui-hover border border-ui-border rounded-[4px] text-[11px] font-medium text-ui-ink cursor-pointer"
              >
                <Download className="w-3 h-3" />
                Export JSON
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3 rounded-[8px] bg-ui-surface border border-ui-border">
              <div className="text-[11px] font-medium text-ui-secondary">Endpoints Executed</div>
              <div className="mt-1 font-mono text-[20px] font-semibold text-ui-ink tabular-nums">
                {summary.total}
                <span className="text-[12px] text-ui-muted font-normal">
                  {' '}
                  / {targetRequests.length}
                </span>
              </div>
            </div>
            <div className="p-3 rounded-[8px] bg-ui-surface border border-ui-border">
              <div className="text-[11px] font-medium text-ui-secondary">Assertions Passed</div>
              <div className="mt-1 font-mono text-[20px] font-semibold text-ui-green tabular-nums">
                {summary.passedAssertions}
              </div>
            </div>
            <div className="p-3 rounded-[8px] bg-ui-surface border border-ui-border">
              <div className="text-[11px] font-medium text-ui-secondary">Assertions Failed</div>
              <div
                className={`mt-1 font-mono text-[20px] font-semibold tabular-nums ${
                  summary.failedAssertions > 0 ? 'text-ui-danger' : 'text-ui-secondary'
                }`}
              >
                {summary.failedAssertions}
              </div>
            </div>
            <div className="p-3 rounded-[8px] bg-ui-surface border border-ui-border">
              <div className="text-[11px] font-medium text-ui-secondary">Avg Response Time</div>
              <div className="mt-1 font-mono text-[20px] font-semibold text-ui-ink tabular-nums">
                {summary.avgLatency} <span className="text-[12px] text-ui-muted font-normal">ms</span>
              </div>
            </div>
          </div>

          {/* Progress bar when running */}
          {running && (
            <div className="w-full h-1 bg-ui-elevated rounded-full overflow-hidden">
              <div
                className="h-full bg-ui-accent transition-all duration-150"
                style={{
                  width: `${Math.round((progressIndex / Math.max(1, targetRequests.length)) * 100)}%`,
                }}
              />
            </div>
          )}

          {/* Results List */}
          {results.length === 0 && !running ? (
            <div className="p-10 rounded-[8px] border border-dashed border-ui-border bg-ui-surface/40 text-center space-y-2">
              <p className="text-[13px] font-semibold text-ui-ink">
                Ready to execute {targetRequests.length} endpoints
              </p>
              <p className="text-[12px] text-ui-secondary max-w-md mx-auto">
                Each endpoint in the selected collection will run sequentially against{' '}
                <span className="font-mono text-ui-ink">{activeEnv?.name}</span> and verify all configured status, latency, header, and JSONPath assertions.
              </p>
            </div>
          ) : (
            <div className="border border-ui-border rounded-[6px] overflow-hidden bg-ui-surface">
              {results.map((item) => {
                const isExpanded = expandedIds.has(item.requestId);
                const statusStyle = item.status
                  ? getStatusColorClasses(item.status)
                  : { text: 'text-ui-danger', bg: 'bg-ui-danger/12' };
                const allPassed = item.failedCount === 0 && !item.error;
                return (
                  <div
                    key={item.requestId}
                    className="border-b last:border-b-0 border-ui-border"
                  >
                    <div
                      onClick={() => toggleExpand(item.requestId)}
                      className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-ui-elevated cursor-pointer transition-colors"
                    >
                      <span className="text-ui-muted shrink-0">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </span>
                      {allPassed ? (
                        <CheckCircle2 className="w-4 h-4 text-ui-green shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-ui-danger shrink-0" />
                      )}
                      <MethodBadge method={item.method} compact />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-ui-ink truncate">
                          {item.requestName}
                        </div>
                        <div className="font-mono text-[11px] text-ui-muted truncate">
                          {item.resolvedUrl}
                        </div>
                      </div>
                      <span
                        className={`font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded-[4px] tabular-nums shrink-0 ${statusStyle.bg} ${statusStyle.text}`}
                      >
                        {item.status ? `${item.status} ${item.statusText}` : item.statusText}
                      </span>
                      <span className="font-mono text-[11px] text-ui-secondary tabular-nums w-[62px] text-right shrink-0">
                        {item.durationMs} ms
                      </span>
                      <span className="font-mono text-[11px] text-ui-muted tabular-nums w-[68px] text-right shrink-0">
                        {formatBytes(item.sizeBytes)}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums w-[54px] text-right shrink-0">
                        <span className="text-ui-green">{item.passedCount}</span>
                        <span className="text-ui-muted">/</span>
                        <span className={item.failedCount > 0 ? 'text-ui-danger' : 'text-ui-secondary'}>
                          {item.passedCount + item.failedCount}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenRequest(item.requestId);
                        }}
                        title="Open in Workbench"
                        className="p-1 rounded-[4px] text-ui-muted hover:text-ui-ink hover:bg-ui-border cursor-pointer shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="px-10 py-2.5 bg-ui-canvas border-t border-ui-border space-y-1.5">
                        {item.error && (
                          <div className="font-mono text-[12px] text-ui-danger">{item.error}</div>
                        )}
                        {item.assertionResults.length === 0 && !item.error && (
                          <div className="text-[12px] text-ui-muted">
                            No assertions configured for this endpoint.
                          </div>
                        )}
                        {item.assertionResults.map((asr) => (
                          <div
                            key={asr.ruleId}
                            className="flex items-center justify-between gap-3 py-1 text-[12px]"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {asr.passed ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-ui-green shrink-0" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-ui-danger shrink-0" />
                              )}
                              <span className="text-ui-ink truncate">{asr.label}</span>
                            </div>
                            <span className="font-mono text-[11px] text-ui-secondary shrink-0">
                              Actual:{' '}
                              <span className={asr.passed ? 'text-ui-green' : 'text-ui-danger'}>
                                {asr.actual}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
