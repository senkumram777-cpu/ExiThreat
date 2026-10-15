'use client';

/** Small building blocks shared by the admin page's tabs. */

import { useCallback, useEffect, useState } from 'react';

export const inputClass =
  'bg-navy-900 border border-gray-700 rounded-lg px-3 py-2 font-mono text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal min-w-0';

export function when(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const date = new Date(value);
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function percent(share: number | null | undefined): string {
  return share === null || share === undefined ? '—' : `${Math.round(share * 100)}%`;
}

export function Card({ title, children, actions }: { title?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="p-4 bg-navy-800 rounded-xl border border-gray-800 min-w-0">
      {(title || actions) && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {title && <h2 className="text-xs font-mono text-gray-400 uppercase tracking-widest">{title}</h2>}
          {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="p-3 bg-navy-900 rounded-lg border border-gray-800 min-w-0">
      <div className="text-xl font-mono font-bold text-accent-teal">{value}</div>
      <div className="text-[11px] font-mono text-gray-400">{label}</div>
      {note && <div className="text-[11px] font-mono text-gray-600">{note}</div>}
    </div>
  );
}

type Tone = 'plain' | 'danger' | 'primary';

const toneClass: Record<Tone, string> = {
  plain: 'border-gray-700 text-gray-300 hover:border-accent-teal hover:text-accent-teal',
  danger: 'border-accent-red/60 text-accent-red hover:bg-accent-red/10',
  primary: 'border-accent-teal text-accent-teal hover:bg-accent-teal/10',
};

export function Button({
  children, onClick, tone = 'plain', disabled, type = 'button',
}: { children: React.ReactNode; onClick?: () => void; tone?: Tone; disabled?: boolean; type?: 'button' | 'submit' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 border rounded-lg font-mono text-xs transition-colors disabled:opacity-40 ${toneClass[tone]}`}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'red' | 'teal' | 'yellow' }) {
  const cls = {
    plain: 'border-gray-700 text-gray-400',
    red: 'border-accent-red/50 text-accent-red',
    teal: 'border-accent-teal/50 text-accent-teal',
    yellow: 'border-yellow-600/50 text-yellow-500',
  }[tone];
  return <span className={`inline-block px-2 py-0.5 border rounded-full text-[11px] font-mono whitespace-nowrap ${cls}`}>{children}</span>;
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="text-xs font-mono text-accent-red break-words">{error}</div>;
}

export function Loading() {
  return <div className="h-24 bg-navy-800 rounded-xl animate-pulse" />;
}

/** Loads with `load` and reloads on `reload()` or when `deps` change. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  useEffect(() => {
    let cancelled = false;
    run()
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [run, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

/**
 * Runs an admin action after asking. `ask` is the question; `reason` asks for a reason too,
 * passed to `act`. Reports failures with alert, and calls `done` after success.
 */
export async function confirmAction(
  ask: string,
  act: (reason: string) => Promise<unknown>,
  done: () => void,
  options: { reason?: boolean } = {},
): Promise<void> {
  let reason = '';
  if (options.reason) {
    const answer = window.prompt(`${ask}\n\nReason (kept in the admin log):`, '');
    if (answer === null) return;
    reason = answer;
  } else if (!window.confirm(ask)) {
    return;
  }
  try {
    await act(reason);
    done();
  } catch (err) {
    window.alert((err as Error).message);
  }
}

export function Pager({ offset, total, size = 50, onChange }: { offset: number; total: number; size?: number; onChange: (offset: number) => void }) {
  if (total <= size) return null;
  return (
    <div className="flex items-center gap-2 font-mono text-xs text-gray-400 mt-3">
      <Button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - size))}>← Newer</Button>
      <span>{offset + 1}–{Math.min(total, offset + size)} of {total}</span>
      <Button disabled={offset + size >= total} onClick={() => onChange(offset + size)}>Older →</Button>
    </div>
  );
}

export function SearchBox({ value, onSearch, placeholder }: { value: string; onSearch: (q: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  return (
    <form
      className="flex gap-2 min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(text.trim());
      }}
    >
      <input className={`${inputClass} flex-1`} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
      <Button type="submit" tone="primary">Search</Button>
    </form>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-3 py-1 rounded-full font-mono text-xs border transition-colors ${
            value === key ? 'border-accent-teal text-accent-teal bg-accent-teal/10' : 'border-gray-700 text-gray-400 hover:text-gray-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
