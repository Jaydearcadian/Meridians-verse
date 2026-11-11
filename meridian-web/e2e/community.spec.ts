import { expect, test } from '@playwright/test';

test.describe('Community feed', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/community/posts**', async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      const posts = cursor
        ? [
            {
              id: 3,
              title: 'A second week of focus',
              content: 'Small habits are adding up.',
              postType: 'story',
              postStatus: 'Pusblish',
              publishedDate: '2026-10-12T00:00:00.000Z',
              author: { firstName: 'Sam', lastName: 'Lee' },
              tags: [{ name: 'habits' }],
            },
          ]
        : [
            {
              id: 2,
              title: 'Pool update',
              content: 'A new community update.',
              postType: 'post',
              postStatus: 'publish',
              publishedDate: '2026-10-11T00:00:00.000Z',
              author: { firstName: 'Mina', lastName: 'Ray' },
              tags: [{ name: 'pool' }],
            },
            {
              id: 1,
              title: 'A focused morning',
              content: 'A short story about focus.',
              postType: 'story',
              postStatus: 'Pusblish',
              publishedDate: '2026-10-10T00:00:00.000Z',
              author: { firstName: 'Ari', lastName: 'Kim' },
              tags: [{ name: 'focus' }],
            },
          ];

      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ posts, nextCursor: cursor ? null : 1 }),
      });
    });
    await page.goto('/community');
  });

  test('searches and filters published posts', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'A focused morning' })).toBeVisible();
    await page.getByRole('button', { name: 'Stories' }).click();
    await expect(page.getByRole('heading', { name: 'Pool update' })).toHaveCount(0);

    await page.getByRole('button', { name: 'All posts' }).click();
    await page.getByRole('searchbox', { name: 'Search community posts' }).fill('pool');
    await expect(page.getByRole('heading', { name: 'Pool update' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'A focused morning' })).toHaveCount(0);
  });

  test('loads the next cursor page', async ({ page }) => {
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByRole('heading', { name: 'A second week of focus' })).toBeVisible();
  });
});