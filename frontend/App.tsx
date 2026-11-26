import { isWriteMethod, OperationResultDialog, type OperationResult } from './components/OperationResultDialog';
import { CollectionVariablesDialog } from './components/CollectionVariablesDialog';
import { VariableEditor, VariableValue } from './components/VariableEditor';
import { invoke } from '@tauri-apps/api/core';
import { LanPanel, type LanStatus, type SharedSnapshot } from './components/LanPanel';
import { OnlinePanel } from './components/OnlinePanel';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Cloud,
  Columns2,
  FolderTree,
  Globe,
  History,
  Menu,
  Network,
  PanelLeft,
  Play,
  Plus,
  Rows2,
  Save,
  Search,
  Send,
  Settings,
  Unplug,
  X,
} from 'lucide-react';
import type {
  ActiveScreen,
  ApiEnvironment,
  ApiRequest,
  ApiResponse,
  CollectionFolder,
  CollectionVariableProfiles,
  EnvironmentVariable,
  HistoryEntry,
  HttpMethod,
  SplitOrientation,
} from './types/api';
import {
  INITIAL_ENVIRONMENTS,
  INITIAL_FOLDERS,
  INITIAL_REQUESTS,
} from './data/seedData';
import {
  evaluateAssertions,
  environmentForRequest,
  extractTemplateVariables,
  parseCurlCommand,
  parseParamsFromUrl,
  parseSetCookies,
  resolveRequestPayload,
  uid,
} from './utils/httpUtils';
import { METHOD_STYLES, MethodBadge } from './components/MethodBadge';
import { executeDesktop, exportDesktopCollection, importDesktopCollection, localProfiles, requestProfile, saveDesktopWorkspace, type StudioWorkspace } from './main';
import { COLOR_MODES, resolveAppearance, STYLES } from './themes';
import { Sidebar } from './components/Sidebar';
import { RequestPane } from './components/RequestPane';
import { ResponsePane } from './components/ResponsePane';
import { EnvironmentsView } from './components/EnvironmentsView';
import { folderAncestors, MAX_FOLDER_DEPTH } from './utils/folderTree';
import { TestRunnerView } from './components/TestRunnerView';
import { HistoryView } from './components/HistoryView';
import { CommandPalette, ImportCurlModal } from './components/CommandPalette';

type VariableEdit = {
  name: string;
  source: string;
  variable?: EnvironmentVariable;
  scope: { environment: string } | { folder: string };
};

function enabledVariable(variables: EnvironmentVariable[] | undefined, name: string) {
  return variables?.findLast(variable => variable.enabled && variable.key.trim() === name);
}

