import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, X } from 'lucide-react';
import type { CollectionFolder } from '../types/api';
import { folderAncestors } from '../utils/folderTree';
import type { SharedSnapshot } from './LanPanel';

const actionStyle = 'cursor-pointer rounded border border-ui-border bg-ui-elevated px-3 py-1.5 hover:bg-ui-hover disabled:cursor-not-allowed disabled:opacity-50';
const inputStyle = 'min-w-0 rounded border border-ui-border bg-ui-canvas px-2 py-1.5 text-ui-ink';

interface GoogleProfile {
  sub: string;
  name?: string | null;
  email: string;
}

export function OnlinePanel({ folders, onClose, onRead }: {
  folders: CollectionFolder[];
  onClose: () => void;
  onRead: (snapshot: SharedSnapshot | undefined) => void;
}) {
  const [profile, setProfile] = useState<GoogleProfile | null>(null);
  const [connected, setConnected] = useState(false);
  const [pickerConfigured, setPickerConfigured] = useState(false);
  const [folderId, setFolderId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [sharedLink, setSharedLink] = useState('');
  const [openLink, setOpenLink] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const byId = useMemo(() => new Map(folders.map(folder => [folder.id, folder])), [folders]);

  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    Promise.all([
      invoke<GoogleProfile | null>('google_profile'),
      invoke<boolean>('google_drive_connected'),
      invoke<boolean>('drive_picker_configured'),
    ])
      .then(([next, drive, picker]) => {
        if (!active) return;
        setProfile(next);
        setConnected(drive);
        setPickerConfigured(picker);
      })
      .catch(error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, []);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError('');
    setStatus('');
    try {
      await action();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy('');
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="online-title" onClose={onClose}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-lg border border-ui-border bg-ui-surface p-4 text-ui-ink ide-shadow backdrop:bg-black/65">
        <header className="mb-4 flex items-center justify-between gap-2">
          <h2 id="online-title" className="flex items-center gap-2 text-base font-semibold"><Cloud size={17} /> Online Sharing</h2>
          <button type="button" className="cursor-pointer rounded p-1 hover:bg-ui-hover" aria-label="Close Online Sharing" onClick={onClose}><X size={16} /></button>
        </header>
        <section className="space-y-2 border-b border-ui-border pb-4">
          <h3 className="font-semibold">Google account</h3>
          {profile && <p className="break-words">{profile.name ?? profile.email}{profile.name && <span className="block text-ui-secondary">{profile.email}</span>}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!!busy} className={actionStyle}
              onClick={() => void run('Waiting for Google in your browser…', async () => {
                setProfile(await invoke<GoogleProfile>('google_login', { drive: true }));
                setConnected(true);
                setSharedLink('');
                onRead(undefined);
                setStatus('Google Drive connected.');
              })}>{connected ? 'Reconnect Google Drive' : profile ? 'Connect Google Drive' : 'Sign in with Google'}</button>
            {profile && <button type="button" disabled={!!busy} className={actionStyle} onClick={() => void run('Signing out…', async () => {
              await invoke('google_logout');
              setProfile(null);
              setConnected(false);
              setSharedLink('');
              onRead(undefined);
              setStatus('Signed out.');
            })}>Sign out</button>}
          </div>
          <p className="text-[11px] text-ui-secondary">PostDove stores JSON snapshots in My Drive / PostDove.</p>
        </section>
        <section className="space-y-3 border-b border-ui-border py-4">
          <h3 className="font-semibold">Publish a folder</h3>
          <label className="grid gap-1">Folder
            <select className={inputStyle} value={folderId} disabled={!!busy} onChange={event => {
              setFolderId(event.target.value);
              setSharedLink('');
            }}>
              <option value="">Choose a folder</option>
              {folders.map(folder => (
                <option key={folder.id} value={folder.id}>
                  {[...folderAncestors(folder.id, byId), folder].map(item => item.name).join(' / ')}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={actionStyle} disabled={!!busy || !connected || !folderId}
            onClick={() => void run('Publishing to Google Drive…', async () => {
              setSharedLink(await invoke<string>('drive_publish', { folderId }));
              setStatus('Snapshot saved in My Drive / PostDove.');
            })}>Publish to Drive</button>
          {sharedLink && <>
            <label className="grid gap-1">Share this invitation
              <input className={inputStyle} value={sharedLink} readOnly onFocus={event => event.target.select()} />
            </label>
            <form className="grid gap-2" onSubmit={event => {
              event.preventDefault();
              void run('Granting Viewer access…', async () => {
                await invoke('drive_grant', { link: sharedLink, email: recipient });
                setStatus('Viewer access granted.');
                setRecipient('');
              });
            }}>
              <label className="grid gap-1">Recipient’s Google email
                <input type="email" required className={inputStyle} value={recipient} disabled={!!busy}
                  onChange={event => setRecipient(event.target.value)} />
              </label>
              <button className={actionStyle} disabled={!!busy || !recipient.trim()}>Share as Viewer</button>
            </form>
            <button type="button" className={actionStyle} disabled={!!busy}
              onClick={() => void run('Opening Google Drive…', () => invoke('drive_open_in_browser', { link: sharedLink }))}>Manage access in Drive</button>
          </>}
        </section>
        <section className="space-y-3 pt-4">
          <h3 className="font-semibold">Open a shared folder</h3>
          <label className="grid gap-1">PostDove invitation or Drive file link
            <input className={inputStyle} value={openLink} placeholder="Paste an invitation" disabled={!!busy}
              onChange={event => setOpenLink(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={actionStyle} disabled={!!busy || !connected || !openLink.trim()}
              onClick={() => void run('Reading Google Drive…', async () => {
                onRead(await invoke<SharedSnapshot>('drive_read', { link: openLink }));
                setStatus('Open Collections to view the read-only folder.');
              })}>Open shared folder</button>
            {pickerConfigured && <button type="button" className={actionStyle} disabled={!!busy || !connected}
              onClick={() => void run('Waiting for Google Picker…', async () => {
                const snapshot = await invoke<SharedSnapshot | null>('drive_pick');
                if (!snapshot) return;
                onRead(snapshot);
                setStatus('Open Collections to view the read-only folder.');
              })}>Choose with Google Picker</button>}
            <button type="button" className={actionStyle} disabled={!!busy || !openLink.trim()}
              onClick={() => void run('Opening Google Drive…', () => invoke('drive_open_in_browser', { link: openLink }))}>Open in Drive</button>
            <button type="button" className={actionStyle} disabled={!!busy}
              onClick={() => void run('Opening a JSON snapshot…', async () => {
                const snapshot = await invoke<SharedSnapshot | null>('drive_import');
                if (!snapshot) return;
                onRead(snapshot);
                setStatus('Open Collections to view the imported read-only snapshot.');
              })}>Import downloaded JSON</button>
          </div>
        </section>
        {(busy || status) && <p className="mt-3 text-ui-secondary" role="status">{busy || status}</p>}
        {error && <p className="mt-3 break-words text-ui-error-text" role="alert">{error}</p>}
    </dialog>
  );
}
