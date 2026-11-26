import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import App from './App';
import { loadDesktopWorkspace, type StudioWorkspace } from './main';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './index.css';

function Desktop() {
  const [initial, setInitial] = useState<StudioWorkspace>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signIn() {
    setBusy(true);
    setError('');
    try {
      await invoke('google_login', { drive: false });
      setInitial(await loadDesktopWorkspace());
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!isTauri()) return (
    <main className="grid h-full place-items-center bg-ui-canvas p-5 text-ui-ink">
      <section className="w-full max-w-sm rounded-lg border border-ui-border bg-ui-surface p-6">
        <h1 className="text-xl font-semibold">Open PostDove Desktop</h1>
        <p className="mt-2 text-ui-secondary">Google sign-in and collection sharing require the PostDove desktop app.</p>
      </section>
    </main>
  );

  if (initial) return <App initial={initial} onLogout={() => {
    setInitial(undefined);
    document.documentElement.dataset.mode = 'dark';
    document.documentElement.dataset.style = 'minimalism';
  }} />;

  return (
    <main className="grid h-full place-items-center bg-ui-canvas p-5 text-ui-ink">
      <section className="w-full max-w-sm rounded-lg border border-ui-border bg-ui-surface p-6" aria-labelledby="sign-in-title">
        <h1 id="sign-in-title" className="text-xl font-semibold">Sign in to PostDove</h1>
        <p className="mt-2 text-ui-secondary">Use your Google account to open your workspace and receive collection invitations.</p>
        <button type="button" disabled={busy} onClick={() => void signIn()}
          className="mt-5 cursor-pointer rounded border border-ui-border bg-ui-elevated px-4 py-2 hover:bg-ui-hover disabled:opacity-50">
          Sign in with Google
        </button>
        {busy && <p className="mt-3 text-ui-secondary" role="status">Continue in your browser…</p>}
        {error && <p className="mt-3 break-words text-ui-error-text" role="alert">{error}</p>}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Desktop />);
