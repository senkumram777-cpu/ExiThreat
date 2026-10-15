'use client';

import { useState } from 'react';
import { admin } from '@/lib/adminApi';
import { Badge, Button, Card, ErrorLine, Loading, confirmAction, inputClass, useLoad, when } from './ui';

/**
 * Law-enforcement officers: the accounts that sign in on ExiThreat's officer page. They live
 * in ProMic; ProMic emails each new officer, and each new password, itself.
 */
export default function Officers() {
  const { data, error, reload } = useLoad(() => admin.officers(), []);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [branch, setBranch] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    setFormError(null);
    try {
      await admin.createOfficer(email.trim(), phone.trim(), branch.trim());
      setNotice(`Account created. ProMic has emailed the password to ${email.trim()}.`);
      setEmail('');
      setPhone('');
      setBranch('');
      reload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title="New officer">
        <form onSubmit={create} className="flex flex-col gap-2">
          <input className={inputClass} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" />
          <input className={inputClass} value={branch} required onChange={(e) => setBranch(e.target.value)} placeholder="Station or unit" maxLength={120} />
          <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" />
          <div><Button type="submit" tone="primary" disabled={saving}>{saving ? 'Creating…' : 'Create and email the password'}</Button></div>
          {notice && <div className="text-xs font-mono text-accent-teal">{notice}</div>}
          <ErrorLine error={formError} />
        </form>
      </Card>
      <Card title={data ? `Officers (${data.length})` : 'Officers'}>
        <ErrorLine error={error} />
        {!data && !error && <Loading />}
        {data && data.length === 0 && <p className="text-xs font-mono text-gray-500">No officer accounts yet.</p>}
        <ul className="flex flex-col divide-y divide-gray-800">
          {(data ?? []).map((o) => (
            <li key={o.id} className="py-2 flex flex-col gap-1 font-mono">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-100 break-all">{o.email}</span>
                {o.disabled ? <Badge tone="red">off</Badge> : <Badge tone="teal">active</Badge>}
                {o.lockedUntil && <Badge tone="yellow">locked until {when(o.lockedUntil)}</Badge>}
              </div>
              <div className="text-xs text-gray-500">
                {o.branch || 'no branch'}{o.phone ? ` · ${o.phone}` : ''} · created {when(o.createdAt)} · last sign-in {when(o.lastLoginAt)}
                {o.hasStation ? ' · station set' : ' · no station yet'}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => confirmAction(`Email ${o.email} a new password? The old one stops working.`, () => admin.resetOfficer(o.email), reload)}>New password</Button>
                {o.disabled ? (
                  <Button tone="primary" onClick={() => confirmAction(`Turn ${o.email}'s account back on?`, () => admin.setOfficerDisabled(o.id, false), reload)}>Turn on</Button>
                ) : (
                  <Button tone="danger" onClick={() => confirmAction(`Turn ${o.email}'s account off? They can no longer sign in.`, () => admin.setOfficerDisabled(o.id, true), reload)}>Turn off</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
