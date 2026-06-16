export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';

const CACHE_FILE = '/tmp/biobakery_stats.json';

// Bioconductor packages maintained by the Huttenhower / bioBakery lab
const BIOC_PACKAGES = ['banocc', 'sparseDOSSA', 'Maaslin2', 'maaslin3', 'Macarron', 'MMUPHin'];

type GalaxyTool  = { tool: string; jobs_ran: number };
type GalaxyStats = { total_registered_users: number; total_jobs_ran: number; tools_and_job_states: GalaxyTool[] };
type PypiStat    = { total: number; last_month: number };
type CachedData  = {
    stats: {
        docker: Record<string, { pull_count: number }>;
        conda: { conda: Record<string, number> };
        bioconductor: { bioconductor: Record<string, number> };
        galaxy: GalaxyStats;
        pypi: Record<string, PypiStat>;
    };
    last_update: string;
};

// ── PyPI packages for https://pypi.org/user/biobakery/ ──────────────────────
const PYPI_PACKAGES = [
    'phylophlan', 'humann', 'kneaddata', 'metaphlan', 'parathaa',
    'fugassem', 'baqlava', 'biobakery-workflows', 'waafle', 'metawibele',
    'halla', 'anadama2', 'lefse', 'export2graphlan', 'graphlan',
    'panphlan', 'shortbred', 'humann2', 'ppanini',
];

// ── Docker Hub ──────────────────────────────────────────────────────────────
async function fetchDockerStats(): Promise<Record<string, { pull_count: number }>> {
    const docker: Record<string, { pull_count: number }> = {};
    let url: string | null = 'https://hub.docker.com/v2/repositories/biobakery/?page_size=100';
    while (url) {
        const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
        if (!res.ok) break;
        const data = await res.json() as {
            next: string | null;
            results: Array<{ name: string; pull_count: number }>;
        };
        for (const repo of data.results ?? []) {
            docker[repo.name] = { pull_count: repo.pull_count ?? 0 };
        }
        url = data.next ?? null;
    }
    return docker;
}

// ── Conda (Anaconda Cloud) ──────────────────────────────────────────────────
async function fetchCondaStats(): Promise<Record<string, number>> {
    const conda: Record<string, number> = {};

    // Fetch biobakery channel and bioconda/metaphlan in parallel
    const [mainRes, mpRes] = await Promise.allSettled([
        fetch('https://api.anaconda.org/packages/biobakery', {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(8_000),
        }),
        fetch('https://api.anaconda.org/package/bioconda/metaphlan', {
            signal: AbortSignal.timeout(8_000),
        }),
    ]);

    if (mainRes.status === 'fulfilled' && mainRes.value.ok) {
        const packages = await mainRes.value.json() as Array<{ name: string; owner: string; ndownloads?: number }>;
        for (const pkg of packages) {
            if (pkg.name) conda[`${pkg.owner}_${pkg.name}`] = pkg.ndownloads ?? 0;
        }
    }

    if (mpRes.status === 'fulfilled' && mpRes.value.ok) {
        const data = await mpRes.value.json() as { ndownloads?: number };
        conda['bioconda_metaphlan'] = data.ndownloads ?? 0;
    }

    return conda;
}

// ── Bioconductor ────────────────────────────────────────────────────────────
async function fetchBioconductorStats(): Promise<Record<string, number>> {
    const bioconductor: Record<string, number> = {};
    await Promise.all(
        BIOC_PACKAGES.map(async (pkg) => {
            try {
                const res = await fetch(
                    `https://bioconductor.org/packages/stats/bioc/${pkg}/${pkg}_stats.tab`,
                    { signal: AbortSignal.timeout(8_000) }
                );
                if (!res.ok) return;
                const text = await res.text();
                // Format: Year\tMonth\tNb_of_distinct_IPs\tNb_of_downloads\t...
                // Backend grabs the "all" summary row: line[1] == "all" → count = line[3]
                for (const line of text.split('\n')) {
                    const cols = line.split('\t');
                    if (cols[1]?.trim() === 'all') {
                        const count = parseInt(cols[3]?.trim() ?? '0', 10);
                        if (!isNaN(count)) bioconductor[pkg] = count;
                        break;
                    }
                }
            } catch { /* skip */ }
        })
    );
    return bioconductor;
}

