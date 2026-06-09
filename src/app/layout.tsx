import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "썸네일 툴",
  description: "이미지 리사이즈 & 썸네일 생성 도구",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="antialiased">
        <main className="px-4 py-6 min-h-screen">
          {children}
        </main>
      </body>
    </html>
  );
}
