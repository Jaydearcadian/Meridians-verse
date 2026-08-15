import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'

// `display: 'swap'` keeps text visible with a fallback font while Geist
// loads, so web fonts never block first paint / LCP. (next/font defaults to
// swap; we set it explicitly to document the intent.)
const _geist = Geist({ subsets: ["latin"], display: "swap" });
const _geistMono = Geist_Mono({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: 'MERIDIAN - Where Effort Meets Value',
  description: 'A productivity-powered on-chain economy platform combining focus, payment streams, and yield opportunities.',
  generator: 'v0.app',
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
    { media: '(prefers-color-scheme: light)', color: '#fcfcfc' },
    { media: '(prefers-color-scheme: dark)', color: '#161616' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // suppressHydrationWarning is required by next-themes to avoid a
    // hydration mismatch when it writes the resolved theme class on
    // the <html> element during the initial client render.
    <html
      lang="en"
      className="bg-background"
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          storageKey="meridian-theme"
          themes={['light', 'dark', 'system']}
        >
          {children}
        </ThemeProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
