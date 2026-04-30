'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────
type SiteStatus = 'up' | 'down' | 'degraded' | 'checking';

type CheckResult = {
    name: string;
    url: string;
    type: 'website' | 'database';
    status: SiteStatus;
    statusCode: number | null;
    responseTime: number;
    checkedAt: string;
    error?: string;
};

type UptimeEntry  = { timestamp: string; status: SiteStatus };
type UptimeHistory = Record<string, UptimeEntry[]>;
type OutagePeriod  = { start: string; end: string | null };

// ── Constants ────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'biobakery_uptime_history';
const MAX_HISTORY = 2016;
const REFRESH_MS  = 5 * 60 * 1000;

const SITES = [
    { name: 'Huttenhower Lab',          url: 'https://huttenhower.sph.harvard.edu/', type: 'website'  as const },
    { name: 'IBDMDB',                   url: 'https://ibdmdb.org/',                  type: 'website'  as const },
    { name: 'IBDMDB Results',           url: 'https://ibdmdb.org/results',           type: 'website'  as const },
    { name: 'BIOM-Mass',                url: 'https://biom-mass.org/',               type: 'website'  as const },
    { name: 'Galaxy bioBakery',         url: 'http://galaxy.biobakery.org/',         type: 'website'  as const },
    { name: 'General Biobakery Database', url: 'http://huttenhower.sph.harvard.edu/humann_data/chocophlan/', type: 'database' as const },
    { name: 'Microbiome Bioactives',    url: 'https://microbiome-bioactives.org/',   type: 'website'  as const },
    { name: 'One Health Microbiome',    url: 'https://onehealthmicrobiome.org/',     type: 'website'  as const },
    { name: 'bioBakery Forum',          url: 'https://forum.biobakery.org/',         type: 'website'  as const },
];

