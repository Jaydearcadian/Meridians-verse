import type { Metadata } from 'next';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { CommunityFeed } from '@/components/community/community-feed';
import { CommunitySidebar } from '@/components/community/community-sidebar';

export const metadata: Metadata = {
  title: 'Community | Meridian',
  description: 'Stories, ideas, and progress shared by the Meridian community.',
};

export default function CommunityPage() {
  return (
    <>
      <Header />
      <main className="min-h-screen pt-16">
        <div className="border-b border-border bg-muted/30">
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
            <p className="text-sm font-semibold uppercase text-primary">Together, in motion</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight sm:text-4xl">
              Meridian Community
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              Notes from people turning focus into progress. Read the latest stories and updates.
            </p>
          </div>
        </div>

        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-16 lg:px-8 lg:py-12">
          <CommunityFeed />
          <CommunitySidebar />
        </div>
      </main>
      <Footer />
    </>
  );
}