import type {
  ApiEnvironment,
  ApiRequest,
  AssertionResult,
  AssertionRule,
  HttpMethod,
  KeyValueItem,
  ParsedCookie,
} from '../types/api';

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function interpolateVariables(input: string, env: ApiEnvironment | undefined): string {
  if (!input || !env) return input;
  const map = new Map<string, string>();
  for (const v of env.variables) {
    if (v.enabled && v.key.trim()) {
      map.set(v.key.trim(), v.currentValue ?? v.initialValue ?? '');
    }
  }
  return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
    return map.has(key) ? map.get(key)! : match;
  });
}

export function extractTemplateVariables(input: string): string[] {
  const matches = new Set<string>();
  const regex = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(input)) !== null) {
    matches.add(m[1]);
  }
  return Array.from(matches);
}

export function buildUrlWithParams(baseUrl: string, params: KeyValueItem[]): string {
  const active = params.filter((p) => p.enabled && p.key.trim().length > 0);
  const [withoutQuery] = baseUrl.split('?');
  if (active.length === 0) return withoutQuery;
  const query = active
    .map((p) => `${encodeURIComponent(p.key.trim())}=${encodeURIComponent(p.value)}`)
    .join('&');
  return `${withoutQuery}?${query}`;
}

export function parseParamsFromUrl(url: string): KeyValueItem[] {
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return [];
  const queryStr = url.slice(qIndex + 1);
  if (!queryStr.trim()) return [];
  return queryStr
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eqIndex = pair.indexOf('=');
      const rawKey = eqIndex === -1 ? pair : pair.slice(0, eqIndex);
      const rawVal = eqIndex === -1 ? '' : pair.slice(eqIndex + 1);
      let key = rawKey;
      let value = rawVal;
      try {
        key = decodeURIComponent(rawKey);
        value = decodeURIComponent(rawVal);
      } catch {
        // Keep raw if malformed encoding
      }
      return {
        id: uid('param'),
        key,
        value,
        description: '',
        enabled: true,
      };
    });
}

const demoEnvironmentIds = new Set(['env_local_sandbox', 'env_staging', 'env_production']);

export function environmentForRequest(request: ApiRequest, env: ApiEnvironment | undefined): ApiEnvironment | undefined {
  if (request.collectionProfile) {
    return { id: '', name: request.collectionProfile, description: '', variables: request.desktopVariables ?? [] };
  }
  if (request.desktopVariables === undefined) return env;

  const usesDemoSandbox = env && demoEnvironmentIds.has(env.id) && env.variables.some(variable =>
    variable.enabled && variable.key.trim() === 'baseUrl' &&
    (variable.currentValue ?? variable.initialValue).trim().replace(/\/$/, '') === '/api/sandbox'
  );
  const selected = usesDemoSandbox ? undefined : env;
  return {
    id: selected?.id ?? '',
    name: selected?.name ?? 'Collection variables',
    description: selected?.description ?? '',
    variables: [...request.desktopVariables, ...(selected?.variables ?? [])],
  };
}

