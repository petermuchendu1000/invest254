import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell } from '@/components/layout/AppShell';
import { Providers } from '@/components/Providers';
import { BrandProvider } from '@/lib/brand/BrandProvider';
import { brandRootStyle, brandWordmark } from '@/lib/brand/brand';
import { currentBrand } from '@/lib/brand/currentBrand';
import { googleFontsHref } from '@/lib/brand/fonts';
import { env } from '@/lib/env';
import { chartStyleOf, tradingViewTypeOf } from '@invest254/shared/chart';
import { registerOf } from '@/lib/ui/register';

// Cloudflare Pages runs on the edge; per-request per-brand SSR (Task G) makes every route dynamic,
// so the whole app must opt into the Edge runtime. Set on the root layout -> cascades to all routes.
export const runtime = 'edge';

// Per-brand document metadata: title/description/icons/theme-colour all come from the resolved
// brand, so one deployment serves each domain its own identity (no rebuild per brand).
export async function generateMetadata(): Promise<Metadata> {
  const b = await currentBrand();
  const name = brandWordmark(b);
  return {
    title: { default: b.name, template: `%s · ${b.name}` },
    // The product this brand actually is. A brand whose shell is the MetaTrader terminal is a
    // broker, and describing it as a prediction game put the wrong product in its page metadata,
    // its manifest and every search and social preview of it. See lib/ui/register.
    description: registerOf(tradingViewTypeOf(chartStyleOf(b.chartStyle)) !== null) === 'trading'
      ? `${b.name}: a trading terminal for synthetic instruments. Live charts, market execution, server-side stops.`
      : `${b.name}: real-money trade-prediction game. Predict BUY/SELL on the live curve.`,
    applicationName: b.name,
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: b.name },
    icons: b.faviconUrl
      ? { icon: [{ url: b.faviconUrl }], apple: [{ url: b.faviconUrl }] }
      : {
          icon: [{ url: '/favicon.png', type: 'image/png' }],
          apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
        },
    other: { 'brand-wordmark': name },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const b = await currentBrand();
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor: b.colorBg,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await currentBrand();
  // Brand default theme seeds the class; a stored user preference (pp-theme) still wins, applied
  // before paint to avoid a flash. 'auto'/'dark' → dark-first; 'light' → light.
  const brandDefaultTheme = brand.theme === 'light' ? 'light' : 'dark';
  const initialClass = brandDefaultTheme === 'light' ? 'light' : 'dark';
  const themeInit = `(function(){try{var d=${JSON.stringify(brandDefaultTheme)};var s=localStorage.getItem('pp-theme');var t=s||d;var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(t==='light'?'light':'dark');var p=localStorage.getItem('pp-pnl');if(p==='classic')e.classList.add('pnl-classic');else e.classList.remove('pnl-classic');}catch(e){}})();`;
  // Load the brand's title + body + mono faces from Google Fonts (empty when the brand sets none).
  const fontHref = googleFontsHref([
    brand.themeTokens?.fontTitle ?? '',
    brand.themeTokens?.fontBody ?? '',
    brand.themeTokens?.fontMono ?? '',
  ]);

  return (
    <html lang="en" className={initialClass} data-brand={brand.slug} data-brand-resolved={String(brand.resolved ?? false)} style={brandRootStyle(brand) as React.CSSProperties}>
      <head>
        {fontHref ? (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            <link rel="stylesheet" href={fontHref} />
          </>
        ) : null}
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <BrandProvider brand={brand}>
          <Providers>
            <AppShell>{children}</AppShell>
          </Providers>
        </BrandProvider>
      </body>
    </html>
  );
}