// ── PyPI (pypistats.org) ────────────────────────────────────────────────────
async function fetchPypiStats(): Promise<Record<string, PypiStat>> {
    const pypi: Record<string, PypiStat> = {};
    await Promise.all(
        PYPI_PACKAGES.map(async (pkg) => {
            try {
                // Fetch overall (per-day rows) and recent in parallel
                const [overallRes, recentRes] = await Promise.all([
                    fetch(`https://pypistats.org/api/packages/${pkg}/overall`, { signal: AbortSignal.timeout(8_000) }),
                    fetch(`https://pypistats.org/api/packages/${pkg}/recent`,  { signal: AbortSignal.timeout(8_000) }),
                ]);

                let total = 0;
                let last_month = 0;

                if (overallRes.ok) {
                    const json = await overallRes.json() as { data: Array<{ category: string; downloads: number }> };
                    // Sum all without_mirrors rows — this covers the full period pypistats has tracked
                    total = json.data
                        .filter(d => d.category === 'without_mirrors')
                        .reduce((s, d) => s + d.downloads, 0);
                }
                if (recentRes.ok) {
                    const json = await recentRes.json() as { data: { last_month: number } };
                    last_month = json.data.last_month;
                }

                if (total > 0 || last_month > 0) pypi[pkg] = { total, last_month };
            } catch { /* skip */ }
        })
    );
    return pypi;
}

// ── Galaxy bioBakery ────────────────────────────────────────────────────────
async function fetchGalaxyStats(fallback: GalaxyStats): Promise<GalaxyStats> {
    const base = 'http://galaxy.biobakery.org';
    // Credentials from the backend (admin user for the reports endpoint)
    const creds = process.env.GALAXY_PASSWORD
        ? `admin:${process.env.GALAXY_PASSWORD}`
        : 'admin:biobakery123';
    const authHeader = 'Basic ' + Buffer.from(creds).toString('base64');
    const headers = { Authorization: authHeader };

    try {
        const [usersRes, toolsRes] = await Promise.all([
            fetch(`${base}/reports/users/registered_users`, { headers, signal: AbortSignal.timeout(8_000) }),
            fetch(`${base}/reports/tools/tools_and_job_state`, { headers, signal: AbortSignal.timeout(8_000) }),
        ]);

        let total_registered_users = fallback.total_registered_users;
        let tools_and_job_states = fallback.tools_and_job_states;

        if (usersRes.ok) {
            const html = await usersRes.text();
            // The page has a link href="/reports/users/registered_users_per_month?..."
            // whose preceding <td> contains the count — grab the first large integer on the page
            const match = html.match(/<td[^>]*>\s*(\d+)\s*<\/td>/);
            if (match) total_registered_users = parseInt(match[1], 10);
        }

        if (toolsRes.ok) {
            const html = await toolsRes.text();
            // Parse table: <table class="colored"><tr><td>ToolName</td><td>JobCount</td></tr>...
            const tools: GalaxyTool[] = [];
            const rowRe = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>\s*(\d[\d,]*)\s*<\/td>/g;
            let m: RegExpExecArray | null;
            while ((m = rowRe.exec(html)) !== null) {
                const tool = m[1].replace(/<[^>]*>/g, '').trim();
                const jobs_ran = parseInt(m[2].replace(/,/g, ''), 10);
                if (tool && !isNaN(jobs_ran)) tools.push({ tool, jobs_ran });
            }
            if (tools.length > 0) tools_and_job_states = tools;
        }

        const total_jobs_ran = tools_and_job_states.reduce((s, t) => s + t.jobs_ran, 0);
        return { total_registered_users, total_jobs_ran, tools_and_job_states };
    } catch {
        return fallback;
    }
}

// ── Main handler ────────────────────────────────────────────────────────────
export async function GET() {
    // Load existing cache so Galaxy (which needs admin HTML scraping) can fall back gracefully
    let cached: CachedData | null = null;
    try {
        cached = JSON.parse(await readFile(CACHE_FILE, 'utf-8'));
    } catch { /* no cache yet */ }

    const fallbackGalaxy: GalaxyStats = cached?.stats.galaxy ?? {
        total_registered_users: 0,
        total_jobs_ran: 0,
        tools_and_job_states: [],
    };

    const [docker, condaRaw, bioconductorRaw, galaxy, pypi] = await Promise.all([
        fetchDockerStats().catch(() => cached?.stats.docker ?? {}),
        fetchCondaStats().catch(() => cached?.stats.conda?.conda ?? {}),
        fetchBioconductorStats().catch(() => cached?.stats.bioconductor?.bioconductor ?? {}),
        fetchGalaxyStats(fallbackGalaxy),
        fetchPypiStats().catch(() => cached?.stats.pypi ?? {}),
    ]);

    const result: CachedData = {
        stats: {
            docker,
            conda: { conda: condaRaw },
            bioconductor: { bioconductor: bioconductorRaw },
            galaxy,
            pypi,
        },
        last_update: new Date().toISOString(),
    };

    try {
        await writeFile(CACHE_FILE, JSON.stringify(result), 'utf-8');
    } catch { /* ignore write errors */ }

    return NextResponse.json(result);
}
