import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { PerformanceMonitor } from '@/components/performance-monitor'
import { MotionConfig } from 'framer-motion'

const _geist = Geist({ subsets: ["latin"], display: "swap", preload: true });
const _geistMono = Geist_Mono({ subsets: ["latin"], display: "swap", preload: true });

export const metadata: Metadata = {
  title: 'MERIDIAN - Where Effort Meets Value',
  description:
    'A productivity-powered on-chain economy platform combining focus, payment streams, and yield opportunities.',
  generator: 'v0.app',
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://meridian.app',
  ),
  openGraph: {
    title: 'MERIDIAN - Where Effort Meets Value',
    description:
      'Earn by staying focused, stream payments in real-time, and participate in yield pools with zero loss.',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MERIDIAN - Where Effort Meets Value',
    description:
      'Earn by staying focused, stream payments in real-time, and participate in yield pools with zero loss.',
  },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className="bg-background"
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          storageKey="meridian-theme"
          themes={['light', 'dark', 'system']}
        >
          <MotionConfig reducedMotion="user">
            {children}
          </MotionConfig>
          <Toaster />
          <PerformanceMonitor />
        </ThemeProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
        <PerformanceMonitor />
      </body>
    </html>
  )
}