export function resolveRequestPayload(request: ApiRequest, env: ApiEnvironment | undefined) {
  env = environmentForRequest(request, env);
  const interpolatedUrl = interpolateVariables(request.url.trim(), env);
  const resolvedParams = request.params
    .filter((p) => p.enabled && p.key.trim())
    .map((p) => ({
      ...p,
      key: interpolateVariables(p.key, env),
      value: interpolateVariables(p.value, env),
    }));

  // Apply API Key in query if configured
  if (request.auth.type === 'apikey' && request.auth.apiKeyIn === 'query' && request.auth.apiKeyName.trim()) {
    resolvedParams.push({
      id: 'auth_apikey_query',
      key: interpolateVariables(request.auth.apiKeyName.trim(), env),
      value: interpolateVariables(request.auth.apiKeyValue, env),
      description: 'Auth API Key',
      enabled: true,
    });
  }

  const finalUrl = buildUrlWithParams(interpolatedUrl, resolvedParams);

  const headers: Record<string, string> = {};
  for (const h of request.headers) {
    if (h.enabled && h.key.trim()) {
      headers[interpolateVariables(h.key.trim(), env)] = interpolateVariables(h.value, env);
    }
  }

  // Inject Auth headers
  if (request.auth.type === 'bearer' && request.auth.bearerToken.trim()) {
    headers['Authorization'] = `Bearer ${interpolateVariables(request.auth.bearerToken.trim(), env)}`;
  } else if (
    request.auth.type === 'apikey' &&
    request.auth.apiKeyIn === 'header' &&
    request.auth.apiKeyName.trim()
  ) {
    headers[interpolateVariables(request.auth.apiKeyName.trim(), env)] = interpolateVariables(
      request.auth.apiKeyValue,
      env
    );
  } else if (request.auth.type === 'basic' && (request.auth.basicUsername || request.auth.basicPassword)) {
    const u = interpolateVariables(request.auth.basicUsername, env);
    const p = interpolateVariables(request.auth.basicPassword, env);
    headers['Authorization'] = `Basic ${btoa(`${u}:${p}`)}`;
  }

  let body = '';
  if (request.bodyMode === 'json') {
    body = interpolateVariables(request.bodyContent, env);
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
  } else if (request.bodyMode === 'raw') {
    body = interpolateVariables(request.bodyContent, env);
  } else if (request.bodyMode === 'form') {
    const activeForm = request.formBody.filter((f) => f.enabled && f.key.trim());
    body = activeForm
      .map(
        (f) =>
          `${encodeURIComponent(interpolateVariables(f.key.trim(), env))}=${encodeURIComponent(
            interpolateVariables(f.value, env)
          )}`
      )
      .join('&');
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }

  return {
    method: request.method,
    url: finalUrl,
    headers,
    body,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function parseSetCookies(rawCookies: string[]): ParsedCookie[] {
  return rawCookies.map((raw) => {
    const parts = raw.split(';').map((s) => s.trim());
    const [nameVal, ...attrs] = parts;
    const eq = nameVal.indexOf('=');
    const name = eq === -1 ? nameVal : nameVal.slice(0, eq);
    const value = eq === -1 ? '' : nameVal.slice(eq + 1);

    let path = '/';
    let httpOnly = false;
    let secure = false;
    let sameSite = 'None';
    let maxAge = 'Session';

    for (const attr of attrs) {
      const lower = attr.toLowerCase();
      if (lower === 'httponly') httpOnly = true;
      else if (lower === 'secure') secure = true;
      else if (lower.startsWith('path=')) path = attr.slice(5);
      else if (lower.startsWith('samesite=')) sameSite = attr.slice(9);
      else if (lower.startsWith('max-age=')) maxAge = `${attr.slice(8)}s`;
      else if (lower.startsWith('expires=')) maxAge = attr.slice(8);
    }

    return { name, value, path, httpOnly, secure, sameSite, maxAge };
  });
}

function getJsonPathValue(obj: unknown, pathStr: string): { found: boolean; value: unknown } {
  if (!obj || typeof obj !== 'object') return { found: false, value: undefined };
  const cleaned = pathStr.replace(/^\$\.?/, '').trim();
  if (!cleaned) return { found: true, value: obj };

  const tokens: string[] = [];
  cleaned.split('.').forEach((part) => {
    const bracketMatches = part.match(/^([^[]*)(\[\d+\])*$/);
    if (bracketMatches) {
      if (bracketMatches[1]) tokens.push(bracketMatches[1]);
      const indices = part.match(/\[(\d+)\]/g);
      if (indices) {
        indices.forEach((idx) => tokens.push(idx.slice(1, -1)));
      }
    } else {
      tokens.push(part);
    }
  });

  let current: unknown = obj;
  for (const token of tokens) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return { found: false, value: undefined };
    }
    if (Array.isArray(current)) {
      const i = Number(token);
      if (Number.isNaN(i) || i < 0 || i >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[i];
    } else {
      const record = current as Record<string, unknown>;
      if (!(token in record)) return { found: false, value: undefined };
      current = record[token];
    }
  }
  return { found: true, value: current };
}

export function evaluateAssertions(
  rules: AssertionRule[],
  status: number,
  durationMs: number,
  headers: Record<string, string>,
  body: string
): AssertionResult[] {
  let parsedJson: unknown = null;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    parsedJson = null;
  }

  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    lowerHeaders[k.toLowerCase()] = v;
  }

  return rules
    .filter((r) => r.enabled)
    .map((rule) => {
      let actual = '';
      let found = true;
      let label = '';

      if (rule.source === 'status') {
        actual = String(status);
        label = `Status code ${rule.operator.replace('_', ' ')} ${rule.expected}`;
      } else if (rule.source === 'duration') {
        actual = `${durationMs} ms`;
        label = `Response time ${rule.operator.replace('_', ' ')} ${rule.expected} ms`;
      } else if (rule.source === 'header') {
        const key = rule.property.toLowerCase().trim();
        found = key in lowerHeaders;
        actual = found ? lowerHeaders[key] : '(missing)';
        label = `Header "${rule.property}" ${rule.operator.replace('_', ' ')} ${rule.expected || '(exists)'}`;
      } else if (rule.source === 'json_path') {
        const lookup = getJsonPathValue(parsedJson, rule.property);
        found = lookup.found;
        actual = found
          ? typeof lookup.value === 'object'
            ? JSON.stringify(lookup.value)
            : String(lookup.value)
          : '(not found)';
        label = `JSON ${rule.property} ${rule.operator.replace('_', ' ')} ${rule.expected || '(exists)'}`;
      } else {
        actual = body.slice(0, 120);
        label = `Body ${rule.operator.replace('_', ' ')} "${rule.expected}"`;
      }

      let passed = false;
      if (rule.operator === 'exists') {
        passed = found && actual !== '(missing)' && actual !== '(not found)' && actual !== '';
      } else if (rule.operator === 'equals') {
        passed = actual === rule.expected;
      } else if (rule.operator === 'not_equals') {
        passed = actual !== rule.expected;
      } else if (rule.operator === 'contains') {
        if (rule.source === 'body_contains') {
          passed = body.includes(rule.expected);
        } else {
          passed = actual.toLowerCase().includes(rule.expected.toLowerCase());
        }
      } else if (rule.operator === 'less_than') {
        const numericActual = rule.source === 'duration' ? durationMs : Number(actual);
        const numericExpected = Number(rule.expected);
        passed = !Number.isNaN(numericActual) && !Number.isNaN(numericExpected) && numericActual < numericExpected;
      }

      return {
        ruleId: rule.id,
        label,
        passed,
        actual: rule.source === 'body_contains' ? (passed ? `Contains "${rule.expected}"` : 'Not matched') : actual,
        expected: rule.operator === 'exists' ? 'Non-empty value' : rule.expected,
      };
    });
}

