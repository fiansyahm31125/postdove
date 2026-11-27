import type { ApiRequest } from '../types/api';
import type { OperationResult } from './OperationResultDialog';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Network, X } from 'lucide-react';

export interface LanStatus {
  suggestedAddress: string;
  hostAddress: string | null;
  viewerAddress: string | null;
  viewerFingerprint: string | null;
  pairedDevices: number;
}
interface Offer {
  invitation: string;
  pin: string;
  fingerprint: string;
  expiresInSeconds: number;
}
export type OnlineRequestConfig = Partial<Pick<ApiRequest, 'headers' | 'params' | 'auth'
  | 'bodyMode' | 'bodyContent' | 'formBody' | 'assertions'>>;

export interface SharedSnapshot {
  folders: { id: string; name: string; desktopParent?: string | null; sharedBy?: string }[];
  requests: {
    id: string; folderId: string; name: string; method: string; url: string;
    headers: string[]; parameters: string[]; onlineConfig?: OnlineRequestConfig;
  }[];
}

function renderSharedFolder(snapshot: SharedSnapshot, folder: SharedSnapshot['folders'][number], compact: boolean, source: 'LAN' | 'Online') {
  return <details key={folder.id} open={!compact} className="mt-1 rounded border border-ui-border p-2">
    <summary className="cursor-pointer break-words font-medium">
      {folder.name}
      <span className="ml-1.5 inline-flex items-center gap-1 align-middle text-[10px] text-ui-green"
        title={folder.sharedBy ? `Shared by ${folder.sharedBy} · Read-only` : `Shared via ${source} · Read-only`}>
        <Network className="h-3 w-3" aria-hidden="true" /> {source}
      </span>
    </summary>
    {snapshot.folders.filter(child => child.desktopParent === folder.id).map(child => renderSharedFolder(snapshot, child, compact, source))}
    {snapshot.requests.filter(request => request.folderId === folder.id).map(request => <div key={request.id}
      className="mt-2 space-y-0.5 border-t border-ui-border pt-2">
      <div><span className="font-mono text-ui-accent-soft">{request.method}</span> {request.name}</div>
      <div className="break-all font-mono text-[11px] text-ui-secondary">{request.url}</div>
      {request.headers.length > 0 && <div className="text-ui-secondary">Headers: {request.headers.join(', ')}</div>}
      {request.parameters.length > 0 && <div className="text-ui-secondary">Parameters: {request.parameters.join(', ')}</div>}
    </div>)}
  </details>;
}

export function SharedWorkspace({ snapshot, compact = false, source = 'LAN' }: { snapshot: SharedSnapshot; compact?: boolean; source?: 'LAN' | 'Online' }) {
  const ids = new Set(snapshot.folders.map(folder => folder.id));
  return (
    <section className={compact ? 'border-t border-ui-border px-2 py-2' : 'border-t border-ui-border p-4'} aria-label={source === 'LAN' ? 'Read-only workspace' : 'Online read-only workspace'}>
      <h3 className="mb-1 text-[12px] font-semibold text-ui-ink">{source === 'LAN' ? 'Shared workspace' : 'Online folders'} <span className="font-normal text-ui-secondary">· Read-only</span></h3>
      {!snapshot.folders.length && <p className="text-[11px] text-ui-secondary">The host hasn’t shared any folders.</p>}
      {snapshot.folders.filter(folder => !folder.desktopParent || !ids.has(folder.desktopParent))
        .map(folder => renderSharedFolder(snapshot, folder, compact, source))}
    </section>
  );
}

const inputClass = 'min-w-0 rounded border border-ui-border bg-ui-canvas p-2 text-ui-ink';
const buttonClass = 'rounded border border-ui-border bg-ui-elevated px-2.5 py-1.5 hover:bg-ui-hover disabled:opacity-40';

