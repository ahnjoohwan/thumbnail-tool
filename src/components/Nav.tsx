"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/resize", label: "이미지 리사이즈" },
  { href: "/thumbnail", label: "썸네일 만들기" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <header style={{
      position: "fixed", top: 0, left: 0, right: 0, height: 48, zIndex: 100,
      background: "rgba(255,255,255,0.85)",
      backdropFilter: "blur(20px) saturate(180%)",
      WebkitBackdropFilter: "blur(20px) saturate(180%)",
      borderBottom: "1px solid rgba(0,0,0,0.08)",
      display: "flex", alignItems: "center", padding: "0 24px", gap: 24,
    }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: "#1d1d1f", letterSpacing: "-0.01em" }}>
        이미지 툴
      </span>
      <nav style={{ display: "flex", gap: 2 }}>
        {tabs.map(tab => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link key={tab.href} href={tab.href} style={{
              padding: "5px 14px", borderRadius: 8, fontSize: 13,
              fontWeight: active ? 600 : 400,
              color: active ? "#0071E3" : "#6e6e73",
              textDecoration: "none",
              background: active ? "rgba(0,113,227,0.08)" : "transparent",
              transition: "all 0.15s",
            }}>
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