export function generateCodeSnippet(
  lang: 'curl' | 'fetch' | 'python' | 'go',
  request: ApiRequest,
  env: ApiEnvironment | undefined
): string {
  const { method, url, headers, body } = resolveRequestPayload(request, env);
  const fullUrl = url.startsWith('/') ? `${window.location.origin}${url}` : url;

  if (lang === 'curl') {
    const lines = [`curl --request ${method} \\`, `  --url '${fullUrl}'`];
    for (const [k, v] of Object.entries(headers)) {
      lines[lines.length - 1] += ' \\';
      lines.push(`  --header '${k}: ${v}'`);
    }
    if (body && method !== 'GET') {
      lines[lines.length - 1] += ' \\';
      lines.push(`  --data '${body.replace(/'/g, "'\\''")}'`);
    }
    return lines.join('\n');
  }

  if (lang === 'fetch') {
    const opts: string[] = [`  method: '${method}',`];
    if (Object.keys(headers).length > 0) {
      opts.push(`  headers: ${JSON.stringify(headers, null, 4).replace(/\n/g, '\n  ')},`);
    }
    if (body && method !== 'GET') {
      opts.push(`  body: ${JSON.stringify(body)},`);
    }
    return `const response = await fetch('${fullUrl}', {\n${opts.join('\n')}\n});\n\nconst data = await response.json();\nconsole.log(response.status, data);`;
  }

  if (lang === 'python') {
    const lines = ['import requests', ''];
    lines.push(`url = "${fullUrl}"`);
    if (Object.keys(headers).length > 0) {
      lines.push(`headers = ${JSON.stringify(headers, null, 2)}`);
    }
    if (body && method !== 'GET') {
      lines.push(`payload = ${JSON.stringify(body)}`);
    }
    const args = ['url'];
    if (Object.keys(headers).length > 0) args.push('headers=headers');
    if (body && method !== 'GET') args.push('data=payload');
    lines.push('');
    lines.push(`response = requests.${method.toLowerCase()}(${args.join(', ')})`);
    lines.push('print(response.status_code, response.text)');
    return lines.join('\n');
  }

  // Go net/http
  const hasBody = Boolean(body && method !== 'GET');
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `\treq.Header.Add("${k}", "${v.replace(/"/g, '\\"')}")`)
    .join('\n');
  return `package main

import (
\t"fmt"
\t"io"
\t"net/http"${hasBody ? '\n\t"strings"' : ''}
)

func main() {
\turl := "${fullUrl}"${hasBody ? `\n\tpayload := strings.NewReader(${JSON.stringify(body)})` : ''}
\treq, _ := http.NewRequest("${method}", url, ${hasBody ? 'payload' : 'nil'})
${headerLines}

\tres, err := http.DefaultClient.Do(req)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer res.Body.Close()

\tbody, _ := io.ReadAll(res.Body)
\tfmt.Println(res.StatusCode, string(body))
}`;
}

