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

// ProMic's CHECK_IN_WAIT_MS (CheckIn.kt): how long a Host has to answer a check-in.
const CHECK_IN_WAIT_SECONDS = 45;

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
  // SOS only: whether it is still going, and when it ended (0 when ProMic has no time for it).
  active?: boolean;
  endedAt?: number;
  // No town or village where the alert was raised, and the nearest named place or wider area.
  remote?: boolean;
  place?: string;
  district?: string;
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
  // No Connected User is listening to this stream: police are the only people who can hear it.
  policeOnly?: boolean;
  // Where the user is: no town or village there, and the nearest named place or wider area.
  remote?: boolean;
  place?: string;
  district?: string;
  // How well their phone is reaching ProMic. `weak` is the phone's own report; `lost` means it
  // has stopped reporting, and lat/lon are then the last known position, sent at `locationAt`.
  weak?: boolean;
  lost?: boolean;
  lastSeenAt?: number;
  locationAt?: number;
  bars?: number;
  net?: string;
}

interface Overview {
  station: Station | null;
  alerts: AlertGroup[];
  live: LiveStream[];
  radiusKm?: number;
}

// The filters above each list. They only choose what is shown: the map and the CSV keep everything.
type AlertFilter = 'all' | 'sosActive' | 'sosEnded' | 'threat' | 'remote';
type LiveFilter = 'all' | 'policeOnly' | 'withListeners' | 'remote' | 'poorSignal';

const ALERT_FILTERS: { id: AlertFilter; label: string; matches: (alert: Alert) => boolean }[] = [
  { id: 'all', label: 'All', matches: () => true },
  { id: 'sosActive', label: 'Active SOS', matches: (alert) => alert.type === 'SOS' && !!alert.active },
  { id: 'sosEnded', label: 'Ended SOS', matches: (alert) => alert.type === 'SOS' && !alert.active },
  { id: 'threat', label: 'AI threats', matches: (alert) => alert.type !== 'SOS' },
  { id: 'remote', label: 'Remote area', matches: (alert) => !!alert.remote },
];

const LIVE_FILTERS: { id: LiveFilter; label: string; matches: (stream: LiveStream) => boolean }[] = [
  { id: 'all', label: 'All', matches: () => true },
  { id: 'policeOnly', label: 'Only police listening', matches: (stream) => !!stream.policeOnly },
  { id: 'withListeners', label: 'With other listeners', matches: (stream) => !stream.policeOnly },
  { id: 'remote', label: 'Remote area', matches: (stream) => !!stream.remote },
  { id: 'poorSignal', label: 'Weak or lost signal', matches: (stream) => !!stream.weak || !!stream.lost },
];

/** A row of filter buttons, each with how many users it would show. */
function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; count: number }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          aria-pressed={value === option.id}
          className={`rounded-full px-3 py-1 font-mono text-xs border ${
            value === option.id
              ? 'border-accent-teal bg-accent-teal/20 text-accent-teal font-bold'
              : 'border-gray-700 text-gray-400'
          }`}
        >
          {option.label} ({option.count})
        </button>
      ))}
    </div>
  );
}

const badgeClass = 'rounded-full px-2 py-0.5 font-mono text-[11px] font-bold';

/** "1 of 4 bars, 2G", from what the phone reported; empty when it reported neither. */
const signalReading = (stream: LiveStream) =>
  [
    typeof stream.bars === 'number' && stream.bars >= 0 ? `${stream.bars} of 4 bars` : '',
    stream.net ?? '',
  ]
    .filter(Boolean)
    .join(', ');

const TYPE_LABELS: Record<string, string> = {
  AI_THREAT_DETECTED: 'AI threat',
  CLOUD_THREAT_CONFIRMED: 'AI threat (confirmed)',
  SOS: 'SOS',
};

const hasPoint = (p: { lat: number; lon: number }) => !(p.lat === 0 && p.lon === 0);
const formatPhone = (phone: string) => (phone ? `+${phone}` : 'No number');

// What ProMic's leCheckInStatus returns: the latest "are you OK?" put to a streaming user, and
// what that user's phone has done with it.
interface CheckInStatus {
  request: { id: string; byName: string; mine: boolean; askedAt: number } | null;
  state: { id: string; status: string; wrongTries: number; talkback: boolean; loud: boolean } | null;
  now: number;
}

