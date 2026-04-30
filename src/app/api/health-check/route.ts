import { NextResponse } from 'next/server';

const SITES = [
    { name: 'Huttenhower Lab', url: 'https://huttenhower.sph.harvard.edu/', type: 'website' },
    { name: 'IBDMDB', url: 'https://ibdmdb.org/', type: 'website' },
    { name: 'IBDMDB Results', url: 'https://ibdmdb.org/results', type: 'website' },
    { name: 'BIOM-Mass', url: 'https://biom-mass.org/', type: 'website' },
    { name: 'Galaxy bioBakery', url: 'http://galaxy.biobakery.org/', type: 'website' },
    {
        name: 'General Biobakery Database',
        url: 'http://huttenhower.sph.harvard.edu/humann_data/chocophlan/',
        type: 'database',
    },
    { name: 'Microbiome Bioactives', url: 'https://microbiome-bioactives.org/', type: 'website' },
    { name: 'One Health Microbiome', url: 'https://onehealthmicrobiome.org/', type: 'website' },
    { name: 'bioBakery Forum', url: 'https://forum.biobakery.org/', type: 'website' },
] as const;

type SiteResult = {
    name: string;
    url: string;
    type: string;
    status: 'up' | 'down' | 'degraded';
    statusCode: number | null;
    responseTime: number;
    checkedAt: string;
    error?: string;
};

async function tryFetch(url: string, method: string, headers?: Record<string, string>, timeoutMs = 15_000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { method, headers, signal: controller.signal, redirect: 'follow' });
        clearTimeout(timeout);
        return { res, err: null as unknown };
    } catch (err) {
        clearTimeout(timeout);
        return { res: null, err };
    }
}

async function checkSite(site: (typeof SITES)[number]): Promise<SiteResult> {
    const start = Date.now();

    // Try HEAD first (15 s). Fall back to GET for ANY HEAD failure — including timeouts —
    // because some slow or proxy-protected sites drop HEAD but serve GET fine.
    let { res, err } = await tryFetch(site.url, 'HEAD', undefined, 15_000);

    const needsFallback = !res || res.status === 405 || res.status === 403;

    if (needsFallback) {
        // Databases: Range header avoids downloading large payloads
        const headers = site.type === 'database' ? { Range: 'bytes=0-0' } : undefined;
        // Give slow sites (e.g. onehealthmicrobiome.org) a generous timeout on GET
        const fb = await tryFetch(site.url, 'GET', headers, 30_000);
        if (fb.res) { res = fb.res; err = null; }
        else if (!err) err = fb.err;
    }

    const responseTime = Date.now() - start;

    if (res) {
        const isUp = res.ok || res.status === 206; // 206 = partial content from Range request
        const status: SiteResult['status'] = isUp ? 'up' : res.status >= 500 ? 'down' : 'degraded';
        return { name: site.name, url: site.url, type: site.type, status, statusCode: res.status, responseTime, checkedAt: new Date().toISOString() };
    }

    return {
        name: site.name,
        url: site.url,
        type: site.type,
        status: 'down',
        statusCode: null,
        responseTime,
        checkedAt: new Date().toISOString(),
        error: (err instanceof Error && (err as Error).name === 'AbortError') ? 'Request timed out' : err instanceof Error ? (err as Error).message : 'Unknown error',
    };
}

export async function GET() {
    const results = await Promise.all(SITES.map(checkSite));
    return NextResponse.json({ results, checkedAt: new Date().toISOString() });
}
