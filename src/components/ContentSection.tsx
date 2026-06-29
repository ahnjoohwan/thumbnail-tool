// 도구 아래에 노출되는 가이드/콘텐츠 영역.
// 서버 컴포넌트로 렌더되어 초기 HTML에 텍스트가 그대로 담긴다
// (검색 노출 및 광고 게재를 위한 게시자 콘텐츠).

import type { ReactNode } from "react";

export type FaqItem = { q: string; a: string };
export type Section = { h: string; body: ReactNode };

export type PageContent = {
  /** 페이지 대제목 (h1) */
  title: string;
  /** 한 줄 소개 */
  lead: string;
  /** 본문 섹션들 (h2 + 내용) */
  sections: Section[];
  /** 자주 묻는 질문 */
  faq: FaqItem[];
};

const wrap: React.CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "64px 24px 96px",
  color: "#1d1d1f",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif",
  lineHeight: 1.7,
};

const h1: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  letterSpacing: "-0.02em",
  marginBottom: 12,
};

const lead: React.CSSProperties = {
  fontSize: 17,
  color: "#6e6e73",
  marginBottom: 48,
};

const h2: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  marginTop: 40,
  marginBottom: 12,
};

const p: React.CSSProperties = {
  fontSize: 15,
  color: "#3c3c43",
  marginBottom: 14,
};

const faqWrap: React.CSSProperties = {
  marginTop: 16,
  borderTop: "1px solid rgba(0,0,0,0.08)",
};

const faqItem: React.CSSProperties = {
  padding: "18px 0",
  borderBottom: "1px solid rgba(0,0,0,0.08)",
};

const faqQ: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  marginBottom: 6,
  color: "#1d1d1f",
};

const faqA: React.CSSProperties = {
  fontSize: 14,
  color: "#6e6e73",
  margin: 0,
};

export default function ContentSection({ content }: { content: PageContent }) {
  return (
    <section
      style={{ background: "#fff", borderTop: "1px solid rgba(0,0,0,0.08)" }}
    >
      <article style={wrap}>
        <h1 style={h1}>{content.title}</h1>
        <p style={lead}>{content.lead}</p>

        {content.sections.map((s, i) => (
          <div key={i}>
            <h2 style={h2}>{s.h}</h2>
            <div style={p}>{s.body}</div>
          </div>
        ))}

        <h2 style={h2}>자주 묻는 질문</h2>
        <div style={faqWrap}>
          {content.faq.map((f, i) => (
            <div key={i} style={faqItem}>
              <p style={faqQ}>{f.q}</p>
              <p style={faqA}>{f.a}</p>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

// 본문 단락 헬퍼 (data 파일에서 사용)
export function P({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontSize: 15, color: "#3c3c43", marginBottom: 14 }}>{children}</p>
  );
}

const ulStyle: React.CSSProperties = {
  fontSize: 15,
  color: "#3c3c43",
  marginBottom: 14,
  paddingLeft: 20,
};

export function UL({ items }: { items: ReactNode[] }) {
  return (
    <ul style={ulStyle}>
      {items.map((it, i) => (
        <li key={i} style={{ marginBottom: 6 }}>
          {it}
        </li>
      ))}
    </ul>
  );
}
