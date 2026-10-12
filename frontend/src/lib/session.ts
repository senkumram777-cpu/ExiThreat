/**
 * The signed-in user, kept in the browser's local storage. One place reads and writes it, so
 * that the navigation bar can follow sign-in and sign-out without a page reload.
 */

export interface Session {
  token: string;
  userId: string;
  username: string;
}

const CHANGED = 'exithreat-session';

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('exithreat_token');
  if (!token) return null;
  return {
    token,
    userId: localStorage.getItem('exithreat_userId') ?? '',
    username: localStorage.getItem('exithreat_username') ?? '',
  };
}

export function saveSession(session: Session): void {
  localStorage.setItem('exithreat_token', session.token);
  localStorage.setItem('exithreat_userId', session.userId);
  localStorage.setItem('exithreat_username', session.username);
  window.dispatchEvent(new Event(CHANGED));
}

export function clearSession(): void {
  localStorage.removeItem('exithreat_token');
  localStorage.removeItem('exithreat_userId');
  localStorage.removeItem('exithreat_username');
  window.dispatchEvent(new Event(CHANGED));
}

/** Calls `listener` when the session changes, in this tab or another one. */
export function onSessionChange(listener: () => void): () => void {
  window.addEventListener(CHANGED, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener('storage', listener);
  };
}
