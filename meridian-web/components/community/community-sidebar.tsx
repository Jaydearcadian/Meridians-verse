import Link from 'next/link';
import { ArrowUpRight, Focus, ShieldCheck } from 'lucide-react';

export function CommunitySidebar() {
  return (
    <aside className="space-y-8 lg:sticky lg:top-24 lg:self-start">
      <section className="border-t-2 border-primary pt-4">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Meridian community</p>
        <h2 className="mt-3 text-xl font-semibold leading-snug">Small steps, shared momentum.</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Share progress, exchange ideas, and keep building a more focused economy together.
        </p>
        <Link
          href="/auth/register"
          className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Join Meridian <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </section>

      <section className="border-t border-border pt-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          Community standards
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Keep discussions constructive, respect other members, and never share private keys or
          recovery phrases.
        </p>
      </section>

      <Link
        href="/#focus"
        className="flex items-start gap-3 border-t border-border pt-4 text-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Focus className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          <span className="block font-semibold">Back to focus</span>
          <span className="mt-1 block text-muted-foreground">Explore the Meridian experience.</span>
        </span>
      </Link>
    </aside>
  );
}