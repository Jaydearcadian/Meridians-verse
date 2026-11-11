import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityFeed } from '@/components/community/community-feed';

const useCommunityPosts = vi.fn();

vi.mock('@/hooks/use-community-posts', () => ({
  useCommunityPosts: () => useCommunityPosts(),
}));

describe('CommunityFeed', () => {
  beforeEach(() => {
    useCommunityPosts.mockReturnValue({
      posts: [
        {
          id: 1,
          title: 'A focused morning',
          content: 'A short story about focus.',
          postType: 'story',
          postStatus: 'Pusblish',
          publishedDate: '2026-10-10T00:00:00.000Z',
          imageUrl: null,
          author: { firstName: 'Ari', lastName: 'Kim' },
          tags: [{ name: 'focus' }],
        },
        {
          id: 2,
          title: 'Pool update',
          content: 'A community update.',
          postType: 'post',
          postStatus: 'publish',
          publishedDate: '2026-10-11T00:00:00.000Z',
          imageUrl: null,
          author: null,
          tags: [],
        },
      ],
      hasMore: false,
      isLoading: false,
      isLoadingMore: false,
      error: null,
      loadMoreError: null,
      refetch: vi.fn(),
      loadMore: vi.fn(),
    });
  });

  it('filters posts by type and search text', () => {
    render(<CommunityFeed />);

    fireEvent.click(screen.getByRole('button', { name: 'Stories' }));
    expect(screen.getByRole('heading', { name: 'A focused morning' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pool update' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All posts' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search community posts' }), {
      target: { value: 'pool' },
    });
    expect(screen.getByRole('heading', { name: 'Pool update' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'A focused morning' })).not.toBeInTheDocument();
  });
});