export function LanPanel({ onClose, onSharingChange, onViewerAddressChange, snapshot, onSnapshot, reportResult }: {
  onClose: () => void;
  onSharingChange: (active: boolean) => void;
  onViewerAddressChange: (address: string | null) => void;
  snapshot?: SharedSnapshot;
  onSnapshot: (snapshot: SharedSnapshot | undefined) => void;
  reportResult: (result: OperationResult) => void;
}) {
  const [status, setStatus] = useState<LanStatus>();
  const [address, setAddress] = useState('');
  const [offer, setOffer] = useState<Offer>();
  const [expiresAt, setExpiresAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [invitation, setInvitation] = useState('');
  const [inviteInfo, setInviteInfo] = useState<[string, string]>();
  const [confirmed, setConfirmed] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function reloadStatus() {
    const next = await invoke<LanStatus>('lan_status');
    setStatus(next);
    onSharingChange(Boolean(next.hostAddress));
    onViewerAddressChange(next.viewerAddress);
    return next;
  }

  useEffect(() => {
    let current = true;
    invoke<LanStatus>('lan_status').then(next => {
      if (!current) return;
      setStatus(next);
      onSharingChange(Boolean(next.hostAddress));
      onViewerAddressChange(next.viewerAddress);
      setAddress(next.hostAddress ?? next.suggestedAddress);
    }).catch(error => { if (current) setError(String(error)); });
    return () => { current = false; };
  }, [onSharingChange, onViewerAddressChange]);

  useEffect(() => {
    if (!expiresAt) return;
    const refresh = () => setSeconds(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  useEffect(() => {
    if (!invitation.trim()) return;
    let current = true;
    invoke<[string, string]>('lan_invite_info', { invitation }).then(info => {
      if (current) setInviteInfo(info);
    }).catch(() => {});
    return () => { current = false; };
  }, [invitation]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  async function run(action: () => Promise<void>, resultAction?: string) {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await action();
      if (resultAction) reportResult({ action: resultAction, ok: true });
    } catch (error) {
      setError(String(error));
      if (resultAction) reportResult({ action: resultAction, ok: false, detail: String(error) });
    } finally {
      setBusy(false);
    }
  }

  function start() {
    void run(async () => {
      const next = await invoke<Offer>('lan_host_start', { address });
      onSharingChange(true);
      setOffer(next);
      setExpiresAt(Date.now() + next.expiresInSeconds * 1000);
      await reloadStatus();
    }, status?.hostAddress ? 'Generate pairing PIN' : 'Start LAN sharing');
  }

  function inspectInvite(value: string) {
    setInvitation(value);
    setConfirmed(false);
    setInviteInfo(undefined);
  }

  function refresh() {
    void run(async () => {
      onSnapshot(undefined);
      onSnapshot(await invoke<SharedSnapshot>('lan_read'));
      await reloadStatus();
    });
  }

  function pair() {
    void run(async () => {
      try {
        await invoke('lan_pair', { invitation, pin });
      } catch (error) {
        reportResult({ action: 'Pair LAN viewer', ok: false, detail: String(error) });
        throw error;
      }
      onSnapshot(undefined);
      reportResult({ action: 'Pair LAN viewer', ok: true });
      setPin('');
      setInvitation('');
      setInviteInfo(undefined);
      setConfirmed(false);
      await reloadStatus();
      onSnapshot(await invoke<SharedSnapshot>('lan_read'));
    });
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/65 p-4" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="lan-title"
        className="w-full max-w-3xl max-h-[90dvh] overflow-auto rounded-lg border border-ui-border bg-ui-surface text-ui-ink shadow-xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-ui-border bg-ui-surface px-4 py-3">
          <h2 id="lan-title" className="flex items-center gap-2 text-[15px] font-semibold"><Network size={16} /> LAN Sharing</h2>
          <button type="button" autoFocus onClick={onClose} aria-label="Close LAN sharing" className={buttonClass}>
            <X size={15} />
          </button>
        </header>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <section className="min-w-0 space-y-2 rounded border border-ui-border p-3">
            <h3 className="font-semibold">Host · CRUD</h3>
            <p className="text-ui-secondary">Use the LAN control on each folder to share its requests. Viewers receive request names, methods, URLs without query values, and field names.</p>
            <label className="grid gap-1 text-ui-secondary">LAN address and port
              <input className={inputClass} value={address} onChange={event => setAddress(event.target.value)}
                placeholder="127.0.0.1:46329" disabled={Boolean(status?.hostAddress) || busy} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`${buttonClass} border-transparent bg-ui-accent text-ui-on-accent-alt`}
                onClick={start} disabled={busy || !address}>{status?.hostAddress ? 'New PIN' : 'Start sharing'}</button>
              {status?.hostAddress && <button type="button" className={buttonClass} disabled={busy}
                onClick={() => void run(async () => {
                  await invoke('lan_host_stop');
                  onSharingChange(false);
                  setOffer(undefined);
                  await reloadStatus();
                }, 'Stop LAN sharing')}>Stop sharing</button>}
            </div>
            {status?.hostAddress && <p className="break-all font-mono text-ui-green">{status.hostAddress}</p>}
            {!!status?.pairedDevices && <button type="button" className={buttonClass} disabled={busy}
              onClick={() => void run(async () => {
                await invoke('lan_revoke');
                setOffer(undefined);
                await reloadStatus();
              }, 'Revoke LAN viewers')}>Revoke {status.pairedDevices} paired device(s)</button>}
            {offer && <div className="space-y-2 border-t border-ui-border pt-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-lg tracking-widest text-ui-accent-soft">{seconds ? offer.pin : 'Expired'}</span>
                {seconds > 0 && <span className="text-ui-secondary">{seconds}s remaining</span>}
              </div>
              <div className="break-all font-mono text-[11px] text-ui-secondary">SHA-256 {offer.fingerprint}</div>
              <textarea aria-label="Generated invitation" value={offer.invitation} readOnly rows={2}
                className={`${inputClass} w-full font-mono text-[11px]`} />
              <button type="button" className={buttonClass} disabled={busy || !seconds}
                onClick={() => void run(async () => {
                  await navigator.clipboard.writeText(offer.invitation);
                  setMessage('Invitation copied. Give the PIN separately.');
                })}>Copy invitation</button>
            </div>}
          </section>
          <section className="min-w-0 space-y-2 rounded border border-ui-border p-3">
            <h3 className="font-semibold">Viewer · Read-only</h3>
            {status?.viewerAddress && <>
              <p className="break-all font-mono text-ui-green">Paired with {status.viewerAddress}</p>
              <p className="break-all font-mono text-[11px] text-ui-secondary">Pinned SHA-256 {status.viewerFingerprint}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass} disabled={busy} onClick={refresh}>Open shared workspace</button>
                <button type="button" className={buttonClass} disabled={busy} onClick={() => void run(async () => {
                  await invoke('lan_forget');
                  onViewerAddressChange(null);
                  onSnapshot(undefined);
                  await reloadStatus();
                }, 'Forget LAN host')}>Forget host</button>
              </div>
            </>}
            <label className="grid gap-1 text-ui-secondary">Invitation from host
              <textarea className={inputClass} value={invitation} rows={2} onChange={event => inspectInvite(event.target.value)}
                placeholder="Paste the Postdove LAN invitation" disabled={busy} />
            </label>
            {inviteInfo && <>
              <p className="break-all font-mono text-[11px] text-ui-secondary">{inviteInfo[0]} · SHA-256 {inviteInfo[1]}</p>
              <label className="flex items-start gap-2 text-ui-secondary">
                <input type="checkbox" className="ide-checkbox mt-0.5" checked={confirmed}
                  onChange={event => setConfirmed(event.target.checked)} disabled={busy} />
                Fingerprint matches the one shown on the host
              </label>
            </>}
            <label className="grid gap-1 text-ui-secondary">Six-digit PIN
              <input className={inputClass} value={pin} inputMode="numeric" maxLength={6}
                autoComplete="off" onChange={event => setPin(event.target.value.replace(/[^0-9]/g, ''))} disabled={busy} />
            </label>
            <button type="button" className={buttonClass} onClick={pair}
              disabled={busy || !confirmed || !inviteInfo || pin.length !== 6}>Pair &amp; open</button>
          </section>
        </div>
        {error && <p className="break-words px-4 pb-3 text-ui-error-text" role="alert">{error}</p>}
        {message && <p className="px-4 pb-3 text-ui-green" role="status">{message}</p>}
        {snapshot && <SharedWorkspace snapshot={snapshot} />}
      </section>
    </div>
  );
}
