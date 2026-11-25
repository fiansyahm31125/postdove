import { useEffect, useRef, useState } from 'react';
import { extractTemplateVariables } from '../utils/httpUtils';
import type { EnvironmentVariable } from '../types/api';

export interface VariableActions {
  lookup: (name: string) => EnvironmentVariable | undefined;
  edit: (name: string) => void;
}

const inputClass = 'w-full bg-transparent px-2.5 py-1.5 font-mono text-[12px] text-ui-ink placeholder-ui-muted focus:outline-none focus:bg-ui-surface focus:ring-1 focus:ring-inset focus:ring-ui-accent';

export function VariableText({ value, actions, onEditText, masked = false }: {
  value: string;
  actions: VariableActions;
  onEditText?: () => void;
  masked?: boolean;
}) {
  let cursor = 0;
  const text = (content: string) => content && <span onClick={onEditText} className={onEditText ? "cursor-text" : undefined}>
    {masked ? '•'.repeat(content.length) : content}
  </span>;
  const segments = [...value.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map(match => {
    const before = value.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const name = match[1];
    const variable = actions.lookup(name);
    const hint = variable
      ? variable.isSecret ? 'Hidden value' : (variable.currentValue ?? variable.initialValue) || '(empty value)'
      : 'Undefined variable';
    return <span key={match.index}>
      {text(before)}
      <button type="button" className="inline rounded-sm bg-ui-accent/10 text-ui-number hover:bg-ui-accent/25 focus-visible:outline focus-visible:outline-ui-accent"
        title={`${match[0]}: ${hint}\nClick to edit variable`} aria-label={`Edit variable ${name}`}
        onClick={() => actions.edit(name)}>{match[0]}</button>
    </span>;
  });
  return <>{segments}{text(value.slice(cursor))}</>;
}

export function VariableValue({ value, placeholder, onChange, actions, className = inputClass,
  label = 'Field value', inputType = 'text', onEnter }: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  actions?: VariableActions;
  className?: string;
  label?: string;
  inputType?: 'text' | 'password';
  onEnter?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const matches = actions && extractTemplateVariables(value).length > 0;
  if (editing || !matches || !actions) {
    return <input type={inputType} aria-label={label} className={className} value={value} placeholder={placeholder}
      autoFocus={editing} spellCheck={false} autoComplete="off" onChange={event => onChange(event.target.value)}
      onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} onKeyDown={event => {
        if (event.key === 'Enter' && onEnter && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          onEnter();
        }
        if (event.key === 'Escape' || event.key === 'Enter') event.currentTarget.blur();
      }} />;
  }
  return <div className={`${className} flex min-w-0 items-center gap-1`}>
    <div className="min-w-0 flex-1 overflow-x-auto whitespace-pre leading-5">
      <VariableText value={value} actions={actions} masked={inputType === 'password'} onEditText={() => setEditing(true)} />
    </div>
    <button type="button" aria-label={label === 'Field value' ? 'Edit field value' : `Edit ${label}`}
      title={`Edit ${label}`} onClick={() => setEditing(true)} className="shrink-0 text-ui-secondary hover:text-ui-ink">✎</button>
  </div>;
}

export function VariableEditor({ name, source, value, isSecret, onSave, onClose }: {
  name: string;
  source: string;
  value: string;
  isSecret: boolean;
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [next, setNext] = useState(value);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    field.current?.focus();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} aria-labelledby="variable-title" onCancel={event => {
    event.preventDefault();
    onClose();
  }} className="m-auto w-[min(92vw,440px)] rounded-lg border border-ui-border bg-ui-surface p-4 text-ui-ink shadow-xl backdrop:bg-black/65">
    <form className="grid gap-3" onSubmit={event => { event.preventDefault(); onSave(next); }}>
      <h2 id="variable-title" className="text-[15px] font-semibold">Edit variable <code>{`{{${name}}}`}</code></h2>
      <p className="text-ui-secondary">{source}</p>
      <label className="grid gap-1 text-ui-secondary">Variable value
        <input ref={field} type={isSecret && !show ? 'password' : 'text'} value={next}
          onChange={event => setNext(event.target.value)} autoComplete="off" spellCheck={false}
          className="rounded border border-ui-border bg-ui-canvas p-2 font-mono text-ui-ink" />
      </label>
      {isSecret && <button type="button" className="justify-self-start text-ui-number"
        onClick={() => setShow(value => !value)}>{show ? 'Hide value' : 'Show value'}</button>}
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded border border-ui-border px-3 py-1.5" onClick={onClose}>Cancel</button>
        <button type="submit" className="rounded bg-ui-accent px-3 py-1.5 font-semibold text-ui-on-accent">Save variable</button>
      </div>
    </form>
  </dialog>;
}
