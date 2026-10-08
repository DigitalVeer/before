import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200"),
  title: "Before: the story before the hospital",
  description: "A voice agent turns witness accounts into source-linked timeline evidence. Explore the guided demo, inspect the sources, and try the evidence gate.",
  openGraph: {
    title: "Before: the story before the hospital",
    description: "Voice conversations. Traceable evidence. A clearer clinical timeline. Play the interactive synthetic demo.",
    type: "website",
    images: [{ url: "/social-preview.png", width: 1440, height: 900, alt: "Before: a voice conversation adds a source-linked baseline to a clinical timeline" }],
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
