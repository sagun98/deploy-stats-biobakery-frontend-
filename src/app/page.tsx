'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Head from 'next/head';
import { Oval } from 'react-loader-spinner';
import HealthCheckSection from './components/HealthCheckSection';

type Stat = {
    pull_count: number;
};

type DockerStats = {
    [repo: string]: Stat;
};

type CondaStats = {
    [item: string]: number;
};

type BioconductorStats = {
    [item: string]: number;
};

type GalaxyTool = {
    tool: string;
    jobs_ran: number;
};

type GalaxyStats = {
    total_registered_users: number;
    total_jobs_ran: number;
    tools_and_job_states: GalaxyTool[];
};

type Stats = {
    docker: DockerStats;
    conda: { conda: CondaStats };
    bioconductor: { bioconductor: BioconductorStats };
    galaxy: GalaxyStats;
};

const LS_KEY = 'biobakery_download_stats';

function persistStats(stats: Stats, last_update: string) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify({ stats, last_update }));
    } catch { /* quota exceeded */ }
}

function loadPersistedStats(): { stats: Stats; last_update: string } | null {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // Basic shape validation
        if (parsed?.stats?.docker && parsed?.last_update) return parsed;
    } catch { /* corrupted */ }
    return null;
}

export default function Home() {
    const [stats, setStats] = useState<Stats | null>(null);
    const [lastUpdate, setLastUpdate] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const formatTimestamp = (timestamp: string | null): string => {
        if (!timestamp) return 'Unknown';
        const options: Intl.DateTimeFormatOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        };
        return new Intl.DateTimeFormat('en-US', options).format(new Date(timestamp));
    };

    // Load cached stats from the Next.js server-side cache file
    const fetchStatsFromCache = useCallback(async (showSpinner = true) => {
        try {
            if (showSpinner) setLoading(true);
            const response = await axios.get('/api/download-stats');
            if (response.data?.stats) {
                setStats(response.data.stats);
                setLastUpdate(formatTimestamp(response.data.last_update) || null);
                persistStats(response.data.stats, response.data.last_update);
            }
        } catch {
            // Server cache empty or unreachable — localStorage data (if any) stays shown
        } finally {
            if (showSpinner) setLoading(false);
        }
    }, []);

    useEffect(() => {
        // Show localStorage data immediately (zero latency), then sync with server cache
        const persisted = loadPersistedStats();
        if (persisted) {
            setStats(persisted.stats);
            setLastUpdate(formatTimestamp(persisted.last_update) || null);
            fetchStatsFromCache(false); // background sync, no spinner
        } else {
            fetchStatsFromCache(true); // first visit: show spinner
        }
    }, [fetchStatsFromCache]);

    // Fetch fresh data from all external APIs (Docker, Conda, Bioconductor, Galaxy)
    const updateStatsFromAPI = async () => {
        try {
            setLoading(true);
            const response = await axios.get('/api/download-stats/refresh');
            if (response.data?.stats) {
                setStats(response.data.stats);
                setLastUpdate(formatTimestamp(response.data.last_update) || null);
                persistStats(response.data.stats, response.data.last_update);
            }
        } catch (error) {
            console.error('Error refreshing stats:', error);
        } finally {
            setLoading(false);
        }
    };

    const sortData = (data: { [key: string]: number | string | { pull_count: number } }) =>
        Object.entries(data)
            .sort(([, a], [, b]) => {
                const aValue = typeof a === 'object' && 'pull_count' in a ? a.pull_count : a;
                const bValue = typeof b === 'object' && 'pull_count' in b ? b.pull_count : b;
                return (bValue as number) - (aValue as number);
            })
            .map(([key, value]) => ({ key, value }));

    const sortGalaxyToolsByJobsRan = (tools: GalaxyTool[]) =>
        [...tools].sort((a, b) => b.jobs_ran - a.jobs_ran);

    const renderTableRows = (data: { [key: string]: number | string | { pull_count: number } }) =>
        sortData(data).map(({ key, value }, idx) => (
            <tr key={key} className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-700'}>
                <td className="px-2 py-1 border border-gray-600 text-sm">{key}</td>
                <td className="px-2 py-1 border border-gray-600 text-sm">
                    {typeof value === 'object' && 'pull_count' in value ? value.pull_count : value || 'N/A'}
                </td>
            </tr>
        ));

    return (
        <>
            <Head>
                <title>bioBakery Stats</title>
            </Head>
            <div className="bg-gray-800 min-h-screen text-white">
                <nav className="bg-gray-900 py-4 px-6 w-full fixed top-0 z-10 flex justify-between items-center">
                    <h1 className="text-xl font-bold">The bioBakery Lab</h1>
                    <button
                        onClick={updateStatsFromAPI}
                        disabled={loading}
                        className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white py-2 px-4 rounded"
                    >
                        Get Latest Download Counts
                    </button>
                </nav>

                <HealthCheckSection />

                {loading && (
                    <div className="flex justify-center items-center py-6">
                        <Oval
                            height={50}
                            width={50}
                            color="#ffffff"
                            secondaryColor="#555555"
                            strokeWidth={4}
                            ariaLabel="Loading..."
                            visible={true}
                        />
                    </div>
                )}

                <div className="flex flex-col lg:flex-row pt-4 px-6">
                    {['docker', 'conda', 'bioconductor'].map((category) => (
                        <div
                            key={category}
                            className="bg-gray-700 rounded shadow-lg p-4 max-w-lg w-full lg:mr-6 mb-6"
                        >
                            <h1 className="text-2xl font-bold mb-4 capitalize">{category}</h1>
                            <p className="text-sm mb-4">
                                <strong>Last Updated:</strong> {lastUpdate || 'Unknown'}
                            </p>
                            <div className="overflow-auto">
                                <table className="table-auto w-full text-left border border-gray-600">
                                    <thead>
                                        <tr className="bg-gray-800">
                                            <th className="px-2 py-1 border border-gray-600 text-sm">Tools</th>
                                            <th className="px-2 py-1 border border-gray-600 text-sm">Counts</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {stats &&
                                            category === 'docker' &&
                                            renderTableRows(stats.docker)}
                                        {stats &&
                                            category === 'conda' &&
                                            renderTableRows(stats.conda.conda)}
                                        {stats &&
                                            category === 'bioconductor' &&
                                            renderTableRows(stats.bioconductor.bioconductor)}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ))}

                    {stats?.galaxy && (
                        <div className="bg-gray-700 rounded shadow-lg p-4 max-w-lg w-full lg:mr-6 mb-6">
                            <h1 className="text-2xl font-bold mb-4">Galaxy</h1>
                            <p className="text-sm mb-4">
                                <strong>Last Updated:</strong> {lastUpdate || 'Unknown'}
                            </p>
                            <p className="text-sm mb-4">
                                <strong>Total Registered Users:</strong> {stats.galaxy.total_registered_users}
                            </p>
                            <p className="text-sm mb-4">
                                <strong>Total Jobs Ran:</strong> {stats.galaxy.total_jobs_ran}
                            </p>

                            <div className="overflow-auto">
                                <table className="table-auto w-full text-left border border-gray-600">
                                    <thead>
                                        <tr className="bg-gray-800">
                                            <th className="px-2 py-1 border border-gray-600 text-sm">Tool</th>
                                            <th className="px-2 py-1 border border-gray-600 text-sm">Jobs Ran</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortGalaxyToolsByJobsRan(stats.galaxy.tools_and_job_states).map((tool, idx) => (
                                            <tr key={tool.tool} className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-700'}>
                                                <td className="px-2 py-1 border border-gray-600 text-sm">{tool.tool}</td>
                                                <td className="px-2 py-1 border border-gray-600 text-sm">{tool.jobs_ran}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
