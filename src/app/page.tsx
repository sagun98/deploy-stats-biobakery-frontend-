'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Head from 'next/head';
import { Oval } from 'react-loader-spinner';

type Stat = {
    pull_count: number | string;
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

type Stats = {
    docker: DockerStats;
    conda: { conda: CondaStats };
    bioconductor: { bioconductor: BioconductorStats };
};

export default function Home() {
    const [stats, setStats] = useState<Stats | null>(null);
    const [lastUpdate, setLastUpdate] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

    const fetchStatsFromFile = useCallback(async () => {
        try {
            setLoading(true);
            const response = await axios.get(`${API_BASE_URL}/fetch-stats-from-file`, {
                params: { file_type: 'json' },
            });
            setStats(response.data.stats);
            setLastUpdate(formatTimestamp(response.data.last_update) || null);
        } catch (error) {
            console.error('Error fetching stats from file:', error);
        } finally {
            setLoading(false);
        }
    }, [API_BASE_URL]);

    useEffect(() => {
        fetchStatsFromFile();
    }, [fetchStatsFromFile]);

    const updateStatsFromAPI = async () => {
        try {
            setLoading(true);
            await axios.get(`${API_BASE_URL}/update-stats-from-api`, {
                params: { file_type: 'json' },
            });
            fetchStatsFromFile();
        } catch (error) {
            console.error('Error updating stats from API:', error);
        } finally {
            setLoading(false);
        }
    };

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

    const sortData = (data: { [key: string]: number | string | { pull_count: number } }) =>
        Object.entries(data)
            .sort(([, a], [, b]) => {
                const aValue = typeof a === 'object' && 'pull_count' in a ? a.pull_count : a;
                const bValue = typeof b === 'object' && 'pull_count' in b ? b.pull_count : b;
                return (bValue as number) - (aValue as number);
            })
            .map(([key, value]) => ({ key, value }));

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
                        className="bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded"
                    >
                        Get Latest Download Counts (~2minutes runtime)
                    </button>
                </nav>

                {loading && (
                    <div className="flex justify-center items-center my-6 pt-16">
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

                <div className="flex flex-col lg:flex-row pt-20 px-6">
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
                </div>
            </div>
        </>
    );
}
