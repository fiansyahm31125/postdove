import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';

interface JsonViewerProps {
  body: string;
  viewMode: 'pretty' | 'tree' | 'raw';
  wrapLines: boolean;
  searchQuery: string;
}

function tokenizeJsonLine(line: string, searchQuery: string) {
  // Highlight JSON syntax tokens cleanly via React elements (never dangerouslySetInnerHTML)
  const tokenRegex =
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;
  const parts: Array<{ text: string; className: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: line.slice(lastIndex, match.index), className: 'text-ui-secondary' });
    }
    const token = match[0];
    let cls = 'text-ui-ink';
    if (token.startsWith('"')) {
      if (match[2]) {
        cls = 'text-ui-key'; // JSON key - crisp light sky blue
      } else {
        cls = 'text-ui-string'; // JSON string - emerald mint
      }
    } else if (token === 'true' || token === 'false') {
      cls = 'text-ui-amber'; // Boolean - amber
    } else if (token === 'null') {
      cls = 'text-ui-danger'; // Null - rose
    } else {
      cls = 'text-ui-number'; // Number - warm primary peach
    }
    parts.push({ text: token, className: cls });
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < line.length) {
    parts.push({ text: line.slice(lastIndex), className: 'text-ui-secondary' });
  }

  if (!searchQuery.trim()) {
    return parts.map((p, i) => (
      <span key={i} className={p.className}>
        {p.text}
      </span>
    ));
  }

  const q = searchQuery.toLowerCase();
  return parts.map((p, idx) => {
    const lower = p.text.toLowerCase();
    if (!lower.includes(q)) {
      return (
        <span key={idx} className={p.className}>
          {p.text}
        </span>
      );
    }
    const subParts: React.ReactNode[] = [];
    let cursor = 0;
    let found = lower.indexOf(q, cursor);
    let subIdx = 0;
    while (found !== -1) {
      if (found > cursor) {
        subParts.push(
          <span key={`t_${subIdx++}`} className={p.className}>
            {p.text.slice(cursor, found)}
          </span>
        );
      }
      subParts.push(
        <mark
          key={`m_${subIdx++}`}
          className="bg-ui-accent/40 text-ui-strong rounded-[2px] px-[1px]"
        >
          {p.text.slice(found, found + q.length)}
        </mark>
      );
      cursor = found + q.length;
      found = lower.indexOf(q, cursor);
    }
    if (cursor < p.text.length) {
      subParts.push(
        <span key={`e_${subIdx++}`} className={p.className}>
          {p.text.slice(cursor)}
        </span>
      );
    }
    return <span key={idx}>{subParts}</span>;
  });
}

interface TreeNodeProps {
  name?: string;
  value: unknown;
  path: string;
  depth: number;
  copiedPath: string | null;
  onCopyPath: (path: string) => void;
}

