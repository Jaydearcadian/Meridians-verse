import { CommunityFeedSkeleton } from '@/components/community/community-feed-skeleton';

export default function CommunityLoading() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 h-9 w-64 animate-pulse rounded bg-muted" />
      <CommunityFeedSkeleton />
    </main>
  );
}