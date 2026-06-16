export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';

const CACHE_FILE = '/tmp/biobakery_stats.json';

const BIOC_PACKAGES = ['banocc', 'sparseDOSSA', 'Maaslin2', 'maaslin3', 'Macarron', 'MMUPHin'];

export async function GET() {
    const bioconductor: Record<string, number> = {};

    // Fetch individual per-package tab files in parallel.
    // These are small files — fast to download. The combined bioc_pkg_stats.tab
    // is huge (all packages × all years) and was causing the 504 timeout.
    await Promise.all(
        BIOC_PACKAGES.map(async (pkg) => {
            try {
                const res = await fetch(
                    `https://bioconductor.org/packages/stats/bioc/${pkg}/${pkg}_stats.tab`,
                    { signal: AbortSignal.timeout(15_000) }
                );
                if (!res.ok) return;
                const text = await res.text();
                // Format: Year\tMonth\tNb_of_distinct_IPs\tNb_of_downloads
                // The "all" row is the all-time total for that year; we want the most recent one.
                for (const line of text.split('\n')) {
                    const cols = line.split('\t');
                    if (cols[1]?.trim() === 'all') {
                        const count = parseInt(cols[3]?.trim() ?? '0', 10);
                        if (!isNaN(count)) bioconductor[pkg] = count;
                        break;
                    }
                }
            } catch { /* skip unavailable packages */ }
        })
    );

    console.log('[refresh-bioc] fetched', Object.keys(bioconductor).length, '/', BIOC_PACKAGES.length, 'packages:', bioconductor);

    // Merge into /tmp cache
    try {
        const cached = JSON.parse(await readFile(CACHE_FILE, 'utf-8'));
        cached.stats.bioconductor = { bioconductor };
        await writeFile(CACHE_FILE, JSON.stringify(cached), 'utf-8');
    } catch { /* cache may not exist yet */ }

    return NextResponse.json({ bioconductor });
}
