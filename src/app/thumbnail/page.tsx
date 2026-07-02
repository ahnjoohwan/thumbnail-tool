import type { Metadata } from "next";
import ThumbnailClient from "./ThumbnailClient";

export const metadata: Metadata = {
  title: "상품 썸네일 만들기",
  description:
    "상품을 중앙에 자동 정렬하고 흰색·회색 배경을 입혀 클릭을 부르는 대표 이미지를 만드는 무료 도구.",
};

export default function ThumbnailPage() {
  return (
    <ThumbnailClient />
  );
}
