import { getCommunityAuthorName, type CommunityPost } from '@/lib/community/posts';

function formatPublishedDate(value: string | null): string {
  if (!value) return 'Publication date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Publication date unavailable';
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);
}

export function CommunityPostCard({ post }: { post: CommunityPost }) {
  const authorName = getCommunityAuthorName(post.author);
  const initials = authorName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <article aria-labelledby={`post-title-${post.id}`} className="border-y border-border py-6">
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-bold text-foreground"
        >
          {initials || 'M'}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{authorName}</p>
          <time
            dateTime={post.publishedDate ?? undefined}
            className="text-xs text-muted-foreground"
          >
            {formatPublishedDate(post.publishedDate)}
          </time>
        </div>
        <span className="ml-auto shrink-0 rounded-sm bg-muted px-2 py-1 text-xs capitalize text-muted-foreground">
          {post.postType}
        </span>
      </div>

      <h2 id={`post-title-${post.id}`} className="mt-5 text-lg font-semibold leading-snug">
        {post.title}
      </h2>
      {post.content && (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
          {post.content}
        </p>
      )}

      {post.tags.length > 0 && (
        <ul aria-label="Post tags" className="mt-4 flex flex-wrap gap-2">
          {post.tags.map((tag, index) => (
            <li
              key={tag.id ?? `${post.id}-${tag.name}-${index}`}
              className="text-xs font-medium text-primary"
            >
              #{tag.name}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}