import { NextRequest, NextResponse } from 'next/server';
import { normalizeCommunityPosts } from '@/lib/community/posts';

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

export async function GET(request: NextRequest) {
  const apiBase = process.env.MERIDIAN_API_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!apiBase) {
    return NextResponse.json(
      { error: 'Community posts are unavailable because the API is not configured.' },
      { status: 503 },
    );
  }

  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isInteger(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, MAX_LIMIT))
    : DEFAULT_LIMIT;
  const cursorParam = request.nextUrl.searchParams.get('cursor');
  const cursor = cursorParam ? Number(cursorParam) : undefined;
  if (cursorParam && (!Number.isInteger(cursor) || (cursor ?? 0) < 1)) {
    return NextResponse.json({ error: 'Invalid cursor.' }, { status: 400 });
  }

  try {
    const url = new URL('/v1/posts', apiBase);
    url.searchParams.set('limit', String(limit));
    if (cursor !== undefined) url.searchParams.set('cursor', String(cursor));

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Unable to load community posts.' },
        { status: response.status >= 500 ? 502 : response.status },
      );
    }

    const page = normalizeCommunityPosts(await response.json());
    return NextResponse.json(page, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Unable to reach the community service. Please try again.' },
      { status: 502 },
    );
  }
}