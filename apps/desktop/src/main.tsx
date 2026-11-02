import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  CueAPI,
  CueSnapshot,
  DirectorMode,
  ReadinessReport,
  SessionRecap,
  StreamPlan,
} from '../../../packages/shared/index';
import './styles.css';

declare global {
  interface Window {
    cue?: CueAPI;
  }
}
// Platform spacing reserves the native macOS traffic-light area without drawing fake controls.
document.documentElement.dataset.platform = /mac/i.test(navigator.platform) ? 'mac' : 'other';
document.documentElement.dataset.shell = window.cue ? 'desktop' : 'preview';
type View = 'studio' | 'setup' | 'live' | 'recap' | 'settings';
const modes: Record<DirectorMode, { name: string; description: string }> = {
  reality_tv: {
    name: 'Reality TV',
    description: 'Playful cues and audience participation.',
  },
  documentary: {
    name: 'Documentary',
    description: 'Context, clear narration, and calm captions.',
  },
  chill: { name: 'Chill', description: 'Fewer overlays. More room to talk.' },
};
function Icon({ name, size = 19 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    studio: (
      <>
        <rect x="3" y="4" width="18" height="14" rx="3" />
        <path d="M8 22h8M12 18v4m-3-13 6 3-6 3Z" />
      </>
    ),
    sliders: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="8" cy="7" r="3" />
        <circle cx="16" cy="17" r="3" />
      </>
    ),
    live: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M3.5 3.5a12 12 0 0 0 0 17m17-17a12 12 0 0 1 0 17" />
      </>
    ),
    recap: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="m10 2-1 3-3 1-3-1-1 3 2 3v2l-2 3 2 3 3-1 2 1 1 3h4l1-3 2-1 3 1 2-3-2-3v-2l2-3-2-3-3 1-2-1-1-3Z" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    plus: <path d="M12 5v14M5 12h14" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    play: <path d="m8 4 12 8-12 8Z" />,
    stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
    film: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4" />
      </>
    ),
    moon: <path d="M20.5 14a9 9 0 0 1-10.5-10.5A9 9 0 1 0 20.5 14Z" />,
    chat: (
      <>
        <path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 0 1-1-5 9 9 0 0 1 18 0Z" />
        <path d="M7 10h10M7 14h6" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    twitch: (
      <>
        <path d="M4 3h17v12l-5 5h-5l-4 3v-3H3V7Z" />
        <path d="M11 7v6M16 7v6" />
      </>
    ),
    obs: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 12c-5 1-7-5-3-8m3 8c1-5 7-4 8 0m-8 0c4 4 0 8-4 7" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    link: (
      <>
        <path d="m10 14 4-4m-6 1-2 2a4 4 0 0 0 6 6l2-2m-4-10 2-2a4 4 0 0 1 6 6l-2 2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.studio}
    </svg>
  );
}
const time = (ts: string) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const duration = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(n % 60)
    .toString()
    .padStart(2, '0')}`;
function download(name: string, content: string, type: string) {
  const u = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function loadBriefDraft() {
  try {
    return localStorage.getItem('cue.streamBrief')?.slice(0, 4000) ?? '';
  } catch {
    return '';
  }
}
function App() {
  const [snapshot, setSnapshot] = useState<CueSnapshot | null>(null),
    [view, setView] = useState<View>('studio'),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [brief, setBrief] = useState(loadBriefDraft),
    [mode, setMode] = useState<DirectorMode>('reality_tv'),
    [draft, setDraft] = useState<StreamPlan | null>(null),
    [readiness, setReadiness] = useState<ReadinessReport | null>(null),
    [recap, setRecap] = useState<SessionRecap | null>(null),
    [message, setMessage] = useState(''),
    [confirm, setConfirm] = useState<'start' | 'stop' | 'metadata' | 'delete' | null>(null),
    [obs, setObs] = useState({ host: '127.0.0.1', port: 4455, password: '' }),
    [tick, setTick] = useState(Date.now());
  const [authorizationStartedAt, setAuthorizationStartedAt] = useState(0);
  const [dismissedBackendError, setDismissedBackendError] = useState('');
  const planSignature = JSON.stringify(snapshot?.plan ?? null);
  const backendErrorSignature = snapshot?.error
    ? `${snapshot.sessionId}:${snapshot.events.findLast((e) => e.kind === 'error')?.id ?? ''}:${snapshot.error}`
    : '';
  const visibleError =
    error || (backendErrorSignature !== dismissedBackendError ? snapshot?.error : null);
  const api = window.cue;
  useEffect(() => {
    try {
      localStorage.setItem('cue.streamBrief', brief);
    } catch {
      /* Local storage can be unavailable in restricted previews. */
    }
  }, [brief]);
  const authorization = snapshot?.events.findLast(
    (e) => e.kind === 'twitch.authorization' && Date.parse(e.ts) >= authorizationStartedAt,
  );
  const authorizationPending =
    busy === 'Connecting Twitch' && !snapshot?.twitch.connected && authorization;
  useEffect(() => {
    if (!api) {
      setError('Open CUE in the desktop app to connect to your production service.');
      return;
    }
    let active = true;
    api
      .getSnapshot()
      .then((s) => {
        if (active) {
          setSnapshot(s);
          setMode(s.settings.mode);
          if (s.status === 'live') setView('live');
          else if (s.plan) setView(s.status === 'ended' ? 'recap' : 'setup');
        }
      })
      .catch((e) => setError(String(e)));
    const off = api.onSnapshot((s) => {
      if (active) setSnapshot(s);
    });
    return () => {
      active = false;
      off();
    };
  }, [api]);
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>('.main')?.scrollTo(0, 0);
  }, [view]);
  useEffect(() => {
    if (!confirm) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const buttons = dialog?.querySelectorAll<HTMLButtonElement>('button');
    buttons?.[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirm(null);
      if (event.key === 'Tab' && buttons?.length) {
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [confirm]);
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setDraft(JSON.parse(planSignature) as StreamPlan | null);
  }, [planSignature]);
  useEffect(() => {
    if (view === 'recap' && snapshot?.status === 'ended' && api)
      api
        .getRecap(snapshot.sessionId)
        .then(setRecap)
        .catch((e) => setError(String(e)));
  }, [view, snapshot?.status, snapshot?.sessionId, api]);
  const run = async (label: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    if (label === 'Connecting Twitch') setAuthorizationStartedAt(Date.now());
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };
  const create = () =>
    run('Building your show', async () => {
      if (!api) return;
      const p = await api.createPlan(brief.trim(), mode);
      setDraft(p);
      setView('setup');
    });
  const save = async () => {
    if (api && draft) await api.savePlan(draft);
  };
  const action = async () => {
    const operation = confirm;
    setConfirm(null);
    await run(
      operation === 'start'
        ? 'Starting stream'
        : operation === 'stop'
          ? 'Ending stream'
          : 'Applying changes',
      async () => {
        if (!api) return;
        if (operation === 'start' || operation === 'stop') {
          const token = await api.requestConfirmation(operation);
          if (operation === 'start') {
            await api.startStream(token);
            setView('live');
          } else {
            await api.endStream(token);
            setView('recap');
          }
        } else if (operation === 'metadata' && draft) {
          await save();
          await api.applyMetadata(draft.id);
          setNotice('Your stream details are updated.');
        } else if (operation === 'delete') {
          await api.deleteHistory();
          setRecap(null);
          setDraft(null);
          setView('studio');
        }
      },
    );
  };
  const live = snapshot?.status === 'live',
    ended = snapshot?.status === 'ended';
  const elapsed = snapshot?.startedAt
    ? Math.max(
        0,
        ((ended
          ? Date.parse(
              snapshot.events.findLast((e) => e.kind === 'stream.ended')?.ts ?? snapshot.startedAt,
            )
          : tick) -
          Date.parse(snapshot.startedAt)) /
          1000,
      )
    : 0;
  const broadcasting = !!(live && snapshot?.obs.connected && snapshot.obs.streaming);
  const directorActive = !!(broadcasting && snapshot?.overlay.staged && !snapshot.paused);
  const chat = snapshot?.events.filter((e) => e.kind.includes('chat')) || [];
  const nav = [
    ['studio', 'studio', 'Studio'],
    ['setup', 'sliders', 'Stream plan'],
    ['live', 'live', 'Live production'],
    ['recap', 'recap', 'Session recap'],
  ] as const;
  const updatePlan = (patch: Partial<StreamPlan>) => setDraft((p) => (p ? { ...p, ...patch } : p));
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="window-drag-region" aria-hidden="true" />
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView('studio');
          }}
          aria-label="CUE home"
        >
          <span className="brand-monogram" aria-hidden="true">
            c<span>→</span>
          </span>
          <span className="brand-wordmark">
            <span className="brand-symbol">
              CUE<span className="brand-period">.</span>
            </span>
            <span className="brand-caption">Livestream production</span>
          </span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {nav.map(([id, icon, label]) => (
            <button
              key={id}
              className={`nav-item ${view === id ? 'active' : ''}`}
              aria-current={view === id ? 'page' : undefined}
              aria-label={label}
              onClick={() => setView(id)}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {id === 'live' && live && <span className="live-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-show">
          <span className="sidebar-note-label">THE PRODUCTION DESK</span>
          <div className="sidebar-note-mark" aria-hidden="true">
            cue<span>→</span>
          </div>
          <p>
            A plan before you go live.
            <br />
            <strong>A producer while you are.</strong>
          </p>
          <button className="sidebar-note-link" onClick={() => setView('setup')}>
            Open your stream plan <Icon name="arrow" size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${view === 'settings' ? 'active' : ''}`}
            aria-current={view === 'settings' ? 'page' : undefined}
            aria-label="Settings"
            onClick={() => setView('settings')}
          >
            <Icon name="settings" />
            <span>Settings</span>
          </button>
          <div className="profile">
            <span className="status-dot green" />
            <span>Local workspace</span>
            <small>v0.1</small>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <Icon name="chevron" size={13} />
            <strong>{nav.find((n) => n[0] === view)?.[2] || 'Settings'}</strong>
          </div>
          <div className="topbar-status">
            <span className={`chip ${snapshot?.settings.demo ? 'demo' : ''}`}>
              <span className="status-dot" />
              {snapshot?.settings.demo ? 'Demo Mode' : 'Production Mode'}
            </span>
            {broadcasting && (
              <span className="chip on-air">
                <span className="live-dot" /> ON AIR · {duration(elapsed)}
              </span>
            )}
            <div className="topbar-profile">
              <div className="avatar">
                {snapshot?.twitch.displayName?.slice(0, 1).toUpperCase() || 'CU'}
              </div>
              <div>
                <strong>{snapshot?.twitch.displayName || 'Your workspace'}</strong>
                <small>{snapshot?.settings.demo ? 'Demo session' : 'Production session'}</small>
              </div>
            </div>
          </div>
        </header>
        {visibleError && (
          <div className="alert error" role="alert">
            <span>{visibleError}</span>
            <button
              aria-label="Dismiss error"
              onClick={() => {
                setError('');
                setDismissedBackendError(backendErrorSignature);
              }}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
        {notice && (
          <div className="alert success" role="status">
            {notice}
            <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
        {authorizationPending && (
          <section className="authorization-prompt" role="status" aria-live="polite">
            <span className="connection-icon twitch">
              <Icon name="twitch" size={25} />
            </span>
            <div>
              <h2>Finish connecting Twitch</h2>
              <p>Enter this code in the Twitch authorization page opened in your browser:</p>
              <code>{String(authorization.payload.userCode || '')}</code>
              <small>
                {String(authorization.payload.verificationUri || 'https://www.twitch.tv/activate')}
              </small>
              <p>Review the permissions in Twitch. CUE will continue when you approve.</p>
              <button
                className="secondary auth-cancel"
                onClick={() => {
                  void api!
                    .disconnect('twitch')
                    .catch((error: unknown) =>
                      setError(error instanceof Error ? error.message : String(error)),
                    );
                }}
              >
                Cancel connection
              </button>
            </div>
          </section>
        )}
        {busy && (
          <div className="working" role="status">
            <span className="spinner" />
            {busy}…
          </div>
        )}
        <div className={`page page-${view}`}>
          {view === 'studio' && (
            <>
              <div className="dashboard-heading">
                <div>
                  <span className="eyebrow">WORKSPACE OVERVIEW</span>
                  <h1>Your studio, in view.</h1>
                  <p>Plan your next stream and keep your production moving.</p>
                </div>
                <span className="dashboard-date">
                  {new Date(tick).toLocaleDateString([], {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
              <section className="studio-overview" aria-label="Current session overview">
                <div className="overview-card overview-featured">
                  <span className="overview-label">Current session</span>
                  <strong>
                    {broadcasting
                      ? 'On air'
                      : live
                        ? 'Interrupted'
                        : ended
                          ? 'Completed'
                          : snapshot?.plan
                            ? 'In preparation'
                            : 'Not started'}
                  </strong>
                  <span className="overview-detail">
                    <span className="status-dot" />
                    {snapshot?.settings.demo ? 'Demo workspace' : 'Local production'}
                  </span>
                  <span className="overview-tag">
                    {broadcasting
                      ? 'LIVE'
                      : live
                        ? 'RECONNECT'
                        : ended
                          ? 'COMPLETED'
                          : snapshot?.plan
                            ? 'PLAN READY'
                            : 'STANDBY'}
                  </span>
                </div>
                <div className="overview-card">
                  <span className="overview-label">Stream time</span>
                  <strong>{duration(elapsed)}</strong>
                  <span className="overview-detail">
                    {broadcasting
                      ? 'Broadcast in progress'
                      : live
                        ? 'Awaiting OBS reconnection'
                        : ended
                          ? 'Last session duration'
                          : 'Ready when you are'}
                  </span>
                </div>
                <div className="overview-card">
                  <span className="overview-label">Chat messages</span>
                  <strong>{chat.length.toLocaleString()}</strong>
                  <span className="overview-detail">
                    {snapshot?.twitch.connected ? 'Channel connected' : 'Connect Twitch to listen'}
                  </span>
                </div>
                <div className="overview-card">
                  <span className="overview-label">Verified cues</span>
                  <strong>
                    {snapshot?.actions.filter((a) => a.status === 'succeeded').length || 0}
                  </strong>
                  <span className="overview-detail">From this session’s action log</span>
                </div>
              </section>
              <div className="studio-body">
                <div className="studio-primary">
                  <section className="welcome panel">
                    <div className="composer-heading">
                      <span className="section-index">01</span>
                      <div>
                        <span className="eyebrow">START WITH A BRIEF</span>
                        <h2>What are we streaming today?</h2>
                        <p>
                          A few details are enough. CUE will turn them into an editable stream plan.
                        </p>
                      </div>
                    </div>
                    <form
                      className="brief-box"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void create();
                      }}
                    >
                      <label className="sr-only" htmlFor="brief">
                        Describe your stream
                      </label>
                      <textarea
                        id="brief"
                        value={brief}
                        onChange={(e) => setBrief(e.target.value)}
                        placeholder="An IRL city walk where chat picks the next stop…"
                        maxLength={4000}
                        rows={4}
                      />
                      <div className="brief-bottom">
                        <span>Title, segments, tags. All yours to edit.</span>
                        <button
                          className="primary"
                          type="submit"
                          disabled={brief.trim().length < 3 || !!busy || !api}
                        >
                          Create stream plan <Icon name="arrow" size={17} />
                        </button>
                      </div>
                    </form>
                    <div className="example-prompts">
                      <span>Try a starting point</span>
                      {['Just Chatting Q&A', 'IRL city walk', 'Gaming challenge'].map((p, i) => (
                        <button
                          key={p}
                          onClick={() =>
                            setBrief(
                              [
                                'A Just Chatting Q&A with my community, fun and interactive',
                                'An IRL city walk exploring hidden gems with chat',
                                'A gaming challenge where chat picks the rules',
                              ][i],
                            )
                          }
                        >
                          {p}
                          <Icon name="plus" size={12} />
                        </button>
                      ))}
                    </div>
                    {snapshot?.plan && (
                      <div className="studio-resume">
                        <div>
                          <span className="eyebrow">
                            {broadcasting
                              ? 'ON AIR'
                              : live
                                ? 'SESSION INTERRUPTED'
                                : ended
                                  ? 'LAST SESSION'
                                  : 'CURRENT DRAFT'}
                          </span>
                          <strong>{snapshot.plan.title}</strong>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setView(live ? 'live' : ended ? 'recap' : 'setup')}
                        >
                          {live ? 'Open production' : ended ? 'View recap' : 'Continue editing'}
                          <Icon name="arrow" size={15} />
                        </button>
                      </div>
                    )}
                  </section>
                  <section className="mode-section panel">
                    <div className="section-heading">
                      <div className="section-heading-title">
                        <span className="section-index">02</span>
                        <div>
                          <h2>Choose a directing style</h2>
                          <p>Affects the tone of your cues. Your permissions stay the same.</p>
                        </div>
                      </div>
                      <span className="subtle">DIRECTOR STYLE</span>
                    </div>
                    <div className="mode-grid">
                      {Object.entries(modes).map(([id, m], i) => (
                        <button
                          key={id}
                          className={`mode-card ${mode === id ? 'selected' : ''}`}
                          aria-pressed={mode === id}
                          onClick={() => setMode(id as DirectorMode)}
                        >
                          <div className="mode-card-top">
                            <span className="mode-number">0{i + 1}</span>
                            <span className="radio-mark">{mode === id && <span />}</span>
                          </div>
                          <h3>{m.name}</h3>
                          <p>{m.description}</p>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
                <aside className="studio-aside">
                  <section className="studio-checklist panel">
                    <div className="section-heading">
                      <div className="section-heading-title">
                        <span className="section-index">03</span>
                        <h2>Studio checklist</h2>
                      </div>
                      <span className="checklist-count">
                        {
                          [
                            !!snapshot?.plan,
                            !!snapshot?.twitch.connected,
                            !!snapshot?.obs.connected,
                            !!snapshot?.overlay.staged,
                          ].filter(Boolean).length
                        }
                        /4
                      </span>
                    </div>
                    <p className="panel-description">A quick check before you go on air.</p>
                    <div className="studio-check-list">
                      {[
                        {
                          title: 'Stream plan',
                          detail: snapshot?.plan
                            ? 'Your running order is ready'
                            : 'Add a brief to build your plan',
                          ok: !!snapshot?.plan,
                          target: 'setup' as View,
                        },
                        {
                          title: 'Twitch channel',
                          detail: snapshot?.twitch.connected
                            ? snapshot.twitch.displayName
                            : 'Connect chat and channel details',
                          ok: !!snapshot?.twitch.connected,
                          target: 'settings' as View,
                        },
                        {
                          title: 'OBS Studio',
                          detail: snapshot?.obs.connected
                            ? snapshot.obs.scene || 'Connected to your studio'
                            : 'Connect your streaming software',
                          ok: !!snapshot?.obs.connected,
                          target: 'settings' as View,
                        },
                        {
                          title: 'CUE overlay',
                          detail: snapshot?.overlay.staged
                            ? 'Staged in your OBS scene'
                            : 'Add your audience overlay',
                          ok: !!snapshot?.overlay.staged,
                          target: 'setup' as View,
                        },
                      ].map((item, i) => (
                        <button
                          key={item.title}
                          className={`checklist-row ${item.ok ? 'complete' : ''}`}
                          onClick={() => setView(item.target)}
                        >
                          <span className="checklist-mark">
                            {item.ok ? (
                              <Icon name="check" size={13} />
                            ) : (
                              String(i + 1).padStart(2, '0')
                            )}
                          </span>
                          <span className="checklist-copy">
                            <strong>{item.title}</strong>
                            <small>{item.detail}</small>
                          </span>
                          <Icon name="chevron" size={14} />
                        </button>
                      ))}
                    </div>
                    <button className="secondary full" onClick={() => setView('setup')}>
                      Open stream setup
                      <Icon name="arrow" size={15} />
                    </button>
                  </section>
                  <section className="session-note">
                    <span className="session-note-kicker">
                      <span className="status-dot" /> YOUR PRODUCTION, YOUR CALL
                    </span>
                    <div className="session-note-grid" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                    <h3>Keep the final say.</h3>
                    <p>
                      CUE handles approved overlays while you stream. Going live and ending a
                      broadcast always need your confirmation.
                    </p>
                    <button className="text-button" onClick={() => setView('settings')}>
                      Review director permissions
                      <Icon name="arrow" size={15} />
                    </button>
                  </section>
                </aside>
              </div>
            </>
          )}
          {view === 'setup' && (
            <>
              <PageHeading
                label="PRE-PRODUCTION"
                title="Stream plan"
                subtitle="Edit your running order, connect your tools, and check your setup."
              />
              {!draft ? (
                <Empty
                  icon="sliders"
                  title="No stream plan yet"
                  text="Tell CUE what you’re streaming to build your first plan."
                  action={() => setView('studio')}
                  button="Create a stream plan"
                />
              ) : (
                <div className="setup-layout">
                  <section className="panel plan-panel">
                    <fieldset className="editor-fields" disabled={!!busy}>
                      <div className="panel-header">
                        <div>
                          <span className="eyebrow purple">YOUR RUN OF SHOW</span>
                          <h2>Plan details</h2>
                        </div>
                        <span className="chip">
                          {broadcasting
                            ? 'On air'
                            : live
                              ? 'Connection interrupted'
                              : ended
                                ? 'Completed'
                                : 'Draft plan'}
                        </span>
                      </div>
                      <label>
                        Stream title
                        <input
                          value={draft.title}
                          maxLength={140}
                          onChange={(e) => updatePlan({ title: e.target.value })}
                        />
                      </label>
                      <div className="field-row">
                        <label>
                          Category
                          <input
                            value={draft.categoryName}
                            onChange={(e) =>
                              updatePlan({ categoryName: e.target.value, categoryId: undefined })
                            }
                          />
                        </label>
                        <label>
                          Category ID <small>for Twitch</small>
                          <input
                            value={draft.categoryId || ''}
                            placeholder="Optional numeric ID"
                            onChange={(e) =>
                              updatePlan({ categoryId: e.target.value || undefined })
                            }
                          />
                        </label>
                      </div>
                      <label>
                        Tags <small>comma separated</small>
                        <input
                          value={draft.tags.join(', ')}
                          onChange={(e) =>
                            updatePlan({ tags: e.target.value.split(',').map((s) => s.trim()) })
                          }
                        />
                      </label>
                      <label>
                        Director mode
                        <select
                          value={draft.mode}
                          onChange={(e) => updatePlan({ mode: e.target.value as DirectorMode })}
                        >
                          {Object.entries(modes).map(([id, m]) => (
                            <option key={id} value={id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Creative brief
                        <textarea
                          value={draft.brief}
                          rows={3}
                          onChange={(e) => updatePlan({ brief: e.target.value })}
                        />
                      </label>
                      <div className="section-heading segment-heading">
                        <h3>The running order</h3>
                        <span className="subtle">
                          {draft.segments.reduce((n, s) => n + s.durationMin, 0)} MIN TOTAL
                        </span>
                      </div>
                      <div className="segments">
                        {draft.segments.map((s, i) => (
                          <div className="segment" key={s.id}>
                            <div className="segment-number">{String(i + 1).padStart(2, '0')}</div>
                            <div className="segment-fields">
                              <input
                                aria-label={`Segment ${i + 1} name`}
                                value={s.name}
                                onChange={(e) =>
                                  updatePlan({
                                    segments: draft.segments.map((v, j) =>
                                      j === i ? { ...v, name: e.target.value } : v,
                                    ),
                                  })
                                }
                              />
                              <input
                                aria-label={`Segment ${i + 1} goal`}
                                value={s.goal}
                                onChange={(e) =>
                                  updatePlan({
                                    segments: draft.segments.map((v, j) =>
                                      j === i ? { ...v, goal: e.target.value } : v,
                                    ),
                                  })
                                }
                              />
                            </div>
                            <label className="segment-time">
                              <input
                                type="number"
                                min={1}
                                max={240}
                                aria-label={`Segment ${i + 1} minutes`}
                                value={s.durationMin}
                                onChange={(e) =>
                                  updatePlan({
                                    segments: draft.segments.map((v, j) =>
                                      j === i ? { ...v, durationMin: Number(e.target.value) } : v,
                                    ),
                                  })
                                }
                              />
                              min
                            </label>
                          </div>
                        ))}
                      </div>
                      <div className="button-row">
                        <button
                          className="secondary"
                          disabled={!!busy}
                          onClick={() =>
                            void run('Saving plan', async () => {
                              await save();
                              setNotice('Plan saved. You’re one step closer.');
                            })
                          }
                        >
                          Save plan
                        </button>
                        <button
                          className="secondary"
                          disabled={!!busy || !snapshot?.twitch.connected}
                          onClick={() => setConfirm('metadata')}
                        >
                          <Icon name="twitch" size={15} />
                          Apply to Twitch
                        </button>
                      </div>
                    </fieldset>
                  </section>
                  <aside className="setup-side">
                    <section className="panel">
                      <div className="panel-header">
                        <h2>Studio check</h2>
                        <span className="step-count">01 / 02</span>
                      </div>
                      <p className="panel-description">
                        Connect your channel and streaming software.
                      </p>
                      <ConnectionRow
                        icon="twitch"
                        title="Twitch"
                        detail={
                          snapshot?.twitch.connected
                            ? snapshot.twitch.displayName
                            : 'Your channel & chat'
                        }
                        connected={!!snapshot?.twitch.connected}
                      />
                      <button
                        className="secondary full"
                        disabled={!!busy || !api || snapshot?.twitch.connected}
                        onClick={() => void run('Connecting Twitch', () => api!.connectTwitch())}
                      >
                        {snapshot?.twitch.connected ? 'Twitch connected' : 'Connect Twitch'}
                      </button>
                      <ConnectionRow
                        icon="obs"
                        title="OBS Studio"
                        detail={
                          snapshot?.obs.connected
                            ? snapshot.obs.scene || 'Connected'
                            : 'Your scenes & stream'
                        }
                        connected={!!snapshot?.obs.connected}
                      />
                      <button
                        className="secondary full"
                        disabled={!!busy || !api || snapshot?.obs.connected}
                        onClick={() => void run('Connecting OBS', () => api!.connectObs(obs))}
                      >
                        {snapshot?.obs.connected ? 'OBS connected' : 'Connect OBS'}
                      </button>
                      <button
                        className="text-button full settings-link"
                        onClick={() => setView('settings')}
                      >
                        Connection settings <Icon name="arrow" size={13} />
                      </button>
                    </section>
                    <section className="panel">
                      <div className="panel-header">
                        <h2>Set the stage</h2>
                        <span className="step-count">02 / 02</span>
                      </div>
                      <p className="panel-description">
                        A transparent CUE overlay, right in your OBS scene.
                      </p>
                      <div className="overlay-mini">
                        <span className="cue-glyph" aria-hidden="true">
                          C
                        </span>
                        <span>
                          {snapshot?.overlay.staged
                            ? 'CUE Overlay · staged'
                            : 'CUE browser overlay'}
                        </span>
                      </div>
                      <button
                        className="secondary full"
                        disabled={!!busy || !snapshot?.obs.connected}
                        onClick={() => void run('Staging overlay', () => api!.stageOverlay())}
                      >
                        {snapshot?.overlay.staged ? (
                          <>
                            <Icon name="check" size={15} /> Restage overlay
                          </>
                        ) : (
                          <>
                            <Icon name="plus" size={15} /> Stage in OBS
                          </>
                        )}
                      </button>
                      <button
                        className="text-button full settings-link"
                        disabled={!!busy}
                        onClick={() =>
                          void run('Checking studio', async () => {
                            await save();
                            setReadiness(await api!.checkReadiness());
                          })
                        }
                      >
                        Run readiness check <Icon name="arrow" size={14} />
                      </button>
                      {readiness && (
                        <ul className="check-list">
                          {readiness.checks.map((c) => (
                            <li key={c.name} className={c.ok ? 'ok' : 'pending'}>
                              <Icon name={c.ok ? 'check' : 'clock'} size={14} />
                              <span>
                                <strong>{c.name}</strong>
                                <small>{c.detail}</small>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                    <button
                      className="primary full go-live"
                      disabled={!!busy || !api || live || ended}
                      onClick={() =>
                        void run('Checking studio', async () => {
                          await save();
                          const r = await api!.checkReadiness();
                          setReadiness(r);
                          if (r.ready) setConfirm('start');
                          else setError('A few studio checks need attention before going live.');
                        })
                      }
                    >
                      <Icon name="live" />
                      {broadcasting
                        ? 'You’re on air'
                        : live
                          ? 'Connection interrupted'
                          : ended
                            ? 'Session completed'
                            : 'Ready? Go live'}
                      <Icon name="arrow" size={17} />
                    </button>
                    <p className="fineprint">One final confirmation. Always your call.</p>
                  </aside>
                </div>
              )}
            </>
          )}
          {view === 'live' && (
            <>
              <PageHeading
                label={
                  broadcasting ? 'ON AIR' : live ? 'CONNECTION INTERRUPTED' : 'PRODUCTION DESK'
                }
                title="Live production"
                subtitle={
                  snapshot?.plan?.title ||
                  'Plan your stream and connect your studio to get started.'
                }
                right={
                  live ? (
                    <button
                      className="danger-button"
                      disabled={!!busy}
                      onClick={() => setConfirm('stop')}
                    >
                      <Icon name="stop" size={15} />
                      End stream
                    </button>
                  ) : (
                    <button className="secondary" onClick={() => setView('setup')}>
                      Back to setup <Icon name="arrow" size={15} />
                    </button>
                  )
                }
              />
              {!snapshot?.plan ? (
                <Empty
                  icon="live"
                  title="The stage is waiting"
                  text="Create a plan to unlock your production desk."
                  action={() => setView('studio')}
                  button="Start with an idea"
                />
              ) : (
                <>
                  <div className="live-metrics">
                    <Metric label="STREAM TIME" value={duration(elapsed)} icon="clock" />
                    <Metric label="CHAT MESSAGES" value={String(chat.length)} icon="chat" />
                    <Metric
                      label="DIRECTOR CUES"
                      value={String(
                        snapshot.actions.filter((a) => a.status === 'succeeded').length,
                      )}
                      icon="recap"
                    />
                    <Metric
                      label="CURRENT SCENE"
                      value={snapshot.obs.scene || 'Not connected'}
                      icon="film"
                    />
                  </div>
                  <div className="live-layout">
                    <div className="live-center">
                      <section className="preview">
                        <div className="preview-top">
                          <span className="preview-label">
                            <span className={broadcasting ? 'live-dot' : 'status-dot'} />
                            {broadcasting
                              ? 'LIVE PRODUCTION'
                              : live
                                ? 'CONNECTION INTERRUPTED'
                                : 'STUDIO STANDBY'}
                          </span>
                          <span>{snapshot.settings.demo ? 'SIMULATED STREAM' : 'OBS STATUS'}</span>
                        </div>
                        <div className="preview-center">
                          <div className="preview-channel-mark" aria-hidden="true">
                            CUE<span>PROGRAM</span>
                          </div>
                          <h2>{snapshot.obs.scene || 'Your main stage'}</h2>
                          <p>
                            {snapshot.settings.demo
                              ? 'Demo broadcast · no public stream'
                              : snapshot.obs.streaming
                                ? 'OBS is actively streaming'
                                : 'OBS is not streaming'}
                          </p>
                        </div>
                        <div
                          className={`preview-overlay ${snapshot.overlay.text ? 'visible' : ''}`}
                        >
                          <span className="overlay-cue">CUE</span>
                          <span>
                            {snapshot.overlay.text || 'No overlay is currently displayed.'}
                          </span>
                        </div>
                        <div className="preview-bottom">
                          <span>
                            <span
                              className={`status-dot ${snapshot.obs.connected ? 'green' : ''}`}
                            />
                            {snapshot.obs.connected ? 'OBS connected' : 'OBS disconnected'}
                          </span>
                          <span>
                            {snapshot.overlay.staged ? 'Overlay staged' : 'Overlay not staged'}
                          </span>
                        </div>
                      </section>
                      <section className="panel chat-panel">
                        <div className="panel-header">
                          <h2>
                            <Icon name="chat" size={17} />
                            Conversation
                          </h2>
                          <span className="chip">{chat.length} messages</span>
                        </div>
                        <div className="chat-scroll">
                          {chat.length ? (
                            chat.slice(-30).map((e) => (
                              <div className="chat-message" key={e.id}>
                                <span className="chat-avatar">
                                  {String(e.payload.user || e.payload.username || 'C')
                                    .slice(0, 1)
                                    .toUpperCase()}
                                </span>
                                <div>
                                  <strong>
                                    {String(e.payload.user || e.payload.username || 'Community')}
                                  </strong>
                                  <p>{String(e.payload.text || e.payload.message || '')}</p>
                                </div>
                                <time>{time(e.ts)}</time>
                              </div>
                            ))
                          ) : (
                            <div className="inline-empty">
                              The conversation starts with your community.
                              <br />
                              {snapshot.settings.demo
                                ? 'Inject demo chat to see the director in action.'
                                : 'Incoming Twitch chat will appear here.'}
                            </div>
                          )}
                        </div>
                        <form
                          className="command-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const text = message.trim();
                            if (text)
                              void run('Sending cue', async () => {
                                await api!.sendMessage(text);
                                setMessage('');
                              });
                          }}
                        >
                          <input
                            aria-label="Message your director"
                            placeholder="Give your director a cue…"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            maxLength={2000}
                          />
                          <button
                            className="icon-button"
                            aria-label="Send director message"
                            disabled={!message.trim() || !!busy || !live}
                          >
                            <Icon name="arrow" />
                          </button>
                        </form>
                      </section>
                    </div>
                    <aside className="director-side">
                      <section className="panel director-panel">
                        <div className="panel-header">
                          <h2>
                            <span className="director-icon">
                              <span className="cue-glyph" aria-hidden="true">
                                C
                              </span>
                            </span>
                            Director feed
                          </h2>
                          <span className={`chip ${directorActive ? 'good' : ''}`}>
                            {snapshot.paused ? 'Paused' : directorActive ? 'Active' : 'Standby'}
                          </span>
                        </div>
                        <p className="panel-description">
                          Observations, decisions, and verified results.
                        </p>
                        <div className="director-actions">
                          {snapshot.actions.length ? (
                            snapshot.actions
                              .slice()
                              .reverse()
                              .map((a) => {
                                const result = snapshot.results.find((r) => r.actionId === a.id);
                                return (
                                  <article className="decision-card" key={a.id}>
                                    <div className="decision-top">
                                      <span className="eyebrow purple">
                                        {a.type.replaceAll('.', ' · ').replaceAll('_', ' ')}
                                      </span>
                                      <span className={`action-status ${a.status}`}>
                                        {a.status}
                                      </span>
                                    </div>
                                    <h3>
                                      {String(a.args.text || a.args.title || 'Production cue')}
                                    </h3>
                                    <div className="decision-step">
                                      <span>OBSERVATION</span>
                                      <p>
                                        {a.evidenceEventIds.length} supporting event
                                        {a.evidenceEventIds.length === 1 ? '' : 's'}
                                      </p>
                                    </div>
                                    <div className="decision-step">
                                      <span>DECISION</span>
                                      <p>{a.reason}</p>
                                    </div>
                                    {result && (
                                      <div className={`result-box ${result.ok ? 'ok' : 'failed'}`}>
                                        <Icon name={result.ok ? 'check' : 'close'} size={14} />
                                        <span>{result.detail}</span>
                                      </div>
                                    )}
                                  </article>
                                );
                              })
                          ) : (
                            <div className="director-empty">
                              <div className="production-mark">
                                <span className="cue-glyph" aria-hidden="true">
                                  C
                                </span>
                              </div>
                              <h3>Waiting for a production cue</h3>
                              <p>
                                Your director watches for chat activity and opportunities to bring
                                your audience in.
                              </p>
                            </div>
                          )}
                        </div>
                      </section>
                      <section className="panel director-controls">
                        <div className="panel-header">
                          <h3>Director controls</h3>
                          <Icon name="sliders" size={16} />
                        </div>
                        <label className="toggle-row">
                          <span>
                            Automatic overlays<small>Allow safe audience cues</small>
                          </span>
                          <input
                            type="checkbox"
                            checked={snapshot.settings.overlays}
                            disabled={!!busy}
                            onChange={(e) =>
                              void run('Updating permissions', () =>
                                api!.updateSettings({ overlays: e.target.checked }),
                              )
                            }
                          />
                        </label>
                        <label className="mode-compact">
                          Director mode
                          <select
                            value={snapshot.settings.mode}
                            disabled={!!busy}
                            onChange={(e) =>
                              void run('Changing director mode', () =>
                                api!.updateSettings({ mode: e.target.value as DirectorMode }),
                              )
                            }
                          >
                            {Object.entries(modes).map(([id, m]) => (
                              <option key={id} value={id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className={`secondary full ${snapshot.paused ? 'resume-button' : ''}`}
                          onClick={() => {
                            void api!
                              .pauseDirector(!snapshot.paused)
                              .catch((error: unknown) =>
                                setError(error instanceof Error ? error.message : String(error)),
                              );
                          }}
                        >
                          <Icon name={snapshot.paused ? 'play' : 'pause'} size={16} />
                          {snapshot.paused ? 'Resume Director' : 'Pause Director'}
                        </button>
                        {snapshot.settings.demo && (
                          <button
                            className="primary full demo-trigger"
                            disabled={!!busy || !live}
                            onClick={() => void run('Injecting demo chat', () => api!.injectDemo())}
                          >
                            <Icon name="chat" size={16} />
                            Inject chat spike
                          </button>
                        )}
                      </section>
                    </aside>
                  </div>
                  <section className="panel timeline-panel">
                    <div className="panel-header">
                      <h2>Production timeline</h2>
                      <span className="subtle">THE AUDIT TRAIL</span>
                    </div>
                    {snapshot.events.length ? (
                      <div className="timeline">
                        {snapshot.events
                          .slice(-12)
                          .reverse()
                          .map((e) => (
                            <div className="timeline-event" key={e.id}>
                              <time>{time(e.ts)}</time>
                              <span className={`timeline-dot ${e.source}`} />
                              <strong>{e.kind.replaceAll('.', ' / ').replaceAll('_', ' ')}</strong>
                              <span>
                                {String(
                                  e.payload.detail ||
                                    e.payload.text ||
                                    e.payload.message ||
                                    e.source,
                                )}
                              </span>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="inline-empty">Your session’s story will be recorded here.</p>
                    )}
                  </section>
                </>
              )}
            </>
          )}
          {view === 'recap' && (
            <>
              <PageHeading
                label="THE WRAP-UP"
                title="Session recap"
                subtitle="Review your session, production decisions, and suggested improvements."
              />
              {!recap ? (
                <Empty
                  icon="recap"
                  title={ended ? 'Loading your session recap…' : 'No completed session yet'}
                  text={
                    live
                      ? 'End your stream to see its production recap.'
                      : 'Finish a session and CUE will put the highlights together.'
                  }
                  action={() => setView(live ? 'live' : 'studio')}
                  button={live ? 'Back to your stream' : 'Start a stream'}
                />
              ) : (
                <>
                  <div className="recap-banner">
                    <span className="mode-icon">
                      <Icon name="check" size={24} />
                    </span>
                    <div>
                      <span className="eyebrow purple">THAT’S A WRAP</span>
                      <h2>{recap.title}</h2>
                      <p>{recap.summary}</p>
                    </div>
                  </div>
                  <div className="live-metrics recap-metrics">
                    <Metric icon="clock" label="ON AIR" value={duration(recap.durationSec)} />
                    <Metric
                      icon="recap"
                      label="INTERVENTIONS"
                      value={String(recap.interventions)}
                    />
                    <Metric
                      icon="film"
                      label="HIGHLIGHT MOMENTS"
                      value={String(recap.highlights.length)}
                    />
                    <Metric icon="sliders" label="FAILED ACTIONS" value={String(recap.failed)} />
                  </div>
                  <div className="recap-grid">
                    <section className="panel">
                      <div className="panel-header">
                        <h2>Highlight suggestions</h2>
                        <Icon name="film" />
                      </div>
                      {recap.highlights.length ? (
                        recap.highlights.map((h, i) => (
                          <div className="highlight-row" key={`${h.ts}-${i}`}>
                            <span className="highlight-time">{time(h.ts)}</span>
                            <p>{h.text}</p>
                            <span className="cue-glyph small" aria-hidden="true">
                              C
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="inline-empty">
                          No highlight markers were recorded in this session.
                        </p>
                      )}
                    </section>
                    <section className="panel">
                      <div className="panel-header">
                        <h2>For your next stream</h2>
                        <span className="section-index">02</span>
                      </div>
                      {recap.improvements.map((s, i) => (
                        <div className="improvement" key={i}>
                          <span>0{i + 1}</span>
                          <p>{s}</p>
                        </div>
                      ))}
                    </section>
                  </div>
                  <div className="recap-footer">
                    <div>
                      <h3>Export session recap</h3>
                      <p>Save your recap and production log.</p>
                    </div>
                    <div className="button-row">
                      <button
                        className="secondary"
                        onClick={() =>
                          download(
                            'cue-recap.json',
                            JSON.stringify(recap, null, 2),
                            'application/json',
                          )
                        }
                      >
                        <Icon name="download" size={15} />
                        JSON
                      </button>
                      <button
                        className="secondary"
                        onClick={() =>
                          download(
                            'cue-recap.md',
                            `# ${recap.title}\n\n${recap.summary}\n\nDuration: ${duration(recap.durationSec)}\nInterventions: ${recap.interventions}\nFailed: ${recap.failed}\n\n## Highlights\n${recap.highlights.map((h) => `- ${time(h.ts)} — ${h.text}`).join('\n')}\n\n## Next stream\n${recap.improvements.map((s) => `- ${s}`).join('\n')}\n\n## Action log\n${recap.actions.map((a) => `- ${a.type}: ${a.status} — ${a.reason}`).join('\n')}\n`,
                            'text/markdown',
                          )
                        }
                      >
                        <Icon name="download" size={15} />
                        Markdown
                      </button>
                      <button
                        className="primary"
                        onClick={() => {
                          setBrief('');
                          setView('studio');
                        }}
                      >
                        Plan the next one <Icon name="arrow" size={16} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
          {view === 'settings' && (
            <>
              <PageHeading
                label="YOUR WORKSPACE"
                title="Workspace settings"
                subtitle="Manage connections, director permissions, and local session history."
              />
              {snapshot && (
                <div className="settings-layout">
                  <section className="panel">
                    <div className="panel-header">
                      <h2>Connections</h2>
                      <Icon name="link" />
                    </div>
                    <ConnectionRow
                      icon="twitch"
                      title="Twitch"
                      detail={
                        snapshot.twitch.connected
                          ? snapshot.twitch.displayName
                          : 'Connect your channel for metadata and chat'
                      }
                      connected={snapshot.twitch.connected}
                    />
                    <button
                      className="secondary"
                      disabled={!!busy}
                      onClick={() =>
                        void run(
                          snapshot.twitch.connected ? 'Disconnecting Twitch' : 'Connecting Twitch',
                          () =>
                            snapshot.twitch.connected
                              ? api!.disconnect('twitch')
                              : api!.connectTwitch(),
                        )
                      }
                    >
                      {snapshot.twitch.connected ? 'Disconnect Twitch' : 'Connect Twitch'}
                    </button>
                    <div className="divider" />
                    <ConnectionRow
                      icon="obs"
                      title="OBS Studio"
                      detail="OBS WebSocket 5 · enable in Tools → WebSocket Server Settings"
                      connected={snapshot.obs.connected}
                    />
                    <div className="field-row">
                      <label>
                        Host
                        <input
                          value={obs.host}
                          onChange={(e) => setObs({ ...obs, host: e.target.value })}
                          placeholder="127.0.0.1"
                        />
                      </label>
                      <label className="port-field">
                        Port
                        <input
                          type="number"
                          value={obs.port}
                          min={1}
                          max={65535}
                          onChange={(e) => setObs({ ...obs, port: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                    <label>
                      WebSocket password
                      <input
                        type="password"
                        autoComplete="off"
                        value={obs.password}
                        onChange={(e) => setObs({ ...obs, password: e.target.value })}
                        placeholder="Your OBS password"
                      />
                    </label>
                    <button
                      className="secondary"
                      disabled={!!busy}
                      onClick={() =>
                        void run(
                          snapshot.obs.connected ? 'Disconnecting OBS' : 'Connecting OBS',
                          async () => {
                            if (snapshot.obs.connected) await api!.disconnect('obs');
                            else {
                              await api!.connectObs(obs);
                              setObs((p) => ({ ...p, password: '' }));
                            }
                          },
                        )
                      }
                    >
                      {snapshot.obs.connected ? 'Disconnect OBS' : 'Connect OBS'}
                    </button>
                    <p className="fineprint left">
                      OBS password is sent to the main process for connection and never logged.
                    </p>
                  </section>
                  <div>
                    <section className="panel">
                      <div className="panel-header">
                        <h2>Director permissions</h2>
                        <Icon name="sliders" />
                      </div>
                      <label className="toggle-row">
                        <span>
                          Demo Mode<small>A complete practice run. No credentials needed.</small>
                        </span>
                        <input
                          type="checkbox"
                          checked={snapshot.settings.demo}
                          disabled={!!busy || live}
                          onChange={(e) =>
                            void run('Switching workspace', () =>
                              api!.updateSettings({ demo: e.target.checked }),
                            )
                          }
                        />
                      </label>
                      {live && (
                        <p className="fineprint left">
                          End the current stream before changing Demo Mode.
                        </p>
                      )}
                      <label className="toggle-row">
                        <span>
                          Automatic overlays<small>Preapprove safe on-screen audience cues.</small>
                        </span>
                        <input
                          type="checkbox"
                          checked={snapshot.settings.overlays}
                          disabled={!!busy}
                          onChange={(e) =>
                            void run('Updating permissions', () =>
                              api!.updateSettings({ overlays: e.target.checked }),
                            )
                          }
                        />
                      </label>
                      <label className="toggle-row">
                        <span>
                          Automatic scene changes <span className="coming-later">Coming later</span>
                          <small>Scene automation is planned for a future release.</small>
                        </span>
                        <input
                          type="checkbox"
                          checked={false}
                          disabled
                          aria-label="Automatic scene changes — coming later"
                        />
                      </label>
                      <label>
                        Director mode
                        <select
                          value={snapshot.settings.mode}
                          disabled={!!busy}
                          onChange={(e) =>
                            void run('Changing mode', () =>
                              api!.updateSettings({ mode: e.target.value as DirectorMode }),
                            )
                          }
                        >
                          {Object.entries(modes).map(([id, m]) => (
                            <option key={id} value={id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Minimum seconds between cues
                        <input
                          type="number"
                          min={10}
                          max={600}
                          value={snapshot.settings.cooldownSec}
                          disabled={!!busy}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (n >= 10 && n <= 600)
                              void run('Updating cooldown', () =>
                                api!.updateSettings({ cooldownSec: n }),
                              );
                          }}
                        />
                      </label>
                      <div className="permission-note">
                        <Icon name="check" size={17} />
                        <p>
                          Going live, ending a stream, and updating Twitch metadata always stay in
                          your hands.
                        </p>
                      </div>
                    </section>
                    <section className="panel data-panel">
                      <h2>Local session history</h2>
                      <p>Clear saved plans, events, decisions, and recaps from this device.</p>
                      <button
                        className="danger-button"
                        disabled={!!busy || live}
                        onClick={() => setConfirm('delete')}
                      >
                        Delete local history
                      </button>
                    </section>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <footer className="app-footer">
          <span>
            <span className="status-dot" /> CUE · Local production workspace
          </span>
          <span>Your stream. Right on cue.</span>
        </footer>
      </main>
      {confirm && (
        <div className="modal-backdrop" onClick={() => setConfirm(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-icon">
              <Icon
                name={
                  confirm === 'start'
                    ? 'live'
                    : confirm === 'stop'
                      ? 'stop'
                      : confirm === 'delete'
                        ? 'close'
                        : 'twitch'
                }
                size={25}
              />
            </div>
            <h2 id="confirm-title">
              {confirm === 'start'
                ? 'Ready to go live?'
                : confirm === 'stop'
                  ? 'End this stream?'
                  : confirm === 'delete'
                    ? 'Delete your local history?'
                    : 'Update your Twitch channel?'}
            </h2>
            <p>
              {confirm === 'start'
                ? snapshot?.settings.demo
                  ? 'This starts a simulated broadcast. No public stream will be started.'
                  : 'This will start OBS streaming to your configured destination. Your audience may see and hear you immediately.'
                : confirm === 'stop'
                  ? 'This will stop the broadcast and create your session recap.'
                  : confirm === 'delete'
                    ? 'Saved session history will be permanently removed from this device.'
                    : `CUE will publish “${draft?.title}” and your selected category and tags to Twitch.`}
            </p>
            <div className="button-row">
              <button className="secondary" onClick={() => setConfirm(null)}>
                Not yet
              </button>
              <button
                className={confirm === 'stop' || confirm === 'delete' ? 'danger-button' : 'primary'}
                onClick={() => void action()}
              >
                {confirm === 'start'
                  ? 'Yes, go live'
                  : confirm === 'stop'
                    ? 'End stream'
                    : confirm === 'delete'
                      ? 'Delete history'
                      : 'Approve update'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function PageHeading({
  label,
  title,
  subtitle,
  right,
}: {
  label: string;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow purple">{label}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {right}
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
  button,
  action,
}: {
  icon: string;
  title: string;
  text: string;
  button: string;
  action: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="production-mark">
        <Icon name={icon} size={30} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="primary" onClick={action}>
        {button}
        <Icon name="arrow" size={16} />
      </button>
    </div>
  );
}
function ConnectionRow({
  icon,
  title,
  detail,
  connected,
}: {
  icon: string;
  title: string;
  detail: string;
  connected: boolean;
}) {
  return (
    <div className="connection-row">
      <span className={`connection-icon ${icon}`}>
        <Icon name={icon} size={22} />
      </span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      <span className={`connection-status ${connected ? 'connected' : ''}`}>
        <span className={`status-dot ${connected ? 'green' : ''}`} />
        {connected ? 'Connected' : 'Disconnected'}
      </span>
    </div>
  );
}
function Metric({ label, value }: { icon?: string; label: string; value: string }) {
  return (
    <div className="metric">
      <div>
        <span className="eyebrow">{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
