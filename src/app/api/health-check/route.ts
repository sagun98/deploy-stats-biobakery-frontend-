export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import https from 'node:https';
import http from 'node:http';

const SITES = [
    { name: 'Huttenhower Lab',          url: 'https://huttenhower.sph.harvard.edu/', type: 'website' },
    { name: 'IBDMDB',                   url: 'https://ibdmdb.org/',                  type: 'website' },
    { name: 'IBDMDB Results',           url: 'https://ibdmdb.org/results',           type: 'website' },
    { name: 'BIOM-Mass',                url: 'https://biom-mass.org/',               type: 'website' },
    { name: 'Galaxy bioBakery',         url: 'http://galaxy.biobakery.org/',         type: 'website' },
    { name: 'General Biobakery Database', url: 'http://huttenhower.sph.harvard.edu/humann_data/chocophlan/', type: 'database' },
    { name: 'Microbiome Bioactives',    url: 'https://microbiome-bioactives.org/',   type: 'website' },
    { name: 'One Health Microbiome',    url: 'https://onehealthmicrobiome.org/',     type: 'website' },
    { name: 'bioBakery Forum',          url: 'https://forum.biobakery.org/',         type: 'website' },
] as const;

type SiteResult = {
    name: string; url: string; type: string;
    status: 'up' | 'down' | 'degraded';
    statusCode: number | null;
    responseTime: number;
    checkedAt: string;
    error?: string;
};

// Use node:https/http directly so we can bypass Node's outdated CA bundle (e.g. Let's Encrypt R13).
// The site's certificate is valid — Node's bundled store just lags behind new intermediates.
function nodeRequest(
    url: string, method: string,
    extraHeaders: Record<string, string> = {},
    timeoutMs = 15_000,
): Promise<{ statusCode: number; responseTime: number }> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const u = new URL(url);
        const mod = u.protocol === 'https:' ? https : http;

        const req = mod.request(
            {
                hostname: u.hostname,
                path: u.pathname + (u.search ?? ''),
                method,
                headers: { 'User-Agent': 'BioBakery-Monitor/1.0', ...extraHeaders },
                rejectUnauthorized: false, // Node CA store may lag; cert validity checked separately
                timeout: timeoutMs,
            },
            (res) => {
                const responseTime = Date.now() - start;
                res.resume(); // discard body
                resolve({ statusCode: res.statusCode ?? 0, responseTime });
            },
        );
        req.on('timeout', () => req.destroy(Object.assign(new Error('AbortError'), { name: 'AbortError' })));
        req.on('error', reject);
        req.end();
    });
}

async function checkSite(site: (typeof SITES)[number]): Promise<SiteResult> {
    const start = Date.now();

    async function attempt(method: string, extraHeaders: Record<string, string> = {}, ms = 15_000) {
        try {
            const r = await nodeRequest(site.url, method, extraHeaders, ms);
            return { ...r, err: null };
        } catch (err) {
            return { statusCode: 0, responseTime: Date.now() - start, err };
        }
    }

    // Try HEAD; fall back to GET for 405 / 403 or any network error
    let r = await attempt('HEAD', {}, 15_000);
    if (r.err || r.statusCode === 405 || r.statusCode === 403) {
        const h: Record<string, string> = site.type === 'database' ? { Range: 'bytes=0-0' } : {};
        r = await attempt('GET', h, 30_000);
    }

    const responseTime = Date.now() - start;

    if (!r.err && r.statusCode > 0) {
        // 2xx / 206 / 3xx all mean the server is responding
        const isUp = r.statusCode < 400 || r.statusCode === 206;
        const status: SiteResult['status'] = isUp ? 'up' : r.statusCode >= 500 ? 'down' : 'degraded';
        return { name: site.name, url: site.url, type: site.type, status, statusCode: r.statusCode, responseTime, checkedAt: new Date().toISOString() };
    }

    const e = r.err as Error;
    return {
        name: site.name, url: site.url, type: site.type,
        status: 'down', statusCode: null, responseTime,
        checkedAt: new Date().toISOString(),
        error: e?.name === 'AbortError' ? 'Request timed out' : (e?.message ?? 'Unknown error'),
    };
}

export async function GET() {
    const results = await Promise.all(SITES.map(checkSite));
    return NextResponse.json({ results, checkedAt: new Date().toISOString() });
}
