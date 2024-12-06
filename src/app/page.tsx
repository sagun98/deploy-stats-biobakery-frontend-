'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import Head from 'next/head';
import { Oval } from 'react-loader-spinner';

export default function Home() {
    const [stats, setStats] = useState<any>(null);
    const [lastUpdate, setLastUpdate] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

    useEffect(() => {
        fetchStatsFromFile();
    }, []);

    const fetchStatsFromFile = async () => {
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
    };

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

    return (
        <>
            <Head>
                <title>bioBakery Stats</title>
            </Head>
            <div className="bg-gray-800 min-h-screen text-white">
                {/* Sticky Navigation Bar */}
                <nav className="bg-gray-900 py-4 px-6 w-full fixed top-0 z-10">
                    <h1 className="text-xl font-bold">The bioBakery Lab</h1>
                </nav>

                <div className="flex flex-col lg:flex-row pt-20 px-6">
                    {/* Card Layout */}
                    <div className="bg-gray-700 rounded shadow-lg p-4 max-w-lg w-full lg:float-left lg:mr-6">
                        {/* Title */}
                        <h1 className="text-2xl font-bold mb-4">DockerHub</h1>

                        {/* Last Update */}
                        <p className="text-sm mb-4">
                            <strong>Last Updated:</strong> {lastUpdate || 'Unknown'}
                        </p>

                        {/* Table */}
                        <div className="overflow-auto">
                            <table className="table-auto w-full text-left border border-gray-600">
                                <thead>
                                    <tr className="bg-gray-800">
                                        <th className="px-2 py-1 border border-gray-600 text-sm">Repository</th>
                                        <th className="px-2 py-1 border border-gray-600 text-sm">Pull Count</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stats &&
                                        Object.entries(stats).map(([repo, data]: any, idx) => (
                                            <tr
                                                key={repo}
                                                className={idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-700'}
                                            >
                                                <td className="px-2 py-1 border border-gray-600 text-sm">{repo}</td>
                                                <td className="px-2 py-1 border border-gray-600 text-sm">
                                                    {data.pull_count || 'N/A'}
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Button */}
                    <div className="mt-4 lg:mt-0 lg:ml-6">
                        <button
                            onClick={updateStatsFromAPI}
                            className="bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded"
                        >
                            Update Stats from API
                        </button>
                    </div>
                </div>

                {/* Loader */}
                {loading && (
                    <div className="flex justify-center items-center my-6">
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
            </div>
        </>
    );
}
