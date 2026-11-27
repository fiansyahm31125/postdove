import { FileText, Plus, Trash2, Upload, X } from 'lucide-react';
import type { MultipartFormItem } from '../types/api';
import { pickDesktopFile } from '../main';
import { uid } from '../utils/httpUtils';
import { VariableValue, type VariableActions } from './VariableEditor';

interface MultipartFormTableProps {
  items: MultipartFormItem[];
  onChange: (items: MultipartFormItem[]) => void;
  variableActions?: VariableActions;
}

function fileBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function MultipartFormTable({ items, onChange, variableActions }: MultipartFormTableProps) {
  const handleUpdate = (id: string, patch: Partial<MultipartFormItem>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const handleDelete = (id: string) => {
    onChange(items.filter((item) => item.id !== id));
  };

  const handleAdd = (type: 'text' | 'file' = 'text') => {
    onChange([
      ...items,
      {
        id: uid('mp'),
        key: '',
        value: '',
        type,
        contentType: '',
        description: '',
        enabled: true,
      },
    ]);
  };

  const handlePickFile = async (id: string) => {
    try {
      const picked = await pickDesktopFile();
      if (!picked) return;
      onChange(
        items.map((item) =>
          item.id === id
            ? {
                ...item,
                type: 'file',
                value: picked.path,
                contentType: item.contentType || picked.contentType,
              }
            : item
        )
      );
    } catch {
      // Ignore canceled/unavailable dialog errors
    }
  };

  const handleClearFile = (id: string) => {
    handleUpdate(id, { type: 'text', value: '', contentType: '' });
  };

  return (
    <div className="flex flex-col border border-ui-border rounded-[4px] overflow-hidden bg-ui-canvas">
      {/* Header Row */}
      <div className="grid grid-cols-[28px_minmax(110px,1fr)_minmax(180px,1.5fr)_minmax(110px,0.9fr)_30px] border-b border-ui-border bg-ui-elevated text-[10px] font-semibold uppercase tracking-[0.04em] text-ui-secondary">
        <div className="flex items-center justify-center h-[28px] border-r border-ui-border" />
        <div className="flex items-center px-2.5 h-[28px] border-r border-ui-border">Key</div>
        <div className="flex items-center px-2.5 h-[28px] border-r border-ui-border">Value</div>
        <div className="flex items-center px-2.5 h-[28px] border-r border-ui-border">Content-Type</div>
        <div className="h-[28px]" />
      </div>

      {/* Rows */}
      {items.length === 0 ? (
        <div className="px-3 py-5 text-center text-[12px] text-ui-muted">
          No multipart fields yet. Add a text or file field below.
        </div>
      ) : (
        <div className="divide-y divide-ui-border">
          {items.map((item) => (
            <div
              key={item.id}
              className={`grid grid-cols-[28px_minmax(110px,1fr)_minmax(180px,1.5fr)_minmax(110px,0.9fr)_30px] items-center group transition-colors hover:bg-ui-elevated/50 ${
                !item.enabled ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-center justify-center h-[32px] border-r border-ui-border">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(e) => handleUpdate(item.id, { enabled: e.target.checked })}
                  aria-label={`Enable ${item.key || 'field'}`}
                  className="w-3.5 h-3.5 accent-ui-accent rounded-[3px] cursor-pointer"
                />
              </div>

              <div className="h-[32px] border-r border-ui-border">
                <VariableValue
                  value={item.key}
                  onChange={(value) => handleUpdate(item.id, { key: value })}
                  actions={variableActions}
                  label="Multipart key"
                  placeholder="field_name"
                  className="w-full h-full px-2.5 bg-transparent font-mono text-[12px] text-ui-ink placeholder-ui-muted focus:outline-none focus:bg-ui-elevated/80"
                />
              </div>

              <div className="h-[32px] border-r border-ui-border flex items-center gap-1 pr-1 min-w-0">
                {item.type === 'file' ? (
                  <div className="flex-1 min-w-0 flex items-center px-2">
                    {item.value ? (
                      <span
                        title={item.value}
                        className="inline-flex items-center gap-1.5 max-w-full px-2 py-0.5 rounded-[4px] bg-ui-elevated border border-ui-border text-[11px] font-mono text-ui-ink"
                      >
                        <FileText className="w-3 h-3 shrink-0 text-ui-accent" />
                        <span className="truncate">{fileBasename(item.value)}</span>
                        <button
                          type="button"
                          onClick={() => handleClearFile(item.id)}
                          title="Remove file"
                          aria-label={`Remove file from ${item.key || 'field'}`}
                          className="shrink-0 text-ui-muted hover:text-ui-danger cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handlePickFile(item.id)}
                        className="text-[11px] text-ui-accent hover:underline cursor-pointer truncate"
                      >
                        Select file...
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 min-w-0 h-full">
                    <VariableValue
                      value={item.value}
                      onChange={(value) => handleUpdate(item.id, { value })}
                      actions={variableActions}
                      label="Multipart value"
                      placeholder="field_value"
                      className="w-full h-full px-2.5 bg-transparent font-mono text-[12px] text-ui-ink placeholder-ui-muted focus:outline-none focus:bg-ui-elevated/80"
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void handlePickFile(item.id)}
                  title="Upload / choose file"
                  aria-label={`Choose file for ${item.key || 'field'}`}
                  className="shrink-0 p-1 rounded-[3px] text-ui-secondary hover:text-ui-ink hover:bg-ui-border cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="h-[32px] border-r border-ui-border">
                <input
                  type="text"
                  value={item.contentType}
                  onChange={(e) => handleUpdate(item.id, { contentType: e.target.value })}
                  placeholder="Auto"
                  className="w-full h-full px-2.5 bg-transparent font-mono text-[11px] text-ui-secondary placeholder-ui-muted focus:outline-none focus:text-ui-ink focus:bg-ui-elevated/80"
                />
              </div>

              <div className="flex items-center justify-center h-[32px]">
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  aria-label="Delete field"
                  className="p-1 text-ui-muted hover:text-ui-danger opacity-60 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer Add Row */}
      <div className="flex items-center gap-3 px-2.5 py-1.5 border-t border-ui-border bg-ui-surface">
        <button
          type="button"
          onClick={() => handleAdd('text')}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-ui-secondary hover:text-ui-ink transition-colors cursor-pointer"
        >
          <Plus className="w-3 h-3" />
          Add Text Field
        </button>
        <button
          type="button"
          onClick={() => handleAdd('file')}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-ui-accent hover:underline transition-colors cursor-pointer"
        >
          <Upload className="w-3 h-3" />
          Add File Field
        </button>
      </div>
    </div>
  );
}
