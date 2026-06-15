"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import JSZip from "jszip";
import PreviewCanvas from "@/components/PreviewCanvas";
import AdSlot from "@/components/AdSlot";

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
const CANVAS_MAX = 460;

function calcDs(w: number, h: number) {
  return Math.min(CANVAS_MAX / w, CANVAS_MAX / h, 1);
}

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

function clampState(s: ImgState, natW: number, natH: number, outW: number, outH: number, mustCover: boolean): ImgState {
  const w = natW * s.scale, h = natH * s.scale;
  let { x, y } = s;
  if (mustCover) {
    if (x > 0) x = 0; if (y > 0) y = 0;
    if (x + w < outW) x = outW - w; if (y + h < outH) y = outH - h;
  } else {
    if (x < -(w * 0.7)) x = -(w * 0.7); if (x > outW - w * 0.3) x = outW - w * 0.3;
    if (y < -(h * 0.7)) y = -(h * 0.7); if (y > outH - h * 0.3) y = outH - h * 0.3;
  }
  return { ...s, x, y };
}

type ImageItem = {
  id: string;
  file: File;
  imgEl: HTMLImageElement;
  natDims: { w: number; h: number };
  detectedBg: string;
  contentBounds: ContentBounds | null;
  customState?: ImgState;
};

export default function BulkClient() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDownloading = useRef(false);
  const modalCanvasRef = useRef<HTMLCanvasElement>(null);
  const modalIsDragging = useRef(false);
  const modalLastPt = useRef<{ x: number; y: number } | null>(null);

  const [items, setItems] = useState<ImageItem[]>([]);
  const [targetKey, setTargetKey] = useState(SIZE_PRESETS[0].key);
  const [resizeMode, setResizeMode] = useState<ResizeMode>("cutout");
  const [downloading, setDownloading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [customSizes, setCustomSizes] = useState<SizePreset[]>([]);
  const [customW, setCustomW] = useState("");
  const [customH, setCustomH] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ImgState | null>(null);
  const [modalGrabbing, setModalGrabbing] = useState(false);

  const allSizes = [...SIZE_PRESETS, ...customSizes];
  const targetPreset = allSizes.find(p => p.key === targetKey) ?? SIZE_PRESETS[0];
  const isCover = resizeMode === "scene";

  // Clear custom states when target size or mode changes
  useEffect(() => {
    setItems(prev => prev.map(item => ({ ...item, customState: undefined })));
  }, [targetKey, resizeMode]);

  const getAutoState = useCallback((item: ImageItem): ImgState => {
    return makeInitialState(
      item.natDims.w, item.natDims.h,
      targetPreset.w, targetPreset.h,
      isCover, !isCover ? item.contentBounds : null
    );
  }, [targetPreset, isCover]);

  const getState = useCallback((item: ImageItem): ImgState => {
    return item.customState ?? getAutoState(item);
  }, [getAutoState]);

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

  const addCustomSize = () => {
    const w = parseInt(customW, 10), h = parseInt(customH, 10);
    if (isNaN(w) || isNaN(h) || w < 1 || h < 1 || w > 10000 || h > 10000) return;
    const key = `${w}x${h}`;
    const newPreset: SizePreset = { key, w, h, label: `${w}×${h}` };
    if (!customSizes.find(p => p.key === key)) setCustomSizes(prev => [...prev, newPreset]);
    setTargetKey(key);
    setCustomW(""); setCustomH("");
  };

  // ── Modal open/close ───────────────────────────────────────────────────────
  const openEdit = (item: ImageItem) => {
    setModalState(getState(item));
    setEditingId(item.id);
  };

  const saveEdit = () => {
    if (!editingId || !modalState) return;
    setItems(prev => prev.map(i => i.id === editingId ? { ...i, customState: modalState } : i));
    setEditingId(null);
    setModalState(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setModalState(null);
  };

  const resetModalState = () => {
    const item = items.find(i => i.id === editingId);
    if (!item) return;
    setModalState(getAutoState(item));
  };

  // ── Modal canvas draw ──────────────────────────────────────────────────────
  const editingItem = items.find(i => i.id === editingId) ?? null;
  const outputDs = calcDs(targetPreset.w, targetPreset.h);
  const frameW = Math.round(targetPreset.w * outputDs);
  const frameH = Math.round(targetPreset.h * outputDs);
  const PAD = Math.round(Math.min(frameW, frameH) * 0.18);
  const stageW = frameW + PAD * 2;
  const stageH = frameH + PAD * 2;
  const stageBg = isCover ? "#e5e7eb" : (editingItem?.detectedBg ?? "#fff");

  useEffect(() => {
    if (!editingItem || !modalState) return;
    const canvas = modalCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = stageW;
    canvas.height = stageH;

    ctx.fillStyle = "#E5E5EA";
    ctx.fillRect(0, 0, stageW, stageH);
    ctx.fillStyle = stageBg;
    ctx.fillRect(PAD, PAD, frameW, frameH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD, PAD, frameW, frameH);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      editingItem.imgEl, 0, 0, editingItem.imgEl.naturalWidth, editingItem.imgEl.naturalHeight,
      PAD + modalState.x * outputDs,
      PAD + modalState.y * outputDs,
      editingItem.natDims.w * modalState.scale * outputDs,
      editingItem.natDims.h * modalState.scale * outputDs
    );
    ctx.restore();

    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, 0, stageW, PAD);
    ctx.fillRect(0, PAD + frameH, stageW, PAD + 1);
    ctx.fillRect(0, PAD, PAD, frameH);
    ctx.fillRect(PAD + frameW, PAD, PAD + 1, frameH);

    ctx.strokeStyle = "rgba(0,113,227,0.9)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(PAD + 0.75, PAD + 0.75, frameW - 1.5, frameH - 1.5);
  }, [editingItem, modalState, outputDs, stageBg, frameW, frameH, PAD, stageW, stageH]);

  // ── Modal pointer events ───────────────────────────────────────────────────
  const onModalPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!modalState) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    modalIsDragging.current = true;
    setModalGrabbing(true);
    modalLastPt.current = { x: e.clientX, y: e.clientY };
  };

  const onModalPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!modalIsDragging.current || !modalLastPt.current || !modalState || !editingItem) return;
    const dx = (e.clientX - modalLastPt.current.x) / outputDs;
    const dy = (e.clientY - modalLastPt.current.y) / outputDs;
    modalLastPt.current = { x: e.clientX, y: e.clientY };
    setModalState(prev => {
      if (!prev) return prev;
      return clampState({ ...prev, x: prev.x + dx, y: prev.y + dy }, editingItem.natDims.w, editingItem.natDims.h, targetPreset.w, targetPreset.h, isCover);
    });
  };

  const onModalPointerUp = () => { modalIsDragging.current = false; setModalGrabbing(false); modalLastPt.current = null; };

  const handleModalZoom = (factor: number) => {
    if (!modalState || !editingItem) return;
    const { w: outW, h: outH } = targetPreset;
    const { w: natW, h: natH } = editingItem.natDims;
    const newScale = modalState.scale * factor;
    if (isCover && newScale < Math.max(outW / natW, outH / natH)) return;
    if (!isCover && newScale < Math.min(outW / natW, outH / natH) * 0.05) return;
    if (newScale > Math.max(outW / natW, outH / natH) * 8) return;
    const newW = natW * newScale, newH = natH * newScale;
    const curW = natW * modalState.scale, curH = natH * modalState.scale;
    const rx = curW > 0 ? (outW / 2 - modalState.x) / curW : 0.5;
    const ry = curH > 0 ? (outH / 2 - modalState.y) / curH : 0.5;
    setModalState(prev => {
      if (!prev) return prev;
      return clampState({ x: outW / 2 - rx * newW, y: outH / 2 - ry * newH, scale: newScale }, natW, natH, outW, outH, isCover);
    });
  };

  const handleModalCenter = () => {
    if (!modalState || !editingItem) return;
    const { w: outW, h: outH } = targetPreset;
    setModalState(prev => {
      if (!prev) return prev;
      return { scale: prev.scale, x: (outW - editingItem.natDims.w * prev.scale) / 2, y: (outH - editingItem.natDims.h * prev.scale) / 2 };
    });
  };

  // ── Generate blob ──────────────────────────────────────────────────────────
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

        <div style={{ padding: "20px 16px 16px", flex: 1 }}>
          <p style={sectionLabel}>출력 사이즈</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {allSizes.map(p => {
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
          {/* Custom size input */}
          <div style={{ marginTop: 10, display: "flex", gap: 5, alignItems: "center" }}>
            <input type="number" placeholder="너비" value={customW} onChange={e => setCustomW(e.target.value)} onKeyDown={e => e.key === "Enter" && addCustomSize()}
              style={{ flex: "0 0 56px", width: 56, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 7, padding: "5px 6px", fontSize: 11, outline: "none", color: "#1d1d1f" }} />
            <span style={{ fontSize: 11, color: "#aeaeb2", flexShrink: 0 }}>×</span>
            <input type="number" placeholder="높이" value={customH} onChange={e => setCustomH(e.target.value)} onKeyDown={e => e.key === "Enter" && addCustomSize()}
              style={{ flex: "0 0 56px", width: 56, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 7, padding: "5px 6px", fontSize: 11, outline: "none", color: "#1d1d1f" }} />
            <button onClick={addCustomSize} disabled={!customW || !customH}
              style={{ padding: "5px 8px", borderRadius: 7, background: "#1d1d1f", color: "#fff", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 500, opacity: (!customW || !customH) ? 0.35 : 1 }}>
              추가
            </button>
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
              cursor: "pointer", transition: "all 0.15s", margin: 24, borderRadius: 16,
              background: isDragOver ? "rgba(0,113,227,0.04)" : "transparent",
              border: `2px dashed ${isDragOver ? "rgba(0,113,227,0.3)" : "rgba(0,0,0,0.1)"}`,
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
          <div
            style={{ flex: 1, overflowY: "auto", padding: 24 }}
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={e => { e.preventDefault(); setIsDragOver(false); handleFiles(e.dataTransfer.files); }}
          >
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

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
              {items.map(item => {
                const state = getState(item);
                const bg = isCover ? "#e5e7eb" : item.detectedBg;
                const isCustom = !!item.customState;
                return (
                  <div key={item.id} style={{
                    background: "#fff", borderRadius: 12,
                    boxShadow: isCustom ? `0 0 0 2px ${APPLE_BLUE}` : "0 1px 4px rgba(0,0,0,0.07)",
                    display: "flex", flexDirection: "column", overflow: "hidden",
                    transition: "box-shadow 0.15s",
                  }}>
                    {/* Preview — click to edit */}
                    <div
                      onClick={() => openEdit(item)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "#F5F5F7", height: 130, overflow: "hidden",
                        cursor: "pointer", position: "relative",
                      }}
                    >
                      <div style={{ borderRadius: 6, overflow: "hidden", border: "1px solid rgba(0,0,0,0.08)" }}>
                        <PreviewCanvas imgEl={item.imgEl} natDims={item.natDims} state={state} outW={targetPreset.w} outH={targetPreset.h} pDs={pDs} bgColor={bg} />
                      </div>
                      {/* Edit overlay hint */}
                      <div style={{
                        position: "absolute", inset: 0, background: "rgba(0,0,0,0)", display: "flex",
                        alignItems: "center", justifyContent: "center", transition: "background 0.15s",
                      }}
                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(0,0,0,0.12)"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(0,0,0,0)"; }}
                      >
                        <span style={{
                          fontSize: 11, fontWeight: 600, color: "#fff",
                          background: "rgba(0,0,0,0.45)", borderRadius: 6, padding: "3px 8px",
                          opacity: 0, transition: "opacity 0.15s", pointerEvents: "none",
                        }}
                          className="edit-hint"
                        >편집</span>
                      </div>
                      {isCustom && (
                        <div style={{
                          position: "absolute", top: 6, right: 6,
                          background: APPLE_BLUE, color: "#fff",
                          fontSize: 9, fontWeight: 600, borderRadius: 4, padding: "2px 5px",
                        }}>수정됨</div>
                      )}
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

            <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={handleDownload} disabled={downloading} style={{
                padding: "9px 22px", borderRadius: 12, background: APPLE_BLUE,
                color: "#fff", border: "none", cursor: downloading ? "not-allowed" : "pointer",
                fontSize: 13, fontWeight: 600, opacity: downloading ? 0.45 : 1, transition: "opacity 0.15s",
              }}>
                {downloading ? "압축 중…" : `ZIP 다운로드 (${items.length}개)`}
              </button>
            </div>

            <div style={{ marginTop: 24 }}>
              <AdSlot />
            </div>
          </div>
        )}
      </main>

      {/* ── Edit Modal ── */}
      {editingId && editingItem && modalState && (
        <div
          onClick={e => { if (e.target === e.currentTarget) cancelEdit(); }}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{
            background: "#fff", borderRadius: 20,
            boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
            padding: "20px 24px 24px",
            display: "flex", flexDirection: "column", gap: 14,
            maxWidth: "90vw",
          }}>
            {/* Modal header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: "#1d1d1f", margin: 0 }}>
                  {editingItem.file.name}
                </p>
                <p style={{ fontSize: 11, color: "#aeaeb2", margin: "2px 0 0" }}>
                  {targetPreset.label}
                </p>
              </div>
              <button onClick={cancelEdit} style={{
                width: 28, height: 28, borderRadius: "50%", border: "none",
                background: "#F5F5F7", cursor: "pointer", fontSize: 16, color: "#6e6e73",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>×</button>
            </div>

            {/* Canvas */}
            <canvas
              ref={modalCanvasRef}
              style={{ cursor: modalGrabbing ? "grabbing" : "grab", borderRadius: 8, display: "block" }}
              onPointerDown={onModalPointerDown}
              onPointerMove={onModalPointerMove}
              onPointerUp={onModalPointerUp}
              onPointerLeave={onModalPointerUp}
            />

            {/* Controls */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[{ l: "+", fn: () => handleModalZoom(1.2) }, { l: "−", fn: () => handleModalZoom(1 / 1.2) }].map(b => (
                  <button key={b.l} onClick={b.fn} style={ctrlBtn}>{b.l}</button>
                ))}
                <div style={{ width: 1, height: 20, background: "rgba(0,0,0,0.1)", alignSelf: "center" }} />
                <button onClick={handleModalCenter} style={ctrlBtn}>중앙</button>
                <button onClick={resetModalState} style={{ ...ctrlBtn, color: "#6e6e73" }}>초기화</button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={cancelEdit} style={{
                  padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.12)",
                  background: "#fff", fontSize: 13, cursor: "pointer", color: "#6e6e73",
                }}>취소</button>
                <button onClick={saveEdit} style={{
                  padding: "8px 20px", borderRadius: 10, background: APPLE_BLUE,
                  color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                }}>완료</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: "#6e6e73",
  textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10,
};

const ctrlBtn: React.CSSProperties = {
  height: 30, padding: "0 11px", borderRadius: 8,
  border: "1px solid rgba(0,0,0,0.12)", background: "#fff",
  fontSize: 11, fontWeight: 500, cursor: "pointer", color: "#1d1d1f",
  transition: "all 0.12s",
};
