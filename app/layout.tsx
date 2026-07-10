import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { getBaseUrl } from "@/lib/site";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const TITLE = "What It Do — Local Events, Concerts & Things To Do";
const DESCRIPTION =
  "Discover things to do in your city: concerts, festivals, comedy, food & drink, arts, and more — aggregated daily and searchable by date and category.";

export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  title: {
    default: TITLE,
    template: "%s · What It Do",
  },
  description: DESCRIPTION,
  applicationName: "What It Do",
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "What It Do",
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
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