function JsonTreeNode({ name, value, path, depth, copiedPath, onCopyPath }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);

  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === 'object' && !isArray;
  const isExpandable = isArray || isObject;

  if (!isExpandable) {
    let valClass = 'text-ui-ink';
    let display = String(value);
    if (typeof value === 'string') {
      valClass = 'text-ui-string';
      display = `"${value}"`;
    } else if (typeof value === 'number') {
      valClass = 'text-ui-number';
    } else if (typeof value === 'boolean') {
      valClass = 'text-ui-amber';
    } else if (value === null) {
      valClass = 'text-ui-danger';
      display = 'null';
    }

    return (
      <div
        className="group flex items-start gap-1.5 py-[2px] px-1.5 rounded-[3px] hover:bg-ui-surface font-mono text-[12px] leading-[18px]"
        style={{ paddingLeft: `${depth * 16 + 18}px` }}
      >
        {name !== undefined && (
          <span className="text-ui-key shrink-0">
            {name}
            <span className="text-ui-muted">:</span>
          </span>
        )}
        <span className={`${valClass} break-all`}>{display}</span>
        <button
          type="button"
          onClick={() => onCopyPath(path)}
          title={`Copy JSONPath: ${path}`}
          className="ml-auto opacity-0 group-hover:opacity-100 text-[10px] text-ui-muted hover:text-ui-ink inline-flex items-center gap-1 px-1 rounded-[3px] hover:bg-ui-elevated transition-opacity cursor-pointer shrink-0"
        >
          {copiedPath === path ? (
            <>
              <Check className="w-3 h-3 text-ui-green" />
              <span className="text-ui-green">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>{path}</span>
            </>
          )}
        </button>
      </div>
    );
  }

  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);

  const openBracket = isArray ? '[' : '{';
  const closeBracket = isArray ? ']' : '}';

  return (
    <div>
      <div
        className="group flex items-center gap-1 py-[2px] px-1.5 rounded-[3px] hover:bg-ui-surface font-mono text-[12px] leading-[18px] cursor-pointer select-none"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="text-ui-muted w-3.5 h-3.5 inline-flex items-center justify-center shrink-0">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        {name !== undefined && (
          <span className="text-ui-key">
            {name}
            <span className="text-ui-muted">: </span>
          </span>
        )}
        <span className="text-ui-secondary">{openBracket}</span>
        {!expanded && (
          <span className="text-ui-muted text-[11px] px-1">
            {entries.length} {isArray ? (entries.length === 1 ? 'item' : 'items') : entries.length === 1 ? 'key' : 'keys'}
          </span>
        )}
        {!expanded && <span className="text-ui-secondary">{closeBracket}</span>}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCopyPath(path);
          }}
          title={`Copy JSONPath: ${path}`}
          className="ml-auto opacity-0 group-hover:opacity-100 text-[10px] text-ui-muted hover:text-ui-ink inline-flex items-center gap-1 px-1 rounded-[3px] hover:bg-ui-elevated cursor-pointer shrink-0"
        >
          {copiedPath === path ? (
            <Check className="w-3 h-3 text-ui-green" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </div>
      {expanded && (
        <div>
          {entries.map(([k, v]) => {
            const childPath = isArray ? `${path}[${k}]` : `${path}.${k}`;
            return (
              <JsonTreeNode
                key={childPath}
                name={isArray ? `[${k}]` : k}
                value={v}
                path={childPath}
                depth={depth + 1}
                copiedPath={copiedPath}
                onCopyPath={onCopyPath}
              />
            );
          })}
          <div
            className="font-mono text-[12px] leading-[18px] text-ui-secondary py-[1px]"
            style={{ paddingLeft: `${depth * 16 + 18}px` }}
          >
            {closeBracket}
          </div>
        </div>
      )}
    </div>
  );
}

export function JsonViewer({ body, viewMode, wrapLines, searchQuery }: JsonViewerProps) {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      const obj = JSON.parse(body);
      return { isJson: true, obj, formatted: JSON.stringify(obj, null, 2) };
    } catch {
      return { isJson: false, obj: null, formatted: body };
    }
  }, [body]);

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path).catch(() => {});
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  if (viewMode === 'tree' && parsed.isJson) {
    return (
      <div className="h-full overflow-auto bg-ui-canvas p-2.5">
        <JsonTreeNode
          value={parsed.obj}
          path="$"
          depth={0}
          copiedPath={copiedPath}
          onCopyPath={handleCopyPath}
        />
      </div>
    );
  }

  const text = viewMode === 'raw' ? body : parsed.formatted;
  const lines = text.split('\n');

  return (
    <div className="h-full overflow-auto bg-ui-canvas font-mono text-[12px] leading-[19px]">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, idx) => (
            <tr key={idx} className="hover:bg-ui-surface/70">
              <td className="w-[46px] px-2.5 py-[0.5px] text-right text-ui-muted select-none align-top border-r border-ui-border/60 tabular-nums">
                {idx + 1}
              </td>
              <td
                className={`px-3 py-[0.5px] align-top ${
                  wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
                }`}
              >
                {parsed.isJson && viewMode === 'pretty'
                  ? tokenizeJsonLine(line, searchQuery)
                  : line || ' '}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
