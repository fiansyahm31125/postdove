import { VariableValue, type VariableActions } from './VariableEditor';
import { useMemo, useState } from 'react';
import { Check, Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import type {
  ApiEnvironment,
  ApiRequest,
  AssertionOperator,
  AssertionRule,
  AssertionSource,
  AuthType,
  BodyMode,
} from '../types/api';
import { KeyValueTable } from './KeyValueTable';
import { JsonCodeEditor } from './JsonCodeEditor';
import { buildUrlWithParams, generateCodeSnippet, uid } from '../utils/httpUtils';

type RequestTab = 'params' | 'headers' | 'auth' | 'body' | 'tests' | 'code';

interface RequestPaneProps {
  request: ApiRequest;
  activeEnv: ApiEnvironment | undefined;
  onChange: (updated: ApiRequest) => void;
  variableActions?: VariableActions;
}

export function RequestPane({ request, activeEnv, onChange, variableActions }: RequestPaneProps) {
  const [activeTab, setActiveTab] = useState<RequestTab>('params');
  const [showSecret, setShowSecret] = useState(false);
  const [codeLang, setCodeLang] = useState<'curl' | 'fetch' | 'python' | 'go'>('curl');
  const [copiedCode, setCopiedCode] = useState(false);

  const activeParamsCount = request.params.filter((p) => p.enabled && p.key.trim()).length;
  const activeHeadersCount = request.headers.filter((h) => h.enabled && h.key.trim()).length;
  const activeAssertionsCount = request.assertions.filter((a) => a.enabled).length;

  const snippet = useMemo(
    () => generateCodeSnippet(codeLang, request, activeEnv),
    [codeLang, request, activeEnv]
  );

  const handleParamsChange = (params: ApiRequest['params']) => {
    const nextUrl = buildUrlWithParams(request.url, params);
    onChange({ ...request, params, url: nextUrl });
  };

  const handleAuthChange = (patch: Partial<ApiRequest['auth']>) => {
    onChange({ ...request, auth: { ...request.auth, ...patch } });
  };

  const handleAddAssertion = () => {
    const next: AssertionRule = {
      id: uid('asr'),
      enabled: true,
      source: 'status',
      property: '',
      operator: 'equals',
      expected: '200',
    };
    onChange({ ...request, assertions: [...request.assertions, next] });
  };

  const handleUpdateAssertion = (id: string, patch: Partial<AssertionRule>) => {
    onChange({
      ...request,
      assertions: request.assertions.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  };

  const handleDeleteAssertion = (id: string) => {
    onChange({
      ...request,
      assertions: request.assertions.filter((a) => a.id !== id),
    });
  };

  const handleCopySnippet = () => {
    navigator.clipboard.writeText(snippet).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1600);
  };

  const tabs: Array<{ id: RequestTab; label: string; count?: number; indicator?: boolean }> = [
    { id: 'params', label: 'Params', count: activeParamsCount },
    { id: 'headers', label: 'Headers', count: activeHeadersCount },
    { id: 'auth', label: 'Auth', indicator: request.auth.type !== 'none' },
    { id: 'body', label: 'Body', indicator: request.bodyMode !== 'none' },
    { id: 'tests', label: 'Assertions', count: activeAssertionsCount },
    { id: 'code', label: 'Code' },
  ];

  return (
    <section className="flex flex-col h-full min-h-0 bg-ui-surface">
      {/* Request Sub-tab Strip */}
      <div className="flex items-center gap-0.5 px-3 pt-1.5 border-b border-ui-border bg-ui-surface shrink-0 overflow-x-auto">
        {tabs.map((tab) => {
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
                <span className="font-mono text-[10px] text-ui-secondary tabular-nums">
                  ({tab.count})
                </span>
              )}
              {tab.indicator && (
                <span className="w-1.5 h-1.5 rounded-full bg-ui-green" aria-label="Configured" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {activeTab === 'params' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] font-semibold text-ui-ink">Query Parameters</h3>
              <span className="text-[11px] text-ui-muted">
                Two-way synced with URL bar
              </span>
            </div>
            <KeyValueTable
              variableActions={variableActions}
              items={request.params}
              onChange={handleParamsChange}
              keyPlaceholder="limit"
              valuePlaceholder="25"
              descriptionPlaceholder="Optional note"
              emptyMessage="No query parameters defined. Add a row or append ?key=value to the URL."
            />
          </div>
        )}

        {activeTab === 'headers' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] font-semibold text-ui-ink">Request Headers</h3>
              <span className="text-[11px] text-ui-muted">
                Supports <span className="font-mono text-ui-secondary">{'{{variables}}'}</span>
              </span>
            </div>
            <KeyValueTable
              variableActions={variableActions}
              items={request.headers}
              onChange={(headers) => onChange({ ...request, headers })}
              keyPlaceholder="X-Custom-Header"
              valuePlaceholder="application/json"
              descriptionPlaceholder="Header purpose"
              emptyMessage="No custom headers configured."
            />
          </div>
        )}

        {activeTab === 'auth' && (
          <div className="max-w-xl space-y-4">
            <div className="flex items-center gap-3">
              <label className="w-[110px] text-[12px] font-medium text-ui-secondary shrink-0">
                Auth Type
              </label>
              <select
                value={request.auth.type}
                onChange={(e) => handleAuthChange({ type: e.target.value as AuthType })}
                className="flex-1 h-[32px] px-2.5 bg-ui-canvas border border-ui-border rounded-[4px] text-[12px] text-ui-ink focus:outline-none focus:border-ui-accent"
              >
                <option value="none">No Auth</option>
                <option value="bearer">Bearer Token</option>
                <option value="apikey">API Key</option>
                <option value="basic">Basic Auth</option>
              </select>
            </div>

            {request.auth.type === 'none' && (
              <div className="p-3 rounded-[8px] bg-ui-canvas border border-ui-border text-[12px] text-ui-secondary">
                This request does not inject automatic authorization headers. Switch to Bearer Token, API Key, or Basic Auth to attach credentials dynamically.
              </div>
            )}

            {request.auth.type === 'bearer' && (
              <div className="p-3 rounded-[8px] bg-ui-canvas border border-ui-border space-y-3">
                <div className="flex items-center gap-3">
                  <label className="w-[98px] text-[12px] font-medium text-ui-secondary shrink-0">
                    Token
                  </label>
                  <div className="relative flex-1">
                    <VariableValue
                      value={request.auth.bearerToken}
                      onChange={(value) => handleAuthChange({ bearerToken: value })}
                      actions={variableActions}
                      label="Bearer token"
                      className="w-full h-[32px] pl-2.5 pr-8 bg-ui-surface border border-ui-border rounded-[4px] font-mono text-[12px] text-ui-ink placeholder-ui-muted focus:outline-none focus:border-ui-accent"
                      inputType={showSecret ? 'text' : 'password'}
                      placeholder="{{accessToken}}"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-ui-muted hover:text-ui-ink cursor-pointer"
                      aria-label={showSecret ? 'Hide token' : 'Reveal token'}
                    >
                      {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-ui-muted">
                  Injects <span className="font-mono text-ui-secondary">Authorization: Bearer &lt;token&gt;</span> header on send.
                </p>
              </div>
            )}

            {request.auth.type === 'apikey' && (
              <div className="p-3 rounded-[8px] bg-ui-canvas border border-ui-border space-y-3">
                <div className="flex items-center gap-3">
                  <label className="w-[98px] text-[12px] font-medium text-ui-secondary shrink-0">
                    Key Name
                  </label>
                  <VariableValue
                    value={request.auth.apiKeyName}
                    onChange={(value) => handleAuthChange({ apiKeyName: value })}
                    actions={variableActions}
                    label="API key name"
                    className="flex-1 h-[32px] px-2.5 bg-ui-surface border border-ui-border rounded-[4px] font-mono text-[12px] text-ui-ink focus:outline-none focus:border-ui-accent"
                    placeholder="X-API-Key"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="w-[98px] text-[12px] font-medium text-ui-secondary shrink-0">
                    Value
                  </label>
                  <VariableValue
                    value={request.auth.apiKeyValue}
                    onChange={(value) => handleAuthChange({ apiKeyValue: value })}
                    actions={variableActions}
                    label="API key value"
                    className="flex-1 h-[32px] px-2.5 bg-ui-surface border border-ui-border rounded-[4px] font-mono text-[12px] text-ui-ink focus:outline-none focus:border-ui-accent"
                    inputType={showSecret ? 'text' : 'password'}
                    placeholder="{{apiKey}}"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="w-[98px] text-[12px] font-medium text-ui-secondary shrink-0">
                    Add To
                  </label>
                  <select
                    value={request.auth.apiKeyIn}
                    onChange={(e) =>
                      handleAuthChange({ apiKeyIn: e.target.value as 'header' | 'query' })
                    }
                    className="flex-1 h-[32px] px-2.5 bg-ui-surface border border-ui-border rounded-[4px] text-[12px] text-ui-ink focus:outline-none focus:border-ui-accent"
                  >
                    <option value="header">Request Header</option>
                    <option value="query">Query Params</option>
                  </select>
                </div>
              </div>
            )}

            {request.auth.type === 'basic' && (
              <div className="p-3 rounded-[8px] bg-ui-canvas border border-ui-border space-y-3">
                <div className="flex items-center gap-3">
                  <label className="w-[98px] text-[12px] font-medium text-ui-secondary shrink-0">
                    Username
                  </label>
                  <VariableValue
                    value={request.auth.basicUsername}
                    onChange={(value) => handleAuthChange({ basicUsername: value })}
                    actions={variableActions}
                    label="Basic username"
                    className="flex-1 h-[32px] px-2.5 bg-ui-surface border border-ui-border rounded-[4px] font-mono text-[12px] text-ui-ink focus:outline-none focus:border-ui-accent"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label className="w-[98px] text-[12px] font-medium text-ui-secondary shrink-0">
                    Password
                  </label>
                  <VariableValue
                    value={request.auth.basicPassword}
                    onChange={(value) => handleAuthChange({ basicPassword: value })}
                    actions={variableActions}
                    label="Basic password"
                    className="flex-1 h-[32px] px-2.5 bg-ui-surface border border-ui-border rounded-[4px] font-mono text-[12px] text-ui-ink focus:outline-none focus:border-ui-accent"
                    inputType={showSecret ? 'text' : 'password'}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'body' && (
          <div className="flex flex-col h-full gap-2.5">
            <div className="flex items-center gap-4 shrink-0">
              {(
                [
                  { id: 'none', label: 'None' },
                  { id: 'json', label: 'JSON' },
                  { id: 'raw', label: 'Raw Text' },
                  { id: 'form', label: 'Form URL-Encoded' },
                ] as Array<{ id: BodyMode; label: string }>
              ).map((opt) => (
                <label
                  key={opt.id}
                  className="inline-flex items-center gap-1.5 text-[12px] text-ui-secondary hover:text-ui-ink cursor-pointer select-none"
                >
                  <input
                    type="radio"
                    name={`body_mode_${request.id}`}
                    checked={request.bodyMode === opt.id}
                    onChange={() => onChange({ ...request, bodyMode: opt.id })}
                    className="accent-ui-accent w-3.5 h-3.5 cursor-pointer"
                  />
                  <span className={request.bodyMode === opt.id ? 'text-ui-ink font-medium' : ''}>
                    {opt.label}
                  </span>
                </label>
              ))}
            </div>

            {request.bodyMode === 'none' && (
              <div className="flex-1 flex items-center justify-center rounded-[4px] border border-dashed border-ui-border bg-ui-canvas/60 text-[12px] text-ui-muted">
                This request does not have a payload body.
              </div>
            )}

            {(request.bodyMode === 'json' || request.bodyMode === 'raw') && (
              <div className="flex-1 min-h-0">
                <JsonCodeEditor
                  value={request.bodyContent}
                  onChange={(bodyContent) => onChange({ ...request, bodyContent })}
                  mode={request.bodyMode}
                  variableActions={variableActions}
                />
              </div>
            )}

            {request.bodyMode === 'form' && (
              <KeyValueTable
                variableActions={variableActions}
                items={request.formBody}
                onChange={(formBody) => onChange({ ...request, formBody })}
                keyPlaceholder="field_name"
                valuePlaceholder="field_value"
                emptyMessage="No form fields added yet."
              />
            )}
          </div>
        )}

        {activeTab === 'tests' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[12px] font-semibold text-ui-ink">
                  Automated Response Assertions
                </h3>
                <p className="text-[11px] text-ui-muted">
                  Evaluated automatically after every Send and during Collection Test Runs.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddAssertion}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-ui-ink bg-ui-elevated hover:bg-ui-hover border border-ui-border rounded-[4px] transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Rule
              </button>
            </div>

            <div className="border border-ui-border rounded-[4px] overflow-hidden bg-ui-canvas">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-ui-elevated border-b border-ui-border text-left">
                    <th className="w-[34px] px-2 py-1.5 border-r border-ui-border" />
                    <th className="w-[130px] px-2.5 py-1.5 border-r border-ui-border text-[11px] font-semibold text-ui-secondary">
                      Target
                    </th>
                    <th className="w-[150px] px-2.5 py-1.5 border-r border-ui-border text-[11px] font-semibold text-ui-secondary">
                      Property / Path
                    </th>
                    <th className="w-[120px] px-2.5 py-1.5 border-r border-ui-border text-[11px] font-semibold text-ui-secondary">
                      Operator
                    </th>
                    <th className="px-2.5 py-1.5 text-[11px] font-semibold text-ui-secondary">
                      Expected Value
                    </th>
                    <th className="w-[34px]" />
                  </tr>
                </thead>
                <tbody>
                  {request.assertions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-[12px] text-ui-muted">
                        No assertions configured for this endpoint.
                      </td>
                    </tr>
                  ) : (
                    request.assertions.map((rule) => {
                      const needsProperty = rule.source === 'json_path' || rule.source === 'header';
                      const needsExpected = rule.operator !== 'exists';
                      return (
                        <tr
                          key={rule.id}
                          className={`group border-b last:border-b-0 border-ui-border hover:bg-ui-surface ${
                            !rule.enabled ? 'opacity-50' : ''
                          }`}
                        >
                          <td className="px-2 py-1 border-r border-ui-border text-center">
                            <input
                              type="checkbox"
                              className="ide-checkbox align-middle"
                              checked={rule.enabled}
                              onChange={(e) =>
                                handleUpdateAssertion(rule.id, { enabled: e.target.checked })
                              }
                            />
                          </td>
                          <td className="border-r border-ui-border p-0">
                            <select
                              value={rule.source}
                              onChange={(e) =>
                                handleUpdateAssertion(rule.id, {
                                  source: e.target.value as AssertionSource,
                                })
                              }
                              className="w-full h-[30px] px-2 bg-transparent text-[12px] text-ui-ink focus:outline-none focus:bg-ui-surface"
                            >
                              <option value="status" className="bg-ui-elevated">Status Code</option>
                              <option value="duration" className="bg-ui-elevated">Response Time (ms)</option>
                              <option value="json_path" className="bg-ui-elevated">JSON Path</option>
                              <option value="header" className="bg-ui-elevated">Response Header</option>
                              <option value="body_contains" className="bg-ui-elevated">Body Text</option>
                            </select>
                          </td>
                          <td className="border-r border-ui-border p-0">
                            <input
                              type="text"
                              disabled={!needsProperty}
                              value={needsProperty ? rule.property : ''}
                              onChange={(e) =>
                                handleUpdateAssertion(rule.id, { property: e.target.value })
                              }
                              placeholder={
                                rule.source === 'json_path'
                                  ? '$.data[0].id'
                                  : rule.source === 'header'
                                    ? 'content-type'
                                    : '—'
                              }
                              spellCheck={false}
                              className="w-full h-[30px] px-2.5 bg-transparent font-mono text-[12px] text-ui-ink placeholder-ui-muted disabled:opacity-40 focus:outline-none focus:bg-ui-surface focus:ring-1 focus:ring-inset focus:ring-ui-accent"
                            />
                          </td>
                          <td className="border-r border-ui-border p-0">
                            <select
                              value={rule.operator}
                              onChange={(e) =>
                                handleUpdateAssertion(rule.id, {
                                  operator: e.target.value as AssertionOperator,
                                })
                              }
                              className="w-full h-[30px] px-2 bg-transparent text-[12px] text-ui-ink focus:outline-none focus:bg-ui-surface"
                            >
                              <option value="equals" className="bg-ui-elevated">Equals</option>
                              <option value="not_equals" className="bg-ui-elevated">Not Equals</option>
                              <option value="contains" className="bg-ui-elevated">Contains</option>
                              <option value="less_than" className="bg-ui-elevated">Less Than</option>
                              <option value="exists" className="bg-ui-elevated">Exists</option>
                            </select>
                          </td>
                          <td className="p-0">
                            <input
                              type="text"
                              disabled={!needsExpected}
                              value={needsExpected ? rule.expected : ''}
                              onChange={(e) =>
                                handleUpdateAssertion(rule.id, { expected: e.target.value })
                              }
                              placeholder={needsExpected ? 'Expected value' : 'Any value'}
                              spellCheck={false}
                              className="w-full h-[30px] px-2.5 bg-transparent font-mono text-[12px] text-ui-ink placeholder-ui-muted disabled:opacity-40 focus:outline-none focus:bg-ui-surface focus:ring-1 focus:ring-inset focus:ring-ui-accent"
                            />
                          </td>
                          <td className="px-1 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteAssertion(rule.id)}
                              title="Remove assertion"
                              className="p-1 rounded-[4px] text-ui-muted opacity-0 group-hover:opacity-100 hover:text-ui-danger cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'code' && (
          <div className="flex flex-col h-full gap-2.5">
            <div className="flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1 p-0.5 bg-ui-canvas border border-ui-border rounded-[4px]">
                {(
                  [
                    { id: 'curl', label: 'cURL' },
                    { id: 'fetch', label: 'JavaScript Fetch' },
                    { id: 'python', label: 'Python Requests' },
                    { id: 'go', label: 'Go net/http' },
                  ] as const
                ).map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setCodeLang(l.id)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-[3px] transition-colors cursor-pointer whitespace-nowrap ${
                      codeLang === l.id
                        ? 'bg-ui-elevated text-ui-ink'
                        : 'text-ui-secondary hover:text-ui-ink'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleCopySnippet}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-ui-ink bg-ui-elevated hover:bg-ui-hover border border-ui-border rounded-[4px] transition-colors cursor-pointer whitespace-nowrap"
              >
                {copiedCode ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-ui-green" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-ui-secondary" />
                    Copy Snippet
                  </>
                )}
              </button>
            </div>

            <pre className="flex-1 overflow-auto p-3 rounded-[4px] bg-ui-canvas border border-ui-border font-mono text-[12px] leading-[19px] text-ui-subtle-ink select-all">
              {snippet}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}