const STATUS_CFG: Record<SiteStatus, { dot: string; text: string; label: string; rowBorder: string }> = {
    up:       { dot: 'bg-green-400',              text: 'text-green-400',  label: 'Operational', rowBorder: 'border-l-2 border-green-500' },
    down:     { dot: 'bg-red-400',                text: 'text-red-400',    label: 'Down',        rowBorder: 'border-l-2 border-red-500'   },
    degraded: { dot: 'bg-yellow-400',             text: 'text-yellow-400', label: 'Degraded',    rowBorder: 'border-l-2 border-yellow-500'},
    checking: { dot: 'bg-gray-500 animate-pulse', text: 'text-gray-500',   label: 'Checking…',  rowBorder: 'border-l-2 border-gray-600'  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
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
    const up = slice.filter(e => e.status === 'up' || e.status === 'degraded').length;
    return Math.round((up / slice.length) * 1000) / 10;
}

function detectOutages(entries: UptimeEntry[]): OutagePeriod[] {
    const outages: OutagePeriod[] = [];
    let start: string | null = null;
    for (const e of entries) {
        if (e.status === 'down' && !start) { start = e.timestamp; }
        else if (e.status !== 'down' && start) { outages.push({ start, end: e.timestamp }); start = null; }
    }
    if (start) outages.push({ start, end: null });
    return outages.reverse().slice(0, 5);
}

function durationStr(start: string, end: string | null): string {
    const ms   = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
    const mins = Math.max(1, Math.round(ms / 60_000));
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function timeAgo(d: Date | null): string {
    if (!d) return 'never';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
}

function fmtDate(iso: string): string {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

// ── Component ────────────────────────────────────────────────────────────────
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
            const res  = await fetch('/api/health-check');
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
        } catch { /* silently fail */ }
        finally { setChecking(false); }
    }, []);

    useEffect(() => {
        setHistory(loadHistory());
        runCheck();
        intervalRef.current = setInterval(runCheck, REFRESH_MS);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [runCheck]);

    const toggleExpand = (name: string) =>
        setExpanded(prev => {
            const s = new Set(prev);
            if (s.has(name)) { s.delete(name); } else { s.add(name); }
            return s;
        });

    const anyDown  = results.some(r => r?.status === 'down');
    const allUp    = results.length > 0 && results.every(r => r?.status === 'up');
    const loaded   = results.some(r => r !== null);

    return (
        <div className="bg-gray-900 border-b border-gray-800 pt-20 px-6 pb-5">

            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-white">Service Health</h2>
                    {loaded && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            anyDown  ? 'bg-red-900/60 text-red-300' :
                            allUp    ? 'bg-green-900/60 text-green-300' :
                                       'bg-yellow-900/60 text-yellow-300'
                        }`}>
                            {anyDown ? 'Partial Outage' : allUp ? 'All Systems Operational' : 'Checking…'}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 hidden sm:block">
                        {lastChecked ? `Updated ${timeAgo(lastChecked)} · auto-refreshes every 5m` : 'Checking…'}
                    </span>
                    <button
                        onClick={runCheck} disabled={checking}
                        className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white py-1 px-3 rounded transition-colors"
                    >
                        {checking ? 'Checking…' : 'Refresh'}
                    </button>
                </div>
            </div>

            {/* ── Site rows ──────────────────────────────────────────────── */}
            <div className="flex flex-col gap-2">
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
                        <div key={site.name} className={`bg-gray-800 rounded-lg border border-gray-700 overflow-hidden ${cfg.rowBorder}`}>

                            {/* ── Compact row (always visible) ─────────── */}
                            <button
                                className="w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-gray-700/40 transition-colors"
                                onClick={() => toggleExpand(site.name)}
                            >
                                {/* Status dot */}
                                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}`} />

                                {/* Name + URL */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-white leading-tight">{site.name}</p>
                                    <a
                                        href={site.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-gray-500 hover:text-gray-300 truncate block transition-colors"
                                        onClick={e => e.stopPropagation()}
                                        title={site.url}
                                    >
                                        {site.url}
                                    </a>
                                </div>

                                {/* Status + response time */}
                                <div className="flex-shrink-0 text-right hidden sm:block">
                                    <p className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</p>
                                    <p className="text-xs text-gray-500">
                                        {result && status !== 'checking'
                                            ? status === 'down' ? '—' : `${result.responseTime}ms`
                                            : ''}
                                    </p>
                                </div>

                                {/* Uptime pills */}
                                <div className="flex-shrink-0 hidden md:flex items-center gap-2">
                                    {u24 !== null && (
                                        <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                                            u24 >= 99 ? 'bg-green-900/50 text-green-400' :
                                            u24 >= 95 ? 'bg-yellow-900/50 text-yellow-400' :
                                                        'bg-red-900/50 text-red-400'
                                        }`}>
                                            24h {u24}%
                                        </span>
                                    )}
                                    {u7d !== null && (
                                        <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                                            u7d >= 99 ? 'bg-green-900/50 text-green-400' :
                                            u7d >= 95 ? 'bg-yellow-900/50 text-yellow-400' :
                                                        'bg-red-900/50 text-red-400'
                                        }`}>
                                            7d {u7d}%
                                        </span>
                                    )}
                                </div>

                                {/* Expand chevron */}
                                <svg
                                    className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {/* ── Expanded detail panel ─────────────────── */}
                            {isOpen && (
                                <div className="border-t border-gray-700 px-4 py-4 space-y-4 bg-gray-900/50">

                                    {/* Last check info */}
                                    <div className="flex flex-wrap gap-4 text-xs text-gray-400">
                                        <span><span className="text-gray-600">Status:</span> <span className={cfg.text}>{cfg.label}</span></span>
                                        {result?.statusCode != null && <span><span className="text-gray-600">HTTP:</span> {result.statusCode}</span>}
                                        {result?.responseTime != null && status !== 'down' && (
                                            <span><span className="text-gray-600">Response:</span> {result.responseTime}ms</span>
                                        )}
                                        {result?.checkedAt && (
                                            <span><span className="text-gray-600">Checked:</span> {fmtDate(result.checkedAt)}</span>
                                        )}
                                        {result?.error && (
                                            <span className="text-red-400"><span className="text-gray-600">Error:</span> {result.error}</span>
                                        )}
                                    </div>

                                    {/* History bar */}
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1.5">Last {Math.min(last30.length || 30, 30)} checks <span className="text-gray-600">(oldest → newest)</span></p>
                                        <div className="flex gap-0.5">
                                            {Array.from({ length: Math.max(0, 30 - last30.length) }, (_, k) => (
                                                <div key={`pad-${k}`} className="h-4 flex-1 rounded-sm bg-gray-700/50" />
                                            ))}
                                            {last30.map((e, k) => (
                                                <div
                                                    key={k}
                                                    className={`h-4 flex-1 rounded-sm cursor-default ${
                                                        e.status === 'up' || e.status === 'degraded' ? 'bg-green-500 hover:bg-green-400' :
                                                        e.status === 'down'                          ? 'bg-red-500 hover:bg-red-400'   :
                                                                                                       'bg-gray-600'
                                                    }`}
                                                    title={`${fmtDate(e.timestamp)}: ${e.status}`}
                                                />
                                            ))}
                                        </div>
                                        {/* Uptime stats row */}
                                        <div className="flex gap-4 mt-2">
                                            <div>
                                                <span className="text-xs text-gray-600">24h uptime </span>
                                                <span className={`text-xs font-semibold ${u24 === null ? 'text-gray-600' : u24 >= 99 ? 'text-green-400' : u24 >= 95 ? 'text-yellow-400' : 'text-red-400'}`}>
                                                    {u24 === null ? 'collecting…' : `${u24}%`}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-xs text-gray-600">7d uptime </span>
                                                <span className={`text-xs font-semibold ${u7d === null ? 'text-gray-600' : u7d >= 99 ? 'text-green-400' : u7d >= 95 ? 'text-yellow-400' : 'text-red-400'}`}>
                                                    {u7d === null ? 'collecting…' : `${u7d}%`}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Outage log */}
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1.5">Recent outages</p>
                                        {outages.length === 0 ? (
                                            <p className="text-xs text-gray-600 italic">
                                                {hist.length === 0 ? 'No history yet — data accumulates over time.' : 'No outages recorded.'}
                                            </p>
                                        ) : (
                                            <div className="space-y-1">
                                                {outages.map((o, k) => (
                                                    <div key={k} className="flex items-center gap-2 text-xs">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                                                        <span className="text-gray-300">{fmtDate(o.start)}</span>
                                                        <span className="text-gray-600">→</span>
                                                        <span className="text-gray-300">{o.end ? fmtDate(o.end) : <span className="text-red-400">ongoing</span>}</span>
                                                        <span className="text-gray-500 ml-1">({durationStr(o.start, o.end)})</span>
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
