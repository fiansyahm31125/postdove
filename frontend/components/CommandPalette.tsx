import { useEffect, useMemo, useState } from 'react';
import {
  Columns2,
  Globe,
  History,
  Import,
  Play,
  Plus,
  Search,
  Terminal,
  X,
} from 'lucide-react';
import type { ActiveScreen, ApiEnvironment, ApiRequest } from '../types/api';
import { MethodBadge } from './MethodBadge';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  requests: ApiRequest[];
  environments: ApiEnvironment[];
  activeEnvId: string;
  onSelectRequest: (id: string) => void;
  onSelectEnv: (id: string) => void;
  onNavigate: (screen: ActiveScreen) => void;
  onNewRequest: () => void;
  onToggleSplit: () => void;
  onOpenImportCurl: () => void;
}

export function CommandPalette({
  open,
  onClose,
  requests,
  environments,
  activeEnvId,
  onSelectRequest,
  onSelectEnv,
  onNavigate,
  onNewRequest,
  onToggleSplit,
  onOpenImportCurl,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const matchingRequests = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return requests.slice(0, 6);
    return requests.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.url.toLowerCase().includes(q) ||
        r.method.toLowerCase().includes(q)
    );
  }, [requests, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] rounded-[8px] bg-ui-elevated border border-ui-border ide-shadow overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-3.5 h-[44px] border-b border-ui-border">
          <Search className="w-4 h-4 text-ui-secondary shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to endpoint, environment, or command..."
            className="flex-1 bg-transparent text-[13px] text-ui-ink placeholder-ui-muted focus:outline-none"
          />
          <kbd className="font-mono text-[10px] text-ui-secondary px-1.5 py-0.5 rounded-[4px] bg-ui-canvas border border-ui-border">
            ESC
          </kbd>
        </div>

        <div className="max-h-[400px] overflow-y-auto p-2 space-y-3">
          {/* Endpoints */}
          <div>
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-ui-muted">
              Endpoints
            </div>
            {matchingRequests.length === 0 ? (
              <div className="px-2.5 py-2 text-[12px] text-ui-muted">No matching endpoints</div>
            ) : (
              matchingRequests.map((req) => (
                <button
                  key={req.id}
                  type="button"
                  onClick={() => {
                    onSelectRequest(req.id);
                    onNavigate('workbench');
                    onClose();
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[4px] hover:bg-ui-border/70 text-left transition-colors cursor-pointer"
                >
                  <MethodBadge method={req.method} compact />
                  <span className="text-[12px] font-medium text-ui-ink truncate">
                    {req.name}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-ui-muted truncate max-w-[220px]">
                    {req.url}
                  </span>
                </button>
              ))
            )}
          </div>

          {/* Quick Actions */}
          <div>
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-ui-muted">
              Workspace Actions
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => {
                  onNewRequest();
                  onClose();
                }}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] hover:bg-ui-border/70 text-[12px] text-ui-ink cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-ui-accent" />
                New HTTP Request
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenImportCurl();
                  onClose();
                }}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] hover:bg-ui-border/70 text-[12px] text-ui-ink cursor-pointer"
              >
                <Import className="w-3.5 h-3.5 text-ui-secondary" />
                Import cURL Command
              </button>
              <button
                type="button"
                onClick={() => {
                  onToggleSplit();
                  onClose();
                }}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] hover:bg-ui-border/70 text-[12px] text-ui-ink cursor-pointer"
              >
                <Columns2 className="w-3.5 h-3.5 text-ui-secondary" />
                Toggle Split Orientation
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate('runner');
                  onClose();
                }}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] hover:bg-ui-border/70 text-[12px] text-ui-ink cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 text-ui-green" />
                Open Collection Runner
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate('environments');
                  onClose();
                }}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] hover:bg-ui-border/70 text-[12px] text-ui-ink cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5 text-ui-sky" />
                Manage Environments
              </button>
              <button
                type="button"
                onClick={() => {
                  onNavigate('history');
                  onClose();
                }}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] hover:bg-ui-border/70 text-[12px] text-ui-ink cursor-pointer"
              >
                <History className="w-3.5 h-3.5 text-ui-secondary" />
                Inspect Execution History
              </button>
            </div>
          </div>

          {/* Environments */}
          <div>
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-ui-muted">
              Switch Environment
            </div>
            <div className="flex flex-wrap gap-1.5 px-2 py-1">
              {environments.map((env) => (
                <button
                  key={env.id}
                  type="button"
                  onClick={() => {
                    onSelectEnv(env.id);
                    onClose();
                  }}
                  className={`px-2.5 py-1 rounded-[4px] text-[12px] border transition-colors cursor-pointer ${
                    env.id === activeEnvId
                      ? 'bg-ui-accent/15 border-ui-accent text-ui-ink'
                      : 'bg-ui-canvas border-ui-border text-ui-secondary hover:text-ui-ink'
                  }`}
                >
                  {env.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ImportCurlModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (curlText: string) => string | null;
}

export function ImportCurlModal({ open, onClose, onImport }: ImportCurlModalProps) {
  const [curlText, setCurlText] = useState(
    `curl -X POST https://jsonplaceholder.typicode.com/posts \\\n  -H "Content-Type: application/json" \\\n  -d '{"title": "Precision Slate test", "body": "Payload verification", "userId": 1}'`
  );
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = onImport(curlText);
    if (err) {
      setError(err);
    } else {
      setError(null);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[580px] rounded-[8px] bg-ui-elevated border border-ui-border ide-shadow overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-ui-border">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-ui-accent" />
            <h3 className="text-[14px] font-semibold text-ui-ink">Import cURL Command</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-ui-secondary hover:text-ui-ink rounded-[4px] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <p className="text-[12px] text-ui-secondary">
            Paste any <span className="font-mono text-ui-ink">curl</span> snippet to parse its HTTP method, URL, query parameters, headers, and JSON body into a new executable request.
          </p>
          <textarea
            value={curlText}
            onChange={(e) => {
              setCurlText(e.target.value);
              setError(null);
            }}
            rows={7}
            spellCheck={false}
            placeholder="curl -X GET https://api.example.com/v1/resource -H 'Authorization: Bearer ...'"
            className="w-full p-3 bg-ui-canvas border border-ui-border rounded-[4px] font-mono text-[12px] leading-[18px] text-ui-ink placeholder-ui-muted focus:outline-none focus:border-ui-accent resize-none"
          />
          {error && <p className="text-[12px] text-ui-danger">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-[12px] font-medium text-ui-secondary hover:text-ui-ink bg-ui-surface border border-ui-border rounded-[4px] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3.5 py-1.5 text-[12px] font-semibold text-white bg-ui-accent hover:bg-ui-accent-hover rounded-[4px] cursor-pointer"
            >
              Import Request
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
