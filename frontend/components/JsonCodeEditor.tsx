import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlignLeft, AlertCircle, CheckCircle2, Minimize2 } from 'lucide-react';
import { extractTemplateVariables } from '../utils/httpUtils';
import { VariableText, type VariableActions } from './VariableEditor';

interface JsonCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  mode: 'json' | 'raw';
  placeholder?: string;
  variableActions?: VariableActions;
}

export function JsonCodeEditor({
  value,
  onChange,
  mode,
  placeholder = '{\n  "key": "value"\n}',
  variableActions,
}: JsonCodeEditorProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const scroll = useRef({ left: 0, top: 0 });
  const [editing, setEditing] = useState(false);
  const hasVariables = Boolean(variableActions) && extractTemplateVariables(value).length > 0;
  const showPreview = hasVariables && !editing;

  useLayoutEffect(() => {
    const field = showPreview ? previewRef.current : textareaRef.current;
    if (!field) return;
    field.scrollLeft = scroll.current.left;
    field.scrollTop = scroll.current.top;
  }, [showPreview]);

  const lines = useMemo(() => {
    const count = Math.max(1, value.split('\n').length);
    return Array.from({ length: count }, (_, idx) => idx + 1);
  }, [value]);

  const jsonValidation = useMemo(() => {
    if (mode !== 'json' || !value.trim()) {
      return { valid: true, message: '' };
    }
    try {
      // Allow {{variables}} inside JSON values during validation check
      const sanitized = value.replace(/\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/g, 'placeholder_val');
      JSON.parse(sanitized);
      return { valid: true, message: 'Valid JSON' };
    } catch (err) {
      return {
        valid: false,
        message: err instanceof Error ? err.message : 'Invalid JSON syntax',
      };
    }
  }, [value, mode]);

  const handleScroll = (field: HTMLElement) => {
    scroll.current = { left: field.scrollLeft, top: field.scrollTop };
    if (gutterRef.current) {
      gutterRef.current.scrollTop = field.scrollTop;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const nextValue = value.slice(0, start) + '  ' + value.slice(end);
      onChange(nextValue);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      });
    }
  };

  const handleFormat = () => {
    if (!value.trim()) return;
    try {
      const parsed = JSON.parse(value);
      onChange(JSON.stringify(parsed, null, 2));
    } catch {
      // Keep current value if invalid JSON
    }
  };

  const handleMinify = () => {
    if (!value.trim()) return;
    try {
      const parsed = JSON.parse(value);
      onChange(JSON.stringify(parsed));
    } catch {
      // Keep current value if invalid JSON
    }
  };

  return (
    <div className="flex flex-col h-full min-h-[200px] border border-ui-border rounded-[4px] bg-ui-canvas overflow-hidden focus-within:border-ui-accent transition-colors">
      {/* Editor Toolbar */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-ui-surface border-b border-ui-border shrink-0">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-mono text-ui-secondary uppercase">{mode}</span>
          {mode === 'json' && value.trim() && (
            <>
              <span className="text-ui-border">|</span>
              {jsonValidation.valid ? (
                <span className="inline-flex items-center gap-1 text-ui-green">
                  <CheckCircle2 className="w-3 h-3" />
                  Valid JSON
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 text-ui-danger truncate max-w-[320px]"
                  title={jsonValidation.message}
                >
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  <span className="truncate">{jsonValidation.message}</span>
                </span>
              )}
            </>
          )}
        </div>

        {(mode === 'json' || showPreview) && (
          <div className="flex items-center gap-1.5">
            {showPreview && <button type="button" onClick={() => setEditing(true)}
              className="rounded border border-ui-border px-2 py-0.5 text-[11px] text-ui-secondary hover:text-ui-ink">Edit body</button>}
            {mode === 'json' && <>
            <button
              type="button"
              onClick={handleFormat}
              disabled={!jsonValidation.valid || !value.trim()}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-ui-ink bg-ui-elevated hover:bg-ui-hover disabled:opacity-40 disabled:cursor-not-allowed border border-ui-border rounded-[4px] transition-colors cursor-pointer whitespace-nowrap"
            >
              <AlignLeft className="w-3 h-3" />
              Format
            </button>
            </>}
            <button
              type="button"
              onClick={handleMinify}
              disabled={!jsonValidation.valid || !value.trim()}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-ui-secondary hover:text-ui-ink bg-ui-elevated hover:bg-ui-hover disabled:opacity-40 disabled:cursor-not-allowed border border-ui-border rounded-[4px] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Minimize2 className="w-3 h-3" />
              Minify
            </button>
          </div>
        )}
      </div>

      {/* Gutter + Textarea */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="w-[44px] py-2.5 pr-2.5 pl-1 bg-ui-canvas border-r border-ui-border/70 text-right font-mono text-[12px] leading-[20px] text-ui-muted select-none overflow-hidden tabular-nums shrink-0"
        >
          {lines.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
        {showPreview && variableActions ? (
          <div ref={previewRef} onScroll={event => handleScroll(event.currentTarget)}
            className="min-w-0 flex-1 overflow-auto whitespace-pre bg-ui-canvas px-3 py-2.5 font-mono text-[13px] leading-[20px] text-ui-ink">
            <VariableText value={value} actions={variableActions} onEditText={() => setEditing(true)} />
            {'\u200b'}
          </div>
        ) : <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={event => handleScroll(event.currentTarget)}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          autoFocus={editing}
          className="flex-1 w-full h-full resize-none bg-ui-canvas px-3 py-2.5 font-mono text-[13px] leading-[20px] text-ui-ink placeholder-ui-muted focus:outline-none overflow-auto whitespace-pre"
        />}
      </div>
    </div>
  );
}
