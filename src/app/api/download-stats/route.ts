import { NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';

const CACHE_FILE = '/tmp/biobakery_stats.json';

export async function POST(request: Request) {
    const body = await request.json();
    await writeFile(CACHE_FILE, JSON.stringify(body), 'utf-8');
    return NextResponse.json({ ok: true });
}
