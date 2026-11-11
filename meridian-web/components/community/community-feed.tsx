'use client';

import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { CommunityFeedEmpty } from '@/components/community/community-feed-empty';
import { CommunityFeedError } from '@/components/community/community-feed-error';
import { CommunityFeedSkeleton } from '@/components/community/community-feed-skeleton';
import { CommunityPostCard } from '@/components/community/community-post-card';
import { useCommunityPosts } from '@/hooks/use-community-posts';

type PostFilter = 'all' | 'story' | 'post';

const FILTERS: { id: PostFilter; label: string }[] = [
  { id: 'all', label: 'All posts' },
  { id: 'story', label: 'Stories' },
  { id: 'post', label: 'Updates' },
];

export function CommunityFeed() {
  const [filter, setFilter] = useState<PostFilter>('all');
  const [query, setQuery] = useState('');
  const {
    posts,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    loadMoreError,
    refetch,
    loadMore,
  } = useCommunityPosts();

  const normalizedQuery = query.trim().toLowerCase();
  const visiblePosts = posts.filter((post) => {
    if (filter !== 'all' && post.postType.toLowerCase() !== filter) return false;
    if (!normalizedQuery) return true;
    const searchableText = [
      post.title,
      post.content,
      post.author?.name,
      post.author?.username,
      post.author?.firstName,
      post.author?.lastName,
      ...post.tags.map((tag) => tag.name),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return searchableText.includes(normalizedQuery);
  });

  function clearFilters() {
    setFilter('all');
    setQuery('');
  }

  return (
    <section aria-label="Community feed">
      <div className="space-y-5 border-b border-border pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Member posts</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {posts.length > 0 ? `${posts.length} loaded` : 'Published stories and updates'}
            </p>
          </div>
          <div className="flex gap-1" role="group" aria-label="Filter by post type">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  filter === item.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <label htmlFor="community-search" className="sr-only">
            Search community posts
          </label>
          <input
            id="community-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search posts, members, or tags"
            className="h-11 w-full rounded-md border border-input bg-background pl-10 pr-10 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div aria-live="polite" className="min-h-24">
        {isLoading && <CommunityFeedSkeleton />}
        {!isLoading && error && <CommunityFeedError message={error} onRetry={refetch} />}
        {!isLoading && !error && visiblePosts.length === 0 && (
          <CommunityFeedEmpty filtered={posts.length > 0 || Boolean(query) || filter !== 'all'} onClear={clearFilters} />
        )}
        {!isLoading && !error && visiblePosts.length > 0 && (
          <div>
            {visiblePosts.map((post) => <CommunityPostCard key={post.id} post={post} />)}
            {hasMore && (
              <div className="py-6 text-center">
                {loadMoreError && <p role="alert" className="mb-3 text-sm text-destructive">{loadMoreError}</p>}
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="inline-flex min-h-10 items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {isLoadingMore ? 'Loading posts...' : loadMoreError ? 'Retry loading posts' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}