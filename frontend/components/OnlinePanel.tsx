import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, X } from 'lucide-react';
import type { CollectionFolder } from '../types/api';
import { folderAncestors } from '../utils/folderTree';
import type { SharedSnapshot } from './LanPanel';

const invitationPage = 'https://fiansyahm31125.github.io/postdove/share.html';
const actionStyle = 'cursor-pointer rounded border border-ui-border bg-ui-elevated px-3 py-1.5 hover:bg-ui-hover disabled:cursor-not-allowed disabled:opacity-50';
const inputStyle = 'min-w-0 rounded border border-ui-border bg-ui-canvas px-2 py-1.5 text-ui-ink';

function repositoryName(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith(invitationPage + '#')) return trimmed;
  return new URLSearchParams(new URL(trimmed).hash.slice(1)).get('repo') ?? '';
}

interface GoogleProfile {
  sub: string;
  name?: string | null;
  email: string;
}

export function OnlinePanel({ folders, onClose, onRead }: {
  folders: CollectionFolder[];
  onClose: () => void;
  onRead: (snapshot: SharedSnapshot) => void;
}) {
  const [profile, setProfile] = useState<GoogleProfile | null>(null);
  const [repository, setRepository] = useState('');
  const [token, setToken] = useState('');
  const [selection, setSelection] = useState(new Set<string>());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [invitation, setInvitation] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const byId = useMemo(() => new Map(folders.map(folder => [folder.id, folder])), [folders]);

  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    invoke<GoogleProfile | null>('google_profile')
      .then(next => { if (active) setProfile(next); })
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

  const target = repositoryName(repository);
  const configured = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(target) && !!token.trim();

  return (
    <dialog ref={dialog} aria-labelledby="online-title" onClose={onClose}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-lg border border-ui-border bg-ui-surface p-4 text-ui-ink ide-shadow backdrop:bg-black/65">
        <header className="mb-4 flex items-center justify-between gap-2">
          <h2 id="online-title" className="flex items-center gap-2 text-base font-semibold"><Cloud size={17} /> Online Sharing</h2>
          <button type="button" className="cursor-pointer rounded p-1 hover:bg-ui-hover" aria-label="Close Online Sharing" onClick={onClose}><X size={16} /></button>
        </header>
        <section className="space-y-2 border-b border-ui-border pb-4">
          <h3 className="font-semibold">Profile</h3>
          {profile ? <>
            <p className="break-words">{profile.name ?? profile.email}{profile.name && <span className="block text-ui-secondary">{profile.email}</span>}</p>
            <button type="button" disabled={!!busy} className={actionStyle} onClick={() => void run('Signing out…', async () => {
              await invoke('google_logout');
              setProfile(null);
              setStatus('Signed out.');
            })}>Sign out</button>
          </> : <button type="button" disabled={!!busy} className={actionStyle} onClick={() => void run('Waiting for Google in your browser…', async () => {
            setProfile(await invoke<GoogleProfile>('google_login'));
            setStatus('Google account connected.');
          })}>Sign in with Google</button>}
          <p className="text-[11px] text-ui-secondary">Google identifies your profile. GitHub controls who can open the shared repository.</p>
        </section>
        <section className="space-y-3 pt-4">
          <label className="grid gap-1">Private GitHub repository or PostDove invitation
            <input className={inputStyle} autoFocus value={repository} onChange={event => {
              setRepository(event.target.value);
              setInvitation('');
            }} placeholder="owner/repository" disabled={!!busy} />
          </label>
          <label className="grid gap-1">GitHub access token
            <input type="password" className={inputStyle} value={token} onChange={event => setToken(event.target.value)}
              autoComplete="off" disabled={!!busy} />
          </label>
          <button type="button" className={actionStyle} disabled={!!busy || !configured}
            onClick={() => void run('Reading GitHub…', async () => {
              onRead(await invoke<SharedSnapshot>('online_read', { repository: target, token }));
              setStatus('Open Collections to view the online folders.');
            })}>Open shared folders</button>
          <fieldset className="rounded border border-ui-border p-2">
            <legend className="px-1 font-semibold">Folders to publish</legend>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {folders.map(folder => <label key={folder.id} className="flex cursor-pointer items-start gap-2 break-all">
                <input type="checkbox" className="ide-checkbox mt-0.5" checked={selection.has(folder.id)} disabled={!!busy}
                  onChange={event => {
                    const checked = event.target.checked;
                    setSelection(previous => {
                      const next = new Set(previous);
                      if (checked) next.add(folder.id);
                      else next.delete(folder.id);
                      return next;
                    });
                  }} />
                {[...folderAncestors(folder.id, byId), folder].map(item => item.name).join(' / ')}
              </label>)}
            </div>
          </fieldset>
          <p className="text-[11px] text-ui-secondary">Publishing replaces the current snapshot for everyone with access to this repository. Earlier commits remain in GitHub history.</p>
          <button type="button" className={actionStyle} disabled={!!busy || !configured}
            onClick={() => {
              if (!selection.size && !window.confirm('Replace the current shared folders with an empty snapshot?')) return;
              void run('Publishing to GitHub…', async () => {
                await invoke('online_publish', { repository: target, token, folders: [...selection] });
                setInvitation(invitationPage + '#' + new URLSearchParams({ repo: target }));
                setStatus(selection.size ? 'Snapshot published.' : 'An empty snapshot was published.');
              });
            }}>{selection.size ? 'Publish selected folders' : 'Publish empty snapshot'}</button>
          {invitation && <label className="grid gap-1">Share this invitation
            <input className={inputStyle} value={invitation} readOnly onFocus={event => event.target.select()} />
          </label>}
        </section>
        {(busy || status) && <p className="mt-3 text-ui-secondary" role="status">{busy || status}</p>}
        {error && <p className="mt-3 break-words text-ui-error-text" role="alert">{error}</p>}
    </dialog>
  );
}
