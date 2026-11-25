import { invoke } from '@tauri-apps/api/core';
import type { ApiEnvironment, ApiRequest, CollectionFolder, CollectionVariableProfiles, EnvironmentVariable, HistoryEntry, KeyValueItem } from './types/api';
import { INITIAL_ENVIRONMENTS, INITIAL_FOLDERS, INITIAL_REQUESTS } from './data/seedData';
import { parseParamsFromUrl, uid } from './utils/httpUtils';
import { folderAncestors } from './utils/folderTree';
import type { Theme } from './themes';

const DEFAULT_AUTH = {
  type: 'none', bearerToken: '', apiKeyName: '', apiKeyValue: '',
  apiKeyIn: 'header', basicUsername: '', basicPassword: '',
} as const;

export interface StudioWorkspace {
  folders: CollectionFolder[];
  requests: ApiRequest[];
  environments: ApiEnvironment[];
  activeEnvId: string;
  history: HistoryEntry[];
  theme?: Theme;
}

interface LegacyCollection {
  name: string; version?: string; docs?: string; folders: string[];
  environments?: Record<string, string>; headers?: string; variables?: string;
  expected_status?: string; postman_collection?: unknown;
}
interface LegacyRequest {
  collection: number; name: string; folder: string; method: string; url: string;
  headers: string; body: string; bearer: string; postman_item?: unknown;
}
interface LegacyWorkspace { collections: LegacyCollection[]; requests: LegacyRequest[] }
interface Imported { collection: LegacyCollection; requests: LegacyRequest[] }

interface WireReply {
  status: number; statusText: string; headers: Record<string, string>; cookies: string[];
  body: string; sizeBytes: number; durationMs: number; finalUrl: string;
}

export async function executeDesktop(request: { method: string; url: string; headers: Record<string, string>; body: string }, signal?: AbortSignal) {
  signal?.throwIfAborted();
  try {
    const data = await invoke<WireReply>('execute_studio', { request });
    signal?.throwIfAborted();
    return { ok: true, status: 200, data: { ...data, error: undefined as string | undefined } };
  } catch (error) {
    signal?.throwIfAborted();
    return { ok: false, status: 0, data: {
      status: 0, statusText: 'Error', headers: {}, cookies: [], body: '', sizeBytes: 0,
      durationMs: 0, finalUrl: request.url, error: String(error),
    } };
  }
}

function pairs(text: string, delimiter: string): KeyValueItem[] {
  return text.split(/\r?\n/).flatMap(line => {
    const pivot = line.indexOf(delimiter);
    if (pivot < 1) return [];
    return [{
      id: uid('kv'), key: line.slice(0, pivot).trim(), value: line.slice(pivot + 1).trim(),
      enabled: true, description: '',
    }];
  });
}

export function variableRows(text: string) {
  return pairs(text, '=').map(item => ({
    id: item.id, key: item.key, initialValue: item.value, currentValue: item.value, enabled: true, isSecret: false,
  }));
}

export function localProfiles(variables: EnvironmentVariable[] = []): CollectionVariableProfiles {
  return { active: 'Local', Local: variables.map(variable => ({ ...variable })), Production: [] };
}

export function requestProfile(profiles: CollectionVariableProfiles) {
  return { collectionProfile: profiles.active, desktopVariables: profiles[profiles.active] };
}

function migrateCollectionProfiles(state: StudioWorkspace): StudioWorkspace {
  const folderById = new Map(state.folders.map(folder => [folder.id, folder]));
  const legacyPaths = new Map<string, Map<string, string>>();
  for (const folder of state.folders) {
    if (!folder.desktopParent || !folder.desktopPath) continue;
    const paths = legacyPaths.get(folder.desktopParent) ?? new Map<string, string>();
    paths.set(folder.desktopPath, folder.id);
    legacyPaths.set(folder.desktopParent, paths);
  }
  for (const [root, paths] of legacyPaths) {
    function ensurePath(path: string): string {
      const segments = path.split('/');
      const name = segments.pop()!;
      const parent = segments.length ? ensurePath(segments.join('/')) : root;
      const id = paths.get(path) ?? uid('folder');
      const existing = folderById.get(id);
      folderById.set(id, { ...existing, id, name, description: existing?.description ?? '',
        desktopParent: parent, desktopPath: undefined });
      paths.set(path, id);
      return id;
    }
    for (const path of paths.keys()) ensurePath(path);
  }
  const rootOf = (id: string) => folderAncestors(id, folderById)[0]?.id ?? id;
  const seeded = new Set(INITIAL_FOLDERS.map(folder => folder.id));
  const localSandbox = state.environments.find(env => env.id === 'env_local_sandbox') ?? INITIAL_ENVIRONMENTS[0];
  const selected = state.environments.find(env => env.id === state.activeEnvId);
  const profilesById = new Map<string, CollectionVariableProfiles>();
  const folders = Array.from(folderById.values(), folder => {
    if (folder.desktopParent) return folder;
    const fromRequest = state.requests.find(request => rootOf(request.folderId) === folder.id && request.desktopVariables?.length)?.desktopVariables;
    const stored = (folder.desktopCollection as { variables?: string } | undefined)?.variables;
    const legacy = folder.collectionVariables ?? fromRequest ?? (stored ? variableRows(stored) : undefined);
    const fallback = seeded.has(folder.id) ? localSandbox.variables
      : !folder.desktopCollection && selected?.id && !INITIAL_ENVIRONMENTS.some(env => env.id === selected.id) ? selected.variables : [];
    const collectionProfiles = folder.collectionProfiles ?? localProfiles(legacy ?? fallback);
    profilesById.set(folder.id, collectionProfiles);
    return { ...folder, collectionProfiles };
  });
  const requests = state.requests.map(request => {
    const profiles = profilesById.get(rootOf(request.folderId));
    return profiles ? { ...request, ...requestProfile(profiles) } : request;
  });
  return { ...state, folders, requests };
}

