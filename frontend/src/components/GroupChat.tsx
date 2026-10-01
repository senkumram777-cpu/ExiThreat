'use client';

/**
 * GroupChat — local-to-group chat that does NOT travel with posts.
 * Polls every 5 seconds for new messages.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { groups as groupsApi, type ChatMessage } from '@/lib/api';

interface GroupChatProps {
  groupId: string;
  currentUserId: string;
  currentUsername: string;
}

export default function GroupChat({ groupId, currentUserId, currentUsername }: GroupChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const latestIdRef = useRef<string | null>(null);

  const loadMessages = useCallback(async () => {
    try {
      const msgs = await groupsApi.getChat(groupId);
      setMessages(msgs);
      if (msgs.length > 0) latestIdRef.current = msgs[msgs.length - 1].id;
    } catch {
      // Silently ignore poll errors
    }
  }, [groupId]);

  useEffect(() => {
    loadMessages();
    const interval = setInterval(loadMessages, 5_000);
    return () => clearInterval(interval);
  }, [loadMessages]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const msg = await groupsApi.sendChat(groupId, draft.trim());
      setMessages((prev) => [...prev, msg]);
      setDraft('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-mono text-gray-400 uppercase tracking-widest">
          Group Chat
        </h3>
        <span className="text-xs font-mono text-gray-600">Local only — stays in group</span>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-0 max-h-72 pr-1">
        {messages.length === 0 && (
          <div className="text-gray-600 text-sm font-mono text-center mt-4">
            No messages yet. Start the conversation.
          </div>
        )}
        {messages.map((m) => {
          const isMe = m.user.id === currentUserId;
          return (
            <div
              key={m.id}
              className={['flex', isMe ? 'justify-end' : 'justify-start'].join(' ')}
            >
              <div
                className={[
                  'max-w-xs rounded-2xl px-3 py-2 text-sm font-mono',
                  isMe
                    ? 'bg-accent-teal text-navy-900 rounded-br-sm'
                    : 'bg-navy-700 text-gray-200 rounded-bl-sm',
                ].join(' ')}
              >
                {!isMe && (
                  <div className="text-xs text-accent-teal/70 mb-0.5">{m.user.username}</div>
                )}
                <p className="break-words">{m.content}</p>
                <div className={['text-xs mt-0.5', isMe ? 'text-navy-800' : 'text-gray-500'].join(' ')}>
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2 pt-1 border-t border-gray-800">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message as ${currentUsername}…`}
          maxLength={1000}
          className="flex-1 bg-navy-800 border border-gray-700 rounded-full px-4 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal"
        />
        <button
          type="submit"
          disabled={submitting || !draft.trim()}
          className="w-10 h-10 rounded-full bg-accent-teal text-navy-900 font-bold flex items-center justify-center disabled:opacity-40 hover:bg-accent-teal/80 transition-colors flex-shrink-0"
          aria-label="Send"
        >
          {submitting ? '…' : '▶'}
        </button>
      </form>

      {error && <div className="text-accent-red text-xs font-mono">{error}</div>}
    </div>
  );
}
