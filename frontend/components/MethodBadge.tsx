import type { HttpMethod } from '../types/api';

export const METHOD_STYLES: Record<
  HttpMethod,
  { text: string; bg: string; short: string; hex: string }
> = {
  GET: {
    text: 'text-ui-green',
    bg: 'bg-ui-green/12',
    short: 'GET',
    hex: '#10B981',
  },
  POST: {
    text: 'text-ui-amber',
    bg: 'bg-ui-amber/12',
    short: 'POST',
    hex: '#F59E0B',
  },
  PUT: {
    text: 'text-ui-sky',
    bg: 'bg-ui-sky/12',
    short: 'PUT',
    hex: '#38BDF8',
  },
  DELETE: {
    text: 'text-ui-danger',
    bg: 'bg-ui-danger/12',
    short: 'DEL',
    hex: '#F43F5E',
  },
  PATCH: {
    text: 'text-ui-purple',
    bg: 'bg-ui-purple/12',
    short: 'PATCH',
    hex: '#A855F7',
  },
};

interface MethodBadgeProps {
  method: HttpMethod;
  compact?: boolean;
  className?: string;
}

export function MethodBadge({ method, compact = false, className = '' }: MethodBadgeProps) {
  const style = METHOD_STYLES[method] || METHOD_STYLES.GET;
  return (
    <span
      className={`inline-flex items-center justify-center font-mono text-[10px] font-bold leading-3 tracking-[0.04em] uppercase rounded-[4px] whitespace-nowrap shrink-0 ${
        compact ? 'w-[42px] py-[2px]' : 'px-1.5 py-[3px]'
      } ${style.bg} ${style.text} ${className}`}
    >
      {compact && method === 'DELETE' ? 'DEL' : method}
    </span>
  );
}

export function getStatusColorClasses(status: number): { text: string; bg: string } {
  if (status >= 200 && status < 300) {
    return { text: 'text-ui-green', bg: 'bg-ui-green/12' };
  }
  if (status >= 300 && status < 400) {
    return { text: 'text-ui-sky', bg: 'bg-ui-sky/12' };
  }
  if (status >= 400 && status < 500) {
    return { text: 'text-ui-amber', bg: 'bg-ui-amber/12' };
  }
  return { text: 'text-ui-danger', bg: 'bg-ui-danger/12' };
}
