export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';

const CACHE_FILE = '/tmp/biobakery_stats.json';

// maaslin3 is newly on Bioconductor and may not have stats yet — omit until confirmed
const BIOC_PACKAGES = ['banocc', 'sparseDOSSA', 'Maaslin2', 'Macarron', 'MMUPHin'];

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
                // One "all" row per year — sum them all for lifetime download total.
                // (The original Python backend did the same: counts[tool] += count for each "all" row)
                let total = 0;
                for (const line of text.split('\n')) {
                    const cols = line.split('\t');
                    if (cols[1]?.trim() === 'all') {
                        const count = parseInt(cols[3]?.trim() ?? '0', 10);
                        if (!isNaN(count)) total += count;
                    }
                }
                if (total > 0) bioconductor[pkg] = total;
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
