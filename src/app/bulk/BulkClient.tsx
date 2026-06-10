"use client";

import { useState, useRef, useCallback } from "react";
import JSZip from "jszip";
import PreviewCanvas from "@/components/PreviewCanvas";

type ImgState = { x: number; y: number; scale: number };
type ResizeMode = "cutout" | "scene";
type ContentBounds = { x: number; y: number; w: number; h: number };
type SizePreset = { key: string; w: number; h: number; label: string };

const SIZE_PRESETS: SizePreset[] = [
  { label: "1000×1000", w: 1000, h: 1000, key: "1000x1000" },
  { label: "1600×1600", w: 1600, h: 1600, key: "1600x1600" },
  { label: "750×750",   w: 750,  h: 750,  key: "750x750"   },
  { label: "1000×1200", w: 1000, h: 1200, key: "1000x1200" },
  { label: "960×1280",  w: 960,  h: 1280, key: "960x1280"  },
  { label: "1080×1296", w: 1080, h: 1296, key: "1080x1296" },
  { label: "1500×2000", w: 1500, h: 2000, key: "1500x2000" },
  { label: "640×320",   w: 640,  h: 320,  key: "640x320"   },
  { label: "550×708",   w: 550,  h: 708,  key: "550x708"   },
  { label: "1010×473",  w: 1010, h: 473,  key: "1010x473"  },
];

const APPLE_BLUE = "#0071E3";

function detectBgColor(img: HTMLImageElement): string {
  try {
    const scale = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const s = Math.max(3, Math.round(Math.min(w, h) * 0.05));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "#ffffff";
    ctx.drawImage(img, 0, 0, w, h);
    const regions = [
      ctx.getImageData(0, 0, s, s),
      ctx.getImageData(w - s, 0, s, s),
      ctx.getImageData(0, h - s, s, s),
      ctx.getImageData(w - s, h - s, s, s),
    ];
    let r = 0, g = 0, b = 0, count = 0;
    for (const reg of regions)
      for (let i = 0; i < reg.data.length; i += 4) { r += reg.data[i]; g += reg.data[i + 1]; b += reg.data[i + 2]; count++; }
    return `rgb(${Math.round(r / count)},${Math.round(g / count)},${Math.round(b / count)})`;
  } catch { return "#ffffff"; }
}

function detectContentBounds(img: HTMLImageElement, bgColor: string, threshold = 15): ContentBounds | null {
  try {
    const sampleScale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
    const sw = Math.round(img.naturalWidth * sampleScale);
    const sh = Math.round(img.naturalHeight * sampleScale);
    const canvas = document.createElement("canvas");
    canvas.width = sw; canvas.height = sh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, sw, sh);
    const { data } = ctx.getImageData(0, 0, sw, sh);
    const m = bgColor.match(/\d+/g);
    if (!m || m.length < 3) return null;
    const [br, bg, bb] = m.map(Number);
    const rowCounts = new Int32Array(sh);
    const colCounts = new Int32Array(sw);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) * 4;
        if (data[i + 3] < 128) continue;
        const diff = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg) + Math.abs(data[i + 2] - bb);
        if (diff > threshold) { rowCounts[y]++; colCounts[x]++; }
      }
    const maxRow = rowCounts.reduce((a, b) => Math.max(a, b), 0);
    const maxCol = colCounts.reduce((a, b) => Math.max(a, b), 0);
    const minR = Math.max(3, Math.round(maxRow * 0.15));
    const minC = Math.max(3, Math.round(maxCol * 0.15));
    let minY = -1, maxY = -1, minX = -1, maxX = -1;
    for (let y = 0; y < sh; y++) if (rowCounts[y] >= minR) { if (minY < 0) minY = y; maxY = y; }
    for (let x = 0; x < sw; x++) if (colCounts[x] >= minC) { if (minX < 0) minX = x; maxX = x; }
    if (minX < 0 || minY < 0) return null;
    return {
      x: Math.floor(minX / sampleScale),
      y: Math.floor(minY / sampleScale),
      w: Math.ceil((maxX - minX + 1) / sampleScale),
      h: Math.ceil((maxY - minY + 1) / sampleScale),
    };
  } catch { return null; }
}

function makeInitialState(
  natW: number, natH: number, outW: number, outH: number,
  cover: boolean, cb?: ContentBounds | null, margin = 0.08
): ImgState {
  if (cb && !cover) {
    const scale = Math.min(
      outW * (1 - 2 * margin) / cb.w,
      outH * (1 - 2 * margin) / cb.h,
      Math.max(outW / natW, outH / natH) * 4
    );
    const cx = cb.x + cb.w / 2;
    const cy = cb.y + cb.h / 2;
    return { x: outW / 2 - cx * scale, y: outH / 2 - cy * scale, scale };
  }
  const scale = cover ? Math.max(outW / natW, outH / natH) : Math.min(outW / natW, outH / natH);
  return { x: (outW - natW * scale) / 2, y: (outH - natH * scale) / 2, scale };
}

