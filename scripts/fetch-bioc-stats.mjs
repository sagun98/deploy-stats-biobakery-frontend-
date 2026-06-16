#!/usr/bin/env node
// Fetches the combined Bioconductor stats file and extracts download counts
// for the bioBakery lab packages. Runs in GitHub Actions (has network access
// to bioconductor.org) and writes public/bioc-stats.json.

import { writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'bioc-stats.json');

const BIOC_PACKAGES = new Set(['banocc', 'sparseDOSSA', 'Maaslin2', 'maaslin3', 'Macarron', 'MMUPHin']);

const URLS = [
    'https://www.bioconductor.org/packages/stats/bioc/bioc_pkg_stats.tab',
    'https://bioconductor.org/packages/stats/bioc/bioc_pkg_stats.tab',
];

async function fetchText(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BioBakery-Stats/1.0)' },
        signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.text();
}

function parse(text) {
    const lines = text.split('\n');
    const header = lines[0].split('\t').map(h => h.trim().toLowerCase());

    const pi = Math.max(0, header.findIndex(h => h === 'package'));
    const mi = header.findIndex(h => h === 'month');
    const di = header.findIndex(h => h.startsWith('nb_of_down') || h === 'downloads');
    const miR = mi >= 0 ? mi : 2;
    const diR = di >= 0 ? di : 4;

    const totals = {};
    for (const line of lines.slice(1)) {
        const cols = line.split('\t');
        const pkg   = cols[pi]?.trim();
        const month = cols[miR]?.trim();
        if (!pkg || month !== 'all' || !BIOC_PACKAGES.has(pkg)) continue;
        const count = parseInt(cols[diR]?.trim() ?? '0', 10);
        if (!isNaN(count)) totals[pkg] = (totals[pkg] ?? 0) + count;
    }
    return totals;
}

let bioconductor = {};
for (const url of URLS) {
    try {
        console.log(`Trying ${url} …`);
        const text = await fetchText(url);
        bioconductor = parse(text);
        console.log(`Success — ${Object.keys(bioconductor).length} packages:`, bioconductor);
        break;
    } catch (e) {
        console.warn(`Failed: ${e.message}`);
    }
}

if (Object.keys(bioconductor).length === 0) {
    console.error('All sources failed — writing empty result');
}

await writeFile(OUT, JSON.stringify({ bioconductor, last_update: new Date().toISOString() }, null, 2));
console.log('Written to', OUT);
