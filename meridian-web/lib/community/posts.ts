export interface CommunityAuthor {
  id?: number;
  name?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface CommunityTag {
  id?: number;
  name: string;
}

export interface CommunityPost {
  id: number;
  title: string;
  content: string;
  postType: string;
  postStatus: string;
  publishedDate: string | null;
  imageUrl: string | null;
  author: CommunityAuthor | null;
  tags: CommunityTag[];
}

export interface CommunityPostsPage {
  posts: CommunityPost[];
  nextCursor: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePost(value: unknown): CommunityPost | null {
  if (!isRecord(value) || typeof value.id !== 'number' || typeof value.title !== 'string') {
    return null;
  }

  const author = isRecord(value.author)
    ? {
        id: typeof value.author.id === 'number' ? value.author.id : undefined,
        name: typeof value.author.name === 'string' ? value.author.name : undefined,
        username: typeof value.author.username === 'string' ? value.author.username : undefined,
        firstName: typeof value.author.firstName === 'string' ? value.author.firstName : undefined,
        lastName: typeof value.author.lastName === 'string' ? value.author.lastName : undefined,
      }
    : null;

  const tags = Array.isArray(value.tags)
    ? value.tags.flatMap((tag): CommunityTag[] => {
        if (typeof tag === 'string') return [{ name: tag }];
        if (!isRecord(tag) || typeof tag.name !== 'string') return [];
        return [{ id: typeof tag.id === 'number' ? tag.id : undefined, name: tag.name }];
      })
    : [];

  return {
    id: value.id,
    title: value.title,
    content: typeof value.content === 'string' ? value.content : '',
    postType: typeof value.postType === 'string' ? value.postType : 'post',
    postStatus: typeof value.postStatus === 'string' ? value.postStatus : '',
    publishedDate: typeof value.publishedDate === 'string' ? value.publishedDate : null,
    imageUrl: typeof value.imageUrl === 'string' ? value.imageUrl : null,
    author,
    tags,
  };
}

export function isPublishedPost(post: CommunityPost): boolean {
  const status = post.postStatus.toLowerCase().replace(/[^a-z]/g, '');
  return status === 'publish' || status === 'published' || status === 'pusblish';
}

export function normalizeCommunityPosts(payload: unknown): CommunityPostsPage {
  let body: unknown = payload;
  if (isRecord(body) && 'apiversion' in body && 'data' in body) body = body.data;

  if (Array.isArray(body)) {
    return {
      posts: body.flatMap((item) => {
        const post = normalizePost(item);
        return post && isPublishedPost(post) ? [post] : [];
      }),
      nextCursor: null,
    };
  }

  if (!isRecord(body)) return { posts: [], nextCursor: null };

  const posts = Array.isArray(body.data)
    ? body.data.flatMap((item) => {
        const post = normalizePost(item);
        return post && isPublishedPost(post) ? [post] : [];
      })
    : [];

  return {
    posts,
    nextCursor: typeof body.nextCursor === 'number' ? body.nextCursor : null,
  };
}

export function getCommunityAuthorName(author: CommunityAuthor | null): string {
  if (!author) return 'Meridian member';
  const fullName = [author.firstName, author.lastName].filter(Boolean).join(' ').trim();
  return author.name || fullName || author.username || 'Meridian member';
}