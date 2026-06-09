import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "이미지 툴",
  description: "이미지 리사이즈 & 썸네일 생성 도구",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Nav />
        <div style={{ paddingTop: 48 }}>{children}</div>
      </body>
    </html>
  );
}
