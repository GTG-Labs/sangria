import type { Metadata } from "next";
import { IBM_Plex_Sans, PT_Serif, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

import { RootProvider } from "fumadocs-ui/provider/next";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

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
        <Script
          id="apollo-tracker"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              function initApollo(){
                var n=Math.random().toString(36).substring(7),
                    o=document.createElement("script");
                o.src="https://assets.apollo.io/micro/website-tracker/tracker.iife.js?nocache="+n;
                o.async=true;
                o.defer=true;
                o.onload=function(){
                  window.trackingFunctions.onLoad({appId:"69e6b9192b847900152bd1e6"})
                };
                document.head.appendChild(o)
              }
              initApollo();
            `,
          }}
        />
      </head>
      <body
        className={`${ibmPlexSans.variable} ${ptSerif.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <RootProvider theme={{ enabled: false }} search={{ enabled: false }}>
            {children}
        </RootProvider>
      </body>
    </html>
  );
}
