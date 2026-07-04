import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getBaseUrl } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = "What It Do ATX — Austin Events, Concerts & Things To Do";
const DESCRIPTION =
  "Discover things to do in Austin: concerts, festivals, comedy, food & drink, arts, and more — aggregated daily from across the city and searchable by date and category.";

export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  title: {
    default: TITLE,
    template: "%s · What It Do ATX",
  },
  description: DESCRIPTION,
  applicationName: "What It Do ATX",
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "What It Do ATX",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
