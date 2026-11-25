import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  Search,
  Send,
  WrapText,
  X,
  XCircle,
} from 'lucide-react';
import type { ApiResponse } from '../types/api';
import { formatBytes } from '../utils/httpUtils';
import { getStatusColorClasses } from './MethodBadge';
import { JsonViewer } from './JsonViewer';

type ResponseTab = 'body' | 'headers' | 'cookies' | 'tests';

interface ResponsePaneProps {
  response: ApiResponse | null;
  loading: boolean;
  onSend: () => void;
  onCancel?: () => void;
}

export function ResponsePane({ response, loading, onSend, onCancel }: ResponsePaneProps) {
  const [activeTab, setActiveTab] = useState<ResponseTab>('body');
  const [bodyMode, setBodyMode] = useState<'pretty' | 'tree' | 'raw'>('pretty');
  const [wrapLines, setWrapLines] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [copied, setCopied] = useState(false);

  const headerEntries = useMemo(() => {
    if (!response) return [];
    return Object.entries(response.headers);
  }, [response]);

  const passedCount = useMemo(
    () => (response ? response.assertionResults.filter((a) => a.passed).length : 0),
    [response]
  );

  const totalAssertions = response?.assertionResults.length ?? 0;

  const handleCopyBody = () => {
    if (!response) return;
    navigator.clipboard.writeText(response.body).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleDownload = () => {
    if (!response) return;
    const blob = new Blob([response.body], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `response-${response.status}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <section className="flex flex-col items-center justify-center h-full bg-ui-surface gap-3 p-6">
        <Loader2 className="w-6 h-6 text-ui-accent animate-spin" />
        <div className="text-center">
          <p className="text-[13px] font-medium text-ui-ink">Executing HTTP request...</p>
          <p className="text-[12px] text-ui-muted mt-0.5">
            Awaiting upstream response and timing metrics
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="mt-1 px-3 py-1.5 text-[12px] font-medium text-ui-ink bg-ui-elevated hover:bg-ui-hover border border-ui-border rounded-[4px] cursor-pointer"
          >
            Cancel Request
          </button>
        )}
      </section>
    );
  }

  if (!response) {
    return (
      <section className="flex flex-col items-center justify-center h-full bg-ui-surface p-6 text-center">
        <div className="w-10 h-10 rounded-[8px] bg-ui-elevated border border-ui-border flex items-center justify-center mb-3">
          <Send className="w-4 h-4 text-ui-secondary" />
        </div>
        <h3 className="text-[14px] font-semibold text-ui-ink">Ready to inspect response</h3>
        <p className="text-[12px] text-ui-secondary mt-1 max-w-[300px]">
          Configure your endpoint parameters above and send the request to inspect JSON payloads, headers, cookies, and assertions.
        </p>
        <button
          type="button"
          onClick={onSend}
          className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-ui-accent hover:bg-ui-accent-hover text-white text-[12px] font-semibold rounded-[4px] transition-colors cursor-pointer"
        >
          Send Request
          <span className="font-mono text-[10px] opacity-85 ml-1">⌘↵</span>
        </button>
      </section>
    );
  }

  if (response.error) {
    return (
      <section className="flex flex-col h-full bg-ui-surface">
        <div className="flex items-center justify-between px-3 h-[36px] border-b border-ui-border shrink-0">
          <span className="text-[12px] font-semibold text-ui-danger inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Request Failed
          </span>
          <span className="font-mono text-[12px] text-ui-secondary tabular-nums">
            {response.durationMs} ms
          </span>
        </div>
        <div className="p-4">
          <div className="p-3 rounded-[8px] bg-ui-canvas border border-ui-danger/40 space-y-1.5">
            <p className="text-[12px] font-semibold text-ui-danger">Network / Proxy Error</p>
            <p className="font-mono text-[12px] text-ui-ink break-all">{response.error}</p>
            <p className="text-[11px] text-ui-muted pt-1">
              Target URL: <span className="font-mono text-ui-secondary">{response.finalUrl}</span>
            </p>
          </div>
        </div>
      </section>
    );
  }

  const statusColors = getStatusColorClasses(response.status);

  return (
    <section className="flex flex-col h-full min-h-0 bg-ui-surface">
      {/* Telemetry + Tabs Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-1.5 border-b border-ui-border bg-ui-surface shrink-0">
        <div className="flex items-center gap-0.5">
          {(
            [
              { id: 'body', label: 'Body' },
              { id: 'headers', label: 'Headers', count: headerEntries.length },
              { id: 'cookies', label: 'Cookies', count: response.cookies.length },
              { id: 'tests', label: 'Test Results', count: totalAssertions },
            ] as Array<{ id: ResponseTab; label: string; count?: number }>
          ).map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-t-[4px] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-ui-elevated text-ui-ink border-t border-x border-ui-border -mb-[1px]'
                    : 'text-ui-secondary hover:text-ui-ink hover:bg-ui-elevated/40'
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 left-0 right-0 h-[2px] bg-ui-accent rounded-t-[4px]"
                  />
                )}
                <span>{tab.label}</span>
                {typeof tab.count === 'number' && tab.count > 0 && (
                  <span
                    className={`font-mono text-[10px] tabular-nums ${
                      tab.id === 'tests'
                        ? passedCount === totalAssertions
                          ? 'text-ui-green'
                          : 'text-ui-danger'
                        : 'text-ui-secondary'
                    }`}
                  >
                    {tab.id === 'tests' ? `(${passedCount}/${totalAssertions})` : `(${tab.count})`}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Status / Latency / Size Readouts */}
        <div className="flex items-center gap-3 pb-1.5 font-mono text-[12px] tabular-nums whitespace-nowrap shrink-0">
          <span
            className={`px-1.5 py-0.5 rounded-[4px] font-semibold text-[11px] ${statusColors.bg} ${statusColors.text}`}
          >
            {response.status} {response.statusText}
          </span>
          <span className="text-ui-secondary">
            <span className="text-ui-muted mr-1">Time</span>
            <span className="text-ui-green">{response.durationMs} ms</span>
          </span>
          <span className="text-ui-secondary">
            <span className="text-ui-muted mr-1">Size</span>
            <span className="text-ui-ink">{formatBytes(response.sizeBytes)}</span>
          </span>
        </div>
      </div>

      {/* Body Toolbar */}
      {activeTab === 'body' && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-ui-surface border-b border-ui-border shrink-0">
          <div className="flex items-center gap-1 p-0.5 bg-ui-canvas border border-ui-border rounded-[4px]">
            {(['pretty', 'tree', 'raw'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setBodyMode(m)}
                className={`px-2 py-0.5 text-[11px] font-medium capitalize rounded-[3px] transition-colors cursor-pointer ${
                  bodyMode === m
                    ? 'bg-ui-elevated text-ui-ink'
                    : 'text-ui-secondary hover:text-ui-ink'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            {showSearch && (
              <div className="relative flex items-center">
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Find in body..."
                  className="h-[24px] w-[150px] pl-2 pr-6 bg-ui-canvas border border-ui-border rounded-[4px] font-mono text-[11px] text-ui-ink placeholder-ui-muted focus:outline-none focus:border-ui-accent"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setShowSearch(false);
                  }}
                  className="absolute right-1 text-ui-muted hover:text-ui-ink cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowSearch((s) => !s)}
              title="Search response"
              className={`p-1 rounded-[4px] border transition-colors cursor-pointer ${
                showSearch
                  ? 'bg-ui-elevated border-ui-accent text-ui-ink'
                  : 'bg-ui-elevated border-ui-border text-ui-secondary hover:text-ui-ink'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setWrapLines((w) => !w)}
              title="Toggle line wrap"
              className={`p-1 rounded-[4px] border transition-colors cursor-pointer ${
                wrapLines
                  ? 'bg-ui-elevated border-ui-accent text-ui-ink'
                  : 'bg-ui-elevated border-ui-border text-ui-secondary hover:text-ui-ink'
              }`}
            >
              <WrapText className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleCopyBody}
              title="Copy response body"
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-ui-elevated hover:bg-ui-hover border border-ui-border rounded-[4px] text-ui-ink transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-ui-green" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 text-ui-secondary" />
                  Copy
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              title="Download JSON"
              className="p-1 rounded-[4px] bg-ui-elevated hover:bg-ui-hover border border-ui-border text-ui-secondary hover:text-ui-ink transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Response Tab Panels */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'body' && (
          <JsonViewer
            body={response.body}
            viewMode={bodyMode}
            wrapLines={wrapLines}
            searchQuery={searchQuery}
          />
        )}

        {activeTab === 'headers' && (
          <div className="h-full overflow-auto p-3">
            <div className="border border-ui-border rounded-[4px] overflow-hidden bg-ui-canvas">
              <table className="w-full border-collapse table-fixed">
                <thead>
                  <tr className="bg-ui-elevated border-b border-ui-border text-left">
                    <th className="w-[38%] px-3 py-1.5 border-r border-ui-border text-[11px] font-semibold text-ui-secondary">
                      Header
                    </th>
                    <th className="px-3 py-1.5 text-[11px] font-semibold text-ui-secondary">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {headerEntries.map(([k, v]) => (
                    <tr
                      key={k}
                      className="border-b last:border-b-0 border-ui-border hover:bg-ui-surface"
                    >
                      <td className="px-3 py-1.5 border-r border-ui-border font-mono text-[12px] text-ui-key truncate select-all">
                        {k}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[12px] text-ui-ink break-all select-all">
                        {v}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'cookies' && (
          <div className="h-full overflow-auto p-3">
            {response.cookies.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-ui-muted border border-ui-border rounded-[4px] bg-ui-canvas">
                No <span className="font-mono text-ui-secondary">Set-Cookie</span> headers returned by this endpoint.
              </div>
            ) : (
              <div className="border border-ui-border rounded-[4px] overflow-hidden bg-ui-canvas">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-ui-elevated border-b border-ui-border text-left">
                      <th className="px-2.5 py-1.5 border-r border-ui-border text-[11px] font-semibold text-ui-secondary">
                        Name
                      </th>
                      <th className="px-2.5 py-1.5 border-r border-ui-border text-[11px] font-semibold text-ui-secondary">
                        Value
                      </th>
                      <th className="px-2.5 py-1.5 border-r border-ui-border text-[11px] font-semibold text-ui-secondary">
                        Path
                      </th>
                      <th className="px-2.5 py-1.5 border-r border-ui-border text-[11px] font-semibold text-ui-secondary">
                        Flags
                      </th>
                      <th className="px-2.5 py-1.5 text-[11px] font-semibold text-ui-secondary">
                        Max-Age
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {response.cookies.map((c, idx) => (
                      <tr
                        key={`${c.name}_${idx}`}
                        className="border-b last:border-b-0 border-ui-border hover:bg-ui-surface font-mono text-[12px]"
                      >
                        <td className="px-2.5 py-1.5 border-r border-ui-border text-ui-key">
                          {c.name}
                        </td>
                        <td className="px-2.5 py-1.5 border-r border-ui-border text-ui-string break-all">
                          {c.value}
                        </td>
                        <td className="px-2.5 py-1.5 border-r border-ui-border text-ui-secondary">
                          {c.path}
                        </td>
                        <td className="px-2.5 py-1.5 border-r border-ui-border text-ui-secondary">
                          {[
                            c.httpOnly ? 'HttpOnly' : null,
                            c.secure ? 'Secure' : null,
                            c.sameSite !== 'None' ? `SameSite=${c.sameSite}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </td>
                        <td className="px-2.5 py-1.5 text-ui-secondary tabular-nums">{c.maxAge}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'tests' && (
          <div className="h-full overflow-auto p-3 space-y-2.5">
            {totalAssertions === 0 ? (
              <div className="p-6 text-center text-[12px] text-ui-muted border border-ui-border rounded-[4px] bg-ui-canvas">
                No active assertions configured. Add rules in the Request Assertions tab to verify responses automatically.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between p-3 rounded-[8px] bg-ui-canvas border border-ui-border">
                  <div className="flex items-center gap-2">
                    {passedCount === totalAssertions ? (
                      <CheckCircle2 className="w-4 h-4 text-ui-green" />
                    ) : (
                      <XCircle className="w-4 h-4 text-ui-danger" />
                    )}
                    <span className="text-[13px] font-semibold text-ui-ink">
                      {passedCount === totalAssertions
                        ? 'All assertions passed'
                        : `${totalAssertions - passedCount} assertion${totalAssertions - passedCount === 1 ? '' : 's'} failed`}
                    </span>
                  </div>
                  <span className="font-mono text-[12px] tabular-nums text-ui-secondary">
                    <span className="text-ui-green font-semibold">{passedCount}</span> /{' '}
                    {totalAssertions} passed
                  </span>
                </div>

                <div className="space-y-2">
                  {response.assertionResults.map((res) => (
                    <div
                      key={res.ruleId}
                      className="p-3 rounded-[8px] bg-ui-surface border border-ui-border flex items-start justify-between gap-3"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        {res.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-ui-green shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-ui-danger shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium text-ui-ink">{res.label}</p>
                          <div className="flex flex-wrap items-center gap-3 mt-1 font-mono text-[11px] text-ui-secondary">
                            <span>
                              Expected:{' '}
                              <span className="text-ui-ink">{res.expected}</span>
                            </span>
                            <span>
                              Actual:{' '}
                              <span className={res.passed ? 'text-ui-green' : 'text-ui-danger'}>
                                {res.actual}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>
                      <span
                        className={`font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-[4px] shrink-0 ${
                          res.passed
                            ? 'bg-ui-green/12 text-ui-green'
                            : 'bg-ui-danger/12 text-ui-danger'
                        }`}
                      >
                        {res.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
