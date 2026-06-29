import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: {
    default: "이미지 툴 — 온라인 셀러용 무료 썸네일·리사이즈 도구",
    template: "%s | 이미지 툴",
  },
  description:
    "스마트스토어·쿠팡·자사몰 상품 이미지를 채널 규격에 맞춰 리사이즈하고 썸네일을 만드는 무료 웹 도구. 설치 없이 브라우저에서 바로 사용하세요.",
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
