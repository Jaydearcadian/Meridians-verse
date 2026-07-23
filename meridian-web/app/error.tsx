"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import Link from "next/link";

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Global error boundary — catches uncaught rendering errors and presents
 * a branded fallback with recovery options.
 *
 * Next.js automatically passes the `reset` function from the error boundary
 * lifecycle. Calling it attempts to re-render the errored segment.
 *
 * Design:
 *  • Brand-styled card with the MERIDIAN amber palette
 *  • Error toast logged via sonner for persistent notification
 *  • Console error logging for debugging
 *  • Two recovery paths: "Try Again" (reset) and "Go Home" (navigation)
 *  • Shows error digest if available for support reference
 */
export default function GlobalErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    // Log to console for development debugging
    console.error("[ErrorBoundary] Captured fault:", error);

    // Surface a persistent toast so users know something happened
    // even if they navigated away from the broken view
    toast.error("Something went wrong", {
      description: error.message || "An unexpected error occurred. Our team has been notified.",
      duration: 6000,
      closeButton: true,
    });
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <div className="max-w-lg w-full">
        {/* Icon with ring */}
        <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 ring-2 ring-destructive/20">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>

        {/* Error heading */}
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-foreground">
          Something went wrong
        </h1>

        <p className="mb-8 text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
          An unexpected error occurred while rendering this page. 
          You can try recovering, or head back to the homepage.
        </p>

        {/* Error digest for support reference */}
        {error.digest && (
          <div className="mb-6 inline-block rounded-lg bg-muted px-3 py-1.5">
            <code className="text-xs text-muted-foreground font-mono">
              Error ref: {error.digest}
            </code>
          </div>
        )}

        {/* Error message if safe to display */}
        {error.message && process.env.NODE_ENV === 'development' && (
          <div className="mb-8 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-left">
            <p className="text-xs font-mono text-destructive break-all">
              {error.message}
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button onClick={reset} variant="default" className="w-full sm:w-auto gap-2">
            <RefreshCw className="h-4 w-4" />
            Try Again
          </Button>
          <Link href="/" passHref>
            <Button variant="outline" className="w-full sm:w-auto gap-2">
              <Home className="h-4 w-4" />
              Go Home
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}