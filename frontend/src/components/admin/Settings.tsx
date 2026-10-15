'use client';

import { useState } from 'react';
import { admin, type Setting } from '@/lib/adminApi';
import { Button, Card, ErrorLine, Loading, inputClass, useLoad, when } from './ui';

/** Shown as typed: shares as percentages. */
function shown(s: Setting, value: number): string {
  return s.unit === 'share' ? String(Math.round(value * 1000) / 10) : String(value);
}

function stored(s: Setting, text: string): number {
  const n = Number(text);
  return s.unit === 'share' ? n / 100 : n;
}

function describe(s: Setting, value: number): string {
  if (s.unit === 'switch') return value === 1 ? 'on' : 'off';
  if (s.unit === 'share') return `${shown(s, value)}%`;
  if (s.unit === 'hours') return `${value} h`;
  return String(value);
}

/** The rules admins can change without a redeploy (backend services/rules.ts). */
export default function Settings() {
  const { data, error, reload } = useLoad(() => admin.settings(), []);
  if (error) return <ErrorLine error={error} />;
  if (!data) return <Loading />;
  return (
    <Card title="Settings">
      <p className="text-xs font-mono text-gray-500 mb-3">
        Changes apply at once, and every change is in the admin log. Weights, pushes due and the common page are
        recalculated after a change to the vote, group or common-page rules.
      </p>
      <div className="flex flex-col divide-y divide-gray-800">
        {data.map((s) => <SettingRow key={s.key} setting={s} onSaved={reload} />)}
      </div>
    </Card>
  );
}

function SettingRow({ setting: s, onSaved }: { setting: Setting; onSaved: () => void }) {
  const [text, setText] = useState(shown(s, s.value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (value: number) => {
    setSaving(true);
    setError(null);
    try {
      await admin.setSetting(s.key, value);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const unitLabel = s.unit === 'share' ? '%' : s.unit === 'hours' ? 'hours' : '';
  return (
    <div className="py-3 flex flex-col gap-2">
      <div className="font-mono text-sm text-gray-100">{s.label}</div>
      <div className="font-mono text-xs text-gray-500">{s.help}</div>
      {s.unit === 'switch' ? (
        <div className="flex items-center gap-3">
          <span className={`font-mono text-sm ${s.value === 1 ? 'text-accent-teal' : 'text-accent-red'}`}>{s.value === 1 ? 'Open' : 'Paused'}</span>
          <Button tone={s.value === 1 ? 'danger' : 'primary'} disabled={saving} onClick={() => {
            if (window.confirm(s.value === 1 ? 'Pause registration?' : 'Open registration again?')) void save(s.value === 1 ? 0 : 1);
          }}>
            {s.value === 1 ? 'Pause' : 'Open'}
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = stored(s, text);
            if (window.confirm(`Change "${s.label}" from ${describe(s, s.value)} to ${describe(s, value)}?`)) void save(value);
          }}
        >
          <input
            className={`${inputClass} w-28`}
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={s.label}
          />
          {unitLabel && <span className="font-mono text-xs text-gray-400">{unitLabel}</span>}
          <Button type="submit" tone="primary" disabled={saving || stored(s, text) === s.value}>Save</Button>
          {s.value !== s.default && (
            <Button disabled={saving} onClick={() => {
              setText(shown(s, s.default));
              if (window.confirm(`Put "${s.label}" back to its default, ${describe(s, s.default)}?`)) void save(s.default);
            }}>
              Default ({describe(s, s.default)})
            </Button>
          )}
        </form>
      )}
      <div className="font-mono text-[11px] text-gray-600">
        Allowed {describe(s, s.min)} to {describe(s, s.max)}
        {s.updatedBy ? ` · changed ${when(s.updatedAt)} by ${s.updatedBy}` : ' · default'}
      </div>
      <ErrorLine error={error} />
    </div>
  );
}
