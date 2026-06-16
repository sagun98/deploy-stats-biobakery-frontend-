'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

type SiteStatus   = 'up' | 'down' | 'degraded' | 'checking';
type CheckResult  = { name: string; url: string; type: 'website' | 'database'; status: SiteStatus; statusCode: number | null; responseTime: number; checkedAt: string; error?: string };
type UptimeEntry  = { timestamp: string; status: SiteStatus };
type UptimeHistory = Record<string, UptimeEntry[]>;
type OutagePeriod  = { start: string; end: string | null };

const STORAGE_KEY = 'biobakery_uptime_history_v2';
const MAX_HISTORY = 2016;
const REFRESH_MS  = 5 * 60 * 1000;

const SITES = [
    { name: 'Huttenhower Lab',            url: 'https://huttenhower.sph.harvard.edu/', type: 'website'  as const },
    { name: 'IBDMDB',                     url: 'https://ibdmdb.org/',                  type: 'website'  as const },
    { name: 'IBDMDB Results',             url: 'https://ibdmdb.org/results',           type: 'website'  as const },
    { name: 'BIOM-Mass',                  url: 'https://biom-mass.org/',               type: 'website'  as const },
    { name: 'Galaxy bioBakery',           url: 'http://galaxy.biobakery.org/',         type: 'website'  as const },
    { name: 'General Biobakery Database', url: 'http://huttenhower.sph.harvard.edu/humann_data/chocophlan/', type: 'database' as const },
    { name: 'Microbiome Bioactives',      url: 'https://microbiome-bioactives.org/',   type: 'website'  as const },
    { name: 'One Health Microbiome',      url: 'https://onehealthmicrobiome.org/',     type: 'website'  as const },
    { name: 'bioBakery Forum',            url: 'https://forum.biobakery.org/',         type: 'website'  as const },
];

const STATUS_CFG: Record<SiteStatus, { dot: string; label: string; labelColor: string }> = {
    up:       { dot: 'bg-green-500',              label: '',          labelColor: 'text-gray-500'   },
    down:     { dot: 'bg-red-500',                label: 'Down',      labelColor: 'text-red-400'    },
    degraded: { dot: 'bg-yellow-500',             label: 'Degraded',  labelColor: 'text-yellow-400' },
    checking: { dot: 'bg-gray-700 animate-pulse', label: '',          labelColor: 'text-gray-600'   },
};

