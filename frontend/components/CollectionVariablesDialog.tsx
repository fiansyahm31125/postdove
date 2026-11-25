import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import type { CollectionProfile, CollectionVariableProfiles, EnvironmentVariable } from '../types/api';
import { uid } from '../utils/httpUtils';

const inputStyle = 'min-w-0 rounded border border-ui-border bg-ui-canvas px-2 py-1.5 font-mono text-ui-ink focus-visible:outline-ui-accent';

export function CollectionVariablesDialog({ collection, profiles, onSave, onClose, onValidationError }: {
  collection: string;
  profiles: CollectionVariableProfiles;
  onSave: (profiles: CollectionVariableProfiles) => void;
  onClose: () => void;
  onValidationError?: (error: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(profiles);
  const [tab, setTab] = useState<CollectionProfile>(profiles.active);
  const rows = draft[tab];
  const [confirmImport, setConfirmImport] = useState(false);
  const importSource = tab === 'Production' ? 'Local' : 'Production';
  const importRows = draft[importSource].filter(row => row.key.trim());

  function setRows(change: (rows: EnvironmentVariable[]) => EnvironmentVariable[]) {
    setDraft(current => ({ ...current, [tab]: change(current[tab]) }));
  }
  const [shown, setShown] = useState<string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  function update(id: string, fields: Partial<EnvironmentVariable>) {
    setRows(rows => rows.map(row => row.id === id ? { ...row, ...fields } : row));
    setError('');
  }

  function save() {
    const cleaned = (key: CollectionProfile) => draft[key]
      .filter(row => row.key.trim() || row.currentValue)
      .map(row => ({ ...row, key: row.key.trim(), initialValue: row.currentValue }));
    const next = { active: draft.active, Production: cleaned('Production'), Local: cleaned('Local') };
    for (const profile of ['Production', 'Local'] as const) {
      const keys = next[profile].map(row => row.key);
      if (keys.some(key => !/^[a-zA-Z0-9_.-]+$/.test(key))) {
        setTab(profile);
        const error = `${profile}: use letters, numbers, dots, underscores, or hyphens for variable names.`;
        setError(error);
        onValidationError?.(error);
        return;
      }
      if (new Set(keys).size !== keys.length) {
        setTab(profile);
        const error = `${profile}: each variable name must be unique.`;
        setError(error);
        onValidationError?.(error);
        return;
      }
    }
    onSave(next);
  }

  return <><dialog ref={dialog} aria-labelledby="collection-variable-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    className="m-auto max-h-[85vh] w-[min(94vw,680px)] overflow-auto rounded-lg border border-ui-border bg-ui-surface p-4 text-ui-ink shadow-xl backdrop:bg-black/65">
    <form className="grid gap-3" onSubmit={event => { event.preventDefault(); save(); }}>
      <header>
        <h2 id="collection-variable-title" className="text-[15px] font-semibold">Collection variables</h2>
        <p className="mt-1 text-ui-secondary">{collection}</p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ui-border pb-2">
        <div className="flex items-center gap-2" aria-label="Variable profiles">
          {(['Production', 'Local'] as const).map(profile => <button type="button" key={profile}
            className={`rounded border px-3 py-1.5 ${tab === profile ? 'border-ui-accent bg-ui-accent/10' : 'border-ui-border'}`}
            aria-pressed={tab === profile} onClick={() => { setTab(profile); setError(''); }}>
            {profile}{draft.active === profile && <span className="ml-2 text-[11px] text-ui-green"> Active</span>}
          </button>)}
        </div>
        {tab !== draft.active && <button type="button" className="rounded border border-ui-border px-3 py-1.5"
          onClick={() => setDraft(current => ({ ...current, active: tab }))}>Set {tab} active</button>}
      </div>
      {rows.length === 0 && <div className="grid gap-2 rounded border border-dashed border-ui-border p-3">
        <p className="text-ui-secondary">No variables in {tab}.</p>
        {importRows.length > 0 && <button type="button" onClick={() => setConfirmImport(true)}
          className="inline-flex items-center gap-1.5 justify-self-start rounded border border-ui-border bg-ui-elevated px-2 py-1 hover:border-ui-accent">
          <ArrowDownToLine size={13} /> Import from {importSource}
        </button>}
      </div>}
      {rows.length > 0 && <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.5fr)_auto] items-center gap-2">
        <span className="sr-only">Enabled</span>
        <span className="text-ui-secondary">Name</span>
        <span className="text-ui-secondary">Value</span>
        <span className="text-ui-secondary">Controls</span>
        {rows.map((row, index) => <VariableRow key={row.id} row={row} index={index}
          visible={shown.includes(row.id)} onChange={fields => update(row.id, fields)}
          onReveal={() => setShown(current => current.includes(row.id) ? current.filter(id => id !== row.id) : [...current, row.id])}
          onRemove={() => setRows(current => current.filter(item => item.id !== row.id))} />)}
      </div>}
      <button type="button" className="inline-flex items-center gap-1 justify-self-start rounded border border-ui-border px-2 py-1"
        onClick={() => setRows(current => [...current, {
          id: uid('var'), key: '', currentValue: '', initialValue: '', enabled: true, isSecret: false,
        }])}><Plus size={13} /> Add variable</button>
      {error && <p role="alert" className="text-ui-error-text">{error}</p>}
      <footer className="flex justify-end gap-2">
        <button type="button" className="rounded border border-ui-border px-3 py-1.5" onClick={onClose}>Cancel</button>
        <button type="submit" className="rounded bg-ui-accent px-3 py-1.5 font-semibold text-ui-on-accent">Save variables</button>
      </footer>
    </form>
  </dialog>
  {confirmImport && <ConfirmProfileImport source={importSource} target={tab} count={importRows.length}
    onCancel={() => setConfirmImport(false)}
    onConfirm={() => {
      setRows(current => current.length ? current : importRows.map(row => ({ ...row, id: uid('var') })));
      setError('');
      setConfirmImport(false);
    }} />}</>;
}

