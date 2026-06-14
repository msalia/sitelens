import type { Metadata, Viewport } from 'next';

import { Geist_Mono, Inter } from 'next/font/google';
import { Toaster } from 'sonner';

import { JsonLd } from '@/components/json-ld';
import { ThemeProvider } from '@/components/theme-provider';
import {
  absoluteUrl,
  ORG_NAME,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from '@/lib/site';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  applicationName: SITE_NAME,
  authors: [{ name: ORG_NAME }],
  category: 'technology',
  creator: ORG_NAME,
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  metadataBase: new URL(SITE_URL),
  openGraph: {
    description: SITE_DESCRIPTION,
    locale: 'en_US',
    siteName: SITE_NAME,
    title: SITE_TITLE,
    type: 'website',
    url: '/',
  },
  publisher: ORG_NAME,
  robots: {
    follow: true,
    googleBot: {
      follow: true,
      index: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
    index: true,
  },
  title: {
    default: SITE_TITLE,
    template: `%s — ${SITE_NAME}`,
  },
  twitter: {
    card: 'summary_large_image',
    description: SITE_DESCRIPTION,
    title: SITE_TITLE,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { color: '#070b16', media: '(prefers-color-scheme: dark)' },
    { color: '#ffffff', media: '(prefers-color-scheme: light)' },
  ],
};

/** Site-wide structured data: the publishing Organization and a WebSite entity.
 *  Page-specific schemas (SoftwareApplication, BreadcrumbList) are added per page. */
const ORGANIZATION_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  brand: SITE_NAME,
  logo: absoluteUrl('/icon.svg'),
  name: ORG_NAME,
  url: SITE_URL,
};

const WEBSITE_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  description: SITE_DESCRIPTION,
  name: SITE_NAME,
  url: SITE_URL,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <JsonLd data={[ORGANIZATION_JSONLD, WEBSITE_JSONLD]} />
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