const CHECKIN_POLL_MS = 3000;
// A question the phone has not acknowledged within this long was not delivered.
const CHECKIN_UNDELIVERED_MS = 20000;

/** The phone's word on the question now showing, or null when it has not said anything about it. */
const checkInAnswer = (c: CheckInStatus | null) =>
  c?.request && c.state && c.state.id === c.request.id ? c.state : null;

const checkInWrongTries = (c: CheckInStatus | null) => checkInAnswer(c)?.wrongTries ?? 0;

function checkInWaiting(c: CheckInStatus | null): boolean {
  if (!c?.request) return false;
  const answer = checkInAnswer(c);
  return answer ? answer.status === 'asked' : c.now - c.request.askedAt <= CHECKIN_UNDELIVERED_MS;
}

function checkInText(c: CheckInStatus | null, name: string): string {
  if (!c?.request) return `${name}'s phone shows the question silently. They answer with their passcode.`;
  const who = c.request.mine ? 'You' : c.request.byName || 'Another listener';
  const answer = checkInAnswer(c);
  if (!answer) {
    return c.now - c.request.askedAt > CHECKIN_UNDELIVERED_MS
      ? `${name}'s phone has not received the question. It may be offline.`
      : `${who} asked. Sending to ${name}'s phone…`;
  }
  if (answer.status === 'safe') return `${name} answered: I'm safe (passcode confirmed).`;
  if (answer.status === 'help') return `${name} asked for help (passcode confirmed). SOS has started.`;
  if (answer.status === 'unanswered') return `${who} asked. ${name} did not answer within ${CHECK_IN_WAIT_SECONDS} seconds.`;
  return `${who} asked. ${name} has ${CHECK_IN_WAIT_SECONDS} seconds to answer with their passcode.`;
}
const formatPoint = (p: { lat: number; lon: number }) =>
  hasPoint(p) ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : 'Location unknown';
