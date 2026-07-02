"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import JSZip from "jszip";
import PreviewCanvas from "@/components/PreviewCanvas";
import AdSlot from "@/components/AdSlot";

// ── Types ──────────────────────────────────────────────────────────────────
type ImgState = { x: number; y: number; scale: number };
type ContentBounds = { x: number; y: number; w: number; h: number };
type SizePreset = { key: string; w: number; h: number; label: string };
type BgOption = { key: string; label: string; color: string };

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

const BG_OPTIONS: BgOption[] = [
  { key: "white", label: "화이트", color: "#FFFFFF" },
  { key: "gray",  label: "그레이", color: "#F4F0F1" },
];

const CANVAS_MAX = 500;
const APPLE_BLUE = "#0071E3";

// ── Helpers ────────────────────────────────────────────────────────────────
function calcDs(w: number, h: number) {
  return Math.min(CANVAS_MAX / w, CANVAS_MAX / h, 1);
}

function detectContentBounds(img: HTMLImageElement): ContentBounds | null {
  try {
    const sampleScale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
    const sw = Math.round(img.naturalWidth * sampleScale);
    const sh = Math.round(img.naturalHeight * sampleScale);
    const canvas = document.createElement("canvas");
    canvas.width = sw; canvas.height = sh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, sw, sh);
    const { data } = ctx.getImageData(0, 0, sw, sh);
    const rowCounts = new Int32Array(sh);
    const colCounts = new Int32Array(sw);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) * 4;
        if (data[i + 3] > 20) { rowCounts[y]++; colCounts[x]++; }
      }
    const maxRow = rowCounts.reduce((a, b) => Math.max(a, b), 0);
    const maxCol = colCounts.reduce((a, b) => Math.max(a, b), 0);
    const minR = Math.max(3, Math.round(maxRow * 0.1));
    const minC = Math.max(3, Math.round(maxCol * 0.1));
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

function makeInitialState(natW: number, natH: number, outW: number, outH: number, cb?: ContentBounds | null, margin = 0.08): ImgState {
  if (cb) {
    const scale = Math.min(outW * (1 - 2 * margin) / cb.w, outH * (1 - 2 * margin) / cb.h, Math.max(outW / natW, outH / natH) * 4);
    const cx = cb.x + cb.w / 2;
    const cy = cb.y + cb.h / 2;
    return { x: outW / 2 - cx * scale, y: outH / 2 - cy * scale, scale };
  }
  const scale = Math.min(outW / natW, outH / natH);
  return { x: (outW - natW * scale) / 2, y: (outH - natH * scale) / 2, scale };
}

function clampState(s: ImgState, natW: number, natH: number, outW: number, outH: number): ImgState {
  const w = natW * s.scale, h = natH * s.scale;
  let { x, y } = s;
  if (x < -(w * 0.7)) x = -(w * 0.7); if (x > outW - w * 0.3) x = outW - w * 0.3;
  if (y < -(h * 0.7)) y = -(h * 0.7); if (y > outH - h * 0.3) y = outH - h * 0.3;
  return { ...s, x, y };
}

