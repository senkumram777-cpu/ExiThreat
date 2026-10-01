'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  promic,
  type ProMicLinkStatus,
  type ProMicAudioBackup,
  type ProMicVideoBackup,
} from '@/lib/api';

type Playing = { kind: 'audio' | 'video'; id: string; url: string };

function formatWhen(ts: number): string {
  return ts ? new Date(ts).toLocaleString() : 'Unknown time';
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function ProMicBackupsPage() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [link, setLink] = useState<ProMicLinkStatus | null>(null);
  const [audio, setAudio] = useState<ProMicAudioBackup[]>([]);
  const [video, setVideo] = useState<ProMicVideoBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [linking, setLinking] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const playingUrl = useRef<string | null>(null);

  const loadBackups = async () => {
    const backups = await promic.listBackups();
    setAudio(backups.audio);
    setVideo(backups.video);
  };

  useEffect(() => {
    const loggedIn = !!localStorage.getItem('exithreat_token');
    setIsLoggedIn(loggedIn);
    if (!loggedIn) {
      setLoading(false);
      return;
    }
    promic
      .getLink()
      .then(async (status) => {
        setLink(status);
        if (status.linked) await loadBackups();
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  // Decrypted media only ever lives in memory — release it when replaced or on leaving the page.
  const releasePlaying = () => {
    if (playingUrl.current) URL.revokeObjectURL(playingUrl.current);
    playingUrl.current = null;
    setPlaying(null);
  };
  useEffect(() => () => {
    if (playingUrl.current) URL.revokeObjectURL(playingUrl.current);
  }, []);

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || linking) return;
    setLinking(true);
    setError(null);
    try {
      const status = await promic.link(code.trim());
      setLink(status);
      setCode('');
      await loadBackups();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async () => {
    if (!window.confirm('Unlink your ProMic account? You can link again with a new code.')) return;
    setError(null);
    try {
      releasePlaying();
      setLink(await promic.unlink());
      setAudio([]);
      setVideo([]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handlePlay = async (kind: 'audio' | 'video', id: string) => {
    if (loadingId) return;
    setLoadingId(id);
    setError(null);
    try {
      const blob = await promic.getMedia(kind, id);
      releasePlaying();
      const url = URL.createObjectURL(blob);
      playingUrl.current = url;
      setPlaying({ kind, id, url });
    } catch {
      setError('Could not open that backup. Try again.');
    } finally {
      setLoadingId(null);
    }
  };

  if (isLoggedIn === false) {
    return (
      <div className="text-center py-12 font-mono text-sm text-gray-400">
        <Link href="/auth/login" className="text-accent-teal">Sign in</Link> to open your ProMic backups.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-mono font-bold text-accent-teal">ProMic Backups</h1>
        {link?.linked && (
          <button onClick={handleUnlink} className="text-xs font-mono text-gray-500 hover:text-accent-red">
            Unlink
          </button>
        )}
      </div>

      {error && <div className="text-accent-red text-xs font-mono">{error}</div>}

      {loading && <div className="h-20 bg-navy-800 rounded-xl animate-pulse" />}

      {!loading && link && !link.linked && (
        <form onSubmit={handleLink} className="flex flex-col gap-3 p-4 bg-navy-800 rounded-xl border border-gray-800">
          <p className="font-mono text-xs text-gray-400 leading-relaxed">
            In the ProMic app on your Host phone, open Settings → Link ExiThreat Account and enter
            the code shown there. It works once and expires after 10 minutes.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="XXXXX-XXXXX"
              autoComplete="off"
              className="flex-1 bg-navy-900 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono tracking-widest text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-teal"
            />
            <button
              type="submit"
              disabled={linking || !code.trim()}
              className="px-4 py-2 bg-navy-700 border border-gray-600 text-gray-300 rounded-lg font-mono text-sm disabled:opacity-40 hover:border-accent-teal transition-colors"
            >
              {linking ? '…' : 'Link'}
            </button>
          </div>
        </form>
      )}

      {!loading && link?.linked && (
        <>
          <div className="font-mono text-xs text-gray-500">
            Linked to {link.hostName ?? 'your ProMic host account'}
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="font-mono font-bold text-sm text-gray-300">Emergency video</h2>
            {video.length === 0 && (
              <div className="py-6 text-center text-gray-600 font-mono text-sm">No video backups.</div>
            )}
            {video.map((v) => (
              <div key={v.id} className="p-4 bg-navy-800 rounded-xl border border-gray-800 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-mono text-xs text-gray-400">
                    <div className="text-gray-200">{formatWhen(v.startTimestamp)}</div>
                    <div>
                      {v.cameraFacing === 'FRONT' ? 'Front' : 'Back'} camera · {formatDuration(v.durationMs)}
                    </div>
                  </div>
                  <button
                    onClick={() => handlePlay('video', v.id)}
                    disabled={loadingId !== null}
                    className="px-3 py-1.5 border border-gray-600 text-gray-300 rounded-lg font-mono text-xs disabled:opacity-40 hover:border-accent-teal transition-colors"
                  >
                    {loadingId === v.id ? 'Opening…' : 'Play'}
                  </button>
                </div>
                {playing?.kind === 'video' && playing.id === v.id && (
                  <video src={playing.url} controls autoPlay playsInline className="w-full rounded-lg" />
                )}
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-mono font-bold text-sm text-gray-300">Audio</h2>
            {audio.length === 0 && (
              <div className="py-6 text-center text-gray-600 font-mono text-sm">No audio backups.</div>
            )}
            {audio.map((a) => (
              <div key={a.id} className="p-4 bg-navy-800 rounded-xl border border-gray-800 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-mono text-xs text-gray-400">
                    <div className="text-gray-200">{formatWhen(a.startTimestamp)}</div>
                    <div>
                      {formatDuration(a.durationMs)}
                      {a.isThreatClip && <span className="text-accent-red"> · Threat clip</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => handlePlay('audio', a.id)}
                    disabled={loadingId !== null}
                    className="px-3 py-1.5 border border-gray-600 text-gray-300 rounded-lg font-mono text-xs disabled:opacity-40 hover:border-accent-teal transition-colors"
                  >
                    {loadingId === a.id ? 'Opening…' : 'Play'}
                  </button>
                </div>
                {playing?.kind === 'audio' && playing.id === a.id && (
                  <audio src={playing.url} controls autoPlay className="w-full" />
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