export function parseCurlCommand(rawCurl: string, folderId: string): ApiRequest | null {
  const cleaned = rawCurl.replace(/\\\r?\n/g, ' ').trim();
  if (!cleaned) return null;

  // Tokenize respecting single and double quotes
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  let method: HttpMethod = 'GET';
  let methodExplicit = false;
  let url = '';
  const headers: KeyValueItem[] = [];
  let bodyContent = '';

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'curl') continue;
    if ((t === '-X' || t === '--request') && tokens[i + 1]) {
      const m = tokens[++i].toUpperCase();
      if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) {
        method = m as HttpMethod;
        methodExplicit = true;
      }
    } else if ((t === '-H' || t === '--header') && tokens[i + 1]) {
      const headerLine = tokens[++i];
      const colonIdx = headerLine.indexOf(':');
      if (colonIdx !== -1) {
        headers.push({
          id: uid('hdr'),
          key: headerLine.slice(0, colonIdx).trim(),
          value: headerLine.slice(colonIdx + 1).trim(),
          description: '',
          enabled: true,
        });
      }
    } else if ((t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary') && tokens[i + 1]) {
      bodyContent = tokens[++i];
      if (!methodExplicit) method = 'POST';
    } else if (t === '--url' && tokens[i + 1]) {
      url = tokens[++i];
    } else if (!t.startsWith('-') && (t.startsWith('http://') || t.startsWith('https://') || t.startsWith('/'))) {
      url = t;
    }
  }

  if (!url) return null;

  let bodyMode: 'none' | 'json' | 'raw' = 'none';
  if (bodyContent) {
    try {
      bodyContent = JSON.stringify(JSON.parse(bodyContent), null, 2);
      bodyMode = 'json';
    } catch {
      bodyMode = 'raw';
    }
  }

  let derivedName = 'Imported cURL Request';
  try {
    const u = new URL(url.startsWith('/') ? `https://local${url}` : url);
    const segments = u.pathname.split('/').filter(Boolean);
    derivedName = segments.length > 0 ? `${method} /${segments.slice(-2).join('/')}` : u.hostname;
  } catch {
    derivedName = `${method} Request`;
  }

  return {
    id: uid('req'),
    folderId,
    name: derivedName,
    method,
    url,
    params: parseParamsFromUrl(url),
    headers,
    auth: {
      type: 'none',
      bearerToken: '',
      apiKeyName: 'X-API-Key',
      apiKeyValue: '',
      apiKeyIn: 'header',
      basicUsername: '',
      basicPassword: '',
    },
    bodyMode,
    bodyContent,
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
}
