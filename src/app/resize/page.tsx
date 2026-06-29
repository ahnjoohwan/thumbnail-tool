import type { Metadata } from "next";
import ResizeClient from "./ResizeClient";
import ContentSection from "@/components/ContentSection";
import { resizeContent } from "@/content/pages";

export const metadata: Metadata = {
  title: "이미지 썸네일 리사이즈",
  description:
    "상품 사진 한 장을 원하는 채널 규격에 맞춰 배경과 여백을 자동으로 채워 리사이즈하는 무료 도구.",
};

export default function ResizePage() {
  return (
    <>
      <ResizeClient />
      <ContentSection content={resizeContent} />
    </>
  );
}
