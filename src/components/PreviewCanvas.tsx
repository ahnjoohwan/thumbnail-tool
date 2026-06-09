"use client";
import { useRef, useEffect } from "react";

type ImgState = { x: number; y: number; scale: number };

interface Props {
  imgEl: HTMLImageElement;
  natDims: { w: number; h: number };
  state: ImgState;
  outW: number;
  outH: number;
  pDs: number;
  bgColor: string;
  shadowEnabled?: boolean;
  shadowBlur?: number;
}

export default function PreviewCanvas({ imgEl, natDims, state, outW, outH, pDs, bgColor, shadowEnabled, shadowBlur = 20 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = Math.round(outW * pDs);
    const h = Math.round(outH * pDs);
    canvas.width = w;
    canvas.height = h;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    if (shadowEnabled) {
      ctx.shadowColor = "rgba(0,0,0,0.30)";
      ctx.shadowBlur = shadowBlur * pDs;
      ctx.shadowOffsetY = Math.round(shadowBlur * 0.4 * pDs);
    }

    ctx.drawImage(
      imgEl, 0, 0, imgEl.naturalWidth, imgEl.naturalHeight,
      state.x * pDs, state.y * pDs,
      natDims.w * state.scale * pDs,
      natDims.h * state.scale * pDs
    );
  }, [imgEl, state, outW, outH, pDs, bgColor, natDims, shadowEnabled, shadowBlur]);

  return <canvas ref={ref} style={{ display: "block" }} />;
}
