'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { common } from '@/lib/api';
import { getSession } from '@/lib/session';
import CommonFeed from '@/components/CommonFeed';
import { pct, useRules } from '@/lib/rules';

/** The common page for members: listed posts, redacted only, by pseudonym. */
export default function CommonPageView() {
  const rules = useRules();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getSession()) router.replace('/auth/login');
    else setReady(true);
  }, [router]);

  const load = useCallback((offset: number) => common.list(offset), []);

  if (!ready) return null;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-mono font-bold text-accent-teal">Common Page</h1>
        <p className="text-xs font-mono text-gray-500 mt-1 leading-relaxed">
          Disclosures that have reached at least {pct(rules.listShare)} of the groups, the fastest spreading first.
          Each shows its author&apos;s pseudonym and the redacted version only. The order changes
          as they keep spreading.
        </p>
      </div>
      <CommonFeed load={load} />
    </div>
  );
}
