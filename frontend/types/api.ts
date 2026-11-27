export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type BodyMode = 'none' | 'json' | 'raw' | 'form';

export type AuthType = 'none' | 'bearer' | 'apikey' | 'basic';

export type ActiveScreen = 'workbench' | 'environments' | 'runner' | 'history';

export type SplitOrientation = 'horizontal' | 'vertical';

export interface KeyValueItem {
  id: string;
  key: string;
  value: string;
  description: string;
  enabled: boolean;
}

export interface AuthConfig {
  type: AuthType;
  bearerToken: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyIn: 'header' | 'query';
  basicUsername: string;
  basicPassword: string;
}

export type AssertionSource = 'status' | 'duration' | 'json_path' | 'header' | 'body_contains';

export type AssertionOperator = 'equals' | 'not_equals' | 'contains' | 'less_than' | 'exists';

export interface AssertionRule {
  id: string;
  enabled: boolean;
  source: AssertionSource;
  property: string; // e.g., "$.status" or "content-type"
  operator: AssertionOperator;
  expected: string;
}

export interface AssertionResult {
  ruleId: string;
  label: string;
  passed: boolean;
  actual: string;
  expected: string;
}

export interface ApiRequest {
  id: string;
  folderId: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValueItem[];
  headers: KeyValueItem[];
  auth: AuthConfig;
  bodyMode: BodyMode;
  bodyContent: string;
  formBody: KeyValueItem[];
  assertions: AssertionRule[];
  updatedAt: string;
  desktopVariables?: EnvironmentVariable[];
  collectionProfile?: CollectionProfile;
  postmanItem?: unknown;
  onlineCopyOf?: string;
  appliedOnlineRevision?: string;
}

export interface CollectionFolder {
  id: string;
  name: string;
  description: string;
  collapsed?: boolean;
  desktopCollection?: object;
  collectionVariables?: EnvironmentVariable[];
  collectionProfiles?: CollectionVariableProfiles;
  desktopParent?: string;
  desktopPath?: string;
  lanShared?: boolean;
  onlineCopyOf?: string;
}

export interface EnvironmentVariable {
  id: string;
  key: string;
  initialValue: string;
  currentValue: string;
  isSecret: boolean;
  enabled: boolean;
}

export type CollectionProfile = 'Production' | 'Local';

export interface CollectionVariableProfiles {
  active: CollectionProfile;
  Production: EnvironmentVariable[];
  Local: EnvironmentVariable[];
}

export interface ApiEnvironment {
  id: string;
  name: string;
  description: string;
  variables: EnvironmentVariable[];
}

export interface ParsedCookie {
  name: string;
  value: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
  maxAge: string;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  cookies: ParsedCookie[];
  rawCookies: string[];
  body: string;
  sizeBytes: number;
  durationMs: number;
  finalUrl: string;
  timestamp: string;
  error?: string;
  assertionResults: AssertionResult[];
}

export interface HistoryEntry {
  id: string;
  requestId: string;
  requestName: string;
  method: HttpMethod;
  resolvedUrl: string;
  requestHeaders: Record<string, string>;
  requestBody: string;
  response: ApiResponse;
  environmentName: string;
}

export interface RunnerExecutionItem {
  requestId: string;
  requestName: string;
  method: HttpMethod;
  resolvedUrl: string;
  status: number | null;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  passedCount: number;
  failedCount: number;
  assertionResults: AssertionResult[];
  error?: string;
}
