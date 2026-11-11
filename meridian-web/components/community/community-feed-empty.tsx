import Link from 'next/link';
import { MessagesSquare, SearchX } from 'lucide-react';

interface CommunityFeedEmptyProps {
  filtered?: boolean;
  onClear?: () => void;
}

export function CommunityFeedEmpty({ filtered = false, onClear }: CommunityFeedEmptyProps) {
  const Icon = filtered ? SearchX : MessagesSquare;

  return (
    <div className="border-y border-dashed border-border py-14 text-center">
      <Icon className="mx-auto mb-4 size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-lg font-semibold">
        {filtered ? 'No posts match these filters' : 'The community is just getting started'}
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        {filtered
          ? 'Try another phrase or switch to a different post type.'
          : 'Published stories and updates from Meridian members will appear here.'}
      </p>
      {filtered ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-5 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Clear filters
        </button>
      ) : (
        <Link
          href="/auth/register"
          className="mt-5 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Join Meridian
        </Link>
      )}
    </div>
  );
}