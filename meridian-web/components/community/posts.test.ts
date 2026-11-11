import { describe, expect, it } from 'vitest';
import {
  getCommunityAuthorName,
  normalizeCommunityPosts,
} from '@/lib/community/posts';

describe('normalizeCommunityPosts', () => {
  it('unwraps the API envelope and keeps only published posts', () => {
    const page = normalizeCommunityPosts({
      apiversion: '0.0.1',
      result: 1,
      data: {
        data: [
          {
            id: 8,
            title: 'Focus notes',
            postStatus: 'Pusblish',
            postType: 'story',
            content: 'A useful session.',
          },
          { id: 9, title: 'Draft', postStatus: 'draft' },
        ],
        nextCursor: 7,
        total: 14,
      },
    });

    expect(page.posts).toHaveLength(1);
    expect(page.posts[0].title).toBe('Focus notes');
    expect(page.nextCursor).toBe(7);
  });

  it('accepts a direct list and safely ignores malformed rows', () => {
    const page = normalizeCommunityPosts([
      { id: 3, title: 'Published', postStatus: 'published' },
      { id: 'bad', title: 'Malformed', postStatus: 'publish' },
    ]);

    expect(page.posts.map((post) => post.title)).toEqual(['Published']);
    expect(page.nextCursor).toBeNull();
  });
});

describe('getCommunityAuthorName', () => {
  it('uses the available public author name without exposing account details', () => {
    expect(getCommunityAuthorName({ firstName: 'Ari', lastName: 'Kim' })).toBe('Ari Kim');
    expect(getCommunityAuthorName(null)).toBe('Meridian member');
  });
});