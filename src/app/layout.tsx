import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "이미지 툴",
  description: "이미지 리사이즈 & 썸네일 생성 도구",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const adsenseClient = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;

  return (
    <html lang="ko">
      {adsenseClient && (
        <head>
          <script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient}`}
            crossOrigin="anonymous"
          />
        </head>
      )}
      <body>
        <Nav />
        <div style={{ paddingTop: 48 }}>{children}</div>
      </body>
    </html>
  );
}