type ImageItem = {
  id: string;
  file: File;
  imgEl: HTMLImageElement;
  natDims: { w: number; h: number };
  detectedBg: string;
  contentBounds: ContentBounds | null;
};

export default function BulkClient() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDownloading = useRef(false);

  const [items, setItems] = useState<ImageItem[]>([]);
  const [targetKey, setTargetKey] = useState(SIZE_PRESETS[0].key);
  const [resizeMode, setResizeMode] = useState<ResizeMode>("cutout");
  const [downloading, setDownloading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const targetPreset = SIZE_PRESETS.find(p => p.key === targetKey)!;
  const isCover = resizeMode === "scene";

  // state is computed dynamically so previews update instantly when size/mode changes
  const getState = useCallback((item: ImageItem): ImgState => {
    return makeInitialState(
      item.natDims.w, item.natDims.h,
      targetPreset.w, targetPreset.h,
      isCover, !isCover ? item.contentBounds : null
    );
  }, [targetPreset, isCover]);

  const handleFiles = useCallback((fileList: FileList | File[]) => {
    const arr = Array.from(fileList).filter(f => f.type.startsWith("image/"));
    for (const f of arr) {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        const bg = detectBgColor(img);
        const cb = detectContentBounds(img, bg);
        setItems(prev => [...prev, {
          id: crypto.randomUUID(),
          file: f,
          imgEl: img,
          natDims: { w: img.naturalWidth, h: img.naturalHeight },
          detectedBg: bg,
          contentBounds: cb,
        }]);
      };
      img.src = url;
    }
  }, []);

  const removeItem = (id: string) => setItems(prev => prev.filter(i => i.id !== id));

  const generateBlob = (item: ImageItem): Promise<Blob | null> => {
    return new Promise(resolve => {
      const { w: outW, h: outH } = targetPreset;
      const state = getState(item);
      const canvas = document.createElement("canvas");
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      if (!isCover) {
        ctx.fillStyle = item.detectedBg;
        ctx.fillRect(0, 0, outW, outH);
      }
      ctx.drawImage(
        item.imgEl, 0, 0, item.imgEl.naturalWidth, item.imgEl.naturalHeight,
        state.x, state.y, item.natDims.w * state.scale, item.natDims.h * state.scale
      );
      canvas.toBlob(resolve, item.file.type || "image/jpeg", 0.95);
    });
  };

  const handleDownload = async () => {
    if (isDownloading.current || items.length === 0) return;
    isDownloading.current = true;
    setDownloading(true);
    const zip = new JSZip();
    for (const item of items) {
      const blob = await generateBlob(item);
      if (blob) {
        const ext = (item.file.name.split(".").pop() ?? "jpg").toLowerCase();
        const base = item.file.name.replace(/\.[^.]+$/, "");
        zip.file(`${base}_${targetPreset.key}.${ext}`, blob);
      }
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bulk_${targetPreset.key}.zip`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    isDownloading.current = false;
    setDownloading(false);
  };

  const pDs = Math.min(120 / targetPreset.w, 120 / targetPreset.h);

  return (
    <div style={{ display: "flex", height: "calc(100vh - 48px)", background: "#F5F5F7", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif" }}>

      <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }}
        onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ""; }} />

      {/* ── Left Panel ── */}
      <aside style={{ width: 320, minWidth: 320, background: "#fff", borderRight: "1px solid rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", overflowY: "auto" }}>

        {/* Mode */}
        <div style={{ padding: "20px 16px 0" }}>
          <p style={sectionLabel}>리사이즈 방식</p>
          <div style={{ display: "flex", background: "#F5F5F7", borderRadius: 10, padding: 2 }}>
            {(["cutout", "scene"] as const).map(m => (
              <button key={m} onClick={() => setResizeMode(m)} style={{
                flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 12, fontWeight: 500, border: "none", cursor: "pointer",
                transition: "all 0.15s",
                background: resizeMode === m ? "#fff" : "transparent",
                color: resizeMode === m ? "#1d1d1f" : "#6e6e73",
                boxShadow: resizeMode === m ? "0 1px 3px rgba(0,0,0,0.10)" : "none",
              }}>
                {m === "cutout" ? "누끼컷" : "크롭컷"}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "#aeaeb2", marginTop: 6, lineHeight: 1.45 }}>
            {resizeMode === "cutout" ? "배경 확장 · 전체 제품 표시" : "프레임 꽉 채우기 · 크롭"}
          </p>
        </div>

        {/* Target size */}
        <div style={{ padding: "20px 16px 16px", flex: 1 }}>
          <p style={sectionLabel}>출력 사이즈</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {SIZE_PRESETS.map(p => {
              const act = p.key === targetKey;
              return (
                <button key={p.key} onClick={() => setTargetKey(p.key)} style={{
                  padding: "8px 10px", border: "none", cursor: "pointer", textAlign: "left", borderRadius: 8,
                  background: act ? "rgba(0,113,227,0.08)" : "transparent",
                  color: act ? APPLE_BLUE : "#1d1d1f",
                  fontSize: 12, fontWeight: act ? 600 : 400, transition: "all 0.1s",
                }}>
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {items.length === 0 ? (
          <div
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={e => { e.preventDefault(); setIsDragOver(false); handleFiles(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              cursor: "pointer", transition: "background 0.15s",
              background: isDragOver ? "rgba(0,113,227,0.04)" : "transparent",
              border: isDragOver ? "2px dashed rgba(0,113,227,0.3)" : "2px dashed transparent",
              margin: 24, borderRadius: 16,
            }}
          >
            <svg width="52" height="52" viewBox="0 0 52 52" fill="none" style={{ marginBottom: 14 }}>
              <rect x="4" y="10" width="44" height="32" rx="5" stroke="#C7C7CC" strokeWidth="2"/>
              <circle cx="16" cy="22" r="4" stroke="#C7C7CC" strokeWidth="1.5"/>
              <path d="M4 36l12-11 8 8 7-7 13 11" stroke="#C7C7CC" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M34 6v12M28 9l6-3 6 3" stroke="#C7C7CC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p style={{ fontSize: 15, fontWeight: 500, color: "#3c3c43", margin: 0 }}>이미지를 여러 장 업로드하세요</p>
            <p style={{ fontSize: 12, color: "#aeaeb2", marginTop: 5 }}>클릭 또는 드래그 · JPG, PNG, WebP 등</p>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: 24 }}
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={e => { e.preventDefault(); setIsDragOver(false); handleFiles(e.dataTransfer.files); }}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#1d1d1f", margin: 0 }}>
                {items.length}개 이미지 → <span style={{ color: APPLE_BLUE }}>{targetPreset.label}</span>
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => fileInputRef.current?.click()} style={{
                  padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)",
                  background: "#fff", fontSize: 12, cursor: "pointer", color: "#1d1d1f", fontWeight: 500,
                }}>
                  + 추가
                </button>
                <button onClick={() => setItems([])} style={{
                  padding: "6px 12px", borderRadius: 8, border: "none",
                  background: "none", fontSize: 12, cursor: "pointer", color: "#ff3b30",
                }}>
                  전체 삭제
                </button>
              </div>
            </div>

            {/* Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
              {items.map(item => {
                const state = getState(item);
                const bg = isCover ? "#e5e7eb" : item.detectedBg;
                return (
                  <div key={item.id} style={{
                    background: "#fff", borderRadius: 12,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.07)", display: "flex", flexDirection: "column",
                    overflow: "hidden",
                  }}>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "#F5F5F7", height: 130, overflow: "hidden",
                    }}>
                      <div style={{ borderRadius: 6, overflow: "hidden", border: "1px solid rgba(0,0,0,0.08)" }}>
                        <PreviewCanvas imgEl={item.imgEl} natDims={item.natDims} state={state} outW={targetPreset.w} outH={targetPreset.h} pDs={pDs} bgColor={bg} />
                      </div>
                    </div>
                    <div style={{ padding: "7px 10px", display: "flex", alignItems: "center", gap: 4 }}>
                      <p style={{ fontSize: 10, color: "#6e6e73", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, margin: 0 }}>
                        {item.file.name}
                      </p>
                      <button onClick={() => removeItem(item.id)} style={{
                        border: "none", background: "none", color: "#c7c7cc",
                        cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1, flexShrink: 0,
                      }}>×</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Download */}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={handleDownload} disabled={downloading} style={{
                padding: "9px 22px", borderRadius: 12, background: APPLE_BLUE,
                color: "#fff", border: "none", cursor: downloading ? "not-allowed" : "pointer",
                fontSize: 13, fontWeight: 600, opacity: downloading ? 0.45 : 1, transition: "opacity 0.15s",
              }}>
                {downloading ? "압축 중…" : `ZIP 다운로드 (${items.length}개)`}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: "#6e6e73",
  textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10,
};
