import type { Metadata } from "next";
import { Onest, Unbounded } from "next/font/google";
import Script from "next/script";
import { GoogleAnalytics } from "@next/third-parties/google";
import { getBaseUrl } from "@/lib/site";
import { SiteFooter } from "@/components/SiteFooter";
import { WebVitals } from "@/components/WebVitals";
import "./globals.css";

// Google Analytics 4 measurement id (e.g. G-XXXXXXXXXX). Public by design and
// inlined at build time. Set only in the deploy environment — when absent
// (local dev, previews without the var) all analytics below no-op, so nothing
// loads and the console stays clean.
const gaId = process.env.NEXT_PUBLIC_GA_ID;

// Warm, rounded grotesk for body/UI text — a distinctive Inter alternative
// that still holds up at small sizes in dense filter rows and event cards.
const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin"],
});

// Blocky, geometric display face for headlines/wordmark — matches the bold
// poster-color palette instead of receding into a generic system sans.
const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin"],
});

const TITLE = "Whats Happenin — Local Events, Concerts & Things To Do";
const DESCRIPTION =
  "Discover things to do in your city: concerts, festivals, comedy, food & drink, arts, and more — aggregated daily and searchable by date and category.";

export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  title: {
    default: TITLE,
    template: "%s · Whats Happenin",
  },
  description: DESCRIPTION,
  applicationName: "Whats Happenin",
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Whats Happenin",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${onest.variable} ${unbounded.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {gaId && (
          // Consent Mode v2 defaults, set before gtag.js configures (this runs
          // beforeInteractive; GoogleAnalytics's config runs afterInteractive).
          // US-only posture today: analytics on, ads off. Structured so a
          // consent banner can later flip analytics_storage to 'denied' by
          // default and grant on opt-in — no re-plumbing required.
          <Script id="ga-consent-default" strategy="beforeInteractive">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'granted',
});`}
          </Script>
        )}
        {children}
        <SiteFooter />
        {gaId && <WebVitals />}
        {gaId && <GoogleAnalytics gaId={gaId} />}
      </body>
    </html>
  );
}
