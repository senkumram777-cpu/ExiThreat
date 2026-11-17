'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { common } from '@/lib/api';
import { getSession } from '@/lib/session';
import CommonFeed from '@/components/CommonFeed';
import { pct, useRules } from '@/lib/rules';

/** The top posts page for members: posts that have reached 40% of the groups, heaviest first. */
export default function TopPostsView() {
  const rules = useRules();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getSession()) router.replace('/auth/login');
    else setReady(true);
  }, [router]);

  const load = useCallback((offset: number, category: string) => common.list(offset, category, 'top'), []);

  if (!ready) return null;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-mono font-bold text-accent-teal">Top Posts</h1>
        <p className="text-xs font-mono text-gray-500 mt-1 leading-relaxed">
          Disclosures that have reached at least {pct(rules.topShare)} of the groups, the most weight first.
          At equal weight, the one that reached {pct(rules.topShare)} most recently comes first. Each shows its
          author&apos;s pseudonym and the redacted version only.
        </p>
      </div>
      <CommonFeed load={load} view="top" />
    </div>
  );
}
