'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { posts as postsApi, type Post } from '@/lib/api';
import { getSession } from '@/lib/session';
import GroupMap from '@/components/GroupMap';

/** The author's map of every group for one of their posts, opened from "Mine". */
export default function PostMapPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSession()) {
      router.replace('/auth/login');
      return;
    }
    if (!id) return;
    postsApi.get(id).then(setPost).catch((err) => setError((err as Error).message));
  }, [id, router]);

  if (error) return <div className="text-accent-red font-mono text-sm text-center py-12">{error}</div>;
  if (!post) return <div className="h-64 bg-navy-800 rounded-xl animate-pulse" />;
  if (!post.isAuthor) {
    return (
      <div className="text-gray-400 font-mono text-sm text-center py-12">
        Only the author can see where a post has been.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link href="/disclosures" className="text-xs font-mono text-gray-500 hover:text-accent-teal">
          ← My Disclosures
        </Link>
        <Link
          href={`/post/${post.id}`}
          className="ml-auto text-xs font-mono text-accent-teal border border-accent-teal/40 px-3 py-1 rounded-full hover:bg-accent-teal hover:text-navy-900 transition-colors no-underline"
        >
          Open post
        </Link>
      </div>
      <div>
        <h1 className="text-lg font-mono font-bold text-accent-teal">Where Your Post Has Been</h1>
        <p className="font-mono text-xs text-gray-400 mt-2 line-clamp-2">{post.redactedContent}</p>
      </div>
      <div className="p-4 bg-navy-800 rounded-xl border border-gray-800">
        <GroupMap postId={post.id} />
      </div>
    </div>
  );
}
