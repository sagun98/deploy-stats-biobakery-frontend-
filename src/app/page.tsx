'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Head from 'next/head';
import HealthCheckSection from './components/HealthCheckSection';

// ── Types ────────────────────────────────────────────────────────────────────
type DockerStats    = Record<string, { pull_count: number }>;
type CondaStats     = Record<string, number>;
type BiocStats      = Record<string, number>;
type GalaxyTool     = { tool: string; jobs_ran: number };
type GalaxyStats    = { total_registered_users: number; total_jobs_ran: number; tools_and_job_states: GalaxyTool[] };
type Stats          = { docker: DockerStats; conda: { conda: CondaStats }; bioconductor: { bioconductor: BiocStats }; galaxy: GalaxyStats };

// ── Persistence ──────────────────────────────────────────────────────────────
const LS_KEY = 'biobakery_download_stats';
const STALE_MS = 60 * 60 * 1000; // auto-refresh when data is > 1 h old

function save(stats: Stats, last_update: string) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ stats, last_update })); } catch { /* quota */ }
}
function load(): { stats: Stats; last_update: string } | null {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (p?.stats?.docker && p?.last_update) return p;
    } catch { /* corrupted */ }
    return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt   = (n: number) => n.toLocaleString();
const fmtSh = (n: number) => n >= 1_000_000 ? `${(n/1e6).toFixed(1)}M` : n >= 1_000 ? `${(n/1e3).toFixed(1)}K` : String(n);

function timeAgo(iso: string) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60)   return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
}
function fmtFull(iso: string) {
    return new Intl.DateTimeFormat('en-US', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(iso));
}

