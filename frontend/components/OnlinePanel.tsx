import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, X } from 'lucide-react';
import type { CollectionFolder } from '../types/api';
import { folderAncestors } from '../utils/folderTree';
import type { SharedSnapshot } from './LanPanel';

const actionStyle = 'cursor-pointer rounded border border-ui-border bg-ui-elevated px-3 py-1.5 hover:bg-ui-hover disabled:cursor-not-allowed disabled:opacity-50';
const primaryStyle = 'cursor-pointer rounded border border-transparent bg-ui-accent px-3 py-1.5 font-medium text-ui-on-accent hover:bg-ui-accent-hover disabled:cursor-not-allowed disabled:opacity-50';
const inputStyle = 'min-w-0 rounded border border-ui-border bg-ui-canvas px-2 py-1.5 text-ui-ink';

interface GoogleProfile {
  sub: string;
  name?: string | null;
  email: string;
}

export interface OnlineInvitation {
  id: string;
  sender: string;
  link: string;
  accepted: boolean;
}

export function OnlinePanel({ folders, onClose, onRead, onLogout, invitations, invitationError, onAccept, onDismiss }: {
  folders: CollectionFolder[];
  onClose: () => void;
  onRead: (snapshot: SharedSnapshot | undefined) => void;
  onLogout: () => void;
  invitations: OnlineInvitation[];
  invitationError: string;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [profile, setProfile] = useState<GoogleProfile | null>(null);
  const [connected, setConnected] = useState(false);
  const [pickerConfigured, setPickerConfigured] = useState(false);
  const [folderId, setFolderId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [sharedLink, setSharedLink] = useState('');
  const [openLink, setOpenLink] = useState('');
  const [view, setView] = useState<'invitations' | 'share'>('invitations');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const options = useRef<HTMLDetailsElement>(null);
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
      if (connected) {
        const stillConnected = await invoke<boolean>('google_drive_connected').catch(() => undefined);
        if (stillConnected === false) setConnected(false);
      }
    } finally {
      setBusy('');
    }
  }

  function connect() {
    void run('Waiting for Google in your browser…', async () => {
      setProfile(await invoke<GoogleProfile>('google_login', { drive: true }));
      setConnected(true);
      setSharedLink('');
      onRead(undefined);
      setStatus('Google Drive connected.');
    });
  }

  function showSnapshot(snapshot: SharedSnapshot) {
    onRead(snapshot);
    onClose();
  }

  function openFolder(link: string) {
    if (!connected) {
      setStatus('Connect Google Drive to open this folder.');
      return;
    }
    void run('Opening shared folder…', async () => {
      try {
        showSnapshot(await invoke<SharedSnapshot>('drive_read', { link }));
      } catch (error) {
        setOpenLink(link);
        if (options.current) options.current.open = true;
        throw error;
      }
    });
  }

  async function publish() {
    const link = await invoke<string>('drive_publish', { folderId });
    setSharedLink(link);
    return link;
  }

  const pending = invitations.filter(invitation => !invitation.accepted).length;

  return (
    <dialog ref={dialog} aria-labelledby="online-title" onClose={onClose}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-auto rounded-lg border border-ui-border bg-ui-surface p-4 text-ui-ink ide-shadow backdrop:bg-black/65">
      <header className="flex items-center justify-between gap-2">
        <h2 id="online-title" className="flex items-center gap-2 text-base font-semibold">
          <Cloud size={17} aria-hidden="true" /> Online Sharing
        </h2>
        <button type="button" className="cursor-pointer rounded p-1 hover:bg-ui-hover" aria-label="Close Online Sharing" onClick={onClose}><X size={16} /></button>
      </header>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px]">
        {profile && <span className="min-w-0 break-all text-ui-secondary">{profile.email}</span>}
        {!connected && <button type="button" disabled={!!busy} className={actionStyle} onClick={connect}>Connect Google Drive</button>}
        {profile && <details className="text-ui-secondary">
          <summary className="cursor-pointer">Account options</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {connected && <button type="button" disabled={!!busy} className={actionStyle} onClick={connect}>Reconnect Drive</button>}
            <button type="button" disabled={!!busy} className={actionStyle} onClick={() => void run('Signing out…', async () => {
              await invoke('google_logout');
              onLogout();
            })}>Sign out</button>
          </div>
        </details>}
      </div>

      <nav aria-label="Online Sharing views" className="mt-4 flex gap-1 border-b border-ui-border">
        {(['invitations', 'share'] as const).map(next => (
          <button type="button" key={next} aria-pressed={view === next} disabled={!!busy}
            className="cursor-pointer border-b-2 border-transparent px-3 py-2 text-ui-secondary hover:text-ui-ink aria-pressed:border-ui-accent aria-pressed:font-semibold aria-pressed:text-ui-ink"
            onClick={() => {
              setView(next);
              setStatus('');
              setError('');
            }}>
            {next === 'invitations' ? `Invitations${pending ? ` (${pending})` : ''}` : 'Share a folder'}
          </button>
        ))}
      </nav>

      {view === 'invitations' ? <section aria-label="Invitations" className="space-y-3 pt-3">
        {invitationError && <p className="text-ui-error-text" role="status">{invitationError}</p>}
        {!invitationError && !invitations.length && <p className="py-2 text-ui-secondary">No invitations yet.</p>}
        {invitations.map(invitation => (
          <div key={invitation.id} className="flex flex-wrap items-center gap-2 border-b border-ui-border pb-2">
            <div className="min-w-[9rem] flex-1">
              <span className="block break-all">{invitation.sender}</span>
              <span className="text-[11px] text-ui-secondary">{invitation.accepted ? 'Accepted' : 'Pending'}</span>
            </div>
            {invitation.accepted
              ? <button type="button" className={actionStyle} disabled={!!busy} onClick={() => openFolder(invitation.link)}>Open folder</button>
              : <button type="button" className={primaryStyle} disabled={!!busy}
                  onClick={() => void run('Accepting invitation…', async () => {
                    await invoke('firebase_accept', { id: invitation.id });
                    onAccept(invitation.id);
                    setStatus('Invitation accepted.');
                  })}>Accept</button>}
            <button type="button" className="cursor-pointer rounded px-2 py-1.5 text-ui-secondary hover:text-ui-ink disabled:opacity-50" disabled={!!busy}
              onClick={() => void run(invitation.accepted ? 'Removing invitation…' : 'Declining invitation…', async () => {
                await invoke('firebase_dismiss', { id: invitation.id });
                onDismiss(invitation.id);
              })}>{invitation.accepted ? 'Remove' : 'Decline'}</button>
          </div>
        ))}
        <details ref={options} className="text-ui-secondary">
          <summary className="cursor-pointer py-1 text-[12px]">Open another way</summary>
          <div className="mt-2 space-y-2">
            <label className="grid gap-1">Drive link or invitation
              <input className={inputStyle} value={openLink} disabled={!!busy} onChange={event => setOpenLink(event.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={actionStyle} disabled={!!busy || !connected || !openLink.trim()}
                onClick={() => openFolder(openLink)}>Open link</button>
              <button type="button" className={actionStyle} disabled={!!busy || !openLink.trim()}
                onClick={() => void run('Opening Google Drive…', () => invoke('drive_open_in_browser', { link: openLink }))}>Open in Drive</button>
              <button type="button" className={actionStyle} disabled={!!busy}
                onClick={() => void run('Opening a JSON snapshot…', async () => {
                  const snapshot = await invoke<SharedSnapshot | null>('drive_import');
                  if (snapshot) showSnapshot(snapshot);
                })}>Import JSON</button>
              {pickerConfigured && <button type="button" className={actionStyle} disabled={!!busy || !connected}
                onClick={() => void run('Waiting for Google Picker…', async () => {
                  const snapshot = await invoke<SharedSnapshot | null>('drive_pick');
                  if (snapshot) showSnapshot(snapshot);
                })}>Google Picker</button>}
            </div>
          </div>
        </details>
      </section> : <section aria-label="Share a folder" className="space-y-3 pt-3">
        <form className="grid gap-3" onSubmit={event => {
          event.preventDefault();
          if (busy || !connected || !folderId || !recipient.trim()) return;
          void run('Publishing and sending invitation…', async () => {
            const link = await publish();
            const notificationError = await invoke<string | null>('drive_grant', { link, email: recipient });
            if (notificationError) {
              setStatus('Viewer access granted in Drive. Try sending the invitation again.');
              setError(notificationError);
              return;
            }
            setRecipient('');
            setStatus('Invitation sent.');
          });
        }}>
          <label className="grid gap-1">Folder
            <select className={inputStyle} value={folderId} disabled={!!busy} required onChange={event => {
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
          <label className="grid gap-1">Recipient’s Google email
            <input type="email" required className={inputStyle} value={recipient} disabled={!!busy}
              onChange={event => setRecipient(event.target.value)} />
          </label>
          <button className={primaryStyle + ' justify-self-start'} disabled={!!busy || !connected || !folderId || !recipient.trim()}>
            Send invitation
          </button>
        </form>
        <details className="text-ui-secondary">
          <summary className="cursor-pointer py-1 text-[12px]">Drive options</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={actionStyle} disabled={!!busy || !connected || !folderId}
              onClick={() => void run('Updating the Drive snapshot…', async () => {
                await publish();
                setStatus('Snapshot saved in My Drive / PostDove.');
              })}>Update snapshot</button>
            {sharedLink && <button type="button" className={actionStyle} disabled={!!busy}
              onClick={() => void run('Opening Google Drive…', () => invoke('drive_open_in_browser', { link: sharedLink }))}>Manage access in Drive</button>}
          </div>
        </details>
      </section>}

      {(busy || status) && <p className="mt-3 text-ui-secondary" role="status">{busy || status}</p>}
      {error && <p className="mt-3 break-words text-ui-error-text" role="alert">{error}</p>}
    </dialog>
  );
}
