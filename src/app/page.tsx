import ResizeClient from "./resize/ResizeClient";
import ContentSection from "@/components/ContentSection";
import { homeContent } from "@/content/pages";

export default function Home() {
  return (
    <>
      <ResizeClient />
      <ContentSection content={homeContent} />
    </>
  );
}
