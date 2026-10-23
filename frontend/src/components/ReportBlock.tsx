'use client';

/**
 * Report or block, for a post, comment or group chat message someone else wrote: a small "⋯"
 * button that opens a dialog. A report goes to the admin (admin page, Reports tab); blocking
 * hides everything the writer posts, comments or says in chat from the reader, without telling
 * them. `onBlocked` gets the writer's pseudonym so the list can drop their items at once.
 *
 * The dialog is not inside the item: `ReportBlockDialog`, placed once in the layout, shows it. A
 * list that refreshes (group chat does every 5 seconds) drops a blocked writer's items, and the
 * dialog must not go with them.
 */

import { useEffect, useState } from 'react';
import { moderation, REPORT_REASONS, type ReportTarget } from '@/lib/api';

const NOUN: Record<ReportTarget, string> = { post: 'post', comment: 'comment', chat: 'message' };

interface Request {
  targetType: ReportTarget;
  targetId: string;
  author: string;
  onBlocked?: (author: string) => void;
}

// The open dialog's item, and the dialog that shows it.
let listener: ((request: Request | null) => void) | null = null;

export default function ReportBlock({
  targetType,
  targetId,
  author,
  onBlocked,
  className = '',
}: Request & { className?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        listener?.({ targetType, targetId, author, onBlocked });
      }}
      aria-label={`Report or block this ${NOUN[targetType]}`}
      title="Report or block"
      className={`px-1.5 leading-none font-mono text-base text-gray-400 hover:text-accent-red ${className}`}
    >
      ⋯
    </button>
  );
}

/** The report-or-block dialog; placed once, in the layout. */
export function ReportBlockDialog() {
  const [request, setRequest] = useState<Request | null>(null);
  useEffect(() => {
    listener = setRequest;
    return () => {
      listener = null;
    };
  }, []);
  // A fresh dialog for each item.
  if (!request) return null;
  return <Dialog key={`${request.targetType}:${request.targetId}`} request={request} onClose={() => setRequest(null)} />;
}

function Dialog({ request, onClose }: { request: Request; onClose: () => void }) {
  const { targetType, targetId, author, onBlocked } = request;
  const [step, setStep] = useState<'menu' | 'report' | 'block' | 'done'>('menu');
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState('');
  const [blocked, setBlocked] = useState(false);

  const close = () => {
    onClose();
    // Their items leave the list only once the dialog is closed, so the message can be read.
    if (blocked) onBlocked?.(author);
  };

  const run = async (act: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      setDone(await act());
      setStep('done');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendReport = () => run(async () => {
    const r = await moderation.report(targetType, targetId, reason, detail.trim(), alsoBlock);
    setBlocked(r.blocked);
    const sent = r.alreadyReported ? `You had already reported this ${NOUN[targetType]}.` : 'Thank you. The report has been sent to the admin, who will look at it.';
    return r.blocked ? `${sent} You will no longer see anything from ${author}.` : sent;
  });

  const sendBlock = () => run(async () => {
    await moderation.block(targetType, targetId);
    setBlocked(true);
    return `${author} is blocked. You can unblock them from your Account page.`;
  });

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 flex items-end sm:items-center justify-center p-4"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm bg-navy-800 border border-gray-700 rounded-xl p-4 flex flex-col gap-3 font-mono text-sm text-gray-200 max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 'menu' && (
          <>
            <div className="text-xs text-gray-400">This {NOUN[targetType]} by {author}</div>
            <button type="button" onClick={() => setStep('report')} className="py-3 border border-accent-red/60 text-accent-red rounded-lg hover:bg-accent-red/10">
              Report {NOUN[targetType]}
            </button>
            <button type="button" onClick={() => setStep('block')} className="py-3 border border-gray-600 rounded-lg hover:border-accent-teal">
              Block {author}
            </button>
            <button type="button" onClick={close} className="py-2 text-gray-400">Cancel</button>
          </>
        )}

        {step === 'report' && (
          <>
            <div className="font-bold">Report this {NOUN[targetType]}</div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-xs text-gray-400 mb-1">What is wrong with it?</legend>
              {REPORT_REASONS.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="reason" value={key} checked={reason === key} onChange={() => setReason(key)} />
                  {label}
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1 text-xs text-gray-400">
              More detail (optional)
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                maxLength={500}
                rows={3}
                className="bg-navy-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent-teal"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} />
              Also block {author}
            </label>
            {error && <div className="text-accent-red text-xs">{error}</div>}
            <div className="flex gap-2">
              <button type="button" onClick={close} disabled={busy} className="flex-1 py-2 border border-gray-700 rounded-lg text-gray-300">Cancel</button>
              <button
                type="button"
                onClick={sendReport}
                disabled={busy || !reason}
                className="flex-1 py-2 bg-accent-red text-white rounded-lg font-bold disabled:opacity-40"
              >
                {busy ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </>
        )}

        {step === 'block' && (
          <>
            <div className="font-bold">Block {author}?</div>
            <p className="text-xs text-gray-400 leading-relaxed">
              You will no longer see their posts, comments or chat messages. They are not told. You can unblock
              them from your Account page.
            </p>
            {error && <div className="text-accent-red text-xs">{error}</div>}
            <div className="flex gap-2">
              <button type="button" onClick={close} disabled={busy} className="flex-1 py-2 border border-gray-700 rounded-lg text-gray-300">Cancel</button>
              <button type="button" onClick={sendBlock} disabled={busy} className="flex-1 py-2 bg-accent-red text-white rounded-lg font-bold disabled:opacity-40">
                {busy ? 'Blocking…' : 'Block'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <p className="text-sm leading-relaxed">{done}</p>
            <button type="button" onClick={close} className="py-2 bg-accent-teal text-navy-900 rounded-lg font-bold">OK</button>
          </>
        )}
      </div>
    </div>
  );
}