function ConfirmProfileImport({ source, target, count, onCancel, onConfirm }: {
  source: CollectionProfile;
  target: CollectionProfile;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    cancelButton.current?.focus();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} aria-labelledby="profile-import-title" aria-describedby="profile-import-description"
    onCancel={event => { event.preventDefault(); onCancel(); }}
    className="m-auto w-[min(92vw,440px)] rounded-lg border border-ui-border bg-ui-surface p-4 text-ui-ink shadow-xl backdrop:bg-black/65">
    <div className="grid gap-3">
      <h2 id="profile-import-title" className="text-[15px] font-semibold">Import variables?</h2>
      <p id="profile-import-description" className="text-ui-secondary">
        Copy {count} {count === 1 ? 'variable' : 'variables'} and their values from <strong>{source}</strong> to <strong>{target}</strong>.
        Click <strong>Save variables</strong> afterwards to keep the imported values.
      </p>
      <div className="flex justify-end gap-2">
        <button ref={cancelButton} type="button" className="rounded border border-ui-border px-3 py-1.5" onClick={onCancel}>Cancel</button>
        <button type="button" className="rounded bg-ui-accent px-3 py-1.5 font-semibold text-ui-on-accent" onClick={onConfirm}>Confirm import</button>
      </div>
    </div>
  </dialog>;
}

function VariableRow({ row, index, visible, onChange, onReveal, onRemove }: {
  row: EnvironmentVariable;
  index: number;
  visible: boolean;
  onChange: (fields: Partial<EnvironmentVariable>) => void;
  onReveal: () => void;
  onRemove: () => void;
}) {
  return <>
    <input type="checkbox" aria-label={`Enable variable ${index + 1}`} className="ide-checkbox"
      checked={row.enabled} onChange={event => onChange({ enabled: event.target.checked })} />
    <input aria-label={`Variable name ${index + 1}`} className={inputStyle} value={row.key}
      spellCheck={false} placeholder="baseUrl" onChange={event => onChange({ key: event.target.value })} />
    <input type={row.isSecret && !visible ? 'password' : 'text'} aria-label={`Variable value ${index + 1}`}
      className={inputStyle} value={row.currentValue} autoComplete="off" spellCheck={false}
      onChange={event => onChange({ currentValue: event.target.value })} />
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1 text-[11px] text-ui-secondary">
        <input type="checkbox" className="ide-checkbox" checked={row.isSecret}
          aria-label={`Secret variable ${index + 1}`} onChange={event => onChange({ isSecret: event.target.checked })} />
        Secret
      </label>
      {row.isSecret && <button type="button" title={visible ? 'Hide value' : 'Show value'}
        aria-label={`${visible ? 'Hide' : 'Show'} value ${index + 1}`} onClick={onReveal}>
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>}
      <button type="button" title="Remove variable" aria-label={`Remove variable ${index + 1}`}
        className="text-ui-secondary hover:text-ui-error-text" onClick={onRemove}><Trash2 size={14} /></button>
    </div>
  </>;
}
