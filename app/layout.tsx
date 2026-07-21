import type { Metadata } from "next";
import { Onest, Unbounded } from "next/font/google";
import { getBaseUrl } from "@/lib/site";
import { organizationJsonLd, websiteJsonLd, jsonLdHtml } from "@/lib/jsonLd";
import { SiteFooter } from "@/components/SiteFooter";
import "./globals.css";

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
  // Domain ownership for Google Search Console and Bing Webmaster Tools. Paste
  // the tokens as env vars (GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION)
  // and Next emits the corresponding <meta> tags; DNS-TXT verification is an
  // alternative that needs no code. Omitted entirely when unset.
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION
      ? { google: process.env.GOOGLE_SITE_VERIFICATION }
      : {}),
    ...(process.env.BING_SITE_VERIFICATION
      ? { other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION } }
      : {}),
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
        {/* Site-wide brand identity for Google (knowledge panel / sitelinks). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(organizationJsonLd()) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(websiteJsonLd()) }}
        />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
