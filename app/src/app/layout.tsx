import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Footer from "@/components/Footer";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Sinap-sys | AI政策管理SaaS",
  description: "日本の自治体・行政向けAI政策管理SaaS。PDCAサイクルに基づく政策管理・KPI管理・EBPMスコアリングを提供します。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen`}
        style={{ background: "#0f1117" }}
      >
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
