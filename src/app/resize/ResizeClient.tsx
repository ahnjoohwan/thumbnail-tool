"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import JSZip from "jszip";
import PreviewCanvas from "@/components/PreviewCanvas";
import AdSlot from "@/components/AdSlot";

// ── Types ──────────────────────────────────────────────────────────────────
type ImgState = { x: number; y: number; scale: number };
type ResizeMode = "cutout" | "scene";
type ContentBounds = { x: number; y: number; w: number; h: number };
type SizePreset = { key: string; w: number; h: number; label: string };

// ── Constants ──────────────────────────────────────────────────────────────
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

const CANVAS_MAX = 500;
const APPLE_BLUE = "#0071E3";

// ── Helpers ────────────────────────────────────────────────────────────────
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

// ── Component ──────────────────────────────────────────────────────────────
export default function ResizeClient() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDragging = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const isDownloading = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [natDims, setNatDims] = useState<{ w: number; h: number } | null>(null);
  const [detectedBg, setDetectedBg] = useState("rgb(255,255,255)");
  const [contentBounds, setContentBounds] = useState<ContentBounds | null>(null);

  const [resizeMode, setResizeMode] = useState<ResizeMode>("cutout");
  const [showGuides, setShowGuides] = useState(false);

  const [selectedKeys, setSelectedKeys] = useState<string[]>(SIZE_PRESETS.map(p => p.key));
  const [perSize, setPerSize] = useState<Record<string, ImgState>>({});
  const [activeKey, setActiveKey] = useState<string>(SIZE_PRESETS[0].key);
  const [customSizes, setCustomSizes] = useState<SizePreset[]>([]);
  const [customW, setCustomW] = useState("");
  const [customH, setCustomH] = useState("");

  const [showNameInput, setShowNameInput] = useState(false);
  const [zipName, setZipName] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [grabbing, setGrabbing] = useState(false);

  const allSizes = [...SIZE_PRESETS, ...customSizes];
  const activePreset = allSizes.find(p => p.key === activeKey) ?? null;
  const activeState = perSize[activeKey] ?? null;
  const isCover = resizeMode === "scene";

  const outputDs = activePreset ? calcDs(activePreset.w, activePreset.h) : 1;
  const frameW = activePreset ? Math.round(activePreset.w * outputDs) : 0;
  const frameH = activePreset ? Math.round(activePreset.h * outputDs) : 0;
  const PAD = activePreset ? Math.round(Math.min(frameW, frameH) * 0.18) : 40;
  const stageW = frameW + PAD * 2;
  const stageH = frameH + PAD * 2;
  const stageBg = isCover ? "#e5e7eb" : detectedBg;

  // ── Handle file ────────────────────────────────────────────────────────
  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const bg = detectBgColor(img);
      const cb = detectContentBounds(img, bg);
      setFile(f);
      setImgEl(img);
      setNatDims({ w: img.naturalWidth, h: img.naturalHeight });
      setDetectedBg(bg);
      setContentBounds(cb);
      const cover = resizeMode === "scene";
      const next: Record<string, ImgState> = {};
      for (const p of SIZE_PRESETS)
        next[p.key] = makeInitialState(img.naturalWidth, img.naturalHeight, p.w, p.h, cover, !cover ? cb : null);
      setPerSize(next);
      setActiveKey(SIZE_PRESETS[0].key);
    };
    img.src = url;
  }, [resizeMode]);

  // ── Mode change → reposition all ──────────────────────────────────────
  useEffect(() => {
    if (!natDims) return;
    const cover = resizeMode === "scene";
    setPerSize(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        const p = allSizes.find(p => p.key === key);
        if (p) next[key] = makeInitialState(natDims.w, natDims.h, p.w, p.h, cover, !cover ? contentBounds : null);
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizeMode]);

  // ── Canvas draw ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = stageW;
    canvas.height = stageH;

    // Stage bg
    ctx.fillStyle = "#E5E5EA";
    ctx.fillRect(0, 0, stageW, stageH);

    // Frame bg
    ctx.fillStyle = stageBg;
    ctx.fillRect(PAD, PAD, frameW, frameH);

    // Image (clipped to frame)
    if (imgEl && activeState && natDims) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD, PAD, frameW, frameH);
      ctx.clip();
      ctx.drawImage(
        imgEl, 0, 0, imgEl.naturalWidth, imgEl.naturalHeight,
        PAD + activeState.x * outputDs,
        PAD + activeState.y * outputDs,
        natDims.w * activeState.scale * outputDs,
        natDims.h * activeState.scale * outputDs
      );
      ctx.restore();
    }

    // Overlay masks
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, 0, stageW, PAD);
    ctx.fillRect(0, PAD + frameH, stageW, PAD + 1);
    ctx.fillRect(0, PAD, PAD, frameH);
    ctx.fillRect(PAD + frameW, PAD, PAD + 1, frameH);

    // Frame border
    ctx.strokeStyle = "rgba(0,113,227,0.9)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(PAD + 0.75, PAD + 0.75, frameW - 1.5, frameH - 1.5);

    // Guides
    if (showGuides && frameW > 0 && frameH > 0) {
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(255,59,48,0.65)";
      ctx.beginPath();
      ctx.moveTo(PAD + frameW / 2, PAD); ctx.lineTo(PAD + frameW / 2, PAD + frameH);
      ctx.moveTo(PAD, PAD + frameH / 2); ctx.lineTo(PAD + frameW, PAD + frameH / 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,149,0,0.5)";
      for (const f of [1 / 3, 2 / 3]) {
        ctx.beginPath();
        ctx.moveTo(PAD + frameW * f, PAD); ctx.lineTo(PAD + frameW * f, PAD + frameH);
        ctx.moveTo(PAD, PAD + frameH * f); ctx.lineTo(PAD + frameW, PAD + frameH * f);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,59,48,0.85)";
      ctx.beginPath();
      ctx.arc(PAD + frameW / 2, PAD + frameH / 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [imgEl, activeState, outputDs, stageBg, frameW, frameH, PAD, stageW, stageH, showGuides, natDims]);

  // ── Pointer events ─────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeState) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    setGrabbing(true);
    lastPt.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging.current || !lastPt.current || !activeState || !activePreset || !natDims) return;
    const dx = (e.clientX - lastPt.current.x) / outputDs;
    const dy = (e.clientY - lastPt.current.y) / outputDs;
    lastPt.current = { x: e.clientX, y: e.clientY };
    const key = activeKey;
    setPerSize(prev => ({
      ...prev,
      [key]: clampState({ ...prev[key], x: prev[key].x + dx, y: prev[key].y + dy }, natDims.w, natDims.h, activePreset.w, activePreset.h, isCover),
    }));
  };

  const onPointerUp = () => { isDragging.current = false; setGrabbing(false); lastPt.current = null; };

  // ── Zoom ───────────────────────────────────────────────────────────────
  const handleZoom = (factor: number) => {
    if (!activeState || !natDims || !activePreset) return;
    const { w: outW, h: outH } = activePreset;
    const { w: natW, h: natH } = natDims;
    const newScale = activeState.scale * factor;
    if (isCover && newScale < Math.max(outW / natW, outH / natH)) return;
    if (!isCover && newScale < Math.min(outW / natW, outH / natH) * 0.05) return;
    if (newScale > Math.max(outW / natW, outH / natH) * 8) return;
    const newW = natW * newScale, newH = natH * newScale;
    const curW = natW * activeState.scale, curH = natH * activeState.scale;
    const rx = curW > 0 ? (outW / 2 - activeState.x) / curW : 0.5;
    const ry = curH > 0 ? (outH / 2 - activeState.y) / curH : 0.5;
    const key = activeKey;
    setPerSize(prev => ({
      ...prev,
      [key]: clampState({ x: outW / 2 - rx * newW, y: outH / 2 - ry * newH, scale: newScale }, natW, natH, outW, outH, isCover),
    }));
  };

  // ── Center ─────────────────────────────────────────────────────────────
  const handleCenter = () => {
    if (!natDims || !activePreset) return;
    const { w: outW, h: outH } = activePreset;
    const key = activeKey;
    setPerSize(prev => {
      const cur = prev[key]; if (!cur) return prev;
      return { ...prev, [key]: { scale: cur.scale, x: (outW - natDims.w * cur.scale) / 2, y: (outH - natDims.h * cur.scale) / 2 } };
    });
  };

  // ── Sync all ───────────────────────────────────────────────────────────
  const handleSyncAll = () => {
    if (!natDims || !activePreset || !activeState || selectedKeys.length < 2) return;
    const { w: outW, h: outH } = activePreset;
    const scx = (outW / 2 - activeState.x) / activeState.scale;
    const scy = (outH / 2 - activeState.y) / activeState.scale;
    // 현재 사이즈의 줌 비율 계산 (기본 스케일 대비 얼마나 줌했는지)
    const margin = 0.08;
    const defaultScale = contentBounds && !isCover
      ? Math.min(outW * (1 - 2 * margin) / contentBounds.w, outH * (1 - 2 * margin) / contentBounds.h, Math.max(outW / natDims.w, outH / natDims.h) * 4)
      : isCover ? Math.max(outW / natDims.w, outH / natDims.h) : Math.min(outW / natDims.w, outH / natDims.h);
    const zoomRatio = defaultScale > 0 ? activeState.scale / defaultScale : 1;
    setPerSize(prev => {
      const next = { ...prev };
      for (const key of selectedKeys) {
        if (key === activeKey) continue;
        const p = allSizes.find(p => p.key === key);
        if (!p) continue;
        // 각 사이즈의 기본 스케일에 동일한 줌 비율 적용
        const baseScale = contentBounds && !isCover
          ? Math.min(p.w * (1 - 2 * margin) / contentBounds.w, p.h * (1 - 2 * margin) / contentBounds.h, Math.max(p.w / natDims.w, p.h / natDims.h) * 4)
          : isCover ? Math.max(p.w / natDims.w, p.h / natDims.h) : Math.min(p.w / natDims.w, p.h / natDims.h);
        const scale = baseScale * zoomRatio;
        next[key] = clampState({ x: p.w / 2 - scx * scale, y: p.h / 2 - scy * scale, scale }, natDims.w, natDims.h, p.w, p.h, isCover);
      }
      return next;
    });
  };

  // ── Reset current ──────────────────────────────────────────────────────
  const handleReset = () => {
    if (!natDims || !activePreset) return;
    const key = activeKey;
    setPerSize(prev => ({
      ...prev,
      [key]: makeInitialState(natDims.w, natDims.h, activePreset.w, activePreset.h, isCover, !isCover ? contentBounds : null),
    }));
  };

  // ── Toggle size ────────────────────────────────────────────────────────
  const toggleSize = (p: SizePreset) => {
    if (selectedKeys.includes(p.key)) {
      const next = selectedKeys.filter(k => k !== p.key);
      setSelectedKeys(next);
      setPerSize(prev => { const n = { ...prev }; delete n[p.key]; return n; });
      if (activeKey === p.key && next.length > 0) setActiveKey(next[next.length - 1]);
    } else {
      const initState = natDims ? makeInitialState(natDims.w, natDims.h, p.w, p.h, isCover, !isCover ? contentBounds : null) : undefined;
      setSelectedKeys(prev => [...prev, p.key]);
      if (initState) setPerSize(prev => ({ ...prev, [p.key]: initState }));
      setActiveKey(p.key);
    }
  };

  // ── Add custom size ────────────────────────────────────────────────────
  const addCustomSize = () => {
    const w = parseInt(customW, 10), h = parseInt(customH, 10);
    if (isNaN(w) || isNaN(h) || w < 1 || h < 1 || w > 10000 || h > 10000) return;
    const key = `${w}x${h}`;
    const newPreset: SizePreset = { key, w, h, label: `${w}×${h}` };
    if (!customSizes.find(p => p.key === key)) setCustomSizes(prev => [...prev, newPreset]);
    const initState = natDims ? makeInitialState(natDims.w, natDims.h, w, h, isCover, !isCover ? contentBounds : null) : undefined;
    if (!selectedKeys.includes(key)) setSelectedKeys(prev => [...prev, key]);
    if (initState) setPerSize(prev => ({ ...prev, [key]: initState }));
    setActiveKey(key);
    setCustomW(""); setCustomH("");
  };

  // ── Generate blob ──────────────────────────────────────────────────────
  const generateBlob = useCallback((state: ImgState, outW: number, outH: number, fillColor?: string): Promise<Blob | null> => {
    return new Promise(resolve => {
      if (!imgEl || !natDims) return resolve(null);
      const canvas = document.createElement("canvas");
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      if (fillColor) { ctx.fillStyle = fillColor; ctx.fillRect(0, 0, outW, outH); }
      ctx.drawImage(imgEl, 0, 0, imgEl.naturalWidth, imgEl.naturalHeight, state.x, state.y, natDims.w * state.scale, natDims.h * state.scale);
      canvas.toBlob(resolve, file?.type || "image/jpeg", 0.95);
    });
  }, [imgEl, natDims, file]);

  // ── Download ZIP ───────────────────────────────────────────────────────
  const handleDownload = async () => {
    if (isDownloading.current || !file || !zipName.trim() || selectedKeys.length === 0) return;
    isDownloading.current = true;
    setDownloading(true);
    const name = zipName.trim();
    const zip = new JSZip();
    const fillColor = isCover ? undefined : detectedBg;
    const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
    for (const key of selectedKeys) {
      const state = perSize[key];
      const preset = allSizes.find(p => p.key === key);
      if (!state || !preset) continue;
      const blob = await generateBlob(state, preset.w, preset.h, fillColor);
      if (blob) zip.file(`${name}_${key}.${ext}`, blob);
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a"); a.href = url; a.download = `${name}.zip`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    isDownloading.current = false;
    setDownloading(false);
    setShowNameInput(false);
    setZipName("");
  };

  // ── Reset all ──────────────────────────────────────────────────────────
  const resetAll = () => {
    setFile(null); setImgEl(null); setNatDims(null);
    setDetectedBg("rgb(255,255,255)"); setContentBounds(null);
    setSelectedKeys(SIZE_PRESETS.map(p => p.key));
    setPerSize({}); setActiveKey(SIZE_PRESETS[0].key);
    setCustomSizes([]);
    setShowNameInput(false); setZipName("");
  };

  // ── Preview scale ──────────────────────────────────────────────────────
  const maxPreviewDim = Math.max(...selectedKeys.map(k => { const p = allSizes.find(p => p.key === k); return p ? Math.max(p.w, p.h) : 0; }), 1);
  const globalPds = 160 / maxPreviewDim;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", height: "calc(100vh - 48px)", background: "#F5F5F7", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif" }}>

      {/* ── Left Panel ── */}
      <aside style={{ width: 320, minWidth: 320, background: "#fff", borderRight: "1px solid rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", overflowY: "auto" }}>

        {/* Upload */}
        <div style={{ padding: "20px 16px 0" }}>
          <p style={sectionLabel}>이미지</p>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            style={{ border: "1.5px dashed rgba(0,0,0,0.14)", borderRadius: 12, padding: "14px 12px", cursor: "pointer", textAlign: "center", transition: "border-color 0.15s" }}
          >
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            {imgEl ? (
              <div>
                <img src={imgEl.src} alt="" style={{ maxHeight: 96, maxWidth: "100%", objectFit: "contain", borderRadius: 8 }} />
                <p style={{ fontSize: 11, color: "#6e6e73", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file?.name}</p>
                {natDims && <p style={{ fontSize: 10, color: "#aeaeb2", marginTop: 2 }}>{natDims.w} × {natDims.h} px</p>}
              </div>
            ) : (
              <div style={{ padding: "8px 0" }}>
                <div style={{ fontSize: 28, marginBottom: 6, color: "#aeaeb2" }}>↑</div>
                <p style={{ fontSize: 13, fontWeight: 500, color: "#3c3c43", margin: 0 }}>이미지 업로드</p>
                <p style={{ fontSize: 11, color: "#aeaeb2", marginTop: 3, margin: "3px 0 0" }}>클릭 또는 드래그</p>
              </div>
            )}
          </div>
          {file && (
            <button onClick={resetAll} style={{ marginTop: 6, width: "100%", fontSize: 11, color: "#ff3b30", background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
              초기화
            </button>
          )}
        </div>

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
          <p style={{ fontSize: 11, color: "#aeaeb2", marginTop: 6, lineHeight: 1.45, margin: "6px 0 0" }}>
            {resizeMode === "cutout" ? "배경 확장 · 전체 제품 표시" : "프레임 꽉 채우기 · 크롭"}
          </p>
        </div>

        {/* Sizes */}
        <div style={{ padding: "20px 16px 16px", flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <p style={{ ...sectionLabel, margin: 0 }}>출력 사이즈</p>
            <button onClick={() => {
              const allSel = allSizes.every(p => selectedKeys.includes(p.key));
              if (allSel) { setSelectedKeys([]); setPerSize({}); }
              else {
                const next: Record<string, ImgState> = {};
                if (natDims) for (const p of allSizes) next[p.key] = makeInitialState(natDims.w, natDims.h, p.w, p.h, isCover, !isCover ? contentBounds : null);
                setSelectedKeys(allSizes.map(p => p.key));
                setPerSize(prev => ({ ...prev, ...next }));
              }
            }} style={{ fontSize: 11, color: APPLE_BLUE, background: "none", border: "none", cursor: "pointer", fontWeight: 500 }}>
              {allSizes.every(p => selectedKeys.includes(p.key)) ? "전체 해제" : "전체 선택"}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {allSizes.map(p => {
              const sel = selectedKeys.includes(p.key);
              const act = activeKey === p.key && sel;
              return (
                <div key={p.key} style={{ display: "flex", alignItems: "center", borderRadius: 8, overflow: "hidden" }}>
                  <button
                    onClick={() => { if (sel) setActiveKey(p.key); else toggleSize(p); }}
                    style={{
                      flex: 1, padding: "7px 10px", border: "none", cursor: "pointer", textAlign: "left",
                      background: act ? "rgba(0,113,227,0.08)" : sel ? "#F5F5F7" : "transparent",
                      color: act ? APPLE_BLUE : sel ? "#1d1d1f" : "#aeaeb2",
                      fontSize: 12, fontWeight: act ? 600 : sel ? 400 : 400,
                      transition: "all 0.1s",
                    }}>
                    {p.label}
                  </button>
                  <button
                    onClick={() => toggleSize(p)}
                    style={{
                      padding: "7px 8px", border: "none", cursor: "pointer", fontSize: 11, lineHeight: 1,
                      background: act ? "rgba(0,113,227,0.08)" : sel ? "#F5F5F7" : "transparent",
                      color: sel ? "#aeaeb2" : "#c7c7cc",
                      transition: "all 0.1s",
                    }}>
                    {sel ? "×" : "+"}
                  </button>
                </div>
              );
            })}
          </div>
          {/* Custom size */}
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

      {/* ── Main Area ── */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!imgEl ? (
          <EmptyState />
        ) : (
          <>
            {/* Size tabs */}
            <div style={{ background: "#fff", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", padding: "0 20px", overflowX: "auto", flexShrink: 0, gap: 0 }}>
              {selectedKeys.map(key => {
                const p = allSizes.find(p => p.key === key);
                const act = key === activeKey;
                return (
                  <button key={key} onClick={() => setActiveKey(key)} style={{
                    padding: "11px 14px", fontSize: 12, fontWeight: act ? 600 : 400,
                    border: "none", borderBottom: `2px solid ${act ? APPLE_BLUE : "transparent"}`,
                    background: "transparent", color: act ? APPLE_BLUE : "#6e6e73",
                    cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.15s",
                  }}>
                    {p?.label ?? key}
                  </button>
                );
              })}
              {selectedKeys.length === 0 && <span style={{ fontSize: 12, color: "#aeaeb2", padding: "11px 0" }}>왼쪽에서 사이즈를 선택하세요</span>}
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
              {activePreset && activeState ? (
                <>
                  {/* Canvas editor */}
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                    <canvas
                      ref={canvasRef}
                      style={{ cursor: grabbing ? "grabbing" : "grab", borderRadius: 6, display: "block" }}
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerLeave={onPointerUp}
                    />
                  </div>

                  {/* Controls */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#aeaeb2" }}>{activePreset.w} × {activePreset.h} px</span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {[{ l: "+", fn: () => handleZoom(1.2) }, { l: "−", fn: () => handleZoom(1 / 1.2) }].map(b => (
                        <button key={b.l} onClick={b.fn} style={ctrlBtn}>{b.l}</button>
                      ))}
                      <Divider />
                      <button onClick={handleCenter} style={ctrlBtn}>중앙</button>
                      <button onClick={() => setShowGuides(v => !v)} style={{ ...ctrlBtn, ...(showGuides ? { background: "rgba(0,113,227,0.08)", color: APPLE_BLUE, borderColor: "rgba(0,113,227,0.3)" } : {}) }}>가이드</button>
                      {selectedKeys.length > 1 && <button onClick={handleSyncAll} style={{ ...ctrlBtn, color: APPLE_BLUE, borderColor: "rgba(0,113,227,0.3)", background: "rgba(0,113,227,0.06)" }}>전체 적용</button>}
                      <Divider />
                      <button onClick={handleReset} style={{ ...ctrlBtn, color: "#6e6e73" }}>초기화</button>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#aeaeb2", fontSize: 13 }}>
                  왼쪽에서 사이즈를 선택하세요
                </div>
              )}

              {/* Preview grid */}
              {selectedKeys.length > 0 && natDims && imgEl && (
                <div style={{ marginTop: 28, paddingTop: 24, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                  <p style={{ ...sectionLabel, marginBottom: 14 }}>사이즈별 미리보기</p>
                  <div style={{ display: "flex", gap: 12, overflowX: "auto", overflowY: "hidden", alignItems: "flex-end", paddingBottom: 4 }}>
                    {selectedKeys.map(key => {
                      const p = allSizes.find(p => p.key === key);
                      const state = perSize[key];
                      if (!p || !state) return null;
                      // 최대 164px 높이 기준으로 캡
                      const pDs = Math.min(
                        Math.max(globalPds, 48 / Math.min(p.w, p.h)),
                        164 / p.h
                      );
                      const act = key === activeKey;
                      const bg = isCover ? "#e5e7eb" : detectedBg;
                      return (
                        <div key={key} onClick={() => setActiveKey(key)} style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                          <div style={{ height: 164, display: "flex", alignItems: "flex-end", justifyContent: "center", overflow: "hidden" }}>
                            <div style={{
                              borderRadius: 10, overflow: "hidden",
                              border: `2px solid ${act ? APPLE_BLUE : "rgba(0,0,0,0.08)"}`,
                              boxShadow: act ? `0 0 0 3px rgba(0,113,227,0.15)` : "none",
                              transition: "all 0.15s",
                            }}>
                              <PreviewCanvas imgEl={imgEl} natDims={natDims} state={state} outW={p.w} outH={p.h} pDs={pDs} bgColor={bg} />
                            </div>
                          </div>
                          <div style={{ marginTop: 5, textAlign: "center", fontSize: 10, fontWeight: act ? 600 : 400, color: act ? APPLE_BLUE : "#6e6e73" }}>
                            {p.label}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Download */}
              {selectedKeys.length > 0 && (
                <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(0,0,0,0.06)", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
                  {showNameInput ? (
                    <>
                      <input autoFocus type="text" placeholder="파일명 (예: 상품명)" value={zipName} onChange={e => setZipName(e.target.value)} onKeyDown={e => e.key === "Enter" && void handleDownload()}
                        style={{ border: "1px solid rgba(0,0,0,0.14)", borderRadius: 10, padding: "8px 14px", fontSize: 13, outline: "none", width: 200, color: "#1d1d1f" }} />
                      <button onClick={() => void handleDownload()} disabled={downloading || !zipName.trim()} style={{ ...downloadBtn, opacity: (downloading || !zipName.trim()) ? 0.45 : 1 }}>
                        {downloading ? "압축 중…" : "저장"}
                      </button>
                      <button onClick={() => { setShowNameInput(false); setZipName(""); }} style={cancelBtn}>취소</button>
                    </>
                  ) : (
                    <button onClick={() => setShowNameInput(true)} style={downloadBtn}>
                      ZIP 다운로드 ({selectedKeys.length}개)
                    </button>
                  )}
                </div>
              )}

              <div style={{ marginTop: 24 }}>
                <AdSlot />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#aeaeb2", gap: 10 }}>
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect x="6" y="10" width="36" height="28" rx="4" stroke="#C7C7CC" strokeWidth="2"/>
        <circle cx="16" cy="20" r="3.5" stroke="#C7C7CC" strokeWidth="1.5"/>
        <path d="M6 32l9-9 7 7 5-5 9 9" stroke="#C7C7CC" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
      <p style={{ fontSize: 15, fontWeight: 500, color: "#3c3c43", margin: 0 }}>왼쪽에서 이미지를 업로드하세요</p>
      <p style={{ fontSize: 12, margin: 0 }}>JPG, PNG, WebP 등 지원</p>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 20, background: "rgba(0,0,0,0.1)", alignSelf: "center" }} />;
}

// ── Shared styles ──────────────────────────────────────────────────────────
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

const downloadBtn: React.CSSProperties = {
  padding: "9px 22px", borderRadius: 12, background: APPLE_BLUE,
  color: "#fff", border: "none", cursor: "pointer",
  fontSize: 13, fontWeight: 600, transition: "opacity 0.15s",
};

const cancelBtn: React.CSSProperties = {
  padding: "9px 14px", borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.12)", background: "#fff",
  cursor: "pointer", fontSize: 13, color: "#6e6e73",
};
