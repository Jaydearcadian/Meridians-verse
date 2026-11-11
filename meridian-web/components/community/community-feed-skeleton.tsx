export function CommunityFeedSkeleton() {
  return (
    <div role="status" aria-label="Loading community posts" className="space-y-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="animate-pulse border-y border-border py-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="size-10 rounded-full bg-muted" />
            <div className="space-y-2">
              <div className="h-3 w-28 rounded bg-muted" />
              <div className="h-3 w-20 rounded bg-muted" />
            </div>
          </div>
          <div className="mb-3 h-5 w-3/4 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
          <div className="mt-2 h-3 w-5/6 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}