export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';

const CACHE_FILE = '/tmp/biobakery_stats.json';

// Bioconductor packages — fetched separately so slow responses don't block the main refresh
const BIOC_PACKAGES = ['banocc', 'sparseDOSSA', 'Maaslin2', 'maaslin3', 'Macarron', 'MMUPHin'];

function parseBiocTab(text: string): number | null {
    for (const line of text.split('\n')) {
        const cols = line.split('\t');
        if (cols[1]?.trim() === 'all') {
            const count = parseInt(cols[3]?.trim() ?? '0', 10);
            return isNaN(count) ? null : count;
        }
    }
    return null;
}

export async function GET() {
    const bioconductor: Record<string, number> = {};

    await Promise.all(
        BIOC_PACKAGES.map(async (pkg) => {
            try {
                const res = await fetch(
                    `https://bioconductor.org/packages/stats/bioc/${pkg}/${pkg}_stats.tab`,
                    { signal: AbortSignal.timeout(15_000) }
                );
                if (!res.ok) return;
                const count = parseBiocTab(await res.text());
                if (count !== null) bioconductor[pkg] = count;
            } catch { /* skip unavailable packages */ }
        })
    );

    // Merge result into the shared /tmp cache so future main-refresh reads include it
    try {
        const cached = JSON.parse(await readFile(CACHE_FILE, 'utf-8'));
        cached.stats.bioconductor = { bioconductor };
        await writeFile(CACHE_FILE, JSON.stringify(cached), 'utf-8');
    } catch { /* cache may not exist yet — not a problem */ }

    return NextResponse.json({ bioconductor });
}
