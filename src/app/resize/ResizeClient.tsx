"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import JSZip from "jszip";

type ImgState = { x: number; y: number; scale: number };
type TopTab = "resize" | "thumbnail";
type ResizeMode = "scene" | "cutout";

const SIZE_PRESETS = [
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
] as const;

const BG_OPTIONS = [
  { key: "white", label: "화이트", color: "#FFFFFF" },
  { key: "gray",  label: "그레이", color: "#F4F0F1" },
] as const;

const MAX_FRAME = 520;

// ── 탭별 독립 상태 타입 ──
type ContentBounds = { x: number; y: number; w: number; h: number };

type TabState = {
  file: File | null;
  previewUrl: string | null;
  imgEl: HTMLImageElement | null;
  natDims: { w: number; h: number } | null;
  detectedBg: string;
  contentBounds: ContentBounds | null;
  selectedKeys: string[];
  perSize: Record<string, ImgState>;
  activeKey: string | null;
  customSizes: { key: string; w: number; h: number; label: string }[];
};

const EMPTY_TAB: TabState = {
  file: null, previewUrl: null, imgEl: null, natDims: null,
  detectedBg: "rgb(255,255,255)", contentBounds: null, selectedKeys: [], perSize: {},
  activeKey: null, customSizes: [],
};

// ── 헬퍼 함수들 ──
function calcDs(outW: number, outH: number) {
  return Math.min(MAX_FRAME / outW, MAX_FRAME / outH, 1);
}

function makeInitialState(
  natW: number, natH: number,
  outW: number, outH: number,
  cover: boolean,
  contentBounds?: ContentBounds | null,
  margin = 0.08
): ImgState {
  if (contentBounds) {
    // 각 캔버스 크기에 맞게 스케일 계산 — 객체가 마진 포함 꼭 맞게
    const scale = Math.min(
      outW * (1 - 2 * margin) / contentBounds.w,
      outH * (1 - 2 * margin) / contentBounds.h,
      Math.max(outW / natW, outH / natH) * 4
    );
    const cx = contentBounds.x + contentBounds.w / 2;
    const cy = contentBounds.y + contentBounds.h / 2;
    return { x: outW / 2 - cx * scale, y: outH / 2 - cy * scale, scale };
  }
  const scale = cover ? Math.max(outW / natW, outH / natH) : Math.min(outW / natW, outH / natH);
  const w = natW * scale, h = natH * scale;
  return { x: (outW - w) / 2, y: (outH - h) / 2, scale };
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
  return { x, y, scale: s.scale };
}

function detectBgColor(img: HTMLImageElement): string {
  try {
    const scale = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const s = Math.max(3, Math.round(Math.min(w, h) * 0.05));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "#ffffff";
    ctx.drawImage(img, 0, 0, w, h);
    const regions = [ctx.getImageData(0,0,s,s), ctx.getImageData(w-s,0,s,s), ctx.getImageData(0,h-s,s,s), ctx.getImageData(w-s,h-s,s,s)];
    let r = 0, g = 0, b = 0, count = 0;
    for (const reg of regions)
      for (let i = 0; i < reg.data.length; i += 4) { r += reg.data[i]; g += reg.data[i+1]; b += reg.data[i+2]; count++; }
    return `rgb(${Math.round(r/count)},${Math.round(g/count)},${Math.round(b/count)})`;
  } catch { return "#ffffff"; }
}

// 배경색과 다른 픽셀의 bounding box를 찾아 실제 객체 영역을 반환
// 행/열 밀도 기반으로 그림자 등 얇은 노이즈 영역을 제외하고 주 객체만 탐지
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

    // 행/열별 비배경 픽셀 수 집계
    const rowCounts = new Int32Array(sh);
    const colCounts = new Int32Array(sw);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) * 4;
        if (data[i + 3] < 128) continue;
        const diff = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg) + Math.abs(data[i + 2] - bb);
        if (diff > threshold) { rowCounts[y]++; colCounts[x]++; }
      }
    }

    // 최대 밀도의 8% 이상인 행/열만 주 객체로 인정
    // 절대값 기준보다 강건 — 그림자(밀도 낮음)는 제외, 본체(밀도 높음)만 포함
    const maxRow = rowCounts.reduce((a, b) => Math.max(a, b), 0);
    const maxCol = colCounts.reduce((a, b) => Math.max(a, b), 0);
    const minRowDensity = Math.max(3, Math.round(maxRow * 0.15));
    const minColDensity = Math.max(3, Math.round(maxCol * 0.15));

    let minY = -1, maxY = -1, minX = -1, maxX = -1;
    for (let y = 0; y < sh; y++) {
      if (rowCounts[y] >= minRowDensity) { if (minY < 0) minY = y; maxY = y; }
    }
    for (let x = 0; x < sw; x++) {
      if (colCounts[x] >= minColDensity) { if (minX < 0) minX = x; maxX = x; }
    }

    if (minX < 0 || minY < 0) return null;
    return {
      x: Math.floor(minX / sampleScale),
      y: Math.floor(minY / sampleScale),
      w: Math.ceil((maxX - minX + 1) / sampleScale),
      h: Math.ceil((maxY - minY + 1) / sampleScale),
    };
  } catch { return null; }
}

interface Props { defaultTab?: TopTab; }

