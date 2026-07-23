import Link from "next/link";
import { ArrowLeft, Home, Bug } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Custom 404 Not Found page — branded fallback for unknown routes.
 *
 * Design:
 *  • Large "404" as a subtle brand accent (primary/20 opacity)
 *  • Clear explanation in brand voice
 *  • Two primary actions: Return Home / Go Back
 *  • Secondary action: Report an Issue (links to the real GitHub issues page)
 *  • Minimal, CLS-free layout — no async data dependencies
 */
export default function NotFoundState() {
  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 text-center">
      {/* Decorative 404 in brand color */}
      <div className="relative mb-8 select-none">
        <span className="text-[8rem] sm:text-[10rem] font-extrabold tracking-tight text-primary/10 leading-none">
          404
        </span>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-20 w-20 rounded-full bg-primary/5 ring-2 ring-primary/10 flex items-center justify-center">
            <span className="text-3xl">🔭</span>
          </div>
        </div>
      </div>

      <h1 className="mb-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        Page Not Found
      </h1>
      
      <p className="mb-2 max-w-md text-base text-muted-foreground leading-relaxed">
        The page you are looking for does not exist or has been moved to a 
        different orbit within the Meridian network.
      </p>
      
      <p className="mb-10 max-w-md text-sm text-muted-foreground">
        Check the URL for typos, or use the navigation below to find your way back.
      </p>

      {/* Primary actions */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full max-w-sm mx-auto">
        <Link href="/" className="w-full sm:w-auto" passHref>
          <Button variant="default" className="w-full gap-2">
            <Home className="h-4 w-4" />
            Return Home
          </Button>
        </Link>
        
        <Button
          variant="outline"
          className="w-full sm:w-auto gap-2"
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>
      </div>

      {/* Secondary action */}
      <div className="mt-12 border-t border-border pt-8 w-full max-w-sm mx-auto">
        <p className="mb-3 text-xs text-muted-foreground">
          Think this is a bug?
        </p>
        <a
          href="https://github.com/MERIDIAN-CITY/Meridians-verse/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors underline underline-offset-4"
        >
          <Bug className="h-3.5 w-3.5" />
          Report an Issue on GitHub
        </a>
      </div>
    </div>
  );
}