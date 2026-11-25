import { useEffect, useRef } from 'react';

export interface OperationResult {
  action: string;
  ok: boolean;
  detail?: string;
  retry?: () => void;
}

export function isWriteMethod(method: string) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

export function OperationResultDialog({ result, onClose }: {
  result: OperationResult;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dismiss = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    dismiss.current?.focus();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} aria-labelledby="operation-result-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    className="m-auto max-h-[85vh] w-[min(92vw,460px)] overflow-auto rounded-lg border border-ui-border bg-ui-surface p-4 text-ui-ink shadow-xl backdrop:bg-black/65">
    <div className="grid gap-3">
      <h2 id="operation-result-title" className={`text-[15px] font-semibold ${result.ok ? 'text-ui-string' : 'text-ui-error-text'}`}>
        {result.ok ? 'Success' : 'Failed'}
      </h2>
      <p className="font-medium">{result.action}</p>
      {result.detail && <p className="whitespace-pre-wrap break-words text-ui-secondary">{result.detail}</p>}
      <div className="flex justify-end gap-2">
        {result.retry && <button type="button" onClick={() => { onClose(); result.retry?.(); }}
          className="rounded border border-ui-border px-3 py-1.5">Retry save</button>}
        <button ref={dismiss} type="button" onClick={onClose}
          className="rounded bg-ui-accent px-3 py-1.5 font-semibold text-ui-on-accent">OK</button>
      </div>
    </div>
  </dialog>;
}
