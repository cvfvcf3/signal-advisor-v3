import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signal Advisor v3",
  description:
    "Read-only multi-coin, multi-mode crypto signal engine with 5-layer confluence analysis.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
