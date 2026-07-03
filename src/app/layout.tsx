import "~/styles/globals.css";

import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { Toaster } from "~/components/ui/sonner";
import { TooltipProvider } from "~/components/ui/tooltip";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
  title: "Magnetron",
  description: "Manual magnet intake for bitmagnet and qBittorrent.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={`${geist.variable} dark`} lang="en">
      <body className="antialiased">
        <TRPCReactProvider>
          <TooltipProvider>
            {children}
            <Toaster position="top-right" richColors />
          </TooltipProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
