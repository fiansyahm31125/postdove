import { useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { ApiEnvironment, EnvironmentVariable } from '../types/api';
import { uid } from '../utils/httpUtils';

interface EnvironmentsViewProps {
  environments: ApiEnvironment[];
  activeEnvId: string;
  onSelectActiveEnv: (id: string) => void;
  drafts: Record<string, ApiEnvironment>;
  onDraftChange: (env: ApiEnvironment) => void;
  onSaveEnvironment: (env: ApiEnvironment) => void;
  onCreateEnvironment: () => void;
  onDuplicateEnvironment: (id: string) => void;
  onDeleteEnvironment: (id: string) => void;
}

export function EnvironmentsView({
  environments,
  activeEnvId,
  onSelectActiveEnv,
  drafts,
  onDraftChange,
  onSaveEnvironment,
  onCreateEnvironment,
  onDuplicateEnvironment,
  onDeleteEnvironment,
}: EnvironmentsViewProps) {
  const [selectedId, setSelectedId] = useState<string>(activeEnvId || environments[0]?.id || '');
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());

  const savedEnv = environments.find((e) => e.id === selectedId) || environments[0];
  const currentEnv = savedEnv ? drafts[savedEnv.id] ?? savedEnv : null;
  const dirty = Boolean(savedEnv && drafts[savedEnv.id]);

  const toggleReveal = (varId: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(varId)) next.delete(varId);
      else next.add(varId);
      return next;
    });
  };

  const handleVarChange = (
    varId: string,
    field: keyof EnvironmentVariable,
    value: string | boolean
  ) => {
    if (!currentEnv) return;
    onDraftChange({
      ...currentEnv,
      variables: currentEnv.variables.map((v) =>
        v.id === varId ? { ...v, [field]: value } : v
      ),
    });
  };

  const handleAddVar = () => {
    if (!currentEnv) return;
    onDraftChange({
      ...currentEnv,
      variables: [
        ...currentEnv.variables,
        {
          id: uid('var'),
          key: '',
          initialValue: '',
          currentValue: '',
          isSecret: false,
          enabled: true,
        },
      ],
    });
  };

  const handleDeleteVar = (varId: string) => {
    if (!currentEnv) return;
    onDraftChange({
      ...currentEnv,
      variables: currentEnv.variables.filter((v) => v.id !== varId),
    });
  };

  const handleSyncInitialToCurrent = () => {
    if (!currentEnv) return;
    onDraftChange({
      ...currentEnv,
      variables: currentEnv.variables.map((v) => ({
        ...v,
        currentValue: v.initialValue,
      })),
    });
  };

  return (
    <div className="flex h-full min-h-0 bg-ui-canvas">
      {/* Left Environment List */}
      <aside className="w-[270px] bg-ui-surface border-r border-ui-border flex flex-col shrink-0">
        <div className="flex items-center justify-between px-3 h-[42px] border-b border-ui-border shrink-0">
          <h2 className="text-[13px] font-semibold text-ui-ink">Environments</h2>
          <button
            type="button"
            onClick={onCreateEnvironment}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-ui-elevated hover:bg-ui-hover border border-ui-border rounded-[4px] text-ui-ink cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {environments.map((env) => {
            const isSelected = currentEnv?.id === env.id;
            const isActive = env.id === activeEnvId;
            return (
              <div
                key={env.id}
                onClick={() => setSelectedId(env.id)}
                className={`p-3 rounded-[8px] border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-ui-elevated border-ui-accent/70'
                    : 'bg-ui-surface border-ui-border hover:bg-ui-elevated/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ui-ink truncate">
                    {env.name}
                  </span>
                  {isActive && (
                    <span className="font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-[4px] bg-ui-green/12 text-ui-green shrink-0">
                      ACTIVE
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-ui-secondary mt-1 line-clamp-2">
                  {env.description || 'No description provided.'}
                </p>
                <div className="mt-2 flex items-center justify-between text-[11px] text-ui-muted font-mono tabular-nums">
                  <span>{env.variables.filter((v) => v.enabled).length} active vars</span>
                  <span>{env.variables.filter((v) => v.isSecret).length} secrets</span>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Right Variable Editor */}
      {currentEnv ? (
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-ui-canvas">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-ui-surface border-b border-ui-border shrink-0">
            <div className="flex-1 min-w-[240px] space-y-1">
              <input
                type="text"
                value={currentEnv.name}
                onChange={(e) => onDraftChange({ ...currentEnv, name: e.target.value })}
                className="w-full max-w-md bg-transparent text-[16px] font-semibold text-ui-ink tracking-[-0.01em] focus:outline-none focus:bg-ui-canvas px-1.5 -ml-1.5 py-0.5 rounded-[4px] border border-transparent focus:border-ui-accent"
              />
              <input
                type="text"
                value={currentEnv.description}
                onChange={(e) =>
                  onDraftChange({ ...currentEnv, description: e.target.value })
                }
                placeholder="Environment description..."
                className="w-full max-w-xl bg-transparent text-[12px] text-ui-secondary placeholder-ui-muted focus:outline-none focus:bg-ui-canvas px-1.5 -ml-1.5 py-0.5 rounded-[4px] border border-transparent focus:border-ui-accent"
              />
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button type="button" disabled={!dirty} onClick={() => onSaveEnvironment(currentEnv)}
                className="rounded-[4px] border border-ui-border bg-ui-elevated px-3 py-1.5 text-[12px] font-semibold text-ui-ink hover:bg-ui-hover disabled:opacity-40">
                Save environment
              </button>
              {currentEnv.id !== activeEnvId ? (
                <button
                  type="button"
                  onClick={() => onSelectActiveEnv(currentEnv.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ui-accent hover:bg-ui-accent-hover text-white text-[12px] font-semibold rounded-[4px] transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Check className="w-3.5 h-3.5" />
                  Set Active
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ui-green/12 border border-ui-green/30 text-ui-green text-[12px] font-medium rounded-[4px] whitespace-nowrap">
                  <Check className="w-3.5 h-3.5" />
                  Active Environment
                </span>
              )}
              <button
                type="button"
                onClick={handleSyncInitialToCurrent}
                className="px-2.5 py-1.5 bg-ui-elevated hover:bg-ui-hover border border-ui-border text-[12px] font-medium text-ui-ink rounded-[4px] cursor-pointer whitespace-nowrap"
              >
                Reset Current
              </button>
              <button
                type="button"
                onClick={() => onDuplicateEnvironment(currentEnv.id)}
                title="Duplicate environment"
                className="p-1.5 bg-ui-elevated hover:bg-ui-hover border border-ui-border text-ui-secondary hover:text-ui-ink rounded-[4px] cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              {environments.length > 1 && (
                <button
                  type="button"
                  onClick={() => onDeleteEnvironment(currentEnv.id)}
                  title="Delete environment"
                  className="p-1.5 bg-ui-elevated hover:bg-ui-hover border border-ui-border text-ui-secondary hover:text-ui-danger rounded-[4px] cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-auto p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[12px] text-ui-secondary">
                Reference any variable in URLs, headers, auth tokens, or JSON bodies using{' '}
                <span className="font-mono text-ui-number">{'{{variableName}}'}</span> syntax.
              </p>
              <button
                type="button"
                onClick={handleAddVar}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-ui-elevated hover:bg-ui-hover border border-ui-border rounded-[4px] text-[12px] font-medium text-ui-ink cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Variable
              </button>
            </div>

            <div className="border border-ui-border rounded-[4px] overflow-hidden bg-ui-surface">
              <table className="w-full border-collapse table-fixed">
                <thead>
                  <tr className="bg-ui-elevated border-b border-ui-border text-left">
                    <th className="w-[38px] px-2.5 py-2 border-r border-ui-border" />
                    <th className="w-[24%] px-3 py-2 border-r border-ui-border text-[11px] font-semibold text-ui-secondary">
                      Variable
                    </th>
                    <th className="w-[31%] px-3 py-2 border-r border-ui-border text-[11px] font-semibold text-ui-secondary">
                      Initial Value
                    </th>
                    <th className="w-[31%] px-3 py-2 border-r border-ui-border text-[11px] font-semibold text-ui-secondary">
                      Current Value
                    </th>
                    <th className="w-[78px] px-2 py-2 text-center text-[11px] font-semibold text-ui-secondary">
                      Controls
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {currentEnv.variables.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-[12px] text-ui-muted">
                        No variables defined in this environment.
                      </td>
                    </tr>
                  ) : (
                    currentEnv.variables.map((variable) => {
                      const isMasked = variable.isSecret && !revealedIds.has(variable.id);
                      return (
                        <tr
                          key={variable.id}
                          className={`group border-b last:border-b-0 border-ui-border bg-ui-canvas hover:bg-ui-surface ${
                            !variable.enabled ? 'opacity-50' : ''
                          }`}
                        >
                          <td className="px-2.5 py-1.5 border-r border-ui-border text-center">
                            <input
                              type="checkbox"
                              className="ide-checkbox align-middle"
                              checked={variable.enabled}
                              onChange={(e) =>
                                handleVarChange(variable.id, 'enabled', e.target.checked)
                              }
                            />
                          </td>
                          <td className="border-r border-ui-border p-0">
                            <input
                              type="text"
                              value={variable.key}
                              onChange={(e) => handleVarChange(variable.id, 'key', e.target.value)}
                              placeholder="baseUrl"
                              spellCheck={false}
                              className="w-full px-3 py-2 bg-transparent font-mono text-[12px] text-ui-number placeholder-ui-muted focus:outline-none focus:bg-ui-surface focus:ring-1 focus:ring-inset focus:ring-ui-accent"
                            />
                          </td>
                          <td className="border-r border-ui-border p-0">
                            <input
                              type={isMasked ? 'password' : 'text'}
                              value={variable.initialValue}
                              onChange={(e) =>
                                handleVarChange(variable.id, 'initialValue', e.target.value)
                              }
                              placeholder="Default value"
                              spellCheck={false}
                              className="w-full px-3 py-2 bg-transparent font-mono text-[12px] text-ui-secondary placeholder-ui-muted focus:outline-none focus:bg-ui-surface focus:ring-1 focus:ring-inset focus:ring-ui-accent"
                            />
                          </td>
                          <td className="border-r border-ui-border p-0">
                            <input
                              type={isMasked ? 'password' : 'text'}
                              value={variable.currentValue}
                              onChange={(e) =>
                                handleVarChange(variable.id, 'currentValue', e.target.value)
                              }
                              placeholder="Active runtime value"
                              spellCheck={false}
                              className="w-full px-3 py-2 bg-transparent font-mono text-[12px] text-ui-ink placeholder-ui-muted focus:outline-none focus:bg-ui-surface focus:ring-1 focus:ring-inset focus:ring-ui-accent"
                            />
                          </td>
                          <td className="px-1.5 py-1.5">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  handleVarChange(variable.id, 'isSecret', !variable.isSecret)
                                }
                                title={variable.isSecret ? 'Mark as plain text' : 'Mark as secret'}
                                className={`p-1 rounded-[4px] cursor-pointer ${
                                  variable.isSecret
                                    ? 'text-ui-amber bg-ui-amber/10'
                                    : 'text-ui-muted hover:text-ui-ink'
                                }`}
                              >
                                {variable.isSecret ? (
                                  <Lock className="w-3.5 h-3.5" />
                                ) : (
                                  <Unlock className="w-3.5 h-3.5" />
                                )}
                              </button>
                              {variable.isSecret && (
                                <button
                                  type="button"
                                  onClick={() => toggleReveal(variable.id)}
                                  title={isMasked ? 'Reveal value' : 'Mask value'}
                                  className="p-1 rounded-[4px] text-ui-secondary hover:text-ui-ink cursor-pointer"
                                >
                                  {isMasked ? (
                                    <Eye className="w-3.5 h-3.5" />
                                  ) : (
                                    <EyeOff className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteVar(variable.id)}
                                title="Delete variable"
                                className="p-1 rounded-[4px] text-ui-muted hover:text-ui-danger cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      ) : null}
    </div>
  );
}
