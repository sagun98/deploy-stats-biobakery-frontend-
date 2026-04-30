'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

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

type UptimeEntry = { timestamp: string; status: SiteStatus };
type UptimeHistory = Record<string, UptimeEntry[]>;

const STORAGE_KEY = 'biobakery_uptime_history';
const MAX_HISTORY = 2016; // ~7 days at 5-min intervals
const REFRESH_MS = 5 * 60 * 1000;

const SITES = [
    { name: 'Huttenhower Lab', type: 'website' as const },
    { name: 'IBDMDB', type: 'website' as const },
    { name: 'IBDMDB Results', type: 'website' as const },
    { name: 'BIOM-Mass', type: 'website' as const },
    { name: 'Galaxy bioBakery', type: 'website' as const },
    { name: 'General Biobakery Database', type: 'database' as const },
    { name: 'Microbiome Bioactives', type: 'website' as const },
    { name: 'One Health Microbiome', type: 'website' as const },
    { name: 'bioBakery Forum', type: 'website' as const },
];

const STATUS_CFG: Record<SiteStatus, { dot: string; text: string; label: string }> = {
    up:       { dot: 'bg-green-400',             text: 'text-green-400',  label: 'Operational' },
    down:     { dot: 'bg-red-400',               text: 'text-red-400',    label: 'Down' },
    degraded: { dot: 'bg-yellow-400',            text: 'text-yellow-400', label: 'Degraded' },
    checking: { dot: 'bg-gray-400 animate-pulse', text: 'text-gray-400',  label: 'Checking…' },
};

function loadHistory(): UptimeHistory {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); }
    catch { return {}; }
}

function saveHistory(h: UptimeHistory) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h)); }
    catch { /* quota exceeded */ }
}

function uptimePct(entries: UptimeEntry[], hours: number): number | null {
    const cutoff = Date.now() - hours * 3_600_000;
    const slice = entries.filter(e => new Date(e.timestamp).getTime() > cutoff);
    if (!slice.length) return null;
    const up = slice.filter(e => e.status === 'up' || e.status === 'degraded').length;
    return Math.round((up / slice.length) * 1000) / 10;
}

function timeAgo(d: Date | null): string {
    if (!d) return 'never';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
}

export default function HealthCheckSection() {
    const [results, setResults] = useState<(CheckResult | null)[]>(SITES.map(() => null));
    const [history, setHistory] = useState<UptimeHistory>({});
    const [lastChecked, setLastChecked] = useState<Date | null>(null);
    const [checking, setChecking] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const runCheck = useCallback(async () => {
        setChecking(true);
        try {
            const res = await fetch('/api/health-check');
            const data = await res.json() as { results: CheckResult[]; checkedAt: string };
            setResults(data.results);
            setLastChecked(new Date(data.checkedAt));
            setHistory(prev => {
                const next = { ...prev };
                for (const r of data.results) {
                    const entries = [...(next[r.name] ?? []), { timestamp: r.checkedAt, status: r.status }];
                    next[r.name] = entries.slice(-MAX_HISTORY);
                }
                saveHistory(next);
                return next;
            });
        } catch {
            // silently fail — don't disrupt main page
        } finally {
            setChecking(false);
        }
    }, []);

    useEffect(() => {
        setHistory(loadHistory());
        runCheck();
        intervalRef.current = setInterval(runCheck, REFRESH_MS);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [runCheck]);

    const anyDown = results.some(r => r?.status === 'down');
    const allUp = results.length > 0 && results.every(r => r?.status === 'up');
    const loaded = results.some(r => r !== null);

    return (
        <div className="bg-gray-900 border-b border-gray-700 pt-20 px-6 pb-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-white">Service Health</h2>
                    {loaded && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            anyDown
                                ? 'bg-red-900/60 text-red-300'
                                : allUp
                                ? 'bg-green-900/60 text-green-300'
                                : 'bg-yellow-900/60 text-yellow-300'
                        }`}>
                            {anyDown ? 'Partial Outage' : allUp ? 'All Systems Operational' : 'Checking…'}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">
                        {lastChecked ? `Updated ${timeAgo(lastChecked)} · auto-refreshes every 5m` : 'Checking…'}
                    </span>
                    <button
                        onClick={runCheck}
                        disabled={checking}
                        className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white py-1 px-3 rounded transition-colors"
                    >
                        {checking ? 'Checking…' : 'Refresh'}
                    </button>
                </div>
            </div>

            {/* Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
                {SITES.map((site, i) => {
                    const result = results[i];
                    const status: SiteStatus = result?.status ?? 'checking';
                    const cfg = STATUS_CFG[status];
                    const hist = history[site.name] ?? [];
                    const last30 = hist.slice(-30);
                    const u24 = uptimePct(hist, 24);
                    const u7d = uptimePct(hist, 168);

                    return (
                        <div key={site.name} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                            {/* Name + status dot */}
                            <div className="flex items-start justify-between mb-1">
                                <div className="flex-1 min-w-0 pr-1">
                                    <p className="text-xs font-medium text-white leading-tight" title={result?.url ?? site.name}>
                                        {site.name}
                                    </p>
                                    {site.type === 'database' && (
                                        <span className="text-xs text-gray-500">DB Availability</span>
                                    )}
                                </div>
                                <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${cfg.dot}`} />
                            </div>

                            {/* Status label */}
                            <p className={`text-xs font-medium mb-1 ${cfg.text}`}>{cfg.label}</p>

                            {/* Response time + HTTP code */}
                            <p className="text-xs text-gray-400 mb-2 min-h-[16px]">
                                {result && status !== 'checking' && (
                                    <>
                                        {status === 'down' ? '—' : `${result.responseTime}ms`}
                                        {result.statusCode != null && (
                                            <span className="ml-1 text-gray-500">({result.statusCode})</span>
                                        )}
                                    </>
                                )}
                            </p>

                            {/* Mini history bar (last 30 checks) */}
                            <div className="flex gap-px mb-2" title="Last 30 checks (newest → right)">
                                {Array.from({ length: Math.max(0, 30 - last30.length) }, (_, k) => (
                                    <div key={`pad-${k}`} className="h-2.5 flex-1 rounded-[2px] bg-gray-700" />
                                ))}
                                {last30.map((e, k) => (
                                    <div
                                        key={k}
                                        className={`h-2.5 flex-1 rounded-[2px] ${
                                            e.status === 'up' || e.status === 'degraded'
                                                ? 'bg-green-500'
                                                : e.status === 'down'
                                                ? 'bg-red-500'
                                                : 'bg-gray-600'
                                        }`}
                                        title={`${new Date(e.timestamp).toLocaleString()}: ${e.status}`}
                                    />
                                ))}
                            </div>

                            {/* Uptime % */}
                            <div className="flex gap-3">
                                <div>
                                    <p className="text-xs text-gray-500">24h</p>
                                    <p className={`text-xs font-semibold ${
                                        u24 === null ? 'text-gray-600' :
                                        u24 >= 99 ? 'text-green-400' :
                                        u24 >= 95 ? 'text-yellow-400' : 'text-red-400'
                                    }`}>
                                        {u24 === null ? '—' : `${u24}%`}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-xs text-gray-500">7d</p>
                                    <p className={`text-xs font-semibold ${
                                        u7d === null ? 'text-gray-600' :
                                        u7d >= 99 ? 'text-green-400' :
                                        u7d >= 95 ? 'text-yellow-400' : 'text-red-400'
                                    }`}>
                                        {u7d === null ? '—' : `${u7d}%`}
                                    </p>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