// The place name ProMic found ("Kodambakkam, Chennai") with its district, else the coordinates.
function formatPlace(p: { lat: number; lon: number; place?: string; district?: string }): string {
  if (!p.place) return formatPoint(p);
  const district = p.district?.replace(/ District$/, '');
  return district && !p.place.includes(district) ? `${p.place} (${district})` : p.place;
}
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
  const [alertFilter, setAlertFilter] = useState<AlertFilter>('all');
  const [liveFilter, setLiveFilter] = useState<LiveFilter>('all');
  const [checkIn, setCheckIn] = useState<CheckInStatus | null>(null);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [talking, setTalking] = useState(false);

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
  const talkLogged = useRef(false);

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

  // "Are you OK?" and talk-back for the stream being listened to. The page cannot read ProMic's
  // database, so every few seconds it asks ProMic how the latest question stands.
  const pollCheckIn = useCallback(
    async (hostId: string) => {
      try {
        setCheckIn(await call('leCheckInStatus', { hostId }));
      } catch {
        // Not joined yet, or a dropped request: the next poll tries again.
      }
    },
    [call],
  );

  useEffect(() => {
    setCheckIn(null);
    setCheckInError(null);
    setTalking(false);
    talkLogged.current = false;
    if (!listeningHostId) return;
    pollCheckIn(listeningHostId);
    const timer = setInterval(() => pollCheckIn(listeningHostId), CHECKIN_POLL_MS);
    return () => clearInterval(timer);
  }, [listeningHostId, pollCheckIn]);

  async function askCheckIn(hostId: string) {
    setCheckInError(null);
    setAsking(true);
    try {
      await call('leCheckIn', { hostId });
      await pollCheckIn(hostId);
    } catch (err) {
      setCheckInError((err as Error).message);
    } finally {
      setAsking(false);
    }
  }

  async function startTalking(hostId: string) {
    if (!player.current) return;
    setCheckInError(null);
    setTalking(true);
    try {
      await player.current.startTalking();
      // Recorded once per stream listened to, in ProMic's activity log.
      if (!talkLogged.current) {
        talkLogged.current = true;
        call('leCheckInStatus', { hostId, talked: true }).catch(() => undefined);
      }
    } catch {
      setTalking(false);
      setCheckInError('The microphone could not be used. Allow it for this site and try again.');
    }
  }

  function stopTalking() {
    player.current?.stopTalking();
    setTalking(false);
  }

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

  // What each filter leaves: a user stays while at least one of their alerts matches, and only
  // the matching alerts are listed under them.
  const groupsFor = (filter: AlertFilter) => {
    const matches = ALERT_FILTERS.find((option) => option.id === filter)!.matches;
    return (overview?.alerts ?? [])
      .map((group) => ({ ...group, alerts: group.alerts.filter(matches) }))
      .filter((group) => group.alerts.length > 0);
  };
  const streamsFor = (filter: LiveFilter) =>
    (overview?.live ?? []).filter(LIVE_FILTERS.find((option) => option.id === filter)!.matches);
  const shownGroups = groupsFor(alertFilter);
  const shownLive = streamsFor(liveFilter);

  function downloadCsv() {
    if (!overview) return;
    const rows = [['Time', 'Type', 'Title', 'Message', 'User name', 'Phone', 'Latitude', 'Longitude', 'SOS ended', 'Place', 'Remote area'].join(',')];
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
            alert.type !== 'SOS' ? '' : alert.active ? 'active' : alert.endedAt ? new Date(alert.endedAt).toLocaleString() : 'ended',
            alert.place ?? '',
            alert.remote ? 'yes' : '',
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
            {overview && overview.alerts.length > 0 && (
              <FilterChips
                options={ALERT_FILTERS.map((option) => ({
                  id: option.id,
                  label: option.label,
                  count: groupsFor(option.id).length,
                }))}
                value={alertFilter}
                onChange={setAlertFilter}
              />
            )}
            {!overview || overview.alerts.length === 0 ? (
              <p className={`${mutedClass} mt-2`}>No alerts in your area.</p>
            ) : shownGroups.length === 0 ? (
              <p className={`${mutedClass} mt-3`}>No alerts match this filter.</p>
            ) : (
              <div className="flex flex-col gap-2 mt-3">
                {shownGroups.map((group) => {
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
                          {group.alerts.some((alert) => alert.active) && (
                            <span className="rounded-full bg-accent-red px-2 py-0.5 font-mono text-[11px] font-bold text-white animate-pulse">
                              SOS active now
                            </span>
                          )}
                          {latest.remote && (
                            <span
                              title="There is no town or village where the latest alert was raised."
                              className={`${badgeClass} bg-amber-500/20 text-amber-400`}
                            >
                              Remote area
                            </span>
                          )}
                          <span className="ml-auto font-mono text-xs text-accent-red">
                            {group.alerts.length} {group.alerts.length === 1 ? 'alert' : 'alerts'}
                          </span>
                        </div>
                        <div className={`${mutedClass} mt-1`}>
                          {TYPE_LABELS[latest.type] ?? latest.type} · {formatWhen(latest.ts)} ·{' '}
                          {located ? formatPlace(located) : 'Location unknown'}
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
                              {alert.message ? ` · ${alert.message}` : ''} · {formatPlace(alert)}
                              {alert.remote && (
                                <span className="text-amber-400">
                                  {' '}
                                  · remote area
                                </span>
                              )}
                              {alert.type === 'SOS' &&
                                (alert.active ? (
                                  <span className="font-bold text-accent-red"> · active now</span>
                                ) : (
                                  <span> · {alert.endedAt ? `ended ${formatWhen(alert.endedAt)}` : 'ended'}</span>
                                ))}
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
            {overview && overview.live.length > 0 && (
              <FilterChips
                options={LIVE_FILTERS.map((option) => ({
                  id: option.id,
                  label: option.label,
                  count: streamsFor(option.id).length,
                }))}
                value={liveFilter}
                onChange={setLiveFilter}
              />
            )}
            {!overview || overview.live.length === 0 ? (
              <p className={`${mutedClass} mt-2`}>Nobody in your area is sharing a live stream right now.</p>
            ) : shownLive.length === 0 ? (
              <p className={`${mutedClass} mt-3`}>No live streams match this filter.</p>
            ) : (
              <div className="flex flex-col gap-2 mt-3">
                {shownLive.map((stream) => {
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
                        {stream.policeOnly && (
                          <span
                            title="Nobody else is listening to this stream. Police are the only people who can hear it."
                            className="ml-auto flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-400"
                          >
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                              <path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3Zm-1 5h2v6h-2V7Zm0 8h2v2h-2v-2Z" />
                            </svg>
                            Only police listening
                          </span>
                        )}
                      </div>
                      <button onClick={() => showOnMap(stream, stream.name)} className={`${mutedClass} mt-1 text-left`}>
                        {formatPlace(stream)}
                        {stream.since ? ` · live since ${formatWhen(stream.since)}` : ''}
                      </button>
                      {(stream.remote || stream.weak || stream.lost) && (
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {stream.lost && (
                            <span
                              title="The phone has stopped reporting. It may be out of signal or switched off."
                              className={`${badgeClass} bg-accent-red/20 text-accent-red`}
                            >
                              Connection lost
                            </span>
                          )}
                          {stream.weak && (
                            <span
                              title="The phone has had a poor connection for a couple of minutes. The audio may break up or stop."
                              className={`${badgeClass} bg-amber-500/20 text-amber-400`}
                            >
                              Weak signal{signalReading(stream) ? ` (${signalReading(stream)})` : ''}
                            </span>
                          )}
                          {stream.remote && (
                            <span
                              title="There is no town or village at this position."
                              className={`${badgeClass} bg-amber-500/20 text-amber-400`}
                            >
                              Remote area
                            </span>
                          )}
                        </div>
                      )}
                      {stream.lost && (
                        <p className="font-mono text-xs text-accent-red mt-2">
                          Nothing from this phone since {formatWhen(stream.lastSeenAt ?? 0)}.{' '}
                          {hasPoint(stream)
                            ? `Last known position: ${formatPoint(stream)}${
                                stream.locationAt ? `, sent ${formatWhen(stream.locationAt)}` : ''
                              }.`
                            : 'No position was received.'}
                        </p>
                      )}
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
                      {active && listening && listening.state !== 'ended' && (
                        <div className="mt-3 pt-3 border-t border-gray-800 flex flex-col gap-2">
                          <button
                            onClick={() => askCheckIn(stream.hostId)}
                            disabled={asking || checkInWaiting(checkIn)}
                            className="self-start px-4 py-2 rounded-lg font-mono font-bold text-xs bg-accent-teal text-navy-900 disabled:opacity-50"
                          >
                            {checkInWaiting(checkIn) ? 'Waiting For An Answer…' : 'Are You OK?'}
                          </button>
                          <p className={mutedClass}>{checkInText(checkIn, stream.name)}</p>
                          {checkInWrongTries(checkIn) > 0 && (
                            <p className="font-mono text-xs text-orange-400">
                              A wrong passcode was entered on {stream.name}&apos;s phone
                              {checkInWrongTries(checkIn) > 1 ? ` (${checkInWrongTries(checkIn)} times)` : ''}.
                            </p>
                          )}
                          {checkInError && <p className="font-mono text-xs text-accent-red">{checkInError}</p>}
                          {checkIn?.state?.talkback && (
                            <>
                              <p className="font-mono text-xs text-gray-200">
                                {checkIn.state.loud
                                  ? `Your voice is coming out of ${stream.name}'s loudspeaker at full volume.`
                                  : `You can now speak through ${stream.name}'s phone. It plays quietly at first (earpiece or earphones), and from the loudspeaker if they still have not answered ${CHECK_IN_WAIT_SECONDS} seconds after you start.`}
                              </p>
                              <button
                                onPointerDown={() => startTalking(stream.hostId)}
                                onPointerUp={stopTalking}
                                onPointerLeave={stopTalking}
                                onPointerCancel={stopTalking}
                                onContextMenu={(event) => event.preventDefault()}
                                className={`self-start px-5 py-3 rounded-full font-mono font-bold text-xs text-white select-none touch-none ${
                                  talking ? 'bg-accent-red' : 'bg-blue-700'
                                }`}
                              >
                                {talking ? 'Speaking… Let Go To Stop' : 'Hold To Talk'}
                              </button>
                            </>
                          )}
                        </div>
                      )}
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
