import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  FolderPlus,
  Import,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { ApiRequest, CollectionFolder } from '../types/api';
import { folderAncestors } from '../utils/folderTree';
import { MethodBadge } from './MethodBadge';

interface SidebarProps {
  folders: CollectionFolder[];
  requests: ApiRequest[];
  activeRequestId: string | null;
  dirtyRequestIds: Set<string>;
  onSelectRequest: (id: string) => void;
  onCreateRequest: (folderId: string) => void;
  onDuplicateRequest: (id: string) => void;
  onDeleteRequest: (id: string) => void;
  onCreateFolder: (name: string, parent?: string) => boolean;
  onDeleteFolder: (id: string) => void;
  onOpenImportCurl: () => void;
  onImportPostman?: () => void;
  onOpenFolder: (id: string) => void;
  onExportPostman?: (id: string) => void;
  width: number;
  isOverlay?: boolean;
  onCloseOverlay?: () => void;
}

export function Sidebar({
  folders,
  requests,
  activeRequestId,
  dirtyRequestIds,
  onSelectRequest,
  onCreateRequest,
  onDuplicateRequest,
  onDeleteRequest,
  onCreateFolder,
  onDeleteFolder,
  onOpenImportCurl,
  onImportPostman,
  onOpenFolder,
  onExportPostman,
  width,
  isOverlay = false,
  onCloseOverlay,
}: SidebarProps) {
  const [search, setSearch] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [folderTarget, setFolderTarget] = useState<{ parent?: string }>();
  const [newFolderName, setNewFolderName] = useState('');

  const toggleFolder = (folderId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const filteredRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.url.toLowerCase().includes(q) ||
        r.method.toLowerCase().includes(q)
    );
  }, [requests, search]);

  const byId = useMemo(() => new Map(folders.map(folder => [folder.id, folder])), [folders]);
  const visibleIds = new Set(filteredRequests.flatMap(request => [
    request.folderId, ...folderAncestors(request.folderId, byId).map(folder => folder.id),
  ]));

  const handleConfirmFolder = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (trimmed && onCreateFolder(trimmed, folderTarget?.parent)) {
      const parent = folderTarget?.parent;
      if (parent) {
        setCollapsedIds(previous => {
          const next = new Set(previous);
          next.delete(parent);
          return next;
        });
        setSearch('');
      }
      setNewFolderName('');
      setFolderTarget(undefined);
    }
  };

  function renderFolder(folder: CollectionFolder, depth: number) {
    const folderRequests = filteredRequests.filter((r) => r.folderId === folder.id);
    const children = folders.filter(item => item.desktopParent === folder.id);
    const isCollapsed = collapsedIds.has(folder.id) && !search.trim();

    if (search.trim() && !visibleIds.has(folder.id)) {
      return null;
    }

    return (
      <div key={folder.id} className="mb-1">
        {/* Folder Row */}
        <div className="group flex items-center gap-1.5 h-[28px] px-2 hover:bg-ui-elevated transition-colors" style={{ paddingLeft: 8 + Math.min(depth, 9) * 12 }}>
          <button type="button" onClick={() => toggleFolder(folder.id)}
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${folder.name}`}
            aria-expanded={!isCollapsed} className="shrink-0 text-ui-muted hover:text-ui-ink">
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button type="button" onClick={() => onOpenFolder(folder.id)}
            title={`Edit variables for ${folder.name}`}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] font-medium text-ui-ink">
            {isCollapsed ? <Folder className="w-3.5 h-3.5 shrink-0 text-ui-secondary" />
              : <FolderOpen className="w-3.5 h-3.5 shrink-0 text-ui-secondary" />}
            <span className="truncate">{folder.name}</span>
          </button>
          <span className="font-mono text-[10px] text-ui-muted tabular-nums group-hover:hidden">
            {folderRequests.length}
          </span>
          <div
            className="hidden group-hover:flex group-focus-within:flex items-center gap-0.5 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => onCreateRequest(folder.id)}
              title="Add request to folder"
              className="p-0.5 rounded-[3px] text-ui-secondary hover:text-ui-ink hover:bg-ui-border cursor-pointer"
            >
              <Plus className="w-3 h-3" />
            </button>
            <button
              type="button"
              title="Add subfolder"
              aria-label={`Add subfolder to ${folder.name}`}
              onClick={() => { setNewFolderName(''); setFolderTarget({ parent: folder.id }); }}
              className="p-0.5 rounded-[3px] text-ui-secondary hover:text-ui-ink hover:bg-ui-border cursor-pointer"
            >
              <FolderPlus className="w-3 h-3" />
            </button>
            {onExportPostman && <button type="button" title="Export Postman collection" aria-label={`Export ${folder.name}`}
              className="p-1 text-ui-secondary hover:text-ui-ink" onClick={() => onExportPostman(folder.id)}>↓</button>}

            {folders.length > 1 && (
              <button
                type="button"
                onClick={() => onDeleteFolder(folder.id)}
                title="Delete folder"
                className="p-0.5 rounded-[3px] text-ui-secondary hover:text-ui-danger hover:bg-ui-border cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Request Rows */}
        {!isCollapsed && (
          <div>
            {children.map(child => renderFolder(child, depth + 1))}
            {folderRequests.length === 0 && children.length === 0 ? (
              <div className="pr-2 py-1 text-[11px] text-ui-muted" style={{ paddingLeft: 32 + Math.min(depth, 9) * 12 }}>
                {folder.desktopParent ? 'Empty folder' : 'Empty collection'}
              </div>
            ) : (
              folderRequests.map((req) => {
                const isActive = req.id === activeRequestId;
                const isDirty = dirtyRequestIds.has(req.id);
                return (
                  <div
                    key={req.id}
                    style={{ paddingLeft: 24 + Math.min(depth, 9) * 12 }}
                    onClick={() => {
                      onSelectRequest(req.id);
                      if (isOverlay && onCloseOverlay) onCloseOverlay();
                    }}
                    className={`group relative flex items-center gap-2 h-[28px] pl-6 pr-2 cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-ui-elevated text-ui-ink'
                        : 'text-ui-secondary hover:bg-ui-elevated/60 hover:text-ui-ink'
                    }`}
                  >
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-0 bottom-0 w-[2px] bg-ui-accent"
                      />
                    )}
                    <MethodBadge method={req.method} compact />
                    <span className="text-[12px] truncate flex-1">{req.name}</span>
                    {isDirty && (
                      <span
                        title="Unsaved changes"
                        className="w-1.5 h-1.5 rounded-full bg-ui-accent shrink-0 group-hover:hidden"
                      />
                    )}
                    <div
                      className="hidden group-hover:flex items-center gap-0.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onDuplicateRequest(req.id)}
                        title="Duplicate request"
                        className="p-0.5 rounded-[3px] text-ui-secondary hover:text-ui-ink hover:bg-ui-border cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRequest(req.id)}
                        title="Delete request"
                        className="p-0.5 rounded-[3px] text-ui-secondary hover:text-ui-danger hover:bg-ui-border cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside
      style={isOverlay ? undefined : { width }}
      className={`flex flex-col h-full bg-ui-surface border-r border-ui-border select-none shrink-0 ${
        isOverlay ? 'w-[280px] ide-shadow' : ''
      }`}
    >
      {/* Sidebar Header */}
      <div className="flex items-center justify-between px-3 h-[38px] border-b border-ui-border shrink-0">
        <span className="text-[12px] font-semibold text-ui-ink tracking-[-0.01em]">
          Collections
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onCreateRequest(folders[0]?.id || 'col_payments')}
            title="New Request"
            className="p-1 rounded-[4px] text-ui-secondary hover:text-ui-ink hover:bg-ui-elevated transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => { setNewFolderName(''); setFolderTarget(folderTarget && !folderTarget.parent ? undefined : {}); }}
            title="New Collection"
            className="p-1 rounded-[4px] text-ui-secondary hover:text-ui-ink hover:bg-ui-elevated transition-colors cursor-pointer"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onOpenImportCurl}
            title="Import cURL"
            className="p-1 rounded-[4px] text-ui-secondary hover:text-ui-ink hover:bg-ui-elevated transition-colors cursor-pointer"
          >
            <Import className="w-3.5 h-3.5" />
          </button>
          {isOverlay && onCloseOverlay && (
            <button
              type="button"
              onClick={onCloseOverlay}
              title="Close sidebar"
              className="p-1 rounded-[4px] text-ui-secondary hover:text-ui-ink hover:bg-ui-elevated transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {onImportPostman && <button type="button" title="Import Postman collection" aria-label="Import Postman collection"
          className="p-1 text-ui-secondary hover:text-ui-ink" onClick={onImportPostman}>↑</button>}
      </div>
      </div>

      {/* Filter Input */}
      <div className="p-2 border-b border-ui-border shrink-0">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-ui-muted absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter endpoints..."
            className="w-full h-[28px] pl-8 pr-6 bg-ui-canvas border border-ui-border rounded-[4px] text-[12px] text-ui-ink placeholder-ui-muted focus:outline-none focus:border-ui-accent transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear filter"
              className="absolute right-1.5 p-0.5 text-ui-muted hover:text-ui-ink cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {folderTarget && (
          <form onSubmit={handleConfirmFolder} className="mt-2">
            <label htmlFor={isOverlay ? 'overlay-folder-name' : 'folder-name'} className="block truncate text-[11px] text-ui-secondary">
              {folderTarget.parent ? `New folder in ${byId.get(folderTarget.parent)?.name}` : 'New collection'}
            </label>
            <div className="mt-1 flex items-center gap-1">
              <input
                type="text"
                id={isOverlay ? 'overlay-folder-name' : 'folder-name'}
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name..."
                className="min-w-0 flex-1 h-[26px] px-2 bg-ui-canvas border border-ui-accent rounded-[4px] text-[12px] text-ui-ink placeholder-ui-muted focus:outline-none"
              />
              <button
                type="submit"
                className="h-[26px] px-2 bg-ui-accent text-white text-[11px] font-semibold rounded-[4px] hover:bg-ui-accent-hover cursor-pointer"
              >
                Add
              </button>
              <button type="button" aria-label="Cancel folder creation" onClick={() => setFolderTarget(undefined)}
                className="p-1 text-ui-secondary hover:text-ui-ink"><X className="h-3 w-3" /></button>
            </div>
          </form>
        )}
      </div>

      {/* Collection Tree */}
      <div className="flex-1 overflow-y-auto py-1.5">
        {folders.filter(folder => !folder.desktopParent || !byId.has(folder.desktopParent)).map(folder => renderFolder(folder, 0))}

        {filteredRequests.length === 0 && search.trim() && (
          <div className="px-3 py-8 text-center">
            <p className="text-[12px] text-ui-secondary">No matching endpoints</p>
            <button
              type="button"
              onClick={() => setSearch('')}
              className="mt-2 text-[11px] text-ui-accent hover:underline cursor-pointer"
            >
              Clear search
            </button>
          </div>
        )}
      </div>

      {/* Footer Quick Action */}
      <div className="p-2 border-t border-ui-border shrink-0">
        <button
          type="button"
          onClick={onOpenImportCurl}
          className="w-full flex items-center justify-center gap-1.5 h-[28px] bg-ui-elevated hover:bg-ui-hover border border-ui-border rounded-[4px] text-[12px] font-medium text-ui-ink transition-colors cursor-pointer whitespace-nowrap"
        >
          <Import className="w-3.5 h-3.5 text-ui-secondary" />
          Import cURL Command
        </button>
      </div>
    </aside>
  );
}
