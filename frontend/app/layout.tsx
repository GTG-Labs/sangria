import type { Metadata } from "next";
import { PT_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

import { RootProvider } from "fumadocs-ui/provider/next";

const ptSerif = PT_Serif({
  variable: "--font-pt-serif",
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sangria — HTTP-native Micropayments with x402",
  description:
    "A demo of the x402 payment protocol — HTTP-native micropayments using USDC on Base Sepolia.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        {/* Banking application - no third-party tracking for compliance and security */}
      </head>
      <body
        className={`${ptSerif.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <RootProvider theme={{ enabled: false }} search={{ enabled: false }}>
            {children}
        </RootProvider>
      </body>
    </html>
  );
}
