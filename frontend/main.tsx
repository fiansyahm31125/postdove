import { createRoot } from 'react-dom/client';
import App from './App';
import { loadDesktopWorkspace } from './main';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './index.css';

const root = createRoot(document.getElementById('root')!);
loadDesktopWorkspace().then(initial => root.render(<App initial={initial} />)).catch(error => {
  root.render(<main role="alert" className="p-6">Could not open Postdove workspace. {String(error)}</main>);
});