// ── Skeleton card ────────────────────────────────────────────────────────────
const SKELETON_WIDTHS = ['w-3/4','w-1/2','w-2/3','w-4/5','w-2/5','w-3/5'];
function SkeletonCard({ accent }: { accent: string }) {
    return (
        <div className={`bg-gray-800 rounded-xl border border-gray-700 overflow-hidden flex flex-col border-t-2 ${accent}`}>
            <div className="px-4 py-3 bg-gray-900 border-b border-gray-700 space-y-1.5">
                <div className="h-4 w-24 bg-gray-700 rounded animate-pulse" />
                <div className="h-3 w-40 bg-gray-700/50 rounded animate-pulse" />
            </div>
            <div className="divide-y divide-gray-700/40">
                {SKELETON_WIDTHS.map((w, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="h-3 w-4 bg-gray-700 rounded animate-pulse flex-shrink-0" />
                        <div className={`h-3 ${w} bg-gray-700 rounded animate-pulse`} />
                        <div className="h-3 w-14 bg-gray-700 rounded animate-pulse ml-auto flex-shrink-0" />
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function Home() {
    const [stats, setStats]               = useState<Stats | null>(null);
    const [lastUpdate, setLastUpdate]     = useState<string | null>(null);
    const [refreshing, setRefreshing]     = useState(false);

    const applyData = useCallback((data: { stats: Stats; last_update: string }) => {
        setStats(data.stats);
        setLastUpdate(data.last_update);
        save(data.stats, data.last_update);
    }, []);

    const fetchCache = useCallback(async () => {
        try {
            const res = await axios.get('/api/download-stats');
            if (res.data?.stats) applyData(res.data);
        } catch { /* no server cache yet */ }
    }, [applyData]);

    const refresh = useCallback(async (showSpinner = true) => {
        if (showSpinner) setRefreshing(true);
        try {
            const res = await axios.get('/api/download-stats/refresh');
            if (res.data?.stats) applyData(res.data);
        } catch (e) { console.error('Refresh failed:', e); }
        finally { if (showSpinner) setRefreshing(false); }
    }, [applyData]);

    useEffect(() => {
        const persisted = load();
        if (persisted) {
            applyData(persisted);
            const age = Date.now() - new Date(persisted.last_update).getTime();
            // silently re-fetch server cache first; if stale also refresh from APIs
            fetchCache();
            if (age > STALE_MS) refresh(false);
        } else {
            // First visit — auto-load everything
            refresh(true);
        }
    }, [applyData, fetchCache, refresh]);

    // ── Derived data ────────────────────────────────────────────────────────
    const dockerRows    = stats ? Object.entries(stats.docker).sort(([,a],[,b]) => b.pull_count - a.pull_count) : [];
    const condaRows     = stats ? Object.entries(stats.conda.conda).sort(([,a],[,b]) => b - a) : [];
    const biocRows      = stats ? Object.entries(stats.bioconductor.bioconductor).sort(([,a],[,b]) => b - a) : [];
    const galaxyTools   = stats ? [...stats.galaxy.tools_and_job_states].sort((a,b) => b.jobs_ran - a.jobs_ran) : [];
    const dockerTotal   = dockerRows.reduce((s,[,v]) => s + v.pull_count, 0);
    const condaTotal    = condaRows.reduce((s,[,v]) => s + v, 0);
    const biocTotal     = biocRows.reduce((s,[,v]) => s + v, 0);

    return (
        <>
            <Head><title>bioBakery Stats</title></Head>
            <div className="bg-gray-900 min-h-screen text-white">

                {/* ── Nav ─────────────────────────────────────────────────── */}
                <nav className="bg-gray-950 border-b border-gray-800 py-3 px-6 w-full fixed top-0 z-10 flex justify-between items-center">
                    <h1 className="text-lg font-bold tracking-tight">The bioBakery Lab</h1>
                    <div className="flex items-center gap-4">
                        {lastUpdate && (
                            <span className="text-xs text-gray-500 hidden sm:block" title={fmtFull(lastUpdate)}>
                                Updated {timeAgo(lastUpdate)}
                            </span>
                        )}
                        <button
                            onClick={() => refresh(true)}
                            disabled={refreshing}
                            className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white py-1.5 px-3 rounded-md transition-colors"
                        >
                            {refreshing ? (
                                <>
                                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                                    </svg>
                                    Refreshing…
                                </>
                            ) : 'Refresh Stats'}
                        </button>
                    </div>
                </nav>

                {/* ── Health checks ────────────────────────────────────────── */}
                <HealthCheckSection />

                {/* ── Download stats ───────────────────────────────────────── */}
                <div className="px-6 pb-8">

                    {/* Timestamp bar */}
                    {lastUpdate && (
                        <div className="py-3 mb-4 flex items-center gap-2 border-b border-gray-800">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                            <p className="text-xs text-gray-400">
                                Download counts last fetched <strong className="text-gray-300">{fmtFull(lastUpdate)}</strong>
                                <span className="text-gray-500 ml-1">({timeAgo(lastUpdate)})</span>
                            </p>
                        </div>
                    )}

                    {/* Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">

                        {/* ── Docker ──────────────────────────────────── */}
                        {stats ? (
                            <div className="bg-gray-800 rounded-xl border border-gray-700 border-t-2 border-t-sky-500 flex flex-col overflow-hidden">
                                <div className="px-4 py-3 bg-gray-900 border-b border-gray-700">
                                    <div className="flex items-center justify-between">
                                        <h2 className="font-semibold text-white">Docker</h2>
                                        <span className="text-xs text-gray-500">{dockerRows.length} repos</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {fmtSh(dockerTotal)} total pulls
                                    </p>
                                </div>
                                <div className="overflow-y-auto max-h-[420px] divide-y divide-gray-700/40">
                                    {dockerRows.map(([name, { pull_count }], i) => (
                                        <div key={name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/30 transition-colors">
                                            <span className="text-xs text-gray-600 w-5 text-right flex-shrink-0 font-mono">{i+1}</span>
                                            <span className="flex-1 text-sm text-gray-200 truncate min-w-0" title={name}>{name}</span>
                                            <span className="text-sm font-mono font-semibold text-sky-400 flex-shrink-0 tabular-nums">{fmt(pull_count)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : <SkeletonCard accent="border-sky-500" />}

                        {/* ── Conda ───────────────────────────────────── */}
                        {stats ? (
                            <div className="bg-gray-800 rounded-xl border border-gray-700 border-t-2 border-t-emerald-500 flex flex-col overflow-hidden">
                                <div className="px-4 py-3 bg-gray-900 border-b border-gray-700">
                                    <div className="flex items-center justify-between">
                                        <h2 className="font-semibold text-white">Conda</h2>
                                        <span className="text-xs text-gray-500">{condaRows.length} packages</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {fmtSh(condaTotal)} total downloads
                                    </p>
                                </div>
                                <div className="overflow-y-auto max-h-[420px] divide-y divide-gray-700/40">
                                    {condaRows.map(([name, count], i) => (
                                        <div key={name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/30 transition-colors">
                                            <span className="text-xs text-gray-600 w-5 text-right flex-shrink-0 font-mono">{i+1}</span>
                                            <span className="flex-1 text-sm text-gray-200 truncate min-w-0" title={name}>{name}</span>
                                            <span className="text-sm font-mono font-semibold text-emerald-400 flex-shrink-0 tabular-nums">{fmt(count)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : <SkeletonCard accent="border-emerald-500" />}

                        {/* ── Bioconductor ────────────────────────────── */}
                        {stats ? (
                            <div className="bg-gray-800 rounded-xl border border-gray-700 border-t-2 border-t-violet-500 flex flex-col overflow-hidden">
                                <div className="px-4 py-3 bg-gray-900 border-b border-gray-700">
                                    <div className="flex items-center justify-between">
                                        <h2 className="font-semibold text-white">Bioconductor</h2>
                                        <span className="text-xs text-gray-500">{biocRows.length} packages</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {fmtSh(biocTotal)} total downloads
                                    </p>
                                </div>
                                <div className="overflow-y-auto max-h-[420px] divide-y divide-gray-700/40">
                                    {biocRows.map(([name, count], i) => (
                                        <div key={name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/30 transition-colors">
                                            <span className="text-xs text-gray-600 w-5 text-right flex-shrink-0 font-mono">{i+1}</span>
                                            <span className="flex-1 text-sm text-gray-200 truncate min-w-0" title={name}>{name}</span>
                                            <span className="text-sm font-mono font-semibold text-violet-400 flex-shrink-0 tabular-nums">{fmt(count)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : <SkeletonCard accent="border-violet-500" />}

                        {/* ── Galaxy ──────────────────────────────────── */}
                        {stats ? (
                            <div className="bg-gray-800 rounded-xl border border-gray-700 border-t-2 border-t-amber-500 flex flex-col overflow-hidden">
                                <div className="px-4 py-3 bg-gray-900 border-b border-gray-700">
                                    <div className="flex items-center justify-between">
                                        <h2 className="font-semibold text-white">Galaxy</h2>
                                        <span className="text-xs text-gray-500">{galaxyTools.length} tools</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                        {stats.galaxy.total_registered_users > 0 && <>{fmt(stats.galaxy.total_registered_users)} users · </>}{fmtSh(stats.galaxy.total_jobs_ran)} jobs
                                    </p>
                                </div>
                                <div className="overflow-y-auto max-h-[420px] divide-y divide-gray-700/40">
                                    {galaxyTools.map((tool, i) => (
                                        <div key={tool.tool} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/30 transition-colors">
                                            <span className="text-xs text-gray-600 w-5 text-right flex-shrink-0 font-mono">{i+1}</span>
                                            <span className="flex-1 text-sm text-gray-200 truncate min-w-0" title={tool.tool}>{tool.tool}</span>
                                            <span className="text-sm font-mono font-semibold text-amber-400 flex-shrink-0 tabular-nums">{fmt(tool.jobs_ran)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : <SkeletonCard accent="border-amber-500" />}

                    </div>
                </div>
            </div>
        </>
    );
}