function adaptCollection(collection: LegacyCollection, requests: LegacyRequest[]) {
  const root = uid('col');
  const profiles = localProfiles(variableRows(collection.variables ?? ''));
  const folders: CollectionFolder[] = [
    { id: root, name: collection.name, description: collection.docs ?? '', desktopCollection: collection,
      collectionProfiles: profiles },
  ];
  const folderIds = new Map<string, string>();
  function addPath(path: string): string {
    if (!path) return root;
    const existing = folderIds.get(path);
    if (existing) return existing;
    const parts = path.split('/');
    const name = parts.pop()!;
    const parent = addPath(parts.join('/'));
    const id = uid('folder');
    folderIds.set(path, id);
    folders.push({ id, name, description: '', desktopParent: parent });
    return id;
  }
  for (const path of collection.folders) addPath(path);
  const converted = requests.map((request): ApiRequest => {
    const manualHeaders = pairs(request.headers, ':');
    const headerNames = new Set(manualHeaders.map(item => item.key.toLowerCase()));
    const defaults = pairs(collection.headers ?? '', ':').filter(item => !headerNames.has(item.key.toLowerCase()));
    return {
      id: uid('req'), folderId: addPath(request.folder),
      name: request.name || request.url, method: request.method as ApiRequest['method'], url: request.url,
      params: parseParamsFromUrl(request.url), headers: [...defaults, ...manualHeaders],
      auth: { ...DEFAULT_AUTH, ...(request.bearer ? { type: 'bearer' as const, bearerToken: request.bearer } : {}) },
      bodyMode: request.body ? 'raw' : 'none', bodyContent: request.body, formBody: [],
      assertions: collection.expected_status ? [{
        id: uid('assert'), enabled: true, source: 'status', property: '', operator: 'equals', expected: collection.expected_status,
      }] : [],
      updatedAt: new Date().toISOString(), ...requestProfile(profiles), postmanItem: request.postman_item,
    };
  });
  const environments: ApiEnvironment[] = Object.entries(collection.environments ?? {}).map(([name, values]) => ({
    id: uid('env'), name: `${collection.name} / ${name}`, description: collection.name,
    variables: variableRows(values),
  }));
  return { folders, requests: converted, environments };
}

export async function importDesktopCollection() {
  const payload = await invoke<Imported | null>('import_collection');
  return payload ? adaptCollection(payload.collection, payload.requests) : null;
}

export async function exportDesktopCollection(id: string, folders: CollectionFolder[], requests: ApiRequest[]) {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const selected = byId.get(id);
  if (!selected) return;
  const root = folderAncestors(id, byId)[0] ?? selected;
  const ids = new Map([[root.id, '']]);
  for (const folder of folders) {
    const ancestors = folderAncestors(folder.id, byId);
    if (ancestors[0]?.id !== root.id) continue;
    ids.set(folder.id, [...ancestors.slice(1), folder].map(item => item.name).join('/'));
  }
  const profile = root.collectionProfiles;
  const variables = profile?.[profile.active].filter(item => item.enabled && item.key.trim())
    .map(item => `${item.key}=${item.currentValue ?? item.initialValue}`).join('\n');
  const collection = {
    headers: '', variables: '', expected_status: '', ...root.desktopCollection,
    ...(variables === undefined ? {} : { variables }),
    name: root.name, docs: root.description, folders: [...ids.values()].filter(Boolean),
  };
  return invoke<string | null>('export_collection', {
    collection,
    requests: requests.filter(request => ids.has(request.folderId)).map(request => ({
      name: request.name, method: request.method, url: request.url,
      headers: request.headers.filter(header => header.enabled && header.key.trim())
        .map(header => `${header.key}: ${header.value}`).join('\n'),
      body: request.bodyMode === 'none' ? '' : request.bodyMode === 'form'
        ? request.formBody.filter(item => item.enabled && item.key).map(item =>
          `${encodeURIComponent(item.key)}=${encodeURIComponent(item.value)}`).join('&') : request.bodyContent,
      bearer: '', collection: 0, folder: ids.get(request.folderId) ?? '', postman_item: request.postmanItem,
    })),
  });
}

export async function loadDesktopWorkspace(): Promise<StudioWorkspace> {
  const saved = await invoke<StudioWorkspace | null>('load_studio');
  if (saved) return migrateCollectionProfiles(saved);
  const legacy = await invoke<LegacyWorkspace>('load_workspace');
  const state: StudioWorkspace = {
    folders: [...INITIAL_FOLDERS], requests: [...INITIAL_REQUESTS], environments: [...INITIAL_ENVIRONMENTS],
    activeEnvId: INITIAL_ENVIRONMENTS[0].id, history: [],
  };
  for (const [index, collection] of legacy.collections.entries()) {
    const requests = legacy.requests.filter(request => request.collection === index);
    if (!requests.length && collection.name === 'Local collection' && !collection.docs && !collection.variables
      && !collection.headers && !collection.folders.length && !Object.keys(collection.environments ?? {}).length) continue;
    const adapted = adaptCollection(collection, requests);
    state.folders.push(...adapted.folders);
    state.requests.push(...adapted.requests);
    state.environments.push(...adapted.environments);
  }
  return migrateCollectionProfiles(state);
}

export function saveDesktopWorkspace(workspace: StudioWorkspace) {
  return invoke<void>('save_studio', { workspace });
}
