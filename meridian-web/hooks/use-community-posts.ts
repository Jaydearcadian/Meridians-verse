'use client';

import { useEffect, useState } from 'react';
import type { CommunityPost, CommunityPostsPage } from '@/lib/community/posts';

interface UseCommunityPostsResult {
  posts: CommunityPost[];
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  loadMoreError: string | null;
  refetch: () => void;
  loadMore: () => Promise<void>;
}

const PAGE_SIZE = 8;

async function requestPosts(cursor?: number, signal?: AbortSignal): Promise<CommunityPostsPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor !== undefined) params.set('cursor', String(cursor));

  const response = await fetch(`/api/community/posts?${params}`, { signal });
  const result = (await response.json()) as CommunityPostsPage | { error?: string };
  if (!response.ok) {
    throw new Error('error' in result && result.error ? result.error : 'Unable to load posts.');
  }
  if (!('posts' in result) || !Array.isArray(result.posts)) {
    throw new Error('The community service returned an invalid response.');
  }
  return result;
}

export function useCommunityPosts(): UseCommunityPostsResult {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    setLoadMoreError(null);

    requestPosts(undefined, controller.signal)
      .then((page) => {
        setPosts(page.posts);
        setNextCursor(page.nextCursor);
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Unable to load posts.');
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [requestKey]);

  async function loadMore() {
    if (nextCursor === null || isLoadingMore) return;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await requestPosts(nextCursor);
      setPosts((current) => {
        const existingIds = new Set(current.map((post) => post.id));
        return [...current, ...page.posts.filter((post) => !existingIds.has(post.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setLoadMoreError(cause instanceof Error ? cause.message : 'Unable to load more posts.');
    } finally {
      setIsLoadingMore(false);
    }
  }

  return {
    posts,
    hasMore: nextCursor !== null,
    isLoading,
    isLoadingMore,
    error,
    loadMoreError,
    refetch: () => setRequestKey((key) => key + 1),
    loadMore,
  };
}