"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

export default function AdSlot({ style }: { style?: React.CSSProperties }) {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  const slot = process.env.NEXT_PUBLIC_ADSENSE_SLOT;
  const insRef = useRef<HTMLModElement>(null);

  useEffect(() => {
    if (!client || !slot) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // adsbygoogle script not ready yet
    }
  }, [client, slot]);

  if (!client || !slot) return null;

  return (
    <ins
      ref={insRef}
      className="adsbygoogle"
      style={{ display: "block", ...style }}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}
