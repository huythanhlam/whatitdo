import type { Metadata } from "next";
import { Onest, Unbounded } from "next/font/google";
import { getBaseUrl } from "@/lib/site";
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
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
