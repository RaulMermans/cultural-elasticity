import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Newsreader, Outfit } from "next/font/google";
import "./globals.css";

const serif = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], display: "swap", variable: "--font-newsreader" });
const sans = Outfit({ subsets: ["latin"], display: "swap", variable: "--font-outfit" });

export const metadata: Metadata = {
  title: "Cultural Elasticity",
  description: "A cultural observatory. Investigate where a brand can stretch, grounded in observed evidence.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
