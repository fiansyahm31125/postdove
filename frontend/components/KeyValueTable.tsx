import { VariableValue, type VariableActions } from './VariableEditor';
import { Plus, Trash2 } from 'lucide-react';
import type { KeyValueItem } from '../types/api';
import { uid } from '../utils/httpUtils';

interface KeyValueTableProps {
  items: KeyValueItem[];
  onChange: (items: KeyValueItem[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  descriptionPlaceholder?: string;
  readOnly?: boolean;
  showDescription?: boolean;
  emptyMessage?: string;
  variableActions?: VariableActions;
}

export function KeyValueTable({
  items,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  descriptionPlaceholder = 'Description',
  readOnly = false,
  showDescription = true,
  emptyMessage = 'No entries configured.',
  variableActions,
}: KeyValueTableProps) {
  const handleFieldChange = (id: string, field: keyof KeyValueItem, val: string | boolean) => {
    onChange(items.map((item) => (item.id === id ? { ...item, [field]: val } : item)));
  };

  const handleAddRow = () => {
    onChange([
      ...items,
      {
        id: uid('kv'),
        key: '',
        value: '',
        description: '',
        enabled: true,
      },
    ]);
  };

  const handleDeleteRow = (id: string) => {
    onChange(items.filter((item) => item.id !== id));
  };

  const allChecked = items.length > 0 && items.every((i) => i.enabled);

  const handleToggleAll = () => {
    const next = !allChecked;
    onChange(items.map((i) => ({ ...i, enabled: next })));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border border-ui-border rounded-[4px] overflow-hidden bg-ui-canvas">
        <table className="w-full border-collapse table-fixed">
          <thead>
            <tr className="bg-ui-elevated border-b border-ui-border text-left">
              {!readOnly && (
                <th className="w-[34px] px-2.5 py-1.5 border-r border-ui-border text-center">
                  <input
                    type="checkbox"
                    className="ide-checkbox align-middle"
                    checked={allChecked}
                    onChange={handleToggleAll}
                    aria-label="Toggle all rows"
                  />
                </th>
              )}
              <th className="w-[32%] px-2.5 py-1.5 border-r border-ui-border text-[11px] font-semibold tracking-[0.02em] text-ui-secondary">
                Key
              </th>
              <th
                className={`${
                  showDescription ? 'w-[36%]' : 'w-auto'
                } px-2.5 py-1.5 ${showDescription ? 'border-r border-ui-border' : ''} text-[11px] font-semibold tracking-[0.02em] text-ui-secondary`}
              >
                Value
              </th>
              {showDescription && (
                <th className="px-2.5 py-1.5 text-[11px] font-semibold tracking-[0.02em] text-ui-secondary">
                  Description
                </th>
              )}
              {!readOnly && <th className="w-[34px] px-1.5 py-1.5" />}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={readOnly ? (showDescription ? 3 : 2) : showDescription ? 5 : 4}
                  className="px-3 py-6 text-center text-[12px] text-ui-muted"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr
                  key={item.id}
                  className={`group border-b last:border-b-0 border-ui-border transition-colors hover:bg-ui-surface ${
                    !item.enabled ? 'opacity-50' : ''
                  }`}
                >
                  {!readOnly && (
                    <td className="px-2.5 py-1 border-r border-ui-border text-center">
                      <input
                        type="checkbox"
                        className="ide-checkbox align-middle"
                        checked={item.enabled}
                        onChange={(e) => handleFieldChange(item.id, 'enabled', e.target.checked)}
                        aria-label={`Enable ${item.key || 'row'}`}
                      />
                    </td>
                  )}
                  <td className="border-r border-ui-border p-0">
                    {readOnly ? (
                      <div className="px-2.5 py-1.5 font-mono text-[12px] text-ui-ink truncate select-all">
                        {item.key}
                      </div>
                    ) : (
                      <VariableValue
                        value={item.key}
                        onChange={(value) => handleFieldChange(item.id, 'key', value)}
                        placeholder={keyPlaceholder}
                        label="Field key"
                        actions={variableActions}
                      />
                    )}
                  </td>
                  <td className={`${showDescription ? 'border-r border-ui-border' : ''} p-0`}>
                    {readOnly ? (
                      <div className="px-2.5 py-1.5 font-mono text-[12px] text-ui-secondary break-all select-all">
                        {item.value}
                      </div>
                    ) : (
                      <VariableValue
                        value={item.value}
                        onChange={(value) => handleFieldChange(item.id, 'value', value)}
                        placeholder={valuePlaceholder}
                        actions={variableActions}
                      />
                    )}
                  </td>
                  {showDescription && (
                    <td className="p-0">
                      {readOnly ? (
                        <div className="px-2.5 py-1.5 text-[12px] text-ui-muted truncate">
                          {item.description}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => handleFieldChange(item.id, 'description', e.target.value)}
                          placeholder={descriptionPlaceholder}
                          className="w-full bg-transparent px-2.5 py-1.5 text-[12px] text-ui-secondary placeholder-ui-muted focus:outline-none focus:bg-ui-surface focus:ring-1 focus:ring-inset focus:ring-ui-accent"
                        />
                      )}
                    </td>
                  )}
                  {!readOnly && (
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(item.id)}
                        title="Remove row"
                        className="p-1 rounded-[4px] text-ui-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-ui-danger hover:bg-ui-danger/10 transition-all cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={handleAddRow}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-ui-secondary hover:text-ui-ink bg-ui-elevated hover:bg-ui-hover border border-ui-border rounded-[4px] transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Row
          </button>
          <span className="text-[11px] text-ui-muted tabular-nums">
            {items.filter((i) => i.enabled && i.key.trim()).length} active of {items.length}
          </span>
        </div>
      )}
    </div>
  );
}
