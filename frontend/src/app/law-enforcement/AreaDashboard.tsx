'use client';

/**
 * The officer's area view, shown above "Request Access": a map to mark the police station on,
 * the last 24 hours of AI threat and SOS alerts for that area grouped by ProMic user, and the
 * live streams users chose to share with law enforcement, which can be listened to here.
 *
 * All of it comes from ProMic's endpoints (functions/le.js): leSetStation, leOverview (polled)
 * and leJoinLive. Which users fall in the officer's area is decided there, not here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CircleMarker, LayerGroup, Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LivePlayer, LiveState, LiveTicket } from './liveAudio';

const REFRESH_MS = 15_000;
const INDIA_CENTRE: [number, number] = [21.5, 79];

type Scope = 'radius' | 'district' | 'state';

interface Station {
  lat: number;
  lon: number;
  scope: Scope;
  state: string;
  district: string;
}

interface Alert {
  type: string;
  title: string;
  message: string;
  ts: number;
  lat: number;
  lon: number;
}

interface AlertGroup {
  hostId: string;
  name: string;
  phone: string;
  /** The user is live streaming right now (the green dot). */
  live: boolean;
  /** ...and shared that stream with law enforcement, so it is in the live list below. */
  listenable: boolean;
  alerts: Alert[];
}

interface LiveStream {
  hostId: string;
  name: string;
  phone: string;
  lat: number;
  lon: number;
  since: number;
}

interface Overview {
  station: Station | null;
  alerts: AlertGroup[];
  live: LiveStream[];
  radiusKm?: number;
}

const TYPE_LABELS: Record<string, string> = {
  AI_THREAT_DETECTED: 'AI threat',
  CLOUD_THREAT_CONFIRMED: 'AI threat (confirmed)',
  SOS: 'SOS',
};

const hasPoint = (p: { lat: number; lon: number }) => !(p.lat === 0 && p.lon === 0);
const formatPhone = (phone: string) => (phone ? `+${phone}` : 'No number');
const formatPoint = (p: { lat: number; lon: number }) =>
  hasPoint(p) ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : 'Location unknown';
const formatWhen = (ms: number) =>
  new Date(ms).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** One CSV cell; text a spreadsheet would run as a formula gets a leading quote. */
function csvCell(value: string | number): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const cardClass = 'p-4 bg-navy-800 rounded-xl border border-gray-800';
const mutedClass = 'font-mono text-xs text-gray-400 leading-relaxed';
const headingClass = 'font-mono font-bold text-sm text-accent-teal';