export default function ResizeClient({ defaultTab = "resize" }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDragging = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const isDownloadingRef = useRef(false);

  const [topTab, setTopTab] = useState<TopTab>(defaultTab);
  const [resizeMode, setResizeMode] = useState<ResizeMode>("cutout");

  // 탭별 독립 상태
  const [tabStates, setTabStates] = useState<Record<TopTab, TabState>>({
    resize: { ...EMPTY_TAB },
    thumbnail: { ...EMPTY_TAB },
  });

  // 썸네일 전용 설정 (탭 공유 불필요)
  const [selectedBgs, setSelectedBgs] = useState<string[]>(["white"]);
  const [activeBg, setActiveBg] = useState<string>("white");
  const [shadowEnabled, setShadowEnabled] = useState(false);
  const [shadowBlur, setShadowBlur] = useState(20);

  const [showGuides, setShowGuides] = useState(false);
  const [customW, setCustomW] = useState("");
  const [customH, setCustomH] = useState("");
  const [grabbing, setGrabbing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showNameInput, setShowNameInput] = useState(false);
  const [zipName, setZipName] = useState("");

  // ── 리사이즈 스텝 플로우 ──
  const [resizeStep, setResizeStep] = useState<1|2|3|4|5>(1);
  // 1=업로드, 2=영점조준, 3=유형선택, 4=사이즈선택, 5=시안확인
  const [zeroImgState, setZeroImgState] = useState<ImgState | null>(null);
  const [zeroCenterRef, setZeroCenterRef] = useState<{ scx: number; scy: number } | null>(null);
  const isZeroDragging = useRef(false);
  const lastZeroPt = useRef<{ x: number; y: number } | null>(null);
  const [zeroGrabbing, setZeroGrabbing] = useState(false);
  const resizeFileInputRef = useRef<HTMLInputElement>(null);

  // 영점 조준 캔버스 상수 (1000×1000 기준)
  const ZERO_W = 1000, ZERO_H = 1000;
  const zeroDs = calcDs(ZERO_W, ZERO_H);
  const zeroFrameW = ZERO_W * zeroDs;
  const zeroFrameH = ZERO_H * zeroDs;
  const zeroPad = Math.round(Math.min(zeroFrameW, zeroFrameH) * 0.2);
  const zeroStageW = Math.round(zeroFrameW + zeroPad * 2);
  const zeroStageH = Math.round(zeroFrameH + zeroPad * 2);

  // 현재 탭 상태 단축
  const ts = tabStates[topTab];
  const { file, previewUrl, imgEl, natDims, detectedBg, selectedKeys, perSize, activeKey, customSizes } = ts;

  // 현재 탭 상태 업데이트 헬퍼
  const setTS = useCallback((tab: TopTab, updates: Partial<TabState> | ((prev: TabState) => Partial<TabState>)) => {
    setTabStates((prev) => ({
      ...prev,
      [tab]: { ...prev[tab], ...(typeof updates === "function" ? updates(prev[tab]) : updates) },
    }));
  }, []);

  const allSizes = [...SIZE_PRESETS, ...customSizes];
  const activePreset = allSizes.find((p) => p.key === activeKey) ?? null;
  const activeState = activeKey ? (perSize[activeKey] ?? null) : null;

  const outputDs = activePreset ? calcDs(activePreset.w, activePreset.h) : 1;
  // Math.round 제거 — 소수점 유지해야 outputDs와 frameW/frameH 비율이 정확히 일치
  // round하면 e.g. 1920×1080에서 frameH=round(292.5)=293 → 0.5px 오차 → 위치 불일치
  const frameW = activePreset ? activePreset.w * outputDs : 0;
  const frameH = activePreset ? activePreset.h * outputDs : 0;
  const pad = activePreset ? Math.round(Math.min(frameW, frameH) * 0.2) : 0;
  const stageW = Math.round(frameW + pad * 2);
  const stageH = Math.round(frameH + pad * 2);

  const isCover = topTab === "resize" && resizeMode === "scene";
  const currentBgKey = selectedBgs.includes(activeBg) ? activeBg : (selectedBgs[0] ?? "white");
  const currentBgColor = BG_OPTIONS.find((b) => b.key === currentBgKey)?.color ?? "#ffffff";
  const stageBg = topTab === "thumbnail" ? currentBgColor
    : resizeMode === "cutout" ? detectedBg : "#e5e7eb";
  const shadowCss = shadowEnabled
    ? `drop-shadow(0px ${Math.round(shadowBlur * 0.5)}px ${shadowBlur}px rgba(0,0,0,0.35))` : "none";

  const handleFile = (f: File, tab: TopTab) => {
    if (!f.type.startsWith("image/")) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const detectedBg = detectBgColor(img);
      const contentBounds = detectContentBounds(img, detectedBg);
      // 영점 조준 초기 상태 설정
      const initZero = makeInitialState(img.naturalWidth, img.naturalHeight, ZERO_W, ZERO_H, false, contentBounds);
      setZeroImgState(initZero);
      setZeroCenterRef(null);
      if (tab === "resize") setResizeStep(2);
      setTS(tab, {
        file: f, previewUrl: url, imgEl: img,
        natDims: { w: img.naturalWidth, h: img.naturalHeight },
        detectedBg, contentBounds,
        selectedKeys: [], perSize: {}, activeKey: null,
      });
    };
    img.src = url;
  };

  // ── 영점 조준 핸들러 ──
  const onZeroPointerDown = (e: React.PointerEvent) => {
    if (!zeroImgState) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isZeroDragging.current = true; setZeroGrabbing(true);
    lastZeroPt.current = { x: e.clientX, y: e.clientY };
  };
  const onZeroPointerMove = (e: React.PointerEvent) => {
    if (!isZeroDragging.current || !lastZeroPt.current || !zeroImgState || !natDims) return;
    const dx = (e.clientX - lastZeroPt.current.x) / zeroDs;
    const dy = (e.clientY - lastZeroPt.current.y) / zeroDs;
    lastZeroPt.current = { x: e.clientX, y: e.clientY };
    setZeroImgState(prev => prev ? clampState({ ...prev, x: prev.x + dx, y: prev.y + dy }, natDims.w, natDims.h, ZERO_W, ZERO_H, false) : null);
  };
  const onZeroPointerUp = () => { isZeroDragging.current = false; setZeroGrabbing(false); lastZeroPt.current = null; };

  const handleZeroZoom = (factor: number) => {
    if (!zeroImgState || !natDims) return;
    const newScale = zeroImgState.scale * factor;
    const minContain = Math.min(ZERO_W / natDims.w, ZERO_H / natDims.h);
    if (newScale < minContain * 0.05 || newScale > Math.max(ZERO_W / natDims.w, ZERO_H / natDims.h) * 8) return;
    const newW = natDims.w * newScale, newH = natDims.h * newScale;
    const curW = natDims.w * zeroImgState.scale, curH = natDims.h * zeroImgState.scale;
    const cx = ZERO_W / 2, cy = ZERO_H / 2;
    const rx = curW > 0 ? (cx - zeroImgState.x) / curW : 0.5;
    const ry = curH > 0 ? (cy - zeroImgState.y) / curH : 0.5;
    setZeroImgState(prev => prev ? clampState({ x: cx - rx * newW, y: cy - ry * newH, scale: newScale }, natDims.w, natDims.h, ZERO_W, ZERO_H, false) : null);
  };

  const advanceFromZero = () => {
    if (!zeroImgState) return;
    setZeroCenterRef({ scx: (ZERO_W / 2 - zeroImgState.x) / zeroImgState.scale, scy: (ZERO_H / 2 - zeroImgState.y) / zeroImgState.scale });
    setResizeStep(3);
  };

  // 시안 확인 진입: 영점 중심으로 전체 사이즈 자동 배치
  const enterPreviewStep = () => {
    if (!natDims) return;
    setTS("resize", (prev) => {
      const allKeys = [...SIZE_PRESETS.map(p => p.key), ...prev.customSizes.map(p => p.key)];
      const keys = prev.selectedKeys.length > 0 ? prev.selectedKeys : allKeys;
      const cb = prev.contentBounds;
      const margin = 0.08;
      const zcr = zeroCenterRef;
      const next = { ...prev.perSize };
      for (const key of keys) {
        const p = [...SIZE_PRESETS, ...prev.customSizes].find(p => p.key === key);
        if (!p) continue;
        if (zcr && cb) {
          const scale = Math.min(p.w * (1 - 2 * margin) / cb.w, p.h * (1 - 2 * margin) / cb.h, Math.max(p.w / natDims.w, p.h / natDims.h) * 4);
          next[key] = clampState({ x: p.w / 2 - zcr.scx * scale, y: p.h / 2 - zcr.scy * scale, scale }, natDims.w, natDims.h, p.w, p.h, isCover);
        } else if (!next[key]) {
          next[key] = makeInitialState(natDims.w, natDims.h, p.w, p.h, isCover, !isCover ? cb : null);
        }
      }
      const newActiveKey = keys.includes(prev.activeKey ?? "") ? prev.activeKey : (keys[0] ?? null);
      return { selectedKeys: keys, perSize: next, activeKey: newActiveKey };
    });
    setResizeStep(5);
  };

  // 탭/모드 변경 시 전체 사이즈 초기상태 리셋
  useEffect(() => {
    if (!natDims || selectedKeys.length === 0) return;
    setTS(topTab, (prev) => {
      const next = { ...prev.perSize };
      for (const key of prev.selectedKeys) {
        const p = allSizes.find((p) => p.key === key);
        if (p) next[key] = makeInitialState(natDims.w, natDims.h, p.w, p.h, isCover, !isCover ? prev.contentBounds : null);
      }
      return { perSize: next };
    });
  }, [topTab, resizeMode]);

  const toggleSize = (preset: { key: string; w: number; h: number }) => {
    const { key, w, h } = preset;
    setTS(topTab, (prev) => {
      if (prev.selectedKeys.includes(key)) {
        const next = prev.selectedKeys.filter((k) => k !== key);
        const nextPerSize = { ...prev.perSize };
        delete nextPerSize[key];
        return { selectedKeys: next, perSize: nextPerSize, activeKey: next[next.length - 1] ?? null };
      }
      const initState = prev.natDims ? makeInitialState(prev.natDims.w, prev.natDims.h, w, h, isCover, !isCover ? prev.contentBounds : null) : undefined;
      return {
        selectedKeys: [...prev.selectedKeys, key],
        perSize: initState ? { ...prev.perSize, [key]: initState } : prev.perSize,
        activeKey: key,
      };
    });
  };

  const addCustomSize = () => {
    const w = parseInt(customW, 10), h = parseInt(customH, 10);
    if (isNaN(w) || isNaN(h) || w < 1 || h < 1 || w > 10000 || h > 10000) return;
    const key = `${w}x${h}`;
    if (selectedKeys.includes(key)) { setTS(topTab, { activeKey: key }); return; }
    setTS(topTab, (prev) => {
      const newCustom = prev.customSizes.find((p) => p.key === key)
        ? prev.customSizes : [...prev.customSizes, { key, w, h, label: `${w}×${h}` }];
      const initState = prev.natDims ? makeInitialState(prev.natDims.w, prev.natDims.h, w, h, isCover, !isCover ? prev.contentBounds : null) : undefined;
      return {
        customSizes: newCustom,
        selectedKeys: [...prev.selectedKeys, key],
        perSize: initState ? { ...prev.perSize, [key]: initState } : prev.perSize,
        activeKey: key,
      };
    });
    setCustomW(""); setCustomH("");
  };

  const resetAll = () => {
    setTabStates({ resize: { ...EMPTY_TAB }, thumbnail: { ...EMPTY_TAB } });
    setShadowEnabled(false); setShadowBlur(20);
    setSelectedBgs(["white"]); setActiveBg("white");
    setShowGuides(false);
    setShowNameInput(false); setZipName("");
    setResizeStep(1); setZeroImgState(null); setZeroCenterRef(null);
  };

  // 중앙 맞추기: 현재 scale은 유지하고 위치만 프레임 중앙으로
  const handleCenterAlign = () => {
    if (!natDims || !activeKey || !activePreset) return;
    const { w: outW, h: outH } = activePreset;
    const tab = topTab;
    const key = activeKey;
    // 함수형 업데이트로 최신 scale을 state에서 직접 읽어 사용
    setTS(tab, (prev) => {
      const current = prev.perSize[key];
      if (!current) return {};
      const imgW = natDims.w * current.scale;
      const imgH = natDims.h * current.scale;
      return {
        perSize: { ...prev.perSize, [key]: { scale: current.scale, x: (outW - imgW) / 2, y: (outH - imgH) / 2 } },
      };
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!activeState) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true; setGrabbing(true);
    lastPt.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current || !lastPt.current || !activeState || !activePreset || !natDims || !activeKey) return;
    const dx = (e.clientX - lastPt.current.x) / outputDs;
    const dy = (e.clientY - lastPt.current.y) / outputDs;
    lastPt.current = { x: e.clientX, y: e.clientY };
    const tab = topTab;
    setTS(tab, (prev) => ({
      perSize: {
        ...prev.perSize,
        [activeKey]: clampState({ ...prev.perSize[activeKey], x: prev.perSize[activeKey].x + dx, y: prev.perSize[activeKey].y + dy },
          natDims.w, natDims.h, activePreset.w, activePreset.h, isCover),
      },
    }));
  };

  const onPointerUp = () => { isDragging.current = false; setGrabbing(false); lastPt.current = null; };

  const handleZoom = (factor: number) => {
    if (!activeState || !natDims || !activePreset || !activeKey) return;
    const { w: outW, h: outH } = activePreset;
    const { w: natW, h: natH } = natDims;
    const newScale = activeState.scale * factor;
    const minCover = Math.max(outW / natW, outH / natH);
    const minContain = Math.min(outW / natW, outH / natH);
    if (isCover && newScale < minCover) return;
    if (!isCover && newScale < minContain * 0.05) return;
    if (newScale > minCover * 8) return;
    const newW = natW * newScale, newH = natH * newScale;
    const curW = natW * activeState.scale, curH = natH * activeState.scale;
    const cx = outW / 2, cy = outH / 2;
    const rx = curW > 0 ? (cx - activeState.x) / curW : 0.5;
    const ry = curH > 0 ? (cy - activeState.y) / curH : 0.5;
    const tab = topTab;
    setTS(tab, (prev) => ({
      perSize: {
        ...prev.perSize,
        [activeKey]: clampState({ x: cx - rx * newW, y: cy - ry * newH, scale: newScale }, natW, natH, outW, outH, isCover),
      },
    }));
  };

  const generateBlob = useCallback((imgState: ImgState, outW: number, outH: number, fillColor?: string): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!imgEl || !natDims) return resolve(null);
      const canvas = document.createElement("canvas");
      canvas.width = outW; canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      if (fillColor) { ctx.fillStyle = fillColor; ctx.fillRect(0, 0, outW, outH); }
      if (shadowEnabled && topTab === "thumbnail") {
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = shadowBlur;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = Math.round(shadowBlur * 0.5);
      }
      // 9인수 형식으로 소스 영역 명시 — 브라우저별 5인수 해석 차이 방지
      ctx.drawImage(
        imgEl,
        0, 0, imgEl.naturalWidth, imgEl.naturalHeight,           // 소스: 전체 원본
        imgState.x, imgState.y,                                   // 캔버스 내 위치
        natDims.w * imgState.scale, natDims.h * imgState.scale    // 캔버스 내 크기
      );
      ctx.shadowColor = "transparent";
      const mime = topTab === "thumbnail" ? "image/png" : (file?.type || "image/jpeg");
      canvas.toBlob(resolve, mime, 0.95);
    });
  }, [imgEl, natDims, file, topTab, shadowEnabled, shadowBlur]);

  // 영점 조준: 현재 사이즈에서 잡은 중심점 기준으로 전체 사이즈 동기화
  // 중심점은 공유, 스케일은 캔버스별 content bounds에 맞게 독립 계산 (마진 포함)
  const handleSyncAll = () => {
    if (!natDims || !activeKey || !activePreset || !activeState || selectedKeys.length < 2) return;
    const { w: outW, h: outH } = activePreset;
    // 현재 캔버스 중앙에 보이는 이미지 좌표 = 사용자가 정한 중심점
    const scx = (outW / 2 - activeState.x) / activeState.scale;
    const scy = (outH / 2 - activeState.y) / activeState.scale;
    const tab = topTab;
    setTS(tab, (prev) => {
      const next = { ...prev.perSize };
      const cb = prev.contentBounds;
      const margin = 0.08;
      for (const key of prev.selectedKeys) {
        if (key === activeKey) continue;
        const p = allSizes.find((p) => p.key === key);
        if (!p) continue;
        // 각 캔버스에 맞는 스케일: content bounds 기준 마진 포함 꼭 맞게
        const scale = cb
          ? Math.min(
              p.w * (1 - 2 * margin) / cb.w,
              p.h * (1 - 2 * margin) / cb.h,
              Math.max(p.w / natDims.w, p.h / natDims.h) * 4
            )
          : activeState.scale;
        next[key] = clampState(
          { x: p.w / 2 - scx * scale, y: p.h / 2 - scy * scale, scale },
          natDims.w, natDims.h, p.w, p.h, isCover
        );
      }
      return { perSize: next };
    });
  };

  const handleDownloadZip = async () => {
    if (isDownloadingRef.current || !file || selectedKeys.length === 0 || !zipName.trim()) return;

    isDownloadingRef.current = true;
    setDownloading(true);
    const name = zipName.trim();
    const zip = new JSZip();
    for (const sizeKey of selectedKeys) {
      const imgState = perSize[sizeKey];
      const preset = allSizes.find((p) => p.key === sizeKey);
      if (!imgState || !preset) continue;
      if (topTab === "thumbnail") {
        for (const bgKey of selectedBgs) {
          const bgOpt = BG_OPTIONS.find((b) => b.key === bgKey);
          if (!bgOpt) continue;
          const blob = await generateBlob(imgState, preset.w, preset.h, bgOpt.color);
          // 두 색상 모두 선택 시 폴더로 분리, 단일 선택 시 플랫 구조
          const path = selectedBgs.length > 1
            ? `${bgKey}/${name}_${sizeKey}_${bgKey}.png`
            : `${name}_${sizeKey}_${bgKey}.png`;
          if (blob) zip.file(path, blob);
        }
      } else {
        const fillColor = resizeMode === "cutout" ? detectedBg : undefined;
        const ext = file.name.split(".").pop() ?? "jpg";
        const blob = await generateBlob(imgState, preset.w, preset.h, fillColor);
        if (blob) zip.file(`${name}_${sizeKey}.${ext}`, blob);
      }
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.zip`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    isDownloadingRef.current = false;
    setDownloading(false); setShowNameInput(false); setZipName("");
  };

  const fileCount = topTab === "thumbnail"
    ? selectedKeys.length * Math.max(selectedBgs.length, 1)
    : selectedKeys.length;

  // ── 공용 에디터 스테이지 렌더 ──
  const renderStage = () => (
    <div style={{ position: "relative", width: stageW, height: stageH, background: "#9ca3af", overflow: "hidden", cursor: grabbing ? "grabbing" : "grab" }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
      <div style={{ position: "absolute", left: pad, top: pad, width: frameW, height: frameH, background: stageBg, pointerEvents: "none" }} />
      <img src={imgEl?.src} alt="" draggable={false}
        style={{ position: "absolute", left: pad + (activeState?.x ?? 0) * outputDs, top: pad + (activeState?.y ?? 0) * outputDs, width: (natDims?.w ?? 0) * (activeState?.scale ?? 1) * outputDs, height: "auto", pointerEvents: "none", userSelect: "none", filter: topTab === "thumbnail" ? shadowCss : "none" }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: pad, background: "rgba(0,0,0,0.45)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: pad + frameH, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.45)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: pad, left: 0, width: pad, height: frameH, background: "rgba(0,0,0,0.45)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: pad, left: pad + frameW, right: 0, height: frameH, background: "rgba(0,0,0,0.45)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: pad, top: pad, width: frameW, height: frameH, outline: "2px solid #3b82f6", pointerEvents: "none" }} />
      {showGuides && (<>
        <div style={{ position: "absolute", left: pad, top: pad + frameH / 2, width: frameW, height: 1, background: "rgba(239,68,68,0.75)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", left: pad + frameW / 2, top: pad, width: 1, height: frameH, background: "rgba(239,68,68,0.75)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", left: pad, top: pad + frameH / 3, width: frameW, height: 1, background: "rgba(251,146,60,0.6)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", left: pad, top: pad + (frameH * 2) / 3, width: frameW, height: 1, background: "rgba(251,146,60,0.6)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", left: pad + frameW / 3, top: pad, width: 1, height: frameH, background: "rgba(251,146,60,0.6)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", left: pad + (frameW * 2) / 3, top: pad, width: 1, height: frameH, background: "rgba(251,146,60,0.6)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", left: pad + frameW / 2 - 3, top: pad + frameH / 2 - 3, width: 6, height: 6, borderRadius: "50%", background: "rgba(239,68,68,0.9)", pointerEvents: "none" }} />
      </>)}
    </div>
  );

  // 공용 에디터 컨트롤 바
  const renderEditorControls = (showSync: boolean) => (
    <div className="flex gap-1.5 items-center flex-wrap justify-end">
      <button onClick={() => handleZoom(1.25)} className="w-8 h-8 border rounded-lg text-sm font-bold hover:bg-gray-50">+</button>
      <button onClick={() => handleZoom(1 / 1.25)} className="w-8 h-8 border rounded-lg text-sm font-bold hover:bg-gray-50">−</button>
      <span className="w-px h-5 bg-gray-200" />
      <button onClick={handleCenterAlign} className="h-8 px-2.5 border rounded-lg text-xs hover:bg-gray-50">중앙</button>
      <button onClick={() => setShowGuides(v => !v)} className={`h-8 px-2.5 border rounded-lg text-xs transition-colors ${showGuides ? "bg-orange-500 text-white border-orange-500" : "hover:bg-gray-50"}`}>가이드</button>
      <span className="w-px h-5 bg-gray-200" />
      {showSync && selectedKeys.length > 1 && (
        <button onClick={handleSyncAll} className="h-8 px-2.5 border border-blue-300 rounded-lg text-xs text-blue-600 hover:bg-blue-50">전체 동기화</button>
      )}
      <span className="w-px h-5 bg-gray-200" />
      <button onClick={() => { if (!natDims || !activeKey || !activePreset) return; setTS(topTab, (prev) => ({ perSize: { ...prev.perSize, [activeKey]: makeInitialState(natDims.w, natDims.h, activePreset.w, activePreset.h, isCover, !isCover ? prev.contentBounds : null) } })); }} className="h-8 px-2.5 border rounded-lg text-xs hover:bg-gray-50">초기화</button>
    </div>
  );

  // 공용 다운로드 바
  const renderDownload = () => (
    <div className="flex items-center justify-between pt-1">
      <p className="text-xs text-gray-400">{activePreset?.w} × {activePreset?.h} px{topTab === "thumbnail" && " · PNG"}</p>
      {!showNameInput ? (
        <button onClick={() => setShowNameInput(true)} className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
          ZIP 다운로드 ({fileCount}개)
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input autoFocus type="text" placeholder="파일 이름 (예: 상품명)" className="border rounded-lg px-3 py-2 text-sm w-44"
            value={zipName} onChange={(e) => setZipName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleDownloadZip(); } }} />
          <button onClick={() => void handleDownloadZip()} disabled={downloading || !zipName.trim()} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
            {downloading ? "압축 중..." : "저장"}
          </button>
          <button onClick={() => { setShowNameInput(false); setZipName(""); }} className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50">취소</button>
        </div>
      )}
    </div>
  );

  // 공용 미리보기 그리드
  const renderPreviewGrid = () => {
    if (!imgEl || !natDims || selectedKeys.length === 0) return null;
    const maxDim = Math.max(...selectedKeys.map(key => {
      const p = allSizes.find(p => p.key === key);
      return p ? Math.max(p.w, p.h) : 0;
    }), 1);
    const BASE = 180;
    const globalDs = BASE / maxDim;
    return (
      <div className="mt-6 border-t pt-5">
        <p className="text-sm font-medium text-gray-700 mb-3">사이즈별 미리보기 <span className="text-gray-400 font-normal text-xs ml-1">클릭하여 편집</span></p>
        <div className="flex gap-4 flex-wrap items-end">
          {selectedKeys.map((key) => {
            const p = allSizes.find((p) => p.key === key);
            const state = perSize[key];
            if (!p || !state) return null;
            const pDs = globalDs;
            const isActive = key === activeKey;
            const previewBg = topTab === "thumbnail" ? currentBgColor : resizeMode === "cutout" ? detectedBg : "#e5e7eb";
            return (
              <div key={key} onClick={() => setTS(topTab, { activeKey: key })}
                className={`cursor-pointer flex flex-col rounded-lg overflow-hidden border-2 transition-all ${isActive ? "border-blue-500 shadow-md" : "border-gray-200 hover:border-gray-400"}`}>
                <div style={{ position: "relative", width: p.w * pDs, height: p.h * pDs, background: previewBg, overflow: "hidden" }}>
                  <img src={imgEl.src} alt="" draggable={false}
                    style={{ position: "absolute", left: state.x * pDs, top: state.y * pDs, width: natDims.w * state.scale * pDs, height: natDims.h * state.scale * pDs, pointerEvents: "none", userSelect: "none" }} />
                </div>
                <div className={`px-2 py-1 text-center text-xs font-medium ${isActive ? "bg-blue-50 text-blue-600" : "bg-gray-50 text-gray-500"}`}>{p.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="px-2 max-w-7xl pb-24">
      {/* 상단 탭 + 초기화 버튼 */}
      <div className="flex items-center justify-between border-b mb-5">
        <div className="flex gap-1">
          {([["resize", "이미지 리사이즈"], ["thumbnail", "썸네일 만들기"]] as [TopTab, string][]).map(([tab, label]) => (
            <button key={tab} onClick={() => setTopTab(tab)}
              className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                topTab === tab ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={resetAll} className="mb-1 px-3 py-1.5 text-xs border rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition-colors">
          전체 초기화
        </button>
      </div>

      {/* ══ 리사이즈 탭: 스텝 플로우 ══ */}
      {topTab === "resize" && (
        <div>
          {/* 스텝 인디케이터 */}
          {resizeStep > 1 && (
            <div className="flex items-center gap-1.5 mb-6 text-xs">
              {([["영점 조준", 2], ["유형 선택", 3], ["사이즈 선택", 4], ["시안 확인", 5]] as [string, number][]).map(([label, s], i) => (
                <span key={s} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-gray-300">→</span>}
                  <button
                    onClick={() => { if (resizeStep > s) setResizeStep(s as 1|2|3|4|5); }}
                    className={`px-3 py-1 rounded-full font-medium transition-colors ${resizeStep === s ? "bg-blue-600 text-white" : resizeStep > s ? "bg-gray-200 text-gray-600 hover:bg-gray-300 cursor-pointer" : "bg-gray-100 text-gray-400 cursor-default"}`}>
                    {s - 1}. {label}
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* ─ Step 1: 업로드 ─ */}
          {resizeStep === 1 && (
            <div className="flex flex-col items-center justify-center min-h-72 gap-6">
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-800 mb-1">이미지 리사이즈</p>
                <p className="text-sm text-gray-500">이미지를 업로드하면 영점 조준부터 시작합니다</p>
              </div>
              <div className="w-full max-w-md border-2 border-dashed rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 transition-colors"
                onClick={() => resizeFileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f, "resize"); }}>
                <input ref={resizeFileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, "resize"); }} />
                <p className="text-5xl mb-3">🖼️</p>
                <p className="font-semibold text-gray-700 mb-1">이미지 업로드</p>
                <p className="text-xs text-gray-400">클릭하거나 드래그 · JPG, PNG, WebP 등</p>
              </div>
            </div>
          )}

          {/* ─ Step 2: 영점 조준 ─ */}
          {resizeStep === 2 && imgEl && natDims && zeroImgState && (
            <div className="flex gap-8 items-start">
              <div className="w-52 shrink-0 space-y-3">
                <div className="border rounded-xl p-3 bg-gray-50 space-y-2">
                  <img src={previewUrl!} alt="원본" className="max-h-40 max-w-full object-contain mx-auto block" />
                  <p className="text-xs text-gray-500 text-center truncate">{file?.name}</p>
                  <p className="text-xs text-gray-400 text-center">{natDims.w} × {natDims.h} px</p>
                  <button onClick={() => { setResizeStep(1); setZeroImgState(null); }} className="w-full text-xs text-gray-400 hover:text-red-500 transition-colors">이미지 교체</button>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-xs text-gray-600 space-y-1">
                  <p className="font-semibold text-blue-700">영점 조준 안내</p>
                  <p>• 제품이 프레임 중앙에 오도록 드래그/줌 조정</p>
                  <p>• 이 기준점으로 모든 사이즈가 동기화됩니다</p>
                </div>
              </div>
              <div className="flex-1 min-w-0 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-700">기준 영역 설정 <span className="text-gray-400 font-normal text-xs">(1000 × 1000 기준)</span></p>
                  <div className="flex gap-1.5">
                    <button onClick={() => handleZeroZoom(1.25)} className="w-8 h-8 border rounded-lg text-sm font-bold hover:bg-gray-50">+</button>
                    <button onClick={() => handleZeroZoom(1 / 1.25)} className="w-8 h-8 border rounded-lg text-sm font-bold hover:bg-gray-50">−</button>
                    <span className="w-px h-8 bg-gray-200" />
                    <button onClick={() => { const s = makeInitialState(natDims.w, natDims.h, ZERO_W, ZERO_H, false, ts.contentBounds); setZeroImgState(s); }} className="h-8 px-2.5 border rounded-lg text-xs hover:bg-gray-50">초기화</button>
                  </div>
                </div>
                {/* 영점 스테이지 */}
                <div style={{ position: "relative", width: zeroStageW, height: zeroStageH, background: "#9ca3af", overflow: "hidden", cursor: zeroGrabbing ? "grabbing" : "grab" }}
                  onPointerDown={onZeroPointerDown} onPointerMove={onZeroPointerMove} onPointerUp={onZeroPointerUp} onPointerLeave={onZeroPointerUp}>
                  <div style={{ position: "absolute", left: zeroPad, top: zeroPad, width: zeroFrameW, height: zeroFrameH, background: detectedBg, pointerEvents: "none" }} />
                  <img src={imgEl.src} alt="" draggable={false} style={{ position: "absolute", left: zeroPad + zeroImgState.x * zeroDs, top: zeroPad + zeroImgState.y * zeroDs, width: natDims.w * zeroImgState.scale * zeroDs, height: "auto", pointerEvents: "none", userSelect: "none" }} />
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: zeroPad, background: "rgba(0,0,0,0.45)", pointerEvents: "none" }} />
                  <div style={{ position: "absolute", top: zeroPad + zeroFrameH, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.45)", pointerEvents: "none" }} />
                  <div style={{ position: "absolute", top: zeroPad, left: 0, width: zeroPad, height: zeroFrameH, background: "rgba(0,0,0,0.45)", pointerEvents: "none" }} />
                  <div style={{ position: "absolute", top: zeroPad, left: zeroPad + zeroFrameW, right: 0, height: zeroFrameH, background: "rgba(0,0,0,0.45)", pointerEvents: "none" }} />
                  <div style={{ position: "absolute", left: zeroPad, top: zeroPad, width: zeroFrameW, height: zeroFrameH, outline: "2px solid #3b82f6", pointerEvents: "none" }} />
                  {/* 십자선 */}
                  <div style={{ position: "absolute", left: zeroPad + zeroFrameW / 2 - 16, top: zeroPad + zeroFrameH / 2, width: 32, height: 1, background: "rgba(239,68,68,0.8)", pointerEvents: "none" }} />
                  <div style={{ position: "absolute", left: zeroPad + zeroFrameW / 2, top: zeroPad + zeroFrameH / 2 - 16, width: 1, height: 32, background: "rgba(239,68,68,0.8)", pointerEvents: "none" }} />
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-xs text-gray-400">1000 × 1000 px 기준 · 빨간 십자가 = 동기화 중심점</p>
                  <button onClick={advanceFromZero} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">
                    영점 완료 → 유형 선택
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─ Step 3: 유형 선택 ─ */}
          {resizeStep === 3 && (
            <div className="max-w-xl mx-auto space-y-6">
              <div className="text-center">
                <p className="text-xl font-bold text-gray-800 mb-1">리사이즈 유형을 선택하세요</p>
                <p className="text-sm text-gray-500">선택하면 자동으로 다음 단계로 이동합니다</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {([
                  ["cutout", "누끼컷", "배경색 확장", "제품 전체가 보이도록 배경을 확장합니다. 누끼컷·흰 배경 제품에 최적.", "🖼️"],
                  ["scene", "크롭컷", "프레임 꽉 채우기", "캔버스를 꽉 채우도록 이미지를 크롭합니다. 씬컷·패션·라이프스타일에 최적.", "✂️"],
                ] as [ResizeMode, string, string, string, string][]).map(([mode, title, sub, desc, icon]) => (
                  <button key={mode} onClick={() => {
                    setResizeMode(mode);
                    setTS("resize", (prev) => {
                      if (prev.selectedKeys.length > 0) return {};
                      const next = { ...prev.perSize };
                      for (const p of SIZE_PRESETS) {
                        if (!next[p.key] && prev.natDims) next[p.key] = makeInitialState(prev.natDims.w, prev.natDims.h, p.w, p.h, mode === "scene", mode !== "scene" ? prev.contentBounds : null);
                      }
                      return { selectedKeys: SIZE_PRESETS.map(p => p.key), perSize: next, activeKey: SIZE_PRESETS[0].key };
                    });
                    setResizeStep(4);
                  }} className="border-2 rounded-xl p-6 text-left hover:border-blue-500 hover:bg-blue-50 transition-all">
                    <p className="text-3xl mb-3">{icon}</p>
                    <p className="font-bold text-gray-800 text-lg">{title}</p>
                    <p className="text-sm font-semibold text-blue-600 mb-2">{sub}</p>
                    <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
                  </button>
                ))}
              </div>
              <div className="text-center">
                <button onClick={() => setResizeStep(2)} className="text-xs text-gray-400 hover:text-gray-600">← 영점 조준으로 돌아가기</button>
              </div>
            </div>
          )}

          {/* ─ Step 4: 사이즈 선택 ─ */}
          {resizeStep === 4 && (
            <div className="max-w-2xl space-y-5">
              <div>
                <p className="text-xl font-bold text-gray-800 mb-1">출력 사이즈 선택</p>
                <p className="text-sm text-gray-500">기본으로 전체 선택되어 있습니다. 원하는 사이즈를 추가하거나 제외하세요.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => {
                  const allSelected = allSizes.every(p => selectedKeys.includes(p.key));
                  if (allSelected) { setTS("resize", { selectedKeys: [], perSize: {}, activeKey: null }); }
                  else { setTS("resize", (prev) => { const next = { ...prev.perSize }; for (const p of allSizes) { if (!next[p.key] && prev.natDims) next[p.key] = makeInitialState(prev.natDims.w, prev.natDims.h, p.w, p.h, isCover, !isCover ? prev.contentBounds : null); } const keys = allSizes.map(p => p.key); return { selectedKeys: keys, perSize: next, activeKey: keys[keys.length - 1] }; }); }
                }} className={`px-3 py-1.5 text-xs border rounded-lg font-medium transition-colors ${allSizes.length > 0 && allSizes.every(p => selectedKeys.includes(p.key)) ? "bg-gray-700 text-white border-gray-700" : "border-gray-400 text-gray-700 hover:bg-gray-100"}`}>
                  {allSizes.length > 0 && allSizes.every(p => selectedKeys.includes(p.key)) ? "전체 해제" : "전체 선택"}
                </button>
                {allSizes.map((p) => (
                  <button key={p.key} onClick={() => toggleSize(p)}
                    className={`px-3 py-1.5 text-xs border rounded-lg font-medium transition-colors ${selectedKeys.includes(p.key) ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input type="number" min={1} max={10000} placeholder="너비" className="border rounded px-2 py-1.5 w-20 text-xs" value={customW} onChange={(e) => setCustomW(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustomSize()} />
                <span className="text-gray-400 text-xs">×</span>
                <input type="number" min={1} max={10000} placeholder="높이" className="border rounded px-2 py-1.5 w-20 text-xs" value={customH} onChange={(e) => setCustomH(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustomSize()} />
                <button onClick={addCustomSize} disabled={!customW || !customH} className="px-2.5 py-1.5 text-xs border rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40">추가</button>
              </div>
              {selectedKeys.length > 0 && <p className="text-xs text-gray-400">{selectedKeys.length}개 사이즈 선택</p>}
              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setResizeStep(3)} className="text-xs text-gray-400 hover:text-gray-600">← 유형 선택으로 돌아가기</button>
                <button onClick={enterPreviewStep} disabled={selectedKeys.length === 0}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors">
                  시안 확인 → ({selectedKeys.length}개)
                </button>
              </div>
            </div>
          )}

          {/* ─ Step 5: 시안 확인 ─ */}
          {resizeStep === 5 && selectedKeys.length > 0 && natDims && imgEl && (
            <div className="space-y-4">
              {/* 현재 사이즈 에디터 */}
              {activePreset && activeState && (
                <div className="space-y-3 border-b pb-5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex gap-1 flex-wrap">
                      {selectedKeys.map((key) => {
                        const p = allSizes.find(p => p.key === key);
                        return (
                          <button key={key} onClick={() => setTS("resize", { activeKey: key })}
                            className={`px-3 py-1.5 text-xs rounded-t-lg font-medium border-b-2 transition-colors ${activeKey === key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                            {p?.label ?? key}
                          </button>
                        );
                      })}
                    </div>
                    {renderEditorControls(true)}
                  </div>
                  {renderStage()}
                  <p className="text-xs text-gray-400">{activePreset.w} × {activePreset.h} px</p>
                </div>
              )}
              {/* 미리보기 그리드 */}
              {renderPreviewGrid()}
              {/* 다운로드 */}
              <div className="flex items-center justify-between pt-3 border-t">
                <button onClick={() => setResizeStep(4)} className="text-xs text-gray-400 hover:text-gray-600">← 사이즈 선택으로 돌아가기</button>
                {renderDownload()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ 썸네일 탭: 기존 레이아웃 ══ */}
      {topTab === "thumbnail" && (
        <div className="flex gap-6 items-start">
          {/* 왼쪽 패널 */}
          <div className="w-72 shrink-0 space-y-5">
            {/* 업로드 */}
            <div className="border-2 border-dashed rounded-xl p-4 text-center cursor-pointer hover:border-gray-400 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f, "thumbnail"); }}>
              <input ref={fileInputRef} type="file" accept="image/png,image/webp" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, "thumbnail"); }} />
              {previewUrl ? (
                <div className="space-y-1.5">
                  <div style={{ background: "repeating-conic-gradient(#d1d5db 0% 25%, #fff 0% 50%) 0 0 / 16px 16px" }} className="max-h-36 mx-auto flex items-center justify-center rounded overflow-hidden">
                    <img src={previewUrl} alt="원본" className="max-h-36 max-w-full object-contain" />
                  </div>
                  <p className="text-xs font-medium text-gray-700 truncate">{file?.name}</p>
                  {natDims && <p className="text-xs text-gray-400">{natDims.w} × {natDims.h} px</p>}
                  <p className="text-xs text-gray-400">클릭하여 교체</p>
                </div>
              ) : (
                <div className="space-y-2 text-gray-400 py-6">
                  <p className="text-3xl">🎨</p>
                  <p className="text-sm font-medium">누끼컷 PNG 업로드</p>
                  <p className="text-xs">투명 배경 PNG / WebP</p>
                </div>
              )}
            </div>
            {/* 배경색 */}
            <div className="space-y-2">
              <p className="text-sm font-medium">배경색 <span className="text-gray-400 font-normal text-xs">복수 선택 가능</span></p>
              <div className="flex gap-2">
                {BG_OPTIONS.map((bg) => {
                  const selected = selectedBgs.includes(bg.key);
                  return (
                    <button key={bg.key} onClick={() => setSelectedBgs(prev => prev.includes(bg.key) ? prev.filter(k => k !== bg.key) : [...prev, bg.key])}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors flex-1 ${selected ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
                      <div className="w-5 h-5 rounded border border-gray-300 shrink-0" style={{ background: bg.color }} />
                      <span>{bg.label}</span>
                      {selected && <span className="ml-auto text-blue-500 text-xs">✓</span>}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400">화이트: #FFFFFF · 그레이: #F4F0F1</p>
            </div>
            {/* 그림자 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">그림자 효과</p>
                <button onClick={() => setShadowEnabled(v => !v)} className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${shadowEnabled ? "bg-gray-900 text-white border-gray-900" : "border-gray-300 text-gray-500 hover:bg-gray-50"}`}>
                  {shadowEnabled ? "적용 중" : "적용 안함"}
                </button>
              </div>
              {shadowEnabled && (
                <div className="space-y-1 pt-0.5">
                  <div className="flex justify-between text-xs text-gray-400"><span>강도</span><span>{shadowBlur}</span></div>
                  <input type="range" min={5} max={60} value={shadowBlur} onChange={(e) => setShadowBlur(Number(e.target.value))} className="w-full accent-gray-900 cursor-pointer" />
                  <div className="flex justify-between text-xs text-gray-300"><span>약하게</span><span>강하게</span></div>
                </div>
              )}
            </div>
            {/* 사이즈 선택 */}
            {file && natDims && (
              <div className="space-y-2">
                <p className="text-sm font-medium">출력 사이즈 <span className="text-gray-400 font-normal text-xs">복수 선택 가능</span></p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => {
                    const allSelected = allSizes.every(p => selectedKeys.includes(p.key));
                    if (allSelected) { setTS("thumbnail", { selectedKeys: [], perSize: {}, activeKey: null }); }
                    else { setTS("thumbnail", (prev) => { const next = { ...prev.perSize }; for (const p of allSizes) { if (!next[p.key] && prev.natDims) next[p.key] = makeInitialState(prev.natDims.w, prev.natDims.h, p.w, p.h, false, null); } const keys = allSizes.map(p => p.key); return { selectedKeys: keys, perSize: next, activeKey: keys[keys.length - 1] }; }); }
                  }} className={`px-2.5 py-1 text-xs border rounded-lg font-medium transition-colors ${allSizes.length > 0 && allSizes.every(p => selectedKeys.includes(p.key)) ? "bg-gray-700 text-white border-gray-700" : "border-gray-400 text-gray-700 hover:bg-gray-100"}`}>
                    {allSizes.length > 0 && allSizes.every(p => selectedKeys.includes(p.key)) ? "전체 해제" : "전체 선택"}
                  </button>
                  {allSizes.map(p => (
                    <button key={p.key} onClick={() => toggleSize(p)} className={`px-2.5 py-1 text-xs border rounded-lg font-medium transition-colors ${selectedKeys.includes(p.key) ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{p.label}</button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <input type="number" min={1} max={10000} placeholder="너비" className="border rounded px-2 py-1.5 w-20 text-xs" value={customW} onChange={(e) => setCustomW(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustomSize()} />
                  <span className="text-gray-400 text-xs">×</span>
                  <input type="number" min={1} max={10000} placeholder="높이" className="border rounded px-2 py-1.5 w-20 text-xs" value={customH} onChange={(e) => setCustomH(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustomSize()} />
                  <button onClick={addCustomSize} disabled={!customW || !customH} className="px-2.5 py-1.5 text-xs border rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40">추가</button>
                </div>
                {selectedKeys.length > 0 && <p className="text-xs text-gray-400">{selectedKeys.length}개 사이즈 선택{selectedBgs.length > 1 && ` × ${selectedBgs.length}색 = ${fileCount}개 파일`}</p>}
              </div>
            )}
          </div>
          {/* 오른쪽 패널 */}
          <div className="flex-1 min-w-0">
            {!file ? (
              <div className="flex items-center justify-center h-64 border-2 border-dashed rounded-xl text-sm text-gray-400">왼쪽에서 누끼컷 PNG를 업로드하세요</div>
            ) : selectedKeys.length === 0 || !activePreset || !activeState ? (
              <div className="flex items-center justify-center h-64 border-2 border-dashed rounded-xl text-sm text-gray-400">왼쪽에서 출력 사이즈를 선택하면 에디터가 표시됩니다</div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-1 flex-wrap border-b pb-2">
                  {selectedKeys.map(key => {
                    const p = allSizes.find(p => p.key === key);
                    return <button key={key} onClick={() => setTS("thumbnail", { activeKey: key })} className={`px-3 py-1.5 text-xs rounded-t-lg font-medium border-b-2 transition-colors ${activeKey === key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>{p?.label ?? key}</button>;
                  })}
                </div>
                {selectedBgs.length > 1 && (
                  <div className="flex gap-1.5">
                    {selectedBgs.map(bgKey => {
                      const bg = BG_OPTIONS.find(b => b.key === bgKey);
                      return <button key={bgKey} onClick={() => setActiveBg(bgKey)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${currentBgKey === bgKey ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-300 text-gray-500 hover:bg-gray-50"}`}><div className="w-3.5 h-3.5 rounded border border-gray-300 shrink-0" style={{ background: bg?.color }} />{bg?.label}</button>;
                    })}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-gray-500 shrink-0">드래그로 위치 · +− 크기</p>
                  {renderEditorControls(false)}
                </div>
                {renderStage()}
                {renderDownload()}
              </div>
            )}
          </div>
        </div>
      )}
      {topTab === "thumbnail" && renderPreviewGrid()}
    </div>
  );
}
