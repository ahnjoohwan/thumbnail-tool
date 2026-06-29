import type { Metadata } from "next";
import BulkClient from "./BulkClient";
import ContentSection from "@/components/ContentSection";
import { bulkContent } from "@/content/pages";

export const metadata: Metadata = {
  title: "이미지 대량 리사이즈",
  description:
    "여러 장의 상품 이미지를 같은 규격으로 한 번에 변환하고 ZIP으로 내려받는 무료 도구.",
};

export default function BulkPage() {
  return (
    <>
      <BulkClient />
      <ContentSection content={bulkContent} />
    </>
  );
}
