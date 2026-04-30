import { NextResponse } from 'next/server';

const SITES = [
    { name: 'Huttenhower Lab', url: 'https://huttenhower.sph.harvard.edu/', type: 'website' },
    { name: 'IBDMDB', url: 'https://ibdmdb.org/', type: 'website' },
    { name: 'IBDMDB Results', url: 'https://ibdmdb.org/results', type: 'website' },
    { name: 'BIOM-Mass', url: 'https://biom-mass.org/', type: 'website' },
    { name: 'Galaxy bioBakery', url: 'http://galaxy.biobakery.org/', type: 'website' },
    {
        name: 'DB: ChocoPhlAn',
        url: 'http://huttenhower.sph.harvard.edu/humann_data/chocophlan/chocophlan.v4_alpha.tar.gz',
        type: 'database',
    },
    { name: 'Microbiome Bioactives', url: 'https://microbiome-bioactives.org/', type: 'website' },
    { name: 'One Health Microbiome', url: 'https://onehealthmicrobiome.org/', type: 'website' },
    { name: 'bioBakery Forum', url: 'https://forum.biobakery.org/', type: 'website' },
] as const;

async function checkSite(site: (typeof SITES)[number]) {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetch(site.url, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'follow',
        });
        clearTimeout(timeout);
        const responseTime = Date.now() - start;
        const status = response.ok ? 'up' : response.status >= 500 ? 'down' : 'degraded';
        return {
            name: site.name,
            url: site.url,
            type: site.type,
            status,
            statusCode: response.status,
            responseTime,
            checkedAt: new Date().toISOString(),
        };
    } catch (error) {
        clearTimeout(timeout);
        const responseTime = Date.now() - start;
        const isTimeout = error instanceof Error && error.name === 'AbortError';
        return {
            name: site.name,
            url: site.url,
            type: site.type,
            status: 'down',
            statusCode: null,
            responseTime,
            checkedAt: new Date().toISOString(),
            error: isTimeout ? 'Request timed out' : error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export async function GET() {
    const results = await Promise.all(SITES.map(checkSite));
    return NextResponse.json({ results, checkedAt: new Date().toISOString() });
}