// ── Component ──────────────────────────────────────────────────────────────
export default function ThumbnailClient() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDragging = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const isDownloading = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [natDims, setNatDims] = useState<{ w: number; h: number } | null>(null);
  const [contentBounds, setContentBounds] = useState<ContentBounds | null>(null);

  const [selectedBgs, setSelectedBgs] = useState<string[]>(["white"]);
  const [activeBg, setActiveBg] = useState<string>("white");
  const [shadowEnabled, setShadowEnabled] = useState(false);
  const [shadowBlur, setShadowBlur] = useState(20);
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

  const currentBgColor = BG_OPTIONS.find(b => b.key === (selectedBgs.includes(activeBg) ? activeBg : selectedBgs[0]))?.color ?? "#FFFFFF";

  const outputDs = activePreset ? calcDs(activePreset.w, activePreset.h) : 1;
  const frameW = activePreset ? Math.round(activePreset.w * outputDs) : 0;
  const frameH = activePreset ? Math.round(activePreset.h * outputDs) : 0;
  const PAD = activePreset ? Math.round(Math.min(frameW, frameH) * 0.18) : 40;
  const stageW = frameW + PAD * 2;
  const stageH = frameH + PAD * 2;

  // ── Handle file ────────────────────────────────────────────────────────
  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const cb = detectContentBounds(img);
      setFile(f);
      setImgEl(img);
      setNatDims({ w: img.naturalWidth, h: img.naturalHeight });
      setContentBounds(cb);
      const next: Record<string, ImgState> = {};
      for (const p of SIZE_PRESETS)
        next[p.key] = makeInitialState(img.naturalWidth, img.naturalHeight, p.w, p.h, cb);
      setPerSize(next);
      setActiveKey(SIZE_PRESETS[0].key);
    };
    img.src = url;
  }, []);

  // ── Canvas draw ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = stageW;
    canvas.height = stageH;

    ctx.fillStyle = "#E5E5EA";
    ctx.fillRect(0, 0, stageW, stageH);

    ctx.fillStyle = currentBgColor;
    ctx.fillRect(PAD, PAD, frameW, frameH);

    if (imgEl && activeState && natDims) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD, PAD, frameW, frameH);
      ctx.clip();
      if (shadowEnabled) {
        ctx.shadowColor = "rgba(0,0,0,0.30)";
        ctx.shadowBlur = shadowBlur * outputDs;
        ctx.shadowOffsetY = Math.round(shadowBlur * 0.4 * outputDs);
      }
      ctx.drawImage(
        imgEl, 0, 0, imgEl.naturalWidth, imgEl.naturalHeight,
        PAD + activeState.x * outputDs,
        PAD + activeState.y * outputDs,
        natDims.w * activeState.scale * outputDs,
        natDims.h * activeState.scale * outputDs
      );
      ctx.restore();
    }

    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, 0, stageW, PAD);
    ctx.fillRect(0, PAD + frameH, stageW, PAD + 1);
    ctx.fillRect(0, PAD, PAD, frameH);
    ctx.fillRect(PAD + frameW, PAD, PAD + 1, frameH);

    ctx.strokeStyle = "rgba(0,113,227,0.9)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(PAD + 0.75, PAD + 0.75, frameW - 1.5, frameH - 1.5);

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
  }, [imgEl, activeState, outputDs, currentBgColor, frameW, frameH, PAD, stageW, stageH, showGuides, natDims, shadowEnabled, shadowBlur]);

  // ── Pointer events ─────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeState) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true; setGrabbing(true);
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
      [key]: clampState({ ...prev[key], x: prev[key].x + dx, y: prev[key].y + dy }, natDims.w, natDims.h, activePreset.w, activePreset.h),
    }));
  };

  const onPointerUp = () => { isDragging.current = false; setGrabbing(false); lastPt.current = null; };

  // ── Zoom / Center / Reset ──────────────────────────────────────────────
  const handleZoom = (factor: number) => {
    if (!activeState || !natDims || !activePreset) return;
    const { w: outW, h: outH } = activePreset;
    const { w: natW, h: natH } = natDims;
    const newScale = activeState.scale * factor;
    if (newScale < Math.min(outW / natW, outH / natH) * 0.05 || newScale > Math.max(outW / natW, outH / natH) * 8) return;
    const newW = natW * newScale, newH = natH * newScale;
    const curW = natW * activeState.scale, curH = natH * activeState.scale;
    const rx = curW > 0 ? (outW / 2 - activeState.x) / curW : 0.5;
    const ry = curH > 0 ? (outH / 2 - activeState.y) / curH : 0.5;
    const key = activeKey;
    setPerSize(prev => ({
      ...prev,
      [key]: clampState({ x: outW / 2 - rx * newW, y: outH / 2 - ry * newH, scale: newScale }, natW, natH, outW, outH),
    }));
  };

  const handleCenter = () => {
    if (!natDims || !activePreset) return;
    const { w: outW, h: outH } = activePreset;
    const key = activeKey;
    setPerSize(prev => {
      const cur = prev[key]; if (!cur) return prev;
      return { ...prev, [key]: { scale: cur.scale, x: (outW - natDims.w * cur.scale) / 2, y: (outH - natDims.h * cur.scale) / 2 } };
    });
  };

  const handleSyncAll = () => {
    if (!natDims || !activePreset || !activeState || selectedKeys.length < 2) return;
    const { w: outW, h: outH } = activePreset;
    const scx = (outW / 2 - activeState.x) / activeState.scale;
    const scy = (outH / 2 - activeState.y) / activeState.scale;
    const margin = 0.08;
    const defaultScale = contentBounds
      ? Math.min(outW * (1 - 2 * margin) / contentBounds.w, outH * (1 - 2 * margin) / contentBounds.h, Math.max(outW / natDims.w, outH / natDims.h) * 4)
      : Math.min(outW / natDims.w, outH / natDims.h);
    const zoomRatio = defaultScale > 0 ? activeState.scale / defaultScale : 1;
    setPerSize(prev => {
      const next = { ...prev };
      for (const key of selectedKeys) {
        if (key === activeKey) continue;
        const p = allSizes.find(p => p.key === key);
        if (!p) continue;
        const baseScale = contentBounds
          ? Math.min(p.w * (1 - 2 * margin) / contentBounds.w, p.h * (1 - 2 * margin) / contentBounds.h, Math.max(p.w / natDims.w, p.h / natDims.h) * 4)
          : Math.min(p.w / natDims.w, p.h / natDims.h);
        const scale = baseScale * zoomRatio;
        next[key] = clampState({ x: p.w / 2 - scx * scale, y: p.h / 2 - scy * scale, scale }, natDims.w, natDims.h, p.w, p.h);
      }
      return next;
    });
  };

  const handleReset = () => {
    if (!natDims || !activePreset) return;
    const key = activeKey;
    setPerSize(prev => ({ ...prev, [key]: makeInitialState(natDims.w, natDims.h, activePreset.w, activePreset.h, contentBounds) }));
  };

  // ── Size management ────────────────────────────────────────────────────
  const toggleSize = (p: SizePreset) => {
    if (selectedKeys.includes(p.key)) {
      const next = selectedKeys.filter(k => k !== p.key);
      setSelectedKeys(next);
      setPerSize(prev => { const n = { ...prev }; delete n[p.key]; return n; });
      if (activeKey === p.key && next.length > 0) setActiveKey(next[next.length - 1]);
    } else {
      const initState = natDims ? makeInitialState(natDims.w, natDims.h, p.w, p.h, contentBounds) : undefined;
      setSelectedKeys(prev => [...prev, p.key]);
      if (initState) setPerSize(prev => ({ ...prev, [p.key]: initState }));
      setActiveKey(p.key);
    }
  };

  const addCustomSize = () => {
    const w = parseInt(customW, 10), h = parseInt(customH, 10);
    if (isNaN(w) || isNaN(h) || w < 1 || h < 1 || w > 10000 || h > 10000) return;
    const key = `${w}x${h}`;
    const newPreset: SizePreset = { key, w, h, label: `${w}×${h}` };
    if (!customSizes.find(p => p.key === key)) setCustomSizes(prev => [...prev, newPreset]);
    const initState = natDims ? makeInitialState(natDims.w, natDims.h, w, h, contentBounds) : undefined;
    if (!selectedKeys.includes(key)) setSelectedKeys(prev => [...prev, key]);
    if (initState) setPerSize(prev => ({ ...prev, [key]: initState }));
    setActiveKey(key);
    setCustomW(""); setCustomH("");
  };

  // ── Generate blob ──────────────────────────────────────────────────────
  const generateBlob = useCallback((state: ImgState, outW: number, outH: number, bgColor: string): Promise<Blob | null> => {
    return new Promise(resolve => {
      if (!imgEl || !natDims) return resolve(null);
      const canvas = document.createElement("canvas");
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, outW, outH);
      if (shadowEnabled) {
        ctx.shadowColor = "rgba(0,0,0,0.30)";
        ctx.shadowBlur = shadowBlur;
        ctx.shadowOffsetY = Math.round(shadowBlur * 0.4);
      }
      ctx.drawImage(imgEl, 0, 0, imgEl.naturalWidth, imgEl.naturalHeight, state.x, state.y, natDims.w * state.scale, natDims.h * state.scale);
      canvas.toBlob(resolve, "image/png");
    });
  }, [imgEl, natDims, shadowEnabled, shadowBlur]);

  // ── Download ZIP ───────────────────────────────────────────────────────
  const handleDownload = async () => {
    if (isDownloading.current || !file || !zipName.trim() || selectedKeys.length === 0) return;
    isDownloading.current = true;
    setDownloading(true);
    const name = zipName.trim();
    const files: { fname: string; blob: Blob }[] = [];
    for (const key of selectedKeys) {
      const state = perSize[key];
      const preset = allSizes.find(p => p.key === key);
      if (!state || !preset) continue;
      for (const bgKey of selectedBgs) {
        const bg = BG_OPTIONS.find(b => b.key === bgKey);
        if (!bg) continue;
        const blob = await generateBlob(state, preset.w, preset.h, bg.color);
        const fname = selectedBgs.length > 1 ? `${bgKey}/${name}_${key}_${bgKey}.png` : `${name}_${key}.png`;
        if (blob) files.push({ fname, blob });
      }
    }
    if (files.length === 1) {
      // 작업본이 1개면 압축하지 않고 개별 파일로 다운로드
      const { fname, blob } = files[0];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = fname.split("/").pop()!;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else if (files.length > 0) {
      const zip = new JSZip();
      for (const { fname, blob } of files) zip.file(fname, blob);
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a"); a.href = url; a.download = `${name}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    isDownloading.current = false;
    setDownloading(false); setShowNameInput(false); setZipName("");
  };

  const resetAll = () => {
    setFile(null); setImgEl(null); setNatDims(null); setContentBounds(null);
    setSelectedKeys(SIZE_PRESETS.map(p => p.key));
    setPerSize({}); setActiveKey(SIZE_PRESETS[0].key);
    setCustomSizes([]);
    setShowNameInput(false); setZipName("");
  };

  const fileCount = selectedKeys.length * Math.max(selectedBgs.length, 1);
  const maxPreviewDim = Math.max(...selectedKeys.map(k => { const p = allSizes.find(p => p.key === k); return p ? Math.max(p.w, p.h) : 0; }), 1);
  const globalPds = 160 / maxPreviewDim;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", height: "calc(100vh - 48px)", background: "#F5F5F7", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif" }}>

      {/* ── Left Panel ── */}
      <aside style={{ width: 320, minWidth: 320, background: "#fff", borderRight: "1px solid rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", overflowY: "auto" }}>

        {/* Upload */}
        <div style={{ padding: "20px 16px 0" }}>
          <p style={sectionLabel}>누끼컷 PNG</p>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            style={{ border: "1.5px dashed rgba(0,0,0,0.14)", borderRadius: 12, padding: "14px 12px", cursor: "pointer", textAlign: "center" }}
          >
            <input ref={fileInputRef} type="file" accept="image/png,image/webp" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            {imgEl ? (
              <div>
                <div style={{ background: "repeating-conic-gradient(#d1d5db 0% 25%, #fff 0% 50%) 0 0 / 12px 12px", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", maxHeight: 96, overflow: "hidden" }}>
                  <img src={imgEl.src} alt="" style={{ maxHeight: 96, maxWidth: "100%", objectFit: "contain" }} />
                </div>
                <p style={{ fontSize: 11, color: "#6e6e73", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file?.name}</p>
                {natDims && <p style={{ fontSize: 10, color: "#aeaeb2", marginTop: 2 }}>{natDims.w} × {natDims.h} px</p>}
              </div>
            ) : (
              <div style={{ padding: "8px 0" }}>
                <div style={{ fontSize: 28, marginBottom: 6, color: "#aeaeb2" }}>✂️</div>
                <p style={{ fontSize: 13, fontWeight: 500, color: "#3c3c43", margin: 0 }}>누끼컷 업로드</p>
                <p style={{ fontSize: 11, color: "#aeaeb2", marginTop: 3, margin: "3px 0 0" }}>투명 배경 PNG · WebP</p>
              </div>
            )}
          </div>
          {file && <button onClick={resetAll} style={{ marginTop: 6, width: "100%", fontSize: 11, color: "#ff3b30", background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>초기화</button>}
        </div>

        {/* Background */}
        <div style={{ padding: "20px 16px 0" }}>
          <p style={sectionLabel}>배경색</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {BG_OPTIONS.map(bg => {
              const sel = selectedBgs.includes(bg.key);
              const act = activeBg === bg.key && sel;
              return (
                <div key={bg.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, border: `1.5px solid ${sel ? "rgba(0,113,227,0.35)" : "rgba(0,0,0,0.1)"}`, background: sel ? "rgba(0,113,227,0.04)" : "#fff", cursor: "pointer", transition: "all 0.12s" }}
                  onClick={() => {
                    if (sel && selectedBgs.length === 1) return;
                    if (sel) { setSelectedBgs(prev => prev.filter(k => k !== bg.key)); if (activeBg === bg.key) setActiveBg(selectedBgs.find(k => k !== bg.key) ?? "white"); }
                    else { setSelectedBgs(prev => [...prev, bg.key]); setActiveBg(bg.key); }
                  }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: bg.color, border: "1px solid rgba(0,0,0,0.1)", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: "#1d1d1f", margin: 0 }}>{bg.label}</p>
                    <p style={{ fontSize: 10, color: "#aeaeb2", margin: 0 }}>{bg.color}</p>
                  </div>
                  {sel && (
                    <button onClick={e => { e.stopPropagation(); setActiveBg(bg.key); }} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, border: `1px solid ${act ? APPLE_BLUE : "rgba(0,0,0,0.1)"}`, background: act ? APPLE_BLUE : "#fff", color: act ? "#fff" : "#6e6e73", cursor: "pointer" }}>
                      {act ? "미리보기" : "선택"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {selectedBgs.length > 1 && <p style={{ fontSize: 10, color: "#aeaeb2", marginTop: 6 }}>두 색상 모두 내보냅니다 → 폴더로 분리</p>}
        </div>

        {/* Shadow */}
        <div style={{ padding: "16px 16px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: shadowEnabled ? 10 : 0 }}>
            <p style={{ ...sectionLabel, margin: 0 }}>그림자</p>
            <button onClick={() => setShadowEnabled(v => !v)} style={{
              padding: "4px 12px", borderRadius: 8, fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer", transition: "all 0.15s",
              background: shadowEnabled ? "#1d1d1f" : "#F5F5F7",
              color: shadowEnabled ? "#fff" : "#6e6e73",
            }}>
              {shadowEnabled ? "적용 중" : "끔"}
            </button>
          </div>
          {shadowEnabled && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#aeaeb2", marginBottom: 4 }}>
                <span>강도</span><span>{shadowBlur}</span>
              </div>
              <input type="range" min={5} max={60} value={shadowBlur} onChange={e => setShadowBlur(Number(e.target.value))} style={{ width: "100%", accentColor: "#1d1d1f" }} />
            </div>
          )}
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
                if (natDims) for (const p of allSizes) next[p.key] = makeInitialState(natDims.w, natDims.h, p.w, p.h, contentBounds);
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
                  <button onClick={() => { if (sel) setActiveKey(p.key); else toggleSize(p); }} style={{ flex: 1, padding: "7px 10px", border: "none", cursor: "pointer", textAlign: "left", background: act ? "rgba(0,113,227,0.08)" : sel ? "#F5F5F7" : "transparent", color: act ? APPLE_BLUE : sel ? "#1d1d1f" : "#aeaeb2", fontSize: 12, fontWeight: act ? 600 : 400, transition: "all 0.1s" }}>
                    {p.label}
                  </button>
                  <button onClick={() => toggleSize(p)} style={{ padding: "7px 8px", border: "none", cursor: "pointer", fontSize: 11, lineHeight: 1, background: act ? "rgba(0,113,227,0.08)" : sel ? "#F5F5F7" : "transparent", color: sel ? "#aeaeb2" : "#c7c7cc", transition: "all 0.1s" }}>
                    {sel ? "×" : "+"}
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 5, alignItems: "center" }}>
            <input type="number" placeholder="너비" value={customW} onChange={e => setCustomW(e.target.value)} onKeyDown={e => e.key === "Enter" && addCustomSize()} style={{ flex: "0 0 56px", width: 56, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 7, padding: "5px 6px", fontSize: 11, outline: "none", color: "#1d1d1f" }} />
            <span style={{ fontSize: 11, color: "#aeaeb2", flexShrink: 0 }}>×</span>
            <input type="number" placeholder="높이" value={customH} onChange={e => setCustomH(e.target.value)} onKeyDown={e => e.key === "Enter" && addCustomSize()} style={{ flex: "0 0 56px", width: 56, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 7, padding: "5px 6px", fontSize: 11, outline: "none", color: "#1d1d1f" }} />
            <button onClick={addCustomSize} disabled={!customW || !customH} style={{ padding: "5px 8px", borderRadius: 7, background: "#1d1d1f", color: "#fff", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 500, opacity: (!customW || !customH) ? 0.35 : 1 }}>추가</button>
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
            <div style={{ background: "#fff", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", padding: "0 20px", overflowX: "auto", flexShrink: 0 }}>
              {selectedKeys.map(key => {
                const p = allSizes.find(p => p.key === key);
                const act = key === activeKey;
                return (
                  <button key={key} onClick={() => setActiveKey(key)} style={{ padding: "11px 14px", fontSize: 12, fontWeight: act ? 600 : 400, border: "none", borderBottom: `2px solid ${act ? APPLE_BLUE : "transparent"}`, background: "transparent", color: act ? APPLE_BLUE : "#6e6e73", cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.15s" }}>
                    {p?.label ?? key}
                  </button>
                );
              })}
              {/* Bg switcher in tabs row if multiple bgs */}
              {selectedBgs.length > 1 && activePreset && (
                <div style={{ marginLeft: "auto", display: "flex", gap: 4, paddingRight: 4 }}>
                  {selectedBgs.map(bgKey => {
                    const bg = BG_OPTIONS.find(b => b.key === bgKey);
                    const act = activeBg === bgKey;
                    return (
                      <button key={bgKey} onClick={() => setActiveBg(bgKey)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, border: `1px solid ${act ? APPLE_BLUE : "rgba(0,0,0,0.1)"}`, background: act ? "rgba(0,113,227,0.06)" : "#fff", cursor: "pointer", fontSize: 11, color: act ? APPLE_BLUE : "#6e6e73", fontWeight: act ? 600 : 400 }}>
                        <div style={{ width: 12, height: 12, borderRadius: 3, background: bg?.color, border: "1px solid rgba(0,0,0,0.12)" }} />
                        {bg?.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
              {activePreset && activeState ? (
                <>
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                    <canvas ref={canvasRef} style={{ cursor: grabbing ? "grabbing" : "grab", borderRadius: 6, display: "block" }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#aeaeb2" }}>{activePreset.w} × {activePreset.h} px · PNG</span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {[{ l: "+", fn: () => handleZoom(1.2) }, { l: "−", fn: () => handleZoom(1 / 1.2) }].map(b => <button key={b.l} onClick={b.fn} style={ctrlBtn}>{b.l}</button>)}
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
                <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#aeaeb2", fontSize: 13 }}>왼쪽에서 사이즈를 선택하세요</div>
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
                      const pDs = Math.min(
                        Math.max(globalPds, 48 / Math.min(p.w, p.h)),
                        164 / p.h
                      );
                      const act = key === activeKey;
                      return (
                        <div key={key} onClick={() => setActiveKey(key)} style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                          <div style={{ height: 164, display: "flex", alignItems: "flex-end", justifyContent: "center", overflow: "hidden" }}>
                            <div style={{
                              borderRadius: 10, overflow: "hidden",
                              border: `2px solid ${act ? APPLE_BLUE : "rgba(0,0,0,0.08)"}`,
                              boxShadow: act ? `0 0 0 3px rgba(0,113,227,0.15)` : "none",
                              transition: "all 0.15s",
                            }}>
                              <PreviewCanvas imgEl={imgEl} natDims={natDims} state={state} outW={p.w} outH={p.h} pDs={pDs} bgColor={currentBgColor} shadowEnabled={shadowEnabled} shadowBlur={shadowBlur} />
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
                        {downloading ? "처리 중…" : "저장"}
                      </button>
                      <button onClick={() => { setShowNameInput(false); setZipName(""); }} style={cancelBtn}>취소</button>
                    </>
                  ) : (
                    <button onClick={() => setShowNameInput(true)} style={downloadBtn}>
                      ZIP 다운로드 ({fileCount}개)
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

// ── Sub-components & Styles ────────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect x="6" y="10" width="36" height="28" rx="4" stroke="#C7C7CC" strokeWidth="2"/>
        <circle cx="16" cy="20" r="3.5" stroke="#C7C7CC" strokeWidth="1.5"/>
        <path d="M6 32l9-9 7 7 5-5 9 9" stroke="#C7C7CC" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
      <p style={{ fontSize: 15, fontWeight: 500, color: "#3c3c43", margin: 0 }}>왼쪽에서 누끼컷 PNG를 업로드하세요</p>
      <p style={{ fontSize: 12, color: "#aeaeb2", margin: 0 }}>투명 배경 PNG · WebP 지원</p>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 20, background: "rgba(0,0,0,0.1)", alignSelf: "center" }} />;
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