export default function App({ initial }: { initial: StudioWorkspace }) {
  const [appearance, setAppearance] = useState(() => resolveAppearance(initial.appearance, initial.theme));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    document.documentElement.dataset.mode = appearance.mode;
    document.documentElement.dataset.style = appearance.style;
  }, [appearance]);
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('workbench');
  const [folders, setFolders] = useState<CollectionFolder[]>(initial.folders);
  const [requests, setRequests] = useState<ApiRequest[]>(initial.requests);
  const [environments, setEnvironments] = useState<ApiEnvironment[]>(initial.environments);
  const [environmentDrafts, setEnvironmentDrafts] = useState<Record<string, ApiEnvironment>>({});
  const [activeEnvId, setActiveEnvId] = useState<string>(initial.activeEnvId);
  const [history, setHistory] = useState<HistoryEntry[]>(initial.history);

  // Workbench tabs & drafts
  const [openTabIds, setOpenTabIds] = useState<string[]>(() => [
    initial.requests[0]?.id,
    initial.requests[1]?.id,
  ].filter(Boolean) as string[]);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(
    initial.requests[0]?.id || null
  );
  const [drafts, setDrafts] = useState<Record<string, ApiRequest>>({});
  const [responsesById, setResponsesById] = useState<Record<string, ApiResponse>>({});
  const [loadingRequestId, setLoadingRequestId] = useState<string | null>(null);

  // Layout & responsive state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(258);
  const [splitOrientation, setSplitOrientation] = useState<SplitOrientation>('horizontal');
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isCompactViewport, setIsCompactViewport] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 1024 : false
  );

  // Floating overlays
  const [collectionEdit, setCollectionEdit] = useState<string>();
  const [variableEdit, setVariableEdit] = useState<VariableEdit>();
  const [lanOpen, setLanOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [onlineSnapshot, setOnlineSnapshot] = useState<SharedSnapshot>();
  const [lanSharing, setLanSharing] = useState<boolean>();
  const [viewerAddress, setViewerAddress] = useState<string | null>(null);
  const [sharedSnapshot, setSharedSnapshot] = useState<SharedSnapshot>();
  useEffect(() => {
    let current = true;
    invoke<LanStatus>('lan_status').then(status => {
      if (!current) return;
      setLanSharing(Boolean(status.hostAddress));
      setViewerAddress(status.viewerAddress);
    }).catch(() => {});
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (!viewerAddress) return;
    let active = true;
    let timer: number;
    const refresh = async () => {
      try {
        const next = await invoke<SharedSnapshot>('lan_read');
        if (active) setSharedSnapshot(next);
      } catch {
        if (active) setSharedSnapshot(undefined);
      } finally {
        if (active) timer = window.setTimeout(refresh, 5000);
      }
    };
    void refresh();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [viewerAddress]);
  const [envMenuOpen, setEnvMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [importCurlOpen, setImportCurlOpen] = useState(false);

  const splitContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasAutoExecutedRef = useRef(false);

  const saveQueue = useRef(Promise.resolve());
  const lastSnapshot = useRef<StudioWorkspace>(initial);
  const pendingChanges = useRef<string[]>([]);
  const [results, setResults] = useState<(OperationResult & { id: string })[]>([]);
  const reportResult = useCallback((result: OperationResult) => {
    setResults(previous => [...previous, { ...result, id: uid('result') }]);
  }, []);
  const markChange = useCallback((action: string) => { pendingChanges.current.push(action); }, []);
  const [desktopError, setDesktopError] = useState('');

  const enqueueSave = useCallback((snapshot: StudioWorkspace, changes: string[]) => {
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        await saveDesktopWorkspace(snapshot);
        setDesktopError('');
        for (const action of changes) reportResult({ action, ok: true });
      } catch (error) {
        const detail = `Could not save workspace: ${String(error)}`;
        if (!changes.length) {
          setDesktopError(detail);
          return;
        }
        reportResult({
          action: changes.join(' · '), ok: false,
          detail: `${detail} Changes are still in this window.`,
          retry: () => enqueueSave(lastSnapshot.current, changes),
        });
      }
    });
  }, [reportResult]);

  useEffect(() => {
    const state: StudioWorkspace = { folders, requests, environments, activeEnvId, history: history.slice(0, 60), appearance };
    lastSnapshot.current = state;
    const changes = pendingChanges.current.splice(0);
    enqueueSave(state, changes);
  }, [folders, requests, environments, activeEnvId, history, appearance, enqueueSave]);

  const importCollection = async () => {
    try {
      const imported = await importDesktopCollection();
      if (!imported) return;
      markChange("Import Postman collection");
      setFolders(previous => [...previous, ...imported.folders]);
      setRequests(previous => [...previous, ...imported.requests]);
      setEnvironments(previous => [...previous, ...imported.environments]);
      const first = imported.requests[0];
      if (first) {
        setActiveRequestId(first.id);
        setOpenTabIds(previous => [...previous, first.id]);
      }
      setActiveScreen('workbench');
    } catch (error) {
      reportResult({ action: 'Import Postman collection', ok: false, detail: String(error) });
    }
  };
  const exportCollection = async (id: string) => {
    try {
      const file = await exportDesktopCollection(id, folders, requests);
      if (file) reportResult({ action: 'Export Postman collection', ok: true, detail: file });
    } catch (error) {
      reportResult({ action: 'Export Postman collection', ok: false, detail: String(error) });
    }
  };

  // Responsive viewport listener (<1024px collapses sidebar and stacks panes)
  useEffect(() => {
    const handleResize = () => {
      const compact = window.innerWidth < 1024;
      setIsCompactViewport(compact);
      if (!compact) setMobileDrawerOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const activeEnv = useMemo(
    () => environments.find((e) => e.id === activeEnvId) || environments[0],
    [environments, activeEnvId]
  );

  const activeRequest = useMemo(() => {
    if (!activeRequestId) return null;
    if (drafts[activeRequestId]) return drafts[activeRequestId];
    return requests.find((r) => r.id === activeRequestId) || null;
  }, [activeRequestId, drafts, requests]);

  const dirtyRequestIds = useMemo(() => new Set(Object.keys(drafts)), [drafts]);
  const displayedEnv = activeScreen === 'workbench' && activeRequest
    ? environmentForRequest(activeRequest, activeEnv)
    : activeEnv;

  const activeFolder = useMemo(
    () => folders.find((f) => f.id === activeRequest?.folderId) || null,
    [folders, activeRequest]
  );

  const folderById = useMemo(() => new Map(folders.map(folder => [folder.id, folder])), [folders]);

  function collectionRoot(id: string) {
    return folderAncestors(id, folderById)[0]?.id ?? id;
  }

  function profilesForCollection(root: string): CollectionVariableProfiles {
    return folders.find(folder => folder.id === root)?.collectionProfiles ?? localProfiles();
  }

  function saveCollectionProfiles(root: string, profiles: CollectionVariableProfiles, action = 'Save collection variables') {
    markChange(action);
    const updateRequest = (request: ApiRequest): ApiRequest => collectionRoot(request.folderId) === root
      ? { ...request, ...requestProfile(profiles) } : request;
    setRequests(current => current.map(updateRequest));
    setDrafts(current => Object.fromEntries(Object.entries(current).map(([id, request]) => [id, updateRequest(request)])));
    setFolders(current => current.map(folder => folder.id === root ? { ...folder, collectionProfiles: profiles } : folder));
  }

  function editVariable(name: string) {
    if (!activeRequest) return;
    const resolved = environmentForRequest(activeRequest, activeEnv);
    const selectedEnv = environments.find(environment => environment.id === resolved?.id);
    const environmentVariable = enabledVariable(selectedEnv?.variables, name);
    const collectionVariable = enabledVariable(activeRequest.desktopVariables, name);
    if (selectedEnv && (environmentVariable || (!collectionVariable && activeRequest.desktopVariables === undefined))) {
      setVariableEdit({ name, source: selectedEnv.name, variable: environmentVariable, scope: { environment: selectedEnv.id } });
      return;
    }
    const root = collectionRoot(activeRequest.folderId);
    setVariableEdit({
      name,
      source: `${folders.find(folder => folder.id === root)?.name ?? 'Collection'} · ${profilesForCollection(root).active}`,
      variable: collectionVariable, scope: { folder: root },
    });
  }

  function saveVariable(value: string) {
    if (!variableEdit) return;
    const { name, variable, scope } = variableEdit;
    const created: EnvironmentVariable = {
      id: uid('var'), key: name, initialValue: value, currentValue: value,
      enabled: true, isSecret: /token|secret|password/i.test(name),
    };
    const update = (variables: EnvironmentVariable[], collection: boolean) => {
      const target = enabledVariable(variables, name);
      if (!target) return [...variables, { ...created, isSecret: variable?.isSecret ?? created.isSecret }];
      return variables.map(item => item.id === target.id
        ? { ...item, currentValue: value, ...(collection ? { initialValue: value } : {}) }
        : item);
    };
    if ('environment' in scope) {
      markChange('Save environment variable');
      setEnvironments(current => current.map(environment => environment.id === scope.environment
        ? { ...environment, variables: update(environment.variables, false) } : environment));
    } else {
      const profiles = profilesForCollection(scope.folder);
      saveCollectionProfiles(scope.folder, { ...profiles, [profiles.active]: update(profiles[profiles.active], true) }, 'Save collection variable');
    }
    setVariableEdit(undefined);
  }

  const variableActions = {
    lookup: (name: string) => enabledVariable(displayedEnv?.variables, name),
    edit: editVariable,
  };

  const resolvedPreview = useMemo(() => {
    if (!activeRequest) return null;
    const vars = extractTemplateVariables(activeRequest.url);
    if (vars.length === 0) return null;
    return resolveRequestPayload(activeRequest, activeEnv).url;
  }, [activeRequest, activeEnv]);

  const handleSelectRequest = useCallback((id: string) => {
    setActiveRequestId(id);
    setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const handleCloseTab = useCallback(
    (id: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      setOpenTabIds((prev) => {
        const next = prev.filter((t) => t !== id);
        if (activeRequestId === id) {
          const closedIdx = prev.indexOf(id);
          const fallback = next[Math.min(closedIdx, next.length - 1)] || null;
          setActiveRequestId(fallback);
        }
        return next;
      });
    },
    [activeRequestId]
  );

  const handleDraftChange = useCallback((updated: ApiRequest) => {
    setDrafts((prev) => ({ ...prev, [updated.id]: updated }));
  }, []);

  const handleSaveRequest = useCallback(() => {
    if (!activeRequestId) return;
    const draft = drafts[activeRequestId];
    if (!draft) return;
    markChange("Save request");
    const stamped = { ...draft, updatedAt: new Date().toISOString() };
    setRequests((prev) => prev.map((r) => (r.id === activeRequestId ? stamped : r)));
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[activeRequestId];
      return next;
    });
  }, [activeRequestId, drafts, markChange]);

  const handleCreateRequest = useCallback(
    (folderId: string) => {
      const selectedFolder = folderId || folders[0]?.id || 'col_payments';
      const profiles = profilesForCollection(collectionRoot(selectedFolder));
      const newReq: ApiRequest = {
        ...requestProfile(profiles),
        id: uid('req'),
        folderId: selectedFolder,
        name: 'Untitled Request',
        method: 'GET',
        url: '{{baseUrl}}/echo',
        params: [],
        headers: [
          {
            id: uid('hdr'),
            key: 'Accept',
            value: 'application/json',
            description: '',
            enabled: true,
          },
        ],
        auth: {
          type: 'none',
          bearerToken: '',
          apiKeyName: 'X-API-Key',
          apiKeyValue: '',
          apiKeyIn: 'header',
          basicUsername: '',
          basicPassword: '',
        },
        bodyMode: 'none',
        bodyContent: '{\n  \n}',
        formBody: [],
        assertions: [
          {
            id: uid('asr'),
            enabled: true,
            source: 'status',
            property: '',
            operator: 'equals',
            expected: '200',
          },
        ],
        updatedAt: new Date().toISOString(),
      };
      markChange("Create request");
      setRequests((prev) => [...prev, newReq]);
      setOpenTabIds((prev) => [...prev, newReq.id]);
      setActiveRequestId(newReq.id);
      setActiveScreen('workbench');
    },
    [folders, markChange]
  );

  const handleDuplicateRequest = useCallback(
    (id: string) => {
      const source = drafts[id] || requests.find((r) => r.id === id);
      if (!source) return;
      const copy: ApiRequest = {
        ...JSON.parse(JSON.stringify(source)),
        id: uid('req'),
        name: `${source.name} (Copy)`,
        updatedAt: new Date().toISOString(),
      };
      markChange("Duplicate request");
      setRequests((prev) => [...prev, copy]);
      setOpenTabIds((prev) => [...prev, copy.id]);
      setActiveRequestId(copy.id);
    },
    [drafts, requests, markChange]
  );

  const handleDeleteRequest = useCallback(
    (id: string) => {
      if (!requests.some(request => request.id === id)) return;
      markChange("Delete request");
      setRequests((prev) => prev.filter((r) => r.id !== id));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      handleCloseTab(id);
    },
    [handleCloseTab, requests, markChange]
  );

  function handleCreateFolder(name: string, parent?: string) {
    const action = parent ? 'Create folder' : 'Create collection';
    if (parent) {
      const detail = !folderById.has(parent) ? 'The parent folder no longer exists.'
        : name.includes('/') ? "Folder names cannot contain '/'."
        : folders.some(folder => folder.desktopParent === parent && folder.name === name) ? 'This folder already has a subfolder with that name.'
        : folderAncestors(parent, folderById).length >= MAX_FOLDER_DEPTH ? 'The maximum folder depth is 32.'
        : undefined;
      if (detail) {
        reportResult({ action, ok: false, detail });
        return false;
      }
    }
    markChange(action);
    setFolders((prev) => [
      ...prev,
      parent
        ? { id: uid('folder'), name, description: '', desktopParent: parent }
        : { id: uid('col'), name, description: 'Custom API collection', collectionProfiles: localProfiles() },
    ]);
    return true;
  }

  function handleDeleteFolder(folderId: string) {
    const folder = folderById.get(folderId);
    if (folders.length <= 1 || !folder) return;
    if (folder.desktopParent && folders.some(item => item.desktopParent === folderId)) {
      reportResult({ action: 'Delete folder', ok: false, detail: 'Remove its subfolders before deleting this folder.' });
      return;
    }
    const remaining = folders.filter(folder => folder.id !== folderId).map(folder =>
      folder.desktopParent === folderId ? { ...folder, desktopParent: undefined,
        collectionProfiles: profilesForCollection(folderId) } : folder);
    const fallback = remaining.find(item => item.id === folder.desktopParent)
      ?? remaining.find(item => !item.desktopParent)!;
    markChange(folder.desktopParent ? 'Delete folder' : 'Delete collection');
    setFolders(remaining);
    const update = (request: ApiRequest) => request.folderId === folderId
      ? { ...request, folderId: fallback.id, ...requestProfile(fallback.collectionProfiles ?? profilesForCollection(collectionRoot(fallback.id))) }
      : request;
    setRequests(current => current.map(update));
    setDrafts(current => Object.fromEntries(Object.entries(current).map(([id, request]) => [id, update(request)])));
  }

  function toggleFolderSharing(folder: CollectionFolder) {
    markChange(folder.lanShared ? 'Stop sharing folder' : 'Share folder over LAN');
    setFolders(current => current.map(item => item.id === folder.id
      ? { ...item, lanShared: !item.lanShared }
      : item));
  }

  const handleImportCurl = useCallback(
    (curlText: string): string | null => {
      const parsed = parseCurlCommand(curlText, folders[0]?.id || 'col_public');
      if (!parsed) {
        reportResult({ action: 'Import cURL request', ok: false, detail: 'Could not detect a valid HTTP URL in the cURL command.' });
        return 'Could not detect a valid HTTP URL in the cURL command.';
      }
      const request = { ...parsed, ...requestProfile(profilesForCollection(collectionRoot(parsed.folderId))) };
      markChange("Import cURL request");
      setRequests((prev) => [...prev, request]);
      setOpenTabIds((prev) => [...prev, request.id]);
      setActiveRequestId(parsed.id);
      setActiveScreen('workbench');
      return null;
    },
    [folders, markChange, reportResult]
  );

  const executeRequest = useCallback(
    async (reqToRun: ApiRequest) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setLoadingRequestId(reqToRun.id);
      const action = `${reqToRun.method} · ${reqToRun.name}`;
      const write = isWriteMethod(reqToRun.method);
      const clientStart = performance.now();

      try {
        const resolved = resolveRequestPayload(reqToRun, activeEnv);
        const { ok, status, data } = await executeDesktop(resolved, controller.signal);

        let apiResponse: ApiResponse;
        if (!ok || data.error) {
          apiResponse = {
            status,
            statusText: 'Error',
            headers: {},
            cookies: [],
            rawCookies: [],
            body: '',
            sizeBytes: 0,
            durationMs: data.durationMs || Math.round(performance.now() - clientStart),
            finalUrl: resolved.url,
            timestamp: new Date().toISOString(),
            error: data.error || `Request failed with proxy status ${status}`,
            assertionResults: [],
          };
        } else {
          const rawCookies: string[] = Array.isArray(data.cookies) ? data.cookies : [];
          const assertionResults = evaluateAssertions(
            reqToRun.assertions,
            data.status,
            data.durationMs,
            data.headers || {},
            data.body || ''
          );
          apiResponse = {
            status: data.status,
            statusText: data.statusText || 'OK',
            headers: data.headers || {},
            cookies: parseSetCookies(rawCookies),
            rawCookies,
            body: data.body ?? '',
            sizeBytes: data.sizeBytes ?? 0,
            durationMs: data.durationMs ?? Math.round(performance.now() - clientStart),
            finalUrl: data.finalUrl || resolved.url,
            timestamp: new Date().toISOString(),
            assertionResults,
          };
        }

        setResponsesById((prev) => ({ ...prev, [reqToRun.id]: apiResponse }));
        if (write) reportResult({
          action,
          ok: !apiResponse.error && apiResponse.status >= 200 && apiResponse.status < 300,
          detail: apiResponse.error || `${apiResponse.status} ${apiResponse.statusText}`,
        });
        setHistory((prev) => [
          {
            id: uid('hist'),
            requestId: reqToRun.id,
            requestName: reqToRun.name,
            method: reqToRun.method,
            resolvedUrl: apiResponse.finalUrl,
            requestHeaders: resolved.headers,
            requestBody: resolved.body,
            response: apiResponse,
            environmentName: environmentForRequest(reqToRun, activeEnv)?.name || 'None',
          },
          ...prev.slice(0, 59),
        ]);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          if (write) reportResult({ action, ok: false, detail: 'Stopped waiting for the response. The server outcome is unknown.' });
          return;
        }
        const failResponse: ApiResponse = {
          status: 0,
          statusText: 'Network Error',
          headers: {},
          cookies: [],
          rawCookies: [],
          body: '',
          sizeBytes: 0,
          durationMs: Math.round(performance.now() - clientStart),
          finalUrl: reqToRun.url,
          timestamp: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
          assertionResults: [],
        };
        setResponsesById((prev) => ({ ...prev, [reqToRun.id]: failResponse }));
        if (write) reportResult({ action, ok: false, detail: failResponse.error });
      } finally {
        if (abortControllerRef.current === controller) setLoadingRequestId(null);
      }
    },
    [activeEnv, reportResult]
  );

  // Auto-run the initial request once on mount so the IDE opens with live inspected data
  useEffect(() => {
    if (!hasAutoExecutedRef.current && activeRequest) {
      hasAutoExecutedRef.current = true;
      if (activeRequest.id === INITIAL_REQUESTS[0].id && activeRequest.method === 'GET'
        && resolveRequestPayload(activeRequest, activeEnv).url.startsWith('/api/sandbox/transactions')) {
        executeRequest(activeRequest);
      }
    }
  }, [activeRequest, executeRequest]);

  // Global keyboard shortcuts (Cmd+K, Cmd+Enter, Cmd+S, Escape)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (variableEdit || collectionEdit || settingsOpen || onlineOpen || results.length) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (activeScreen === 'workbench' && activeRequest) {
          e.preventDefault();
          executeRequest(activeRequest);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        if (activeScreen === 'workbench' && activeRequest) {
          e.preventDefault();
          handleSaveRequest();
        }
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
        setImportCurlOpen(false);
        setEnvMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeScreen, activeRequest, executeRequest, handleSaveRequest, variableEdit, collectionEdit, settingsOpen, onlineOpen, results.length]);

  // Resizable Sidebar drag handler
  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const initialW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(420, Math.max(200, initialW + (ev.clientX - startX)));
      setSidebarWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Resizable Request/Response split drag handler
  const effectiveOrientation: SplitOrientation = isCompactViewport ? 'vertical' : splitOrientation;

  const startSplitResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      if (effectiveOrientation === 'horizontal') {
        const ratio = (ev.clientX - rect.left) / rect.width;
        setSplitRatio(Math.min(0.75, Math.max(0.25, ratio)));
      } else {
        const ratio = (ev.clientY - rect.top) / rect.height;
        setSplitRatio(Math.min(0.78, Math.max(0.22, ratio)));
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // URL Input change with two-way query param parsing
  const handleUrlInputChange = (nextUrl: string) => {
    if (!activeRequest) return;
    const parsedParams = parseParamsFromUrl(nextUrl);
    const disabledParams = activeRequest.params.filter((p) => !p.enabled);
    handleDraftChange({
      ...activeRequest,
      url: nextUrl,
      params: [...parsedParams, ...disabledParams],
    });
  };

  // Environment CRUD handlers
  const selectEnvironment = (id: string) => {
    if (id === activeEnvId) return;
    markChange('Set active environment');
    setActiveEnvId(id);
  };

  const handleUpdateEnvironment = (updated: ApiEnvironment) => {
    markChange("Save environment");
    setEnvironments((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    setEnvironmentDrafts(current => {
      const next = { ...current };
      delete next[updated.id];
      return next;
    });
  };

  const handleCreateEnvironment = () => {
    const newEnv: ApiEnvironment = {
      id: uid('env'),
      name: `Environment ${environments.length + 1}`,
      description: 'Custom workspace variables',
      variables: [
        {
          id: uid('var'),
          key: 'baseUrl',
          initialValue: '/api/sandbox',
          currentValue: '/api/sandbox',
          isSecret: false,
          enabled: true,
        },
      ],
    };
    markChange("Create environment");
    setEnvironments((prev) => [...prev, newEnv]);
    setActiveEnvId(newEnv.id);
  };

  const handleDuplicateEnvironment = (id: string) => {
    const src = environments.find((e) => e.id === id);
    if (!src) return;
    const copy: ApiEnvironment = {
      ...JSON.parse(JSON.stringify(src)),
      id: uid('env'),
      name: `${src.name} (Copy)`,
    };
    markChange("Duplicate environment");
    setEnvironments((prev) => [...prev, copy]);
  };

  const handleDeleteEnvironment = (id: string) => {
    if (environments.length <= 1) return;
    const remaining = environments.filter((e) => e.id !== id);
    markChange("Delete environment");
    setEnvironments(remaining);
    setEnvironmentDrafts(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (activeEnvId === id) {
      setActiveEnvId(remaining[0].id);
    }
  };

  const activeResponse = activeRequest ? responsesById[activeRequest.id] || null : null;
  const isSendingActive = Boolean(activeRequest && loadingRequestId === activeRequest.id);
  const isDirtyActive = Boolean(activeRequest && dirtyRequestIds.has(activeRequest.id));

  const navItems: Array<{ id: ActiveScreen; label: string; icon: React.ReactNode }> = [
    { id: 'workbench', label: 'Workbench', icon: <FolderTree className="w-3.5 h-3.5" /> },
    { id: 'environments', label: 'Environments', icon: <Globe className="w-3.5 h-3.5" /> },
    { id: 'runner', label: 'Runner', icon: <Play className="w-3.5 h-3.5" /> },
    { id: 'history', label: 'History', icon: <History className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="postdove-shell h-screen w-screen flex flex-col overflow-hidden bg-ui-canvas text-ui-ink">
      {/* Top IDE Bar */}
      <header className="h-[42px] px-3 bg-ui-surface border-b border-ui-border flex items-center justify-between gap-4 shrink-0 z-30">
        {/* Left: Brand & Screen Navigation */}
        <div className="flex items-center gap-5 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            {isCompactViewport && activeScreen === 'workbench' && (
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(true)}
                aria-label="Open collections drawer"
                className="p-1.5 rounded-[4px] text-ui-secondary hover:text-ui-ink hover:bg-ui-elevated cursor-pointer"
              >
                <Menu className="w-4 h-4" />
              </button>
            )}
            <span aria-label="PostDove" role="img" className="inline-flex items-center text-[15px] font-semibold tracking-[-0.02em] text-ui-ink whitespace-nowrap shrink-0">
              <span aria-hidden="true">PostDo</span>
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 text-ui-accent" fill="currentColor" aria-hidden="true">
                <path d="M1.5 3.5c3.8 1.3 7.1 4 10.5 8.4l2.1-3.2c.8-1.2 1.9-1.5 3-1l2-1-.8 2.1c3-3.2 4.2-4.1 4.2-4.1-.9 4.4-3 7.9-7.3 10.2L12 21l-3.2-5.6C4.7 13.6 2.8 9.8 1.5 3.5Z" />
              </svg>
              <span aria-hidden="true">e</span>
            </span>
          </div>

          <nav className="flex items-center gap-1 overflow-x-auto">
            {navItems.map((item) => {
              const active = activeScreen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveScreen(item.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] text-[12px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-ui-elevated text-ui-ink'
                      : 'text-ui-secondary hover:text-ui-ink hover:bg-ui-elevated/50'
                  }`}
                >
                  <span className={active ? 'text-ui-accent' : 'text-ui-muted'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                  {item.id === 'history' && history.length > 0 && (
                    <span className="font-mono text-[10px] text-ui-muted tabular-nums">
                      {history.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: Command Palette + Environment Selector */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden sm:inline-flex items-center gap-2 h-[28px] px-2.5 bg-ui-canvas hover:bg-ui-elevated border border-ui-border rounded-[4px] text-[12px] text-ui-secondary hover:text-ui-ink transition-colors cursor-pointer whitespace-nowrap"
          >
            <Search className="w-3.5 h-3.5 text-ui-muted" />
            <span>Search</span>
            <kbd className="font-mono text-[10px] text-ui-muted pl-1.5">⌘K</kbd>
          </button>

          {/* Environment Dropdown */}
          <button
            type="button"
            aria-label="Settings"
            aria-haspopup="dialog"
            title="Settings"
            onClick={() => {
              settingsDialog.current?.showModal();
              setSettingsOpen(true);
            }}
            className="inline-flex h-[28px] w-[28px] items-center justify-center rounded border border-ui-border bg-ui-elevated text-ui-secondary hover:bg-ui-hover hover:text-ui-ink focus-visible:outline-ui-accent cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setEnvMenuOpen((o) => !o)}
              className="inline-flex items-center gap-2 h-[28px] px-2.5 bg-ui-elevated hover:bg-ui-hover border border-ui-border rounded-[4px] text-[12px] font-medium text-ui-ink transition-colors cursor-pointer whitespace-nowrap"
            >
              <Globe className="w-3.5 h-3.5 text-ui-green" />
              <span className="max-w-[140px] truncate">{displayedEnv?.name || 'No Env'}</span>
              <ChevronDown className="w-3.5 h-3.5 text-ui-secondary" />
            </button>

            {envMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setEnvMenuOpen(false)}
                />
                <div className="absolute right-0 mt-1.5 w-[230px] rounded-[6px] bg-ui-elevated border border-ui-border ide-shadow py-1 z-50">
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-ui-muted">
                    Active Environment
                  </div>
                  {environments.map((env) => (
                    <button
                      key={env.id}
                      type="button"
                      onClick={() => {
                        selectEnvironment(env.id);
                        setEnvMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[12px] text-left hover:bg-ui-border/70 transition-colors cursor-pointer"
                    >
                      <span
                        className={
                          env.id === displayedEnv?.id
                            ? 'text-ui-ink font-medium'
                            : 'text-ui-secondary'
                        }
                      >
                        {env.name}
                      </span>
                      {env.id === displayedEnv?.id && (
                        <Check className="w-3.5 h-3.5 text-ui-accent" />
                      )}
                    </button>
                  ))}
                  <div className="my-1 border-t border-ui-border" />
                  <button
                    type="button"
                    onClick={() => {
                      setEnvMenuOpen(false);
                      setActiveScreen('environments');
                    }}
                    className="w-full px-2.5 py-1.5 text-[12px] text-left text-ui-secondary hover:text-ui-ink hover:bg-ui-border/70 cursor-pointer"
                  >
                    Manage Variables...
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Workspace Area */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {activeScreen === 'workbench' && (
          <>
            {/* Desktop Resizable Sidebar */}
            {!isCompactViewport && sidebarOpen && (
              <>
                <Sidebar
                  folders={folders}
                  requests={requests}
                  activeRequestId={activeRequestId}
                  dirtyRequestIds={dirtyRequestIds}
                  onSelectRequest={handleSelectRequest}
                  onCreateRequest={handleCreateRequest}
                  onDuplicateRequest={handleDuplicateRequest}
                  onDeleteRequest={handleDeleteRequest}
                  onCreateFolder={handleCreateFolder}
                  onDeleteFolder={handleDeleteFolder}
                  onToggleFolderSharing={toggleFolderSharing}
                  lanSharing={Boolean(lanSharing)}
                  sharedSnapshot={viewerAddress ? sharedSnapshot : undefined}
                  onlineSnapshot={onlineSnapshot}
                  onOpenImportCurl={() => setImportCurlOpen(true)}
                  onImportPostman={importCollection}
                  onExportPostman={exportCollection}
                  onOpenFolder={id => setCollectionEdit(collectionRoot(id))}
                  width={sidebarWidth}
                />
                {/* 1px border + 6px invisible drag handle */}
                <div
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={startSidebarResize}
                  className="relative w-0 cursor-col-resize z-20 group"
                >
                  <div className="absolute inset-y-0 -left-[3px] w-[7px] group-hover:bg-ui-accent/40 transition-colors" />
                </div>
              </>
            )}

            {/* Mobile / Tablet Overlay Drawer */}
            {isCompactViewport && mobileDrawerOpen && (
              <div
                className="fixed inset-0 z-40 flex bg-black/60"
                onClick={() => setMobileDrawerOpen(false)}
              >
                <div onClick={(e) => e.stopPropagation()} className="h-full">
                  <Sidebar
                    folders={folders}
                    requests={requests}
                    activeRequestId={activeRequestId}
                    dirtyRequestIds={dirtyRequestIds}
                    onSelectRequest={handleSelectRequest}
                    onCreateRequest={handleCreateRequest}
                    onDuplicateRequest={handleDuplicateRequest}
                    onDeleteRequest={handleDeleteRequest}
                    onCreateFolder={handleCreateFolder}
                    onDeleteFolder={handleDeleteFolder}
                    onToggleFolderSharing={toggleFolderSharing}
                    lanSharing={Boolean(lanSharing)}
                    sharedSnapshot={viewerAddress ? sharedSnapshot : undefined}
                    onlineSnapshot={onlineSnapshot}
                    onOpenFolder={id => {
                      setMobileDrawerOpen(false);
                      setCollectionEdit(collectionRoot(id));
                    }}
                    onOpenImportCurl={() => {
                      setMobileDrawerOpen(false);
                      setImportCurlOpen(true);
                    }}
                    width={280}
                    isOverlay
                    onCloseOverlay={() => setMobileDrawerOpen(false)}
                  />
                </div>
              </div>
            )}

            {/* Central Workbench Pane */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-ui-canvas">
              {/* Open Tabs Bar */}
              <div className="h-[34px] bg-ui-surface border-b border-ui-border flex items-center justify-between pr-2 shrink-0">
                <div className="flex items-end h-full overflow-x-auto min-w-0">
                  {openTabIds.map((tabId) => {
                    const req = drafts[tabId] || requests.find((r) => r.id === tabId);
                    if (!req) return null;
                    const isActive = tabId === activeRequestId;
                    const isDirty = dirtyRequestIds.has(tabId);
                    return (
                      <div
                        key={tabId}
                        onClick={() => setActiveRequestId(tabId)}
                        className={`group relative flex items-center gap-2 h-[33px] px-3 border-r border-ui-border cursor-pointer select-none transition-colors shrink-0 max-w-[210px] ${
                          isActive
                            ? 'bg-ui-elevated text-ui-ink rounded-t-[4px]'
                            : 'bg-ui-surface text-ui-secondary hover:text-ui-ink hover:bg-ui-elevated/50'
                        }`}
                      >
                        {isActive && (
                          <span
                            aria-hidden="true"
                            className="request-tab-indicator absolute top-0 left-0 right-0 h-[2px] bg-ui-accent"
                          />
                        )}
                        <MethodBadge method={req.method} compact />
                        <span className="text-[12px] truncate">{req.name}</span>
                        {isDirty && (
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-ui-accent shrink-0"
                            title="Unsaved changes"
                          />
                        )}
                        <button
                          type="button"
                          onClick={(e) => handleCloseTab(tabId, e)}
                          aria-label={`Close ${req.name}`}
                          className="p-0.5 rounded-[3px] text-ui-muted opacity-60 group-hover:opacity-100 hover:text-ui-ink hover:bg-ui-border cursor-pointer shrink-0"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => handleCreateRequest(folders[0]?.id || 'col_payments')}
                    title="New Request Tab"
                    className="h-[33px] px-2.5 text-ui-secondary hover:text-ui-ink hover:bg-ui-elevated/50 transition-colors cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Layout Orientation Toggle */}
                {!isCompactViewport && (
                  <div className="flex items-center gap-0.5 p-0.5 bg-ui-canvas border border-ui-border rounded-[4px] shrink-0">
                    <button
                      type="button"
                      onClick={() => setSplitOrientation('horizontal')}
                      title="Side-by-side split"
                      className={`p-1 rounded-[3px] transition-colors cursor-pointer ${
                        splitOrientation === 'horizontal'
                          ? 'bg-ui-elevated text-ui-ink'
                          : 'text-ui-muted hover:text-ui-ink'
                      }`}
                    >
                      <Columns2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSplitOrientation('vertical')}
                      title="Stacked vertical split"
                      className={`p-1 rounded-[3px] transition-colors cursor-pointer ${
                        splitOrientation === 'vertical'
                          ? 'bg-ui-elevated text-ui-ink'
                          : 'text-ui-muted hover:text-ui-ink'
                      }`}
                    >
                      <Rows2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {activeRequest ? (
                <>
                  {/* Request Breadcrumb & Unified URL Execution Bar */}
                  <div className="px-3 py-2.5 bg-ui-surface border-b border-ui-border space-y-2 shrink-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0 text-[12px]">
                        <span className="text-ui-muted whitespace-nowrap shrink-0">
                          {activeFolder?.name || 'Collection'}
                        </span>
                        <span className="text-ui-muted">/</span>
                        <input
                          type="text"
                          value={activeRequest.name}
                          onChange={(e) =>
                            handleDraftChange({ ...activeRequest, name: e.target.value })
                          }
                          aria-label="Request name"
                          className="bg-transparent font-semibold text-ui-ink px-1.5 py-0.5 -ml-1 rounded-[4px] border border-transparent hover:border-ui-border focus:border-ui-accent focus:bg-ui-canvas focus:outline-none min-w-[140px] max-w-[340px]"
                        />
                      </div>

                      {resolvedPreview && (
                        <div
                          className="hidden md:flex items-center gap-1.5 font-mono text-[11px] text-ui-muted truncate max-w-[45%]"
                          title={resolvedPreview}
                        >
                          <span className="shrink-0">Resolved:</span>
                          <span className="text-ui-secondary truncate">{resolvedPreview}</span>
                        </div>
                      )}
                    </div>

                    {/* Unified Method + URL + Save + Send Group */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 flex items-center h-[36px] bg-ui-canvas border border-ui-border focus-within:border-ui-accent rounded-[4px] overflow-hidden transition-colors">
                        <select
                          value={activeRequest.method}
                          onChange={(e) =>
                            handleDraftChange({
                              ...activeRequest,
                              method: e.target.value as HttpMethod,
                            })
                          }
                          aria-label="HTTP Method"
                          className={`h-full pl-2.5 pr-2 bg-ui-canvas border-r border-ui-border font-mono text-[12px] font-bold uppercase focus:outline-none cursor-pointer ${
                            (METHOD_STYLES[activeRequest.method] ?? METHOD_STYLES.GET).text
                          }`}
                        >
                          {Array.from(new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', activeRequest.method])).map((m) => (
                            <option
                              key={m}
                              value={m}
                              className="bg-ui-elevated text-ui-ink font-mono"
                            >
                              {m}
                            </option>
                          ))}
                        </select>

                        <VariableValue
                          value={activeRequest.url}
                          onChange={handleUrlInputChange}
                          onEnter={() => executeRequest(activeRequest)}
                          actions={variableActions}
                          label="Request URL"
                          placeholder="https://api.example.com/v1/resource or {{baseUrl}}/transactions"
                          className="flex-1 h-full px-3 bg-transparent font-mono text-[13px] text-ui-ink placeholder-ui-muted focus:outline-none min-w-0"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={handleSaveRequest}
                        disabled={!isDirtyActive}
                        title="Save changes (⌘S)"
                        className="h-[36px] px-3 inline-flex items-center gap-1.5 bg-ui-elevated hover:bg-ui-hover disabled:opacity-45 disabled:cursor-not-allowed border border-ui-border rounded-[4px] text-[12px] font-medium text-ui-ink transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Save className="w-3.5 h-3.5 text-ui-secondary" /> Save
                      </button>

                      <button
                        type="button"
                        onClick={() => executeRequest(activeRequest)}
                        disabled={isSendingActive}
                        title="Send HTTP Request (⌘↵)"
                        className="h-[36px] px-4 inline-flex items-center gap-1.5 bg-ui-accent hover:bg-ui-accent-hover disabled:opacity-70 text-white text-[13px] font-bold rounded-[4px] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {isSendingActive ? 'Sending' : 'Send'}
                      </button>
                    </div>
                  </div>

                  {/* Resizable Split Panes: Request / Response */}
                  <div
                    ref={splitContainerRef}
                    className={`flex-1 min-h-0 flex overflow-hidden ${
                      effectiveOrientation === 'horizontal' ? 'flex-row' : 'flex-col'
                    }`}
                  >
                    <div
                      style={
                        effectiveOrientation === 'horizontal'
                          ? { width: `${splitRatio * 100}%` }
                          : { height: `${splitRatio * 100}%` }
                      }
                      className="min-w-0 min-h-0 flex flex-col overflow-hidden"
                    >
                      <RequestPane
                        request={activeRequest}
                        activeEnv={activeEnv}
                        variableActions={variableActions}
                        onChange={handleDraftChange}
                      />
                    </div>

                    {/* Split Divider with 1px visual line + 8px hit target */}
                    <div
                      role="separator"
                      aria-orientation={
                        effectiveOrientation === 'horizontal' ? 'vertical' : 'horizontal'
                      }
                      onMouseDown={startSplitResize}
                      className={`relative shrink-0 bg-ui-border group z-10 ${
                        effectiveOrientation === 'horizontal'
                          ? 'w-[1px] cursor-col-resize'
                          : 'h-[1px] cursor-row-resize'
                      }`}
                    >
                      <div
                        className={`absolute transition-colors group-hover:bg-ui-accent/50 ${
                          effectiveOrientation === 'horizontal'
                            ? 'inset-y-0 -left-[3px] w-[7px]'
                            : 'inset-x-0 -top-[3px] h-[7px]'
                        }`}
                      />
                    </div>

                    <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
                      <ResponsePane
                        response={activeResponse}
                        loading={isSendingActive}
                        onSend={() => executeRequest(activeRequest)}
                        onCancel={() => {
                          abortControllerRef.current?.abort();
                          setLoadingRequestId(null);
                        }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                  <h2 className="text-[16px] font-semibold text-ui-ink">No active request tab</h2>
                  <p className="text-[12px] text-ui-secondary mt-1">
                    Select an endpoint from Collections or create a new request to begin.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleCreateRequest(folders[0]?.id || 'col_payments')}
                    className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-ui-accent hover:bg-ui-accent-hover text-white text-[12px] font-semibold rounded-[4px] cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Request
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {activeScreen === 'environments' && (
          <div className="flex-1 min-w-0 h-full overflow-hidden">
            <EnvironmentsView
              environments={environments}
              activeEnvId={activeEnvId}
              onSelectActiveEnv={selectEnvironment}
              drafts={environmentDrafts}
              onDraftChange={env => setEnvironmentDrafts(current => ({ ...current, [env.id]: env }))}
              onSaveEnvironment={handleUpdateEnvironment}
              onCreateEnvironment={handleCreateEnvironment}
              onDuplicateEnvironment={handleDuplicateEnvironment}
              onDeleteEnvironment={handleDeleteEnvironment}
            />
          </div>
        )}

        {activeScreen === 'runner' && (
          <div className="flex-1 min-w-0 h-full overflow-hidden">
            <TestRunnerView
              folders={folders}
              requests={requests}
              activeEnv={activeEnv}
              onOpenRequest={(reqId) => {
                handleSelectRequest(reqId);
                setActiveScreen('workbench');
              }}
              reportResult={reportResult}
            />
          </div>
        )}

        {activeScreen === 'history' && (
          <div className="flex-1 min-w-0 h-full overflow-hidden">
            <HistoryView
              history={history}
              onClearHistory={() => { if (history.length) { markChange("Clear history"); setHistory([]); } }}
              onOpenRequest={(reqId) => {
                if (requests.some((r) => r.id === reqId)) {
                  handleSelectRequest(reqId);
                  setActiveScreen('workbench');
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Slim Bottom Status Bar */}
      {desktopError && <div role="alert" className="fixed bottom-8 right-3 z-50 rounded border border-orange-500 bg-ui-elevated p-3">
        {desktopError} <button aria-label="Dismiss" onClick={() => setDesktopError('')}>×</button>
      </div>}
      {collectionEdit && <CollectionVariablesDialog
        key={collectionEdit}
        collection={folders.find(folder => folder.id === collectionEdit)?.name ?? 'Collection'}
        profiles={profilesForCollection(collectionEdit)}
        onSave={profiles => { saveCollectionProfiles(collectionEdit, profiles); setCollectionEdit(undefined); }}
        onValidationError={detail => reportResult({ action: 'Save collection variables', ok: false, detail })}
        onClose={() => setCollectionEdit(undefined)}
      />}
      {variableEdit && <VariableEditor
        name={variableEdit.name}
        source={variableEdit.source}
        value={variableEdit.variable?.currentValue ?? variableEdit.variable?.initialValue ?? ''}
        isSecret={variableEdit.variable?.isSecret ?? /token|secret|password/i.test(variableEdit.name)}
        onSave={saveVariable}
        onClose={() => setVariableEdit(undefined)}
      />}
      {results[0] && <OperationResultDialog key={results[0].id} result={results[0]}
        onClose={() => setResults(current => current.slice(1))} />}
      {lanOpen && <LanPanel onClose={() => setLanOpen(false)} onSharingChange={setLanSharing}
        onViewerAddressChange={setViewerAddress} snapshot={viewerAddress ? sharedSnapshot : undefined}
        onSnapshot={setSharedSnapshot} reportResult={reportResult} />}
      {onlineOpen && <OnlinePanel folders={folders} onClose={() => setOnlineOpen(false)} onRead={setOnlineSnapshot} />}
      <footer className="h-[26px] px-3 bg-ui-surface border-t border-ui-border flex items-center justify-between text-[11px] text-ui-secondary select-none shrink-0">
        <div className="flex items-center gap-3">
          <button type="button" className="inline-flex shrink-0 items-center gap-1.5 hover:text-ui-ink"
            title={lanSharing === undefined ? 'LAN status unavailable' : lanSharing ? 'LAN sharing is active' : 'LAN sharing is off'}
            onClick={() => setLanOpen(true)}>
            {lanSharing ? <Network aria-hidden="true" className="h-3.5 w-3.5 text-ui-string" />
              : <Unplug aria-hidden="true" className="h-3.5 w-3.5 text-ui-secondary" />}
            <span>LAN Sharing</span>
            <span aria-live="polite" className={lanSharing ? 'text-ui-string' : 'text-ui-secondary'}>
              {lanSharing === undefined ? '—' : lanSharing ? 'On' : 'Off'}
            </span>
          </button>
          <button type="button" aria-label="Online Sharing" onClick={() => setOnlineOpen(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-ui-secondary hover:bg-ui-elevated hover:text-ui-ink focus-visible:outline-ui-accent">
            <Cloud aria-hidden="true" className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Online Sharing</span>
          </button>
          {activeScreen === 'workbench' && !isCompactViewport && (
            <button
              type="button"
              onClick={() => setSidebarOpen((s) => !s)}
              className="inline-flex items-center gap-1 hover:text-ui-ink transition-colors cursor-pointer"
            >
              <PanelLeft className="w-3 h-3" />
              <span>{sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveScreen('environments')}
            className="inline-flex items-center gap-1 hover:text-ui-ink transition-colors cursor-pointer"
          >
            <Globe className="w-3 h-3 text-ui-green" />
            <span>{displayedEnv?.name}</span>
          </button>
          <span className="hidden sm:inline font-mono text-ui-muted tabular-nums">
            {requests.length} endpoints · {folders.filter(folder => !folder.desktopParent).length} collections
          </span>
        </div>

        <div className="flex items-center gap-3 font-mono text-[10px] text-ui-muted">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hover:text-ui-ink transition-colors cursor-pointer"
          >
            ⌘K Command Palette
          </button>
          <span className="hidden sm:inline">⌘↵ Send</span>
          <span className="hidden sm:inline">⌘S Save</span>
        </div>
      </footer>

      {/* Floating Overlays */}
      <dialog
        ref={settingsDialog}
        aria-labelledby="settings-title"
        onClose={() => setSettingsOpen(false)}
        className="appearance-dialog m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-lg border border-ui-border bg-ui-surface p-5 text-ui-ink ide-shadow backdrop:bg-black/65"
      >
        <h2 id="settings-title" className="text-base font-semibold">Settings</h2>
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Color mode</legend>
          <div className="mt-2 inline-grid grid-cols-2 gap-1 rounded-md border border-ui-border bg-ui-canvas p-1">
            {COLOR_MODES.map(({ value, label }) => (
              <label key={value} className="appearance-choice flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 hover:bg-ui-hover has-checked:bg-ui-elevated has-focus-visible:outline-2 has-focus-visible:outline-ui-accent">
                <input type="radio" name="color-mode" value={value} checked={appearance.mode === value}
                  onChange={() => setAppearance(current => ({ ...current, mode: value }))}
                  className="accent-ui-accent" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Style</legend>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {STYLES.map(({ value, label }) => (
              <label key={value} className="appearance-choice cursor-pointer rounded-md border border-ui-border bg-ui-canvas p-2 hover:bg-ui-hover has-checked:border-ui-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ui-accent">
                <span className="theme-preview" data-mode={appearance.mode} data-style={value} aria-hidden="true">
                  <span className="theme-preview-sidebar" />
                  <span className="theme-preview-editor"><i /><i /><i /></span>
                </span>
                <span className="mt-2 flex items-center justify-between gap-1 text-[12px] font-medium">
                  {label}
                  <input
                    type="radio"
                    name="appearance-style"
                    value={value}
                    checked={appearance.style === value}
                    onChange={() => setAppearance(current => ({ ...current, style: value }))}
                    className="shrink-0 accent-ui-accent"
                  />
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <form method="dialog" className="mt-5 flex justify-end">
          <button className="cursor-pointer rounded border border-ui-border bg-ui-elevated px-3 py-1.5 font-medium hover:bg-ui-hover focus-visible:outline-ui-accent">
            Done
          </button>
        </form>
      </dialog>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        requests={requests}
        environments={environments}
        activeEnvId={activeEnvId}
        onSelectRequest={handleSelectRequest}
        onSelectEnv={selectEnvironment}
        onNavigate={setActiveScreen}
        onNewRequest={() => handleCreateRequest(folders[0]?.id || 'col_payments')}
        onToggleSplit={() =>
          setSplitOrientation((o) => (o === 'horizontal' ? 'vertical' : 'horizontal'))
        }
        onOpenImportCurl={() => setImportCurlOpen(true)}
      />

      <ImportCurlModal
        open={importCurlOpen}
        onClose={() => setImportCurlOpen(false)}
        onImport={handleImportCurl}
      />
    </div>
  );
}