function loadHistory(): UptimeHistory {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); } catch { return {}; }
}
function saveHistory(h: UptimeHistory) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h)); } catch { /* quota */ }
}
function uptimePct(entries: UptimeEntry[], hours: number): number | null {
    const cutoff = Date.now() - hours * 3_600_000;
    const slice  = entries.filter(e => new Date(e.timestamp).getTime() > cutoff);
    if (!slice.length) return null;
    return Math.round((slice.filter(e => e.status === 'up' || e.status === 'degraded').length / slice.length) * 1000) / 10;
}
function detectOutages(entries: UptimeEntry[]): OutagePeriod[] {
    const out: OutagePeriod[] = [];
    let start: string | null = null;
    for (const e of entries) {
        if (e.status === 'down' && !start) { start = e.timestamp; }
        else if (e.status !== 'down' && start) { out.push({ start, end: e.timestamp }); start = null; }
    }
    if (start) out.push({ start, end: null });
    return out.reverse().slice(0, 5);
}
function durationStr(start: string, end: string | null): string {
    const mins = Math.max(1, Math.round(((end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()) / 60_000));
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
function timeAgo(d: Date | null): string {
    if (!d) return '';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
}
function fmtDate(iso: string) {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export default function HealthCheckSection() {
    const [results,     setResults]     = useState<(CheckResult | null)[]>(SITES.map(() => null));
    const [history,     setHistory]     = useState<UptimeHistory>({});
    const [lastChecked, setLastChecked] = useState<Date | null>(null);
    const [checking,    setChecking]    = useState(false);
    const [expanded,    setExpanded]    = useState<Set<string>>(new Set());
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const runCheck = useCallback(async () => {
        setChecking(true);
        try {
            // Health checks are performed server-side (Node.js http/https in /api/health-check).
            // Client network issues cannot cause false site-down results — only this internal request can fail.
            const res = await fetch('/api/health-check');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json() as { results: CheckResult[]; checkedAt: string };
            setResults(data.results);
            setLastChecked(new Date(data.checkedAt));
            setHistory(prev => {
                const next = { ...prev };
                for (const r of data.results) {
                    const entries = [...(next[r.name] ?? []), { timestamp: r.checkedAt, status: r.status }];
                    next[r.name]  = entries.slice(-MAX_HISTORY);
                }
                saveHistory(next);
                return next;
            });
        } catch {
            // API unreachable — keep existing results rather than showing false "down" states
        }
        finally { setChecking(false); }
    }, []);

    useEffect(() => {
        setHistory(loadHistory());
        runCheck();
        intervalRef.current = setInterval(runCheck, REFRESH_MS);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [runCheck]);

    const toggle = (name: string) => setExpanded(prev => {
        const s = new Set(prev);
        if (s.has(name)) { s.delete(name); } else { s.add(name); }
        return s;
    });

    const anyDown = results.some(r => r?.status === 'down');
    const anyDegraded = results.some(r => r?.status === 'degraded');

    return (
        <div className="pt-20 px-6 pb-5 border-b border-gray-800">

            {/* Header — only surfaces color when there's actually a problem */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-widest">Services</span>
                    {anyDown && <span className="text-xs text-red-400">· Partial outage</span>}
                    {!anyDown && anyDegraded && <span className="text-xs text-yellow-500">· Degraded</span>}
                </div>
                <button
                    onClick={runCheck} disabled={checking}
                    className="text-xs text-gray-600 hover:text-gray-400 disabled:opacity-40 transition-colors"
                >
                    {checking ? 'checking…' : lastChecked ? `updated ${timeAgo(lastChecked)}` : 'checking…'}
                </button>
            </div>

            {/* Rows — single container, dividers instead of individual cards */}
            <div className="rounded-lg border border-gray-800 divide-y divide-gray-800 overflow-hidden">
                {SITES.map((site, i) => {
                    const result  = results[i];
                    const status: SiteStatus = result?.status ?? 'checking';
                    const cfg     = STATUS_CFG[status];
                    const hist    = history[site.name] ?? [];
                    const last30  = hist.slice(-30);
                    const u24     = uptimePct(hist, 24);
                    const u7d     = uptimePct(hist, 168);
                    const outages = detectOutages(hist);
                    const isOpen  = expanded.has(site.name);

                    return (
                        <div key={site.name}>
                            {/* Compact row */}
                            <button
                                className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.02] transition-colors"
                                onClick={() => toggle(site.name)}
                            >
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />

                                <div className="flex-1 min-w-0">
                                    <span className="text-sm text-gray-300">{site.name}</span>
                                    <a
                                        href={site.url} target="_blank" rel="noopener noreferrer"
                                        className="text-xs text-gray-600 hover:text-gray-400 truncate block transition-colors"
                                        onClick={e => e.stopPropagation()}
                                    >
                                        {site.url}
                                    </a>
                                </div>

                                {/* Right — only show label text for non-up states */}
                                <div className="flex-shrink-0 flex items-center gap-3 text-xs">
                                    {status === 'up' && result && (
                                        <span className="text-gray-700 tabular-nums hidden sm:inline">{result.responseTime}ms</span>
                                    )}
                                    {status !== 'up' && status !== 'checking' && (
                                        <span className={cfg.labelColor}>{cfg.label}</span>
                                    )}
                                </div>

                                <svg className={`w-3.5 h-3.5 text-gray-700 flex-shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {/* Expanded panel */}
                            {isOpen && (
                                <div className="px-4 py-4 border-t border-gray-800 bg-gray-950/40 space-y-4">

                                    {/* Meta row */}
                                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
                                        {result?.statusCode != null && <span>HTTP {result.statusCode}</span>}
                                        {result && status !== 'down' && <span>{result.responseTime}ms</span>}
                                        {result?.checkedAt && <span>Checked {fmtDate(result.checkedAt)}</span>}
                                        {result?.error && <span className="text-red-400">{result.error}</span>}
                                    </div>

                                    {/* History bar */}
                                    <div>
                                        <p className="text-xs text-gray-600 mb-1.5">Last 30 checks</p>
                                        <div className="flex gap-0.5">
                                            {Array.from({ length: Math.max(0, 30 - last30.length) }, (_, k) => (
                                                <div key={`p${k}`} className="h-3 flex-1 rounded-[2px] bg-gray-800" />
                                            ))}
                                            {last30.map((e, k) => (
                                                <div key={k}
                                                    className={`h-3 flex-1 rounded-[2px] ${
                                                        e.status === 'down'                          ? 'bg-red-600'    :
                                                        e.status === 'degraded'                     ? 'bg-yellow-600' :
                                                                                                      'bg-green-600'
                                                    }`}
                                                    title={`${fmtDate(e.timestamp)}: ${e.status}`}
                                                />
                                            ))}
                                        </div>
                                        <div className="flex gap-4 mt-2 text-xs text-gray-600">
                                            <span>24h: <span className={u24 === null ? '' : u24 >= 99 ? 'text-green-400' : u24 >= 95 ? 'text-yellow-500' : 'text-red-400'}>{u24 === null ? '—' : `${u24}%`}</span></span>
                                            <span>7d: <span className={u7d === null ? '' : u7d >= 99 ? 'text-green-400' : u7d >= 95 ? 'text-yellow-500' : 'text-red-400'}>{u7d === null ? '—' : `${u7d}%`}</span></span>
                                        </div>
                                    </div>

                                    {/* Outage log */}
                                    <div>
                                        <p className="text-xs text-gray-600 mb-1.5">Outage history</p>
                                        {outages.length === 0 ? (
                                            <p className="text-xs text-gray-700">
                                                {hist.length === 0 ? 'Collecting data…' : 'No outages recorded'}
                                            </p>
                                        ) : (
                                            <div className="space-y-1">
                                                {outages.map((o, k) => (
                                                    <div key={k} className="flex items-center gap-2 text-xs text-gray-500">
                                                        <span className="w-1 h-1 rounded-full bg-red-500 flex-shrink-0" />
                                                        <span>{fmtDate(o.start)}</span>
                                                        <span className="text-gray-700">→</span>
                                                        <span>{o.end ? fmtDate(o.end) : <span className="text-red-400">ongoing</span>}</span>
                                                        <span className="text-gray-700">· {durationStr(o.start, o.end)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
