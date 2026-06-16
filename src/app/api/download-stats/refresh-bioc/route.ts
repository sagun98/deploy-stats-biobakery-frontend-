export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';

const CACHE_FILE = '/tmp/biobakery_stats.json';

const BIOC_PACKAGES = new Set(['banocc', 'sparseDOSSA', 'Maaslin2', 'maaslin3', 'Macarron', 'MMUPHin']);

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; BioBakery-Stats-Monitor/1.0)',
    'Accept': 'text/plain, text/tab-separated-values, */*',
};

// Combined stats file for ALL Bioconductor packages — one request instead of 6.
// Tried in order; first success wins.
const COMBINED_URLS = [
    'https://www.bioconductor.org/packages/stats/bioc/bioc_pkg_stats.tab',
    'https://bioconductor.org/packages/stats/bioc/bioc_pkg_stats.tab',
    'http://master.bioconductor.org/packages/stats/bioc/bioc_pkg_stats.tab',
];

// Parse the combined tab file. Header row names the columns; we detect indices dynamically.
// Expected columns: Package  Year  Month  Nb_of_distinct_IPs  Nb_of_downloads
// Rows where Month == "all" are annual totals; sum across all years for lifetime downloads.
function parseCombinedTab(text: string): Record<string, number> {
    const lines = text.split('\n');
    if (lines.length < 2) return {};

    // Detect column indices from header
    const header = lines[0].split('\t').map(h => h.trim().toLowerCase());
    const pkgIdx  = header.findIndex(h => h === 'package');
    const monIdx  = header.findIndex(h => h === 'month');
    const dlIdx   = header.findIndex(h => h.startsWith('nb_of_down') || h === 'downloads');

    // Fall back to known default positions if header is unrecognised
    const pi = pkgIdx  >= 0 ? pkgIdx  : 0;
    const mi = monIdx  >= 0 ? monIdx  : 2;
    const di = dlIdx   >= 0 ? dlIdx   : 4;

    if (pkgIdx < 0) console.warn('[refresh-bioc] unrecognised header, using defaults. First line:', lines[0].slice(0, 120));

    const totals: Record<string, number> = {};
    for (const line of lines.slice(1)) {
        const cols = line.split('\t');
        const pkg   = cols[pi]?.trim();
        const month = cols[mi]?.trim();
        if (!pkg || month !== 'all' || !BIOC_PACKAGES.has(pkg)) continue;
        const count = parseInt(cols[di]?.trim() ?? '0', 10);
        if (!isNaN(count)) totals[pkg] = (totals[pkg] ?? 0) + count;
    }
    return totals;
}

async function fetchCombinedStats(): Promise<Record<string, number>> {
    const errors: string[] = [];
    for (const url of COMBINED_URLS) {
        try {
            const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
            if (!res.ok) { errors.push(`${url}: HTTP ${res.status}`); continue; }
            const text = await res.text();
            const result = parseCombinedTab(text);
            console.log(`[refresh-bioc] loaded ${Object.keys(result).length} packages from ${url}`);
            return result;
        } catch (e) {
            errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    console.error('[refresh-bioc] all hosts failed:', errors);
    return {};
}

export async function GET() {
    const bioconductor = await fetchCombinedStats();

    // Merge into /tmp cache so the next main-refresh picks it up
    try {
        const cached = JSON.parse(await readFile(CACHE_FILE, 'utf-8'));
        cached.stats.bioconductor = { bioconductor };
        await writeFile(CACHE_FILE, JSON.stringify(cached), 'utf-8');
    } catch { /* cache may not exist yet */ }

    return NextResponse.json({ bioconductor });
}