export default function AreaDashboard({
  baseUrl,
  token,
  onSessionEnded,
}: {
  baseUrl: string;
  token: string;
  onSessionEnded: () => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openHost, setOpenHost] = useState<string | null>(null);
  const [flashHost, setFlashHost] = useState<string | null>(null);
  const [listening, setListening] = useState<{ hostId: string; state: LiveState } | null>(null);

  const mapElement = useRef<HTMLDivElement | null>(null);
  const map = useRef<LeafletMap | null>(null);
  const leaflet = useRef<typeof import('leaflet') | null>(null);
  const stationLayer = useRef<LayerGroup | null>(null);
  const pointLayer = useRef<LayerGroup | null>(null);
  const focusMarker = useRef<CircleMarker | null>(null);
  const centredOnStation = useRef(false);
  const liveRows = useRef<Record<string, HTMLDivElement | null>>({});
  const player = useRef<LivePlayer | null>(null);
  const scopeRef = useRef<Scope>('radius');

  const call = useCallback(
    async (path: string, body: unknown) => {
      const res = await fetch(`${baseUrl}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        onSessionEnded();
        throw new Error('Your session has ended. Sign in again.');
      }
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
      return data;
    },
    [baseUrl, token, onSessionEnded],
  );

  const refresh = useCallback(async () => {
    try {
      const data: Overview = await call('leOverview', {});
      setOverview(data);
      if (data.station) scopeRef.current = data.station.scope;
    } catch (err) {
      setError((err as Error).message);
    }
  }, [call]);

  const saveStation = useCallback(
    async (lat: number, lon: number, scope: Scope) => {
      setError(null);
      setSaving(true);
      try {
        await call('leSetStation', { lat, lon, scope });
        scopeRef.current = scope;
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [call, refresh],
  );

  // The map itself. Leaflet needs the browser, so it is loaded after the page is on screen.
  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((L) => {
      if (cancelled || !mapElement.current || map.current) return;
      leaflet.current = L;
      const created = L.map(mapElement.current).setView(INDIA_CENTRE, 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(created);
      stationLayer.current = L.layerGroup().addTo(created);
      pointLayer.current = L.layerGroup().addTo(created);
      // Clicking the map marks (or moves) the station, keeping the area option already chosen.
      created.on('click', (event) => saveStation(event.latlng.lat, event.latlng.lng, scopeRef.current));
      map.current = created;
      refresh();
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => () => player.current?.stop(), []);

  // While an officer is listening, ProMic is told every 20 seconds, and once more on stopping,
  // so the user's own app can show "Law enforcement is listening" and take it down again.
  const listeningHostId = listening && listening.state !== 'ended' ? listening.hostId : null;
  useEffect(() => {
    if (!listeningHostId) return;
    const tell = (leaving: boolean) =>
      call('leLivePing', { hostId: listeningHostId, leaving }).catch(() => undefined);
    const timer = setInterval(() => tell(false), 20_000);
    return () => {
      clearInterval(timer);
      tell(true);
    };
  }, [listeningHostId, call]);

  // Redraw the station and the alert / live positions whenever fresh data arrives.
  useEffect(() => {
    const L = leaflet.current;
    if (!L || !map.current || !stationLayer.current || !pointLayer.current || !overview) return;
    stationLayer.current.clearLayers();
    pointLayer.current.clearLayers();
    const station = overview.station;
    if (station) {
      L.circleMarker([station.lat, station.lon], { radius: 8, color: '#00b4d8', fillColor: '#00b4d8', fillOpacity: 1 })
        .bindTooltip('Your station')
        .addTo(stationLayer.current);
      if (station.scope === 'radius') {
        L.circle([station.lat, station.lon], {
          radius: (overview.radiusKm ?? 15) * 1000,
          color: '#00b4d8',
          weight: 1,
          fillOpacity: 0.06,
        }).addTo(stationLayer.current);
      }
      if (!centredOnStation.current) {
        map.current.setView([station.lat, station.lon], 11);
        centredOnStation.current = true;
      }
    }
    for (const group of overview.alerts) {
      const latest = group.alerts.find(hasPoint);
      if (!latest) continue;
      L.circleMarker([latest.lat, latest.lon], { radius: 7, color: '#e94560', fillColor: '#e94560', fillOpacity: 0.8 })
        .bindTooltip(`${group.name}: ${TYPE_LABELS[latest.type] ?? latest.type}`)
        .addTo(pointLayer.current);
    }
    for (const stream of overview.live) {
      if (!hasPoint(stream)) continue;
      L.circleMarker([stream.lat, stream.lon], { radius: 7, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.8 })
        .bindTooltip(`${stream.name}: live`)
        .addTo(pointLayer.current);
    }
  }, [overview]);

  function showOnMap(point: { lat: number; lon: number }, label: string) {
    const L = leaflet.current;
    if (!L || !map.current || !hasPoint(point)) return;
    focusMarker.current?.remove();
    focusMarker.current = L.circleMarker([point.lat, point.lon], { radius: 14, color: '#facc15', weight: 3, fillOpacity: 0 })
      .bindPopup(`${label}<br/>${formatPoint(point)}`)
      .addTo(map.current);
    map.current.setView([point.lat, point.lon], Math.max(map.current.getZoom(), 14));
    focusMarker.current.openPopup();
    mapElement.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function onAlertGroupClick(group: AlertGroup) {
    setOpenHost((current) => (current === group.hostId ? null : group.hostId));
    const latest = group.alerts.find(hasPoint);
    if (group.listenable) {
      // Live and shared with law enforcement: go to the same user in the live list.
      liveRows.current[group.hostId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashHost(group.hostId);
      setTimeout(() => setFlashHost((current) => (current === group.hostId ? null : current)), 2500);
    } else if (latest) {
      showOnMap(latest, group.name);
    }
  }

  function stopListening() {
    player.current?.stop();
    player.current = null;
    setListening(null);
  }

  async function listen(stream: LiveStream) {
    if (listening?.hostId === stream.hostId) {
      stopListening();
      return;
    }
    stopListening();
    setError(null);
    // The player is created inside this click so the browser lets it make sound.
    const created = new LivePlayer((state) =>
      setListening((current) => (current?.hostId === stream.hostId ? { hostId: stream.hostId, state } : current)),
    );
    player.current = created;
    setListening({ hostId: stream.hostId, state: 'connecting' });
    try {
      const ticket: LiveTicket = await call('leJoinLive', { hostId: stream.hostId });
      if (player.current !== created) return;
      await created.start(ticket);
    } catch (err) {
      if (player.current === created) stopListening();
      setError((err as Error).message);
    }
  }

  function downloadCsv() {
    if (!overview) return;
    const rows = [['Time', 'Type', 'Title', 'Message', 'User name', 'Phone', 'Latitude', 'Longitude'].join(',')];
    for (const group of overview.alerts) {
      for (const alert of group.alerts) {
        rows.push(
          [
            new Date(alert.ts).toLocaleString(),
            TYPE_LABELS[alert.type] ?? alert.type,
            alert.title,
            alert.message,
            group.name,
            group.phone,
            hasPoint(alert) ? alert.lat : '',
            hasPoint(alert) ? alert.lon : '',
          ]
            .map(csvCell)
            .join(','),
        );
      }
    }
    const url = URL.createObjectURL(new Blob([rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `promic-alerts-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const station = overview?.station ?? null;
  const scopes: Array<{ value: Scope; label: string }> = [
    { value: 'radius', label: `Within ${overview?.radiusKm ?? 15} km of the station, or where it is the nearest station` },
    { value: 'district', label: `Entire District${station?.district ? ` (${station.district})` : ''}` },
    { value: 'state', label: `Entire State${station?.state ? ` (${station.state})` : ''}` },
  ];
  const listeningLabel: Record<LiveState, string> = {
    connecting: 'Connecting…',
    waiting: 'Connected, waiting for audio…',
    playing: 'Listening live',
    ended: 'The stream has ended',
  };

  return (
    <div className="flex flex-col gap-4">
      <div className={cardClass}>
        <div className={headingClass}>Your station</div>
        <p className={`${mutedClass} mt-1 mb-3`}>
          {station
            ? 'Click the map to move your station. Alerts and live streams below are for the area you choose.'
            : 'Click the map where your police station is. Alerts and live streams for that area will appear below.'}
        </p>
        <div ref={mapElement} className="isolate h-80 w-full rounded-lg overflow-hidden border border-gray-800" />
        <div className="flex flex-col gap-2 mt-3">
          {scopes.map((option) => (
            <label key={option.value} className={`${mutedClass} flex items-start gap-2 ${station ? 'cursor-pointer' : 'opacity-50'}`}>
              <input
                type="radio"
                name="le-scope"
                className="mt-0.5"
                disabled={!station || saving}
                checked={(station?.scope ?? 'radius') === option.value}
                onChange={() => station && saveStation(station.lat, station.lon, option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      {error && <div className="text-accent-red text-xs font-mono">{error}</div>}

      {station && (
        <>
          <div className={cardClass}>
            <div className="flex items-center justify-between gap-3">
              <div className={headingClass}>AI Alerts (last 24 hours)</div>
              {overview && overview.alerts.length > 0 && (
                <button onClick={downloadCsv} className="font-mono text-xs text-accent-teal">
                  Download CSV
                </button>
              )}
            </div>
            {!overview || overview.alerts.length === 0 ? (
              <p className={`${mutedClass} mt-2`}>No alerts in your area.</p>
            ) : (
              <div className="flex flex-col gap-2 mt-3">
                {overview.alerts.map((group) => {
                  const latest = group.alerts[0];
                  const located = group.alerts.find(hasPoint);
                  return (
                    <div key={group.hostId} className="rounded-lg border border-gray-800">
                      <button onClick={() => onAlertGroupClick(group)} className="w-full text-left p-3">
                        <div className="flex items-center gap-2">
                          {group.live && (
                            <span
                              title={group.listenable ? 'Live streaming: shared with law enforcement' : 'Live streaming'}
                              className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse flex-shrink-0"
                            />
                          )}
                          <span className="font-mono font-bold text-sm text-gray-200">{group.name}</span>
                          <span className="font-mono text-xs text-gray-400">{formatPhone(group.phone)}</span>
                          <span className="ml-auto font-mono text-xs text-accent-red">
                            {group.alerts.length} {group.alerts.length === 1 ? 'alert' : 'alerts'}
                          </span>
                        </div>
                        <div className={`${mutedClass} mt-1`}>
                          {TYPE_LABELS[latest.type] ?? latest.type} · {formatWhen(latest.ts)} ·{' '}
                          {located ? formatPoint(located) : 'Location unknown'}
                        </div>
                      </button>
                      {openHost === group.hostId && (
                        <div className="border-t border-gray-800 p-3 flex flex-col gap-2">
                          {group.alerts.map((alert, index) => (
                            <button
                              key={`${alert.ts}-${index}`}
                              onClick={() => showOnMap(alert, group.name)}
                              className={`${mutedClass} text-left`}
                            >
                              <span className="text-gray-200">{formatWhen(alert.ts)}</span> ·{' '}
                              {TYPE_LABELS[alert.type] ?? alert.type}
                              {alert.message ? ` · ${alert.message}` : ''} · {formatPoint(alert)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={cardClass}>
            <div className={headingClass}>Live Streaming</div>
            <p className={`${mutedClass} mt-1`}>
              Users who chose to share their live stream with law enforcement. Click one to listen.
            </p>
            {!overview || overview.live.length === 0 ? (
              <p className={`${mutedClass} mt-2`}>Nobody in your area is sharing a live stream right now.</p>
            ) : (
              <div className="flex flex-col gap-2 mt-3">
                {overview.live.map((stream) => {
                  const active = listening?.hostId === stream.hostId;
                  return (
                    <div
                      key={stream.hostId}
                      ref={(element) => {
                        liveRows.current[stream.hostId] = element;
                      }}
                      className={`rounded-lg border p-3 transition-colors ${
                        flashHost === stream.hostId ? 'border-green-500' : 'border-gray-800'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                        <span className="font-mono font-bold text-sm text-gray-200">{stream.name}</span>
                        <span className="font-mono text-xs text-gray-400">{formatPhone(stream.phone)}</span>
                      </div>
                      <button onClick={() => showOnMap(stream, stream.name)} className={`${mutedClass} mt-1 text-left`}>
                        {formatPoint(stream)}
                        {stream.since ? ` · live since ${formatWhen(stream.since)}` : ''}
                      </button>
                      <div className="flex items-center gap-3 mt-2">
                        <button
                          onClick={() => listen(stream)}
                          className={`px-4 py-2 rounded-lg font-mono font-bold text-xs ${
                            active ? 'border border-gray-700 text-gray-300' : 'bg-accent-red text-white'
                          }`}
                        >
                          {active ? 'Stop' : 'Listen'}
                        </button>
                        {active && listening && <span className={mutedClass}>{listeningLabel[listening.state]}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
