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
    /**
     * The soft keyboard must SHRINK the layout, not slide over it.
     *
     * The default, `resizes-visual`, leaves the layout viewport at its full height when the
     * keyboard opens. Every full-height surface in this app is `fixed inset-0` or `h-dvh`, so they
     * all kept their pre-keyboard height and the keyboard simply covered the bottom of them — and
     * on the phone order ticket the bottom is the SELL and BUY row, which sits outside the
     * scrolling area precisely so that it is always reachable. Typing a volume therefore hid the
     * two buttons the screen exists for, with no scroll able to bring them back.
     */
    interactiveWidget: 'resizes-content',
    themeColor: b.colorBg,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await currentBrand();
  // Brand default theme seeds the class; a stored user preference (pp-theme) still wins, applied
  // before paint to avoid a flash. 'auto'/'dark' → dark-first; 'light' → light.
  const brandDefaultTheme = brand.theme === 'light' ? 'light' : 'dark';
  const initialClass = brandDefaultTheme === 'light' ? 'light' : 'dark';
  /**
   * Which mode the brand's OWN palette was authored for.
   *
   * A brand supplies one set of greys, and they are the greys of its own theme. When the trader
   * asks for the other mode those greys are the wrong ones, and feeding them through anyway is
   * exactly why "light mode" looked like nothing had happened: `--pp-bg` resolves
   * `var(--brand-bg, <light fallback>)`, `--brand-bg` is always set inline on this element, so the
   * fallback is never reached and the page stayed the brand's dark colour under a light class.
   *
   * This class lets the stylesheet tell the two cases apart: in the brand's own mode its palette is
   * used, and in the other mode the published neutral palette is. The brand's identity tokens (its
   * accent, its hue, its type and its radius) are brand-driven in BOTH modes, because those are the
   * brand rather than the theme.
   */
  const brandPaletteClass = brandDefaultTheme === 'light' ? 'brand-light' : 'brand-dark';
  /**
   * The stored theme, applied before the first paint so there is no flash of the other one.
   *
   * It no longer touches `pnl-classic`. That class was written here and by a `PnlColorToggle`
   * component, and read by NO stylesheet rule anywhere: a profit/loss colour setting that could not
   * change a colour. The component was also mounted nowhere, so the only trace of the feature was
   * this line keeping a meaningless class in sync. Both are gone. MetaTrader's own answer to
   * "which colours" is the chart's Colors tab, which this terminal has with its four schemes.
   */
  const themeInit = `(function(){try{var d=${JSON.stringify(brandDefaultTheme)};var s=localStorage.getItem('pp-theme');var t=s||d;var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(t==='light'?'light':'dark');}catch(e){}})();`;
  // Load the brand's title + body + mono faces from Google Fonts (empty when the brand sets none).
  const fontHref = googleFontsHref([
    brand.themeTokens?.fontTitle ?? '',
    brand.themeTokens?.fontBody ?? '',
    brand.themeTokens?.fontMono ?? '',
  ]);

  return (
    <html lang="en" className={`${initialClass} ${brandPaletteClass}`} data-brand={brand.slug} data-brand-resolved={String(brand.resolved ?? false)} style={brandRootStyle(brand) as React.CSSProperties}>
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
