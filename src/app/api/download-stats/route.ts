import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'fs/promises';

const CACHE_FILE = '/tmp/biobakery_stats.json';

export async function GET() {
    try {
        const raw = await readFile(CACHE_FILE, 'utf-8');
        return NextResponse.json(JSON.parse(raw));
    } catch {
        return NextResponse.json({ stats: null, last_update: null }, { status: 404 });
    }
}

export async function POST(request: Request) {
    const body = await request.json();
    await writeFile(CACHE_FILE, JSON.stringify(body), 'utf-8');
    return NextResponse.json({ ok: true });
}
