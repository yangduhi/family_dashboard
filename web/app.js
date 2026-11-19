import { DAYCARE_SVG, FIXED_LOCATION, STEP_ILLUSTRATIONS, STEP_META, THEMES } from "./assets.js";
import {
  buildMediaRecordId,
  buildStepMediaSelection,
  classifyMediaPath,
  clearMediaBySlot,
  clearMediaByTheme,
  createEmptyMediaBuckets,
  extractDisplayName,
  getImageMimeType,
  loadMediaPoolByTheme,
  normalizeRelPath,
  parseZipEntries,
  putMediaItems,
  STEP_IDS,
} from "./media_store.js";

export const UNDO_HOLD_MS = 1500;
export const PARENT_HOLD_MS = 3000;

const STORAGE_KEY = "family_dashboard_state_v1";
const WEATHER_CACHE_KEY = "family_dashboard_weather_cache_v1";
const MAX_INLINE_ANIMATED_BYTES = 900_000;
const CUSTOM_SLOTS = [
  { key: "mascot_babyshark", label: "🦈 아기상어 마스코트 (전용)" },
  { key: "mascot_pororo", label: "🐧 뽀로로 마스코트 (전용)" },
  { key: "mascot", label: "⭐ 공통 마스코트 (미설정 시 기본)" },
  { key: "stamp_babyshark", label: "🦈 아기상어 도장 (전용)" },
  { key: "stamp_pororo", label: "🐧 뽀로로 도장 (전용)" },
  { key: "stamp", label: "⭐ 공통 도장 (미설정 시 기본)" },
  { key: "step1", label: "① 아침 먹기" },
  { key: "step2", label: "② 세수·양치" },
  { key: "step3", label: "③ 옷 입기" },
  { key: "step4", label: "④ 가방 챙기기" },
];

export function resolveThemeMascotUrl(state, themeId = state?.theme) {
  const custom = state?.customImages || {};
  return custom[`mascot_${themeId}`] || custom.mascot || null;
}

export function resolveThemeStampUrl(state, themeId = state?.theme) {
  const custom = state?.customImages || {};
  return custom[`stamp_${themeId}`] || custom.stamp || null;
}

export function formatDateISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function createDefaultState(todayStr = formatDateISO()) {
  return {
    theme: "babyshark",
    childName: "우리 딸",
    schoolLabel: "어린이집",
    departureTime: "08:50",
    prepStartTime: "07:50",
    stepsCompleted: [false, false, false, false],
    lastStampedDate: todayStr,
    location: { ...FIXED_LOCATION },
    soundEnabled: true,
    ttsEnabled: true,
    customImages: {
      mascot: null,
      mascot_babyshark: null,
      mascot_pororo: null,
      stamp: null,
      stamp_babyshark: null,
      stamp_pororo: null,
      step1: null,
      step2: null,
      step3: null,
      step4: null,
    },
  };
}

export function normalizeDailyState(rawState, todayStr = formatDateISO()) {
  const base = createDefaultState(todayStr);
  const state = {
    ...base,
    ...(rawState || {}),
    location: { ...FIXED_LOCATION },
    customImages: { ...base.customImages, ...(rawState?.customImages || {}) },
  };
  if (state.theme !== "babyshark" && state.theme !== "pororo") {
    state.theme = "babyshark";
  }
  if (!Array.isArray(state.stepsCompleted) || state.stepsCompleted.length !== 4) {
    state.stepsCompleted = [false, false, false, false];
  } else {
    state.stepsCompleted = state.stepsCompleted.map(Boolean);
  }
  if (state.lastStampedDate !== todayStr) {
    state.stepsCompleted = [false, false, false, false];
    state.lastStampedDate = todayStr;
  }
  return state;
}

export function getActiveStepIndex(stepsCompleted) {
  if (!Array.isArray(stepsCompleted)) return 0;
  return stepsCompleted.findIndex((done) => !done);
}

export function getLastCompletedIndex(stepsCompleted) {
  if (!Array.isArray(stepsCompleted)) return -1;
  for (let i = stepsCompleted.length - 1; i >= 0; i -= 1) {
    if (stepsCompleted[i]) return i;
  }
  return -1;
}

export function applyStamp(state, stepIndex, todayStr = formatDateISO()) {
  const normalized = normalizeDailyState(state, todayStr);
  const activeIdx = getActiveStepIndex(normalized.stepsCompleted);
  if (activeIdx === -1 || stepIndex !== activeIdx) {
    return normalized;
  }
  const nextSteps = [...normalized.stepsCompleted];
  nextSteps[stepIndex] = true;
  return {
    ...normalized,
    stepsCompleted: nextSteps,
    lastStampedDate: todayStr,
  };
}

export function undoLastStamp(state) {
  const lastIdx = getLastCompletedIndex(state?.stepsCompleted);
  if (lastIdx < 0) return state;
  const nextSteps = [...state.stepsCompleted];
  nextSteps[lastIdx] = false;
  return {
    ...state,
    stepsCompleted: nextSteps,
  };
}

function parseMinutesOfDay(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || ""));
  if (!match) return 8 * 60 + 50;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function computeCountdown(nowDate, prepStartTime, departureTime) {
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  const startMin = parseMinutesOfDay(prepStartTime);
  const depMin = parseMinutesOfDay(departureTime);
  const remainingMinutes = Math.max(0, depMin - nowMin);
  const isPastDeparture = nowMin >= depMin;

  let timeProgressPct = 100;
  if (!isPastDeparture) {
    const span = Math.max(10, depMin - startMin);
    const elapsed = Math.max(0, nowMin - startMin);
    timeProgressPct = Math.min(100, Math.max(0, Math.round((elapsed / span) * 100)));
  }

  let formattedRemaining = `${remainingMinutes}분 남았어요`;
  if (isPastDeparture) {
    formattedRemaining = "출발 시간이에요! (0분)";
  } else if (remainingMinutes >= 60) {
    const h = Math.floor(remainingMinutes / 60);
    const m = remainingMinutes % 60;
    formattedRemaining = m === 0 ? `${h}시간 남았어요` : `${h}시간 ${m}분 남았어요`;
  }

  return {
    remainingMinutes,
    timeProgressPct,
    isPastDeparture,
    formattedRemaining,
  };
}

export function buildWeatherTip(tempC, minTempC, maxTempC, precipProb, pm25) {
  const t = Math.round(Number(tempC ?? 10));
  const rain = Math.round(Number(precipProb ?? 0));
  const dust = Math.round(Number(pm25 ?? 12));

  let outfit = `포근한 ${t}° — 가벼운 등원복 좋아요`;
  if (t <= 4) {
    outfit = `아침 ${t}° 추워요 — 따뜻한 패딩·목도리 챙기기`;
  } else if (t <= 11) {
    outfit = `아침 ${t}° 쌀쌀 — 아이 겉옷 챙기기`;
  } else if (t <= 18) {
    outfit = `선선한 ${t}° — 얇은 가디건·긴팔 추천`;
  } else if (t >= 26) {
    outfit = `더운 ${t}° — 시원한 옷·물병·모자 챙기기`;
  }

  let umbrella = "우산 필요 없어요";
  if (rain >= 55) {
    umbrella = `비 확률 ${rain}% — 우산·장화 챙기기`;
  } else if (rain >= 30) {
    umbrella = `비 소식(${rain}%) — 접이식 우산 챙기면 안심`;
  }

  const parts = [`💡 ${outfit}`, umbrella];
  if (dust > 35) {
    parts.push("미세먼지 주의 — 마스크 챙기기");
  }
  return parts.join(" · ");
}

function weatherCodeToDisplay(code) {
  if (code === 0) return { emoji: "☀️", text: "맑음" };
  if (code <= 3) return { emoji: "⛅", text: "구름조금" };
  if (code <= 48) return { emoji: "🌫️", text: "안개" };
  if (code <= 67 || (code >= 80 && code <= 82)) return { emoji: "🌧️", text: "비" };
  if (code <= 77 || (code >= 85 && code <= 86)) return { emoji: "❄️", text: "눈" };
  return { emoji: "⛈️", text: "천둥번개" };
}

function airQualityDisplay(pm25, pm10) {
  const v25 = Number(pm25 ?? 12);
  const v10 = Number(pm10 ?? 22);
  if (v25 <= 15 && v10 <= 30) return { grade: "좋음", emoji: "😊", cls: "good" };
  if (v25 <= 35 && v10 <= 80) return { grade: "보통", emoji: "🙂", cls: "moderate" };
  if (v25 <= 75 && v10 <= 150) return { grade: "나쁨", emoji: "😷", cls: "bad" };
  return { grade: "매우나쁨", emoji: "🚨", cls: "very-bad" };
}

function formatKoreanTimeLabel(hhmm) {
  const [hStr, mStr] = String(hhmm || "08:50").split(":");
  const h = Number(hStr);
  const period = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${h12}:${mStr}`;
}

/* ---------- Web Audio & Speech Synthesis ---------- */
let audioCtx = null;

function ensureAudioContext() {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playStampSound(allDone) {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  // Heavy rubber stamp '쾅!' thud
  const thudOsc = ctx.createOscillator();
  const thudGain = ctx.createGain();
  thudOsc.type = "triangle";
  thudOsc.frequency.setValueAtTime(165, now);
  thudOsc.frequency.exponentialRampToValueAtTime(42, now + 0.16);
  thudGain.gain.setValueAtTime(0.55, now);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  thudOsc.connect(thudGain).connect(ctx.destination);
  thudOsc.start(now);
  thudOsc.stop(now + 0.19);

  // Bright achievement fanfare notes
  const notes = allDone ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
  notes.forEach((freq, idx) => {
    const t = now + 0.12 + idx * 0.09;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.27);
  });
}

function playUndoSound() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  [440, 349.23].forEach((freq, idx) => {
    const t = now + idx * 0.08;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  });
}

function speakCheer(text) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ko-KR";
    utter.rate = 1.02;
    utter.pitch = 1.18;
    window.speechSynthesis.speak(utter);
  } catch {
    // Ignore speech synthesis errors on restricted devices
  }
}

/* ---------- Browser App Controller ---------- */
function setMediaSlot(container, customUrl, fallbackSvg, altText) {
  container.replaceChildren();
  if (customUrl) {
    const img = document.createElement("img");
    img.src = customUrl;
    img.alt = altText;
    img.addEventListener(
      "error",
      () => {
        const tpl = document.createElement("template");
        tpl.innerHTML = fallbackSvg.trim();
        container.replaceChildren(tpl.content);
      },
      { once: true }
    );
    container.appendChild(img);
    return;
  }
  const tpl = document.createElement("template");
  tpl.innerHTML = fallbackSvg.trim();
  container.appendChild(tpl.content);
}

function setStampSlot(container, customStampUrl, themeMascotUrl, theme) {
  if (customStampUrl) {
    setMediaSlot(container, customStampUrl, theme.stampSvg, theme.stampTitle);
    return;
  }
  if (themeMascotUrl) {
    container.replaceChildren();
    const seal = document.createElement("div");
    seal.className = "stamp-generated";
    const img = document.createElement("img");
    img.src = themeMascotUrl;
    img.alt = theme.stampTitle;
    img.addEventListener(
      "error",
      () => {
        const tpl = document.createElement("template");
        tpl.innerHTML = theme.stampSvg.trim();
        container.replaceChildren(tpl.content);
      },
      { once: true }
    );
    const banner = document.createElement("span");
    banner.className = "stamp-generated-banner";
    banner.textContent = theme.stampTitle;
    seal.append(img, banner);
    container.appendChild(seal);
    return;
  }
  setMediaSlot(container, null, theme.stampSvg, theme.stampTitle);
}

function readFileAsDataUrl(file, errorMessage) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(errorMessage));
    reader.readAsDataURL(file);
  });
}

export function resolveUploadedImageMime(file) {
  return String(file?.type || getImageMimeType(file?.name) || "").toLowerCase();
}

async function resizeUploadedImage(file) {
  const mime = resolveUploadedImageMime(file);
  if (mime === "image/svg+xml") {
    return await readFileAsDataUrl(file, "SVG 파일을 읽을 수 없습니다.");
  }
  if (mime === "image/gif" || mime === "image/webp") {
    if (file.size > MAX_INLINE_ANIMATED_BYTES) {
      throw new Error(
        "900KB 초과 GIF·WebP 파일은 위 '5. 테마별 행동 랜덤 풀'에 추가해 주세요."
      );
    }
    return await readFileAsDataUrl(file, "애니메이션 이미지 파일을 읽을 수 없습니다.");
  }
  const dataUrl = await readFileAsDataUrl(file, "이미지 파일을 읽을 수 없습니다.");

  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("이미지 디코딩에 실패했습니다."));
    el.src = dataUrl;
  });

  const maxDim = 512;
  if (mime === "image/png" && Math.max(img.width, img.height) <= maxDim && file.size <= MAX_INLINE_ANIMATED_BYTES) {
    return dataUrl;
  }
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const outType = mime === "image/png" || mime === "image/webp" ? "image/png" : "image/jpeg";
  return canvas.toDataURL(outType, 0.86);
}

function initDashboardApp() {
  const DAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
  let state = loadLocalState();
  let justStampedIndex = -1;
  let wakeLockSentinel = null;
  let serverSyncAvailable = false;
  let mediaPoolCache = {
    babyshark: createEmptyMediaBuckets(),
    pororo: createEmptyMediaBuckets(),
  };
  let activeStepMedia = {
    theme: state.theme,
    dateStr: formatDateISO(),
    byStep: { step1: null, step2: null, step3: null, step4: null },
  };
  let pendingRevokeUrls = [];
  let weatherData = loadCachedWeather() || {
    tempC: 8,
    minTempC: 6,
    maxTempC: 13,
    weatherCode: 0,
    pm10: 20,
    pm25: 10,
    precipProb: 0,
    hourly: [
      { hour: "9시", temp: 8 },
      { hour: "12시", temp: 12 },
      { hour: "15시", temp: 13 },
      { hour: "18시", temp: 10 },
    ],
    offline: true,
  };

  const els = {
    html: document.documentElement,
    headerMascot: document.getElementById("header-mascot"),
    datePill: document.getElementById("date-pill"),
    clockPeriod: document.getElementById("clock-period"),
    clockDigits: document.getElementById("clock-digits"),
    airBadge: document.getElementById("air-badge"),
    airEmoji: document.getElementById("air-emoji"),
    airGrade: document.getElementById("air-grade"),
    weatherEmoji: document.getElementById("weather-emoji"),
    weatherTemp: document.getElementById("weather-temp"),
    weatherCond: document.getElementById("weather-cond"),
    weatherRange: document.getElementById("weather-range"),
    hourlyStrip: document.getElementById("hourly-strip"),
    weatherTipBar: document.getElementById("weather-tip-bar"),
    countdownLabel: document.getElementById("countdown-label"),
    countdownValue: document.getElementById("countdown-value"),
    cheerBubble: document.getElementById("cheer-bubble"),
    progressCountPill: document.getElementById("progress-count-pill"),
    progressFill: document.getElementById("progress-fill"),
    trackMascot: document.getElementById("track-mascot"),
    daycareIcon: document.getElementById("daycare-icon"),
    departureBadge: document.getElementById("departure-badge"),
    cardsGrid: document.getElementById("cards-grid"),
    particleLayer: document.getElementById("particle-layer"),
    parentLockBtn: document.getElementById("parent-lock-btn"),
    parentHoldRing: document.getElementById("parent-hold-ring"),
    parentDialog: document.getElementById("parent-dialog"),
    btnCloseDialog: document.getElementById("btn-close-dialog"),
    btnSaveClose: document.getElementById("btn-save-close"),
    btnParentUndo: document.getElementById("btn-parent-undo"),
    btnParentReset: document.getElementById("btn-parent-reset"),
    inputChildName: document.getElementById("input-child-name"),
    inputSchoolLabel: document.getElementById("input-school-label"),
    inputPrepStart: document.getElementById("input-prep-start"),
    inputDepartureTime: document.getElementById("input-departure-time"),
    chkSound: document.getElementById("chk-sound"),
    chkTts: document.getElementById("chk-tts"),
    btnTestCheer: document.getElementById("btn-test-cheer"),
    btnFullscreen: document.getElementById("btn-fullscreen"),
    mediaPoolThemeLabel: document.getElementById("media-pool-theme-label"),
    inputBatchMedia: document.getElementById("input-batch-media"),
    btnRerollMedia: document.getElementById("btn-reroll-media"),
    btnClearThemeMedia: document.getElementById("btn-clear-theme-media"),
    mediaPoolStatus: document.getElementById("media-pool-status"),
    mediaPoolGrid: document.getElementById("media-pool-grid"),
    customImageGrid: document.getElementById("custom-image-grid"),
    saveStatusNote: document.getElementById("save-status-note"),
  };

  function revokeUrls(urls) {
    urls.forEach((url) => {
      if (url && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore revoke error
        }
      }
    });
  }

  function revokePendingUrls() {
    if (pendingRevokeUrls.length === 0) return;
    const toRevoke = pendingRevokeUrls;
    pendingRevokeUrls = [];
    revokeUrls(toRevoke);
  }

  function rollStepMediaSelection(_reason) {
    const staleUrls = [];
    STEP_IDS.forEach((stepId) => {
      const prevUrl = activeStepMedia.byStep?.[stepId]?.url;
      if (prevUrl) staleUrls.push(prevUrl);
    });
    if (staleUrls.length > 0) {
      pendingRevokeUrls.push(...staleUrls);
    }

    const themePool = mediaPoolCache[state.theme] || createEmptyMediaBuckets();
    const picked = buildStepMediaSelection(themePool, Math.random, activeStepMedia.byStep);
    const nextByStep = {};
    STEP_IDS.forEach((stepId) => {
      const rec = picked[stepId];
      if (rec?.blob && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        nextByStep[stepId] = {
          id: rec.id,
          displayName: rec.displayName,
          url: URL.createObjectURL(rec.blob),
        };
      } else {
        nextByStep[stepId] = null;
      }
    });

    activeStepMedia = {
      theme: state.theme,
      dateStr: formatDateISO(),
      byStep: nextByStep,
    };
  }

  function loadLocalState() {
    const today = formatDateISO();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalizeDailyState(JSON.parse(raw), today);
    } catch {
      // Ignore corrupt localStorage
    }
    return createDefaultState(today);
  }

  function loadCachedWeather() {
    try {
      const raw = localStorage.getItem(WEATHER_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.locationId === FIXED_LOCATION.id) {
          return parsed;
        }
      }
    } catch {
      // Ignore cache error
    }
    return null;
  }

  function persistState(nextState) {
    state = normalizeDailyState(nextState, formatDateISO());
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      if (els.saveStatusNote) {
        els.saveStatusNote.textContent = "저장 공간이 부족해 사진 크기를 줄여 주세요.";
      }
    }
    if (serverSyncAvailable) {
      fetch("./api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      }).catch(() => {});
    }
  }

  function isLocalServerHost() {
    const h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  }

  async function syncFromServerIfEmpty() {
    if (!isLocalServerHost()) return;
    try {
      const healthRes = await fetch("./api/health");
      if (!healthRes.ok) return;
      serverSyncAvailable = true;
      if (localStorage.getItem(STORAGE_KEY)) return;
      const stateRes = await fetch("./api/state");
      if (!stateRes.ok) return;
      const serverState = await stateRes.json();
      state = normalizeDailyState(serverState, formatDateISO());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (state.theme !== activeStepMedia.theme) {
        rollStepMediaSelection("server-sync");
      }
      renderAll();
    } catch {
      // Standalone static hosting mode
    }
  }

  function spawnParticles(originEl) {
    const theme = THEMES[state.theme];
    const rect = originEl
      ? originEl.getBoundingClientRect()
      : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const count = 24;

    for (let i = 0; i < count; i += 1) {
      const dot = document.createElement("span");
      dot.className = `burst-particle ${theme.particleType === "star" ? "is-star" : ""}`;
      const size = 10 + Math.round(Math.random() * 14);
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.35;
      const dist = 75 + Math.random() * 145;
      dot.style.inlineSize = `${size}px`;
      dot.style.blockSize = `${size}px`;
      dot.style.insetInlineStart = `${cx}px`;
      dot.style.insetBlockStart = `${cy}px`;
      dot.style.background = theme.particleColors[i % theme.particleColors.length];
      dot.style.setProperty("--dx", `${Math.round(Math.cos(angle) * dist)}px`);
      dot.style.setProperty("--dy", `${Math.round(Math.sin(angle) * dist - 24)}px`);
      els.particleLayer.appendChild(dot);
      setTimeout(() => dot.remove(), 900);
    }
  }

  function attachHoldBehavior(buttonEl, holdMs, onProgress, onComplete) {
    let rafId = 0;
    let startAt = 0;
    let activePointerId = null;

    const reset = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      activePointerId = null;
      buttonEl.classList.remove("is-holding");
      onProgress(0);
    };

    const tick = (now) => {
      if (activePointerId === null) return;
      const elapsed = now - startAt;
      const ratio = Math.min(1, elapsed / holdMs);
      onProgress(ratio);
      if (ratio >= 1) {
        reset();
        onComplete();
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    buttonEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      e.stopPropagation();
      activePointerId = e.pointerId;
      startAt = performance.now();
      buttonEl.classList.add("is-holding");
      try {
        buttonEl.setPointerCapture(e.pointerId);
      } catch {
        // Ignore on synthetic events
      }
      rafId = requestAnimationFrame(tick);
    });

    buttonEl.addEventListener("pointermove", (e) => {
      if (activePointerId !== e.pointerId) return;
      const rect = buttonEl.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left - 16 &&
        e.clientX <= rect.right + 16 &&
        e.clientY >= rect.top - 16 &&
        e.clientY <= rect.bottom + 16;
      if (!inside) reset();
    });

    buttonEl.addEventListener("pointerup", reset);
    buttonEl.addEventListener("pointercancel", reset);
  }

  function handleStepStamp(stepIndex, cardEl) {
    const next = applyStamp(state, stepIndex, formatDateISO());
    if (next === state) return;
    justStampedIndex = stepIndex;
    persistState(next);
    renderAll();

    const allDone = getActiveStepIndex(state.stepsCompleted) === -1;
    if (state.soundEnabled) {
      playStampSound(allDone);
    }
    if (state.ttsEnabled) {
      const step = STEP_META[stepIndex];
      const theme = THEMES[state.theme];
      const msg = allDone
        ? `우와! ${state.childName} 등원 준비 완료! 신나게 ${state.schoolLabel}에 다녀오세요!`
        : `${theme.cheerPrefix} ${step.title} 완료! ${step.cheer}`;
      speakCheer(msg);
    }
    spawnParticles(cardEl);
    setTimeout(() => {
      justStampedIndex = -1;
    }, 600);
  }

  function handleUndoLast() {
    const prevLast = getLastCompletedIndex(state.stepsCompleted);
    if (prevLast < 0) return;
    persistState(undoLastStamp(state));
    if (state.soundEnabled) playUndoSound();
    renderAll();
  }

  function renderClockAndCountdown() {
    const now = new Date();
    const todayStr = formatDateISO(now);
    if (state.lastStampedDate !== todayStr) {
      persistState(normalizeDailyState(state, todayStr));
      rollStepMediaSelection("date-change");
      renderCards();
    }

    const month = now.getMonth() + 1;
    const date = now.getDate();
    const dayName = DAYS_KO[now.getDay()];
    els.datePill.textContent = `${month}월 ${date}일 ${dayName}요일`;

    const h24 = now.getHours();
    const period = h24 < 12 ? "오전" : "오후";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const mm = String(now.getMinutes()).padStart(2, "0");
    els.clockPeriod.textContent = period;
    els.clockDigits.textContent = `${String(h12).padStart(2, "0")}:${mm}`;

    const countdown = computeCountdown(now, state.prepStartTime, state.departureTime);
    els.countdownLabel.textContent = `${state.schoolLabel} 출발까지`;
    els.countdownValue.textContent = countdown.formattedRemaining;
    els.countdownValue.classList.toggle("is-urgent", countdown.remainingMinutes <= 15);
    els.departureBadge.textContent = `출발 ${formatKoreanTimeLabel(state.departureTime)}`;
  }

  function renderWeather() {
    const cond = weatherCodeToDisplay(weatherData.weatherCode);
    const air = airQualityDisplay(weatherData.pm25, weatherData.pm10);

    els.airBadge.className = `air-badge ${air.cls}`;
    els.airEmoji.textContent = air.emoji;
    els.airGrade.textContent = air.grade;

    els.weatherEmoji.textContent = cond.emoji;
    els.weatherTemp.textContent = `${Math.round(weatherData.tempC)}°`;
    const suffix = weatherData.offline ? " (기본/캐시)" : "";
    els.weatherCond.textContent = `${cond.text} · ${state.location.name}${suffix}`;
    els.weatherRange.textContent = `최고 ${Math.round(weatherData.maxTempC)}° · 최저 ${Math.round(weatherData.minTempC)}° · 초미세 ${Math.round(weatherData.pm25)}`;

    els.hourlyStrip.replaceChildren();
    (weatherData.hourly || []).slice(0, 4).forEach((item) => {
      const cell = document.createElement("div");
      cell.className = "hourly-cell";
      const label = document.createElement("span");
      label.textContent = item.hour;
      const val = document.createElement("strong");
      val.textContent = `${Math.round(item.temp)}°`;
      cell.append(label, val);
      els.hourlyStrip.appendChild(cell);
    });

    els.weatherTipBar.textContent = buildWeatherTip(
      weatherData.tempC,
      weatherData.minTempC,
      weatherData.maxTempC,
      weatherData.precipProb,
      weatherData.pm25
    );
  }

  function renderProgress() {
    const theme = THEMES[state.theme];
    const doneCount = state.stepsCompleted.filter(Boolean).length;
    const activeIdx = getActiveStepIndex(state.stepsCompleted);
    const pct = Math.max(8, Math.round((doneCount / 4) * 100));

    els.progressFill.style.inlineSize = `${pct}%`;
    els.trackMascot.style.insetInlineStart = `${Math.min(94, pct)}%`;
    els.progressCountPill.textContent = `진행률 ${doneCount} / 4 완료`;

    if (activeIdx === -1) {
      els.cheerBubble.textContent = `🎉 ${state.childName} 등원 준비 완료! 최고예요!`;
    } else {
      const step = STEP_META[activeIdx];
      els.cheerBubble.textContent = `${state.childName}, 같이 '${step.title}' 해볼까?`;
    }

    const mascotUrl = resolveThemeMascotUrl(state);
    setMediaSlot(els.headerMascot, mascotUrl, theme.mascotSvg, theme.name);
    setMediaSlot(els.trackMascot, mascotUrl, theme.mascotSvg, theme.name);
    setMediaSlot(els.daycareIcon, null, DAYCARE_SVG, state.schoolLabel);
  }

  function renderCards() {
    const theme = THEMES[state.theme];
    const activeIdx = getActiveStepIndex(state.stepsCompleted);
    const lastDoneIdx = getLastCompletedIndex(state.stepsCompleted);
    els.cardsGrid.replaceChildren();

    STEP_META.forEach((step, idx) => {
      const isDone = Boolean(state.stepsCompleted[idx]);
      const isActive = idx === activeIdx;
      const isLastDone = idx === lastDoneIdx;

      const card = document.createElement("article");
      card.className = "step-card";
      if (isDone) card.classList.add("is-done");
      else if (isActive) card.classList.add("is-active");
      else card.classList.add("is-locked");
      if (idx === justStampedIndex) card.classList.add("just-stamped");

      const head = document.createElement("div");
      head.className = "step-card-head";
      const badge = document.createElement("span");
      badge.className = "step-num-badge";
      badge.textContent = isDone ? "✓" : String(step.number);

      const helper = document.createElement("div");
      helper.className = "active-helper";
      const speech = document.createElement("span");
      speech.className = "active-speech";
      speech.textContent = "같이 하자!";
      const miniMascot = document.createElement("div");
      miniMascot.className = "mini-mascot";
      const mascotUrl = resolveThemeMascotUrl(state);
      setMediaSlot(miniMascot, mascotUrl, theme.mascotSvg, theme.name);
      helper.append(speech, miniMascot);
      head.append(badge, helper);

      const artWrap = document.createElement("div");
      artWrap.className = "step-art-wrap";
      const art = document.createElement("div");
      art.className = "step-art";
      const stepMediaUrl = state.customImages[step.id] || activeStepMedia.byStep?.[step.id]?.url || null;
      setMediaSlot(art, stepMediaUrl, STEP_ILLUSTRATIONS[step.id], step.title);

      const stampOverlay = document.createElement("div");
      stampOverlay.className = "stamp-overlay";
      const stampInner = document.createElement("div");
      stampInner.className = "stamp-badge-inner";
      setStampSlot(stampInner, resolveThemeStampUrl(state), mascotUrl, theme);
      stampOverlay.appendChild(stampInner);
      artWrap.append(art, stampOverlay);

      const title = document.createElement("h2");
      title.className = "step-title";
      title.textContent = step.title;

      const actionSlot = document.createElement("div");
      actionSlot.className = "step-action-slot";

      if (isActive) {
        const ctaBtn = document.createElement("button");
        ctaBtn.type = "button";
        ctaBtn.className = "stamp-cta-btn";
        ctaBtn.textContent = "👆 완료! 도장 찍기";
        let pressedPointerId = null;
        ctaBtn.addEventListener("pointerdown", (e) => {
          pressedPointerId = e.pointerId;
        });
        ctaBtn.addEventListener("click", (e) => {
          // A completed undo hold can place this button under the released pointer.
          if (e.pointerType && e.pointerId !== pressedPointerId) return;
          pressedPointerId = null;
          e.stopPropagation();
          handleStepStamp(idx, card);
        });
        actionSlot.appendChild(ctaBtn);
      } else if (isLastDone) {
        const undoBtn = document.createElement("button");
        undoBtn.type = "button";
        undoBtn.className = "undo-hold-btn";
        undoBtn.setAttribute("aria-label", `${step.title} 도장 취소 (1.5초 길게 누르기)`);

        const fill = document.createElement("span");
        fill.className = "undo-hold-fill";
        const label = document.createElement("span");
        label.className = "undo-hold-label";
        label.textContent = "↩ 도장 취소 (1.5초 꾹)";
        undoBtn.append(fill, label);

        attachHoldBehavior(
          undoBtn,
          UNDO_HOLD_MS,
          (ratio) => {
            fill.style.inlineSize = `${Math.round(ratio * 100)}%`;
            label.textContent = ratio > 0.05 ? "취소하는 중... 계속 꾹!" : "↩ 도장 취소 (1.5초 꾹)";
          },
          () => {
            handleUndoLast();
          }
        );
        actionSlot.appendChild(undoBtn);
      } else if (isDone) {
        const doneCap = document.createElement("span");
        doneCap.className = "done-caption";
        doneCap.textContent = theme.stampTitle;
        actionSlot.appendChild(doneCap);
      } else {
        const lockCap = document.createElement("span");
        lockCap.className = "locked-caption";
        lockCap.textContent = "순서 기다리는 중";
        actionSlot.appendChild(lockCap);
      }

      card.append(head, artWrap, title, actionSlot);
      els.cardsGrid.appendChild(card);
    });
    revokePendingUrls();
  }

  function renderParentModalValues() {
    els.parentDialog.querySelectorAll("[data-theme-choice]").forEach((btn) => {
      btn.classList.toggle("is-selected", btn.dataset.themeChoice === state.theme);
    });
    els.inputChildName.value = state.childName;
    els.inputSchoolLabel.value = state.schoolLabel;
    els.inputPrepStart.value = state.prepStartTime;
    els.inputDepartureTime.value = state.departureTime;
    els.chkSound.checked = Boolean(state.soundEnabled);
    els.chkTts.checked = Boolean(state.ttsEnabled);

    const activeThemeMeta = THEMES[state.theme];
    if (els.mediaPoolThemeLabel) {
      els.mediaPoolThemeLabel.textContent = `현재 테마: ${activeThemeMeta.badge}`;
    }
    if (els.mediaPoolGrid) {
      const themeBuckets = mediaPoolCache[state.theme] || createEmptyMediaBuckets();
      els.mediaPoolGrid.replaceChildren();
      STEP_META.forEach((step) => {
        const items = themeBuckets[step.id] || [];
        const activePick = activeStepMedia.byStep?.[step.id];

        const box = document.createElement("div");
        box.className = "media-pool-card";

        const cardHead = document.createElement("div");
        cardHead.className = "media-pool-card-head";
        const title = document.createElement("div");
        title.className = "image-slot-title";
        title.textContent = `${step.number}. ${step.title}`;
        const countBadge = document.createElement("span");
        countBadge.className = "media-pool-count";
        countBadge.textContent = `${items.length}개`;
        cardHead.append(title, countBadge);

        const sample = document.createElement("div");
        sample.className = "media-pool-sample";
        if (activePick) {
          sample.textContent = `오늘 표시: ${activePick.displayName}`;
        } else if (items.length > 0) {
          sample.textContent = `등록 예: ${items[0].displayName}`;
        } else {
          sample.textContent = "미등록 (기본 내장 그림 사용)";
        }

        const actions = document.createElement("div");
        actions.className = "image-slot-actions";

        const addLabel = document.createElement("label");
        addLabel.className = "upload-file-label";
        addLabel.textContent = "+ 파일 추가";
        const addInput = document.createElement("input");
        addInput.type = "file";
        addInput.multiple = true;
        addInput.accept = "image/*";
        addInput.dataset.poolStep = step.id;
        addInput.addEventListener("change", async (e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          if (files.length === 0) return;
          await handleSlotMediaUpload(step.id, step.title, files);
        });
        addLabel.appendChild(addInput);

        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "clear-img-btn";
        clearBtn.textContent = "비우기";
        clearBtn.disabled = items.length === 0;
        clearBtn.dataset.clearPoolStep = step.id;
        clearBtn.addEventListener("click", async () => {
          try {
            await clearMediaBySlot(state.theme, step.id);
            mediaPoolCache = await loadMediaPoolByTheme();
            rollStepMediaSelection("clear-slot");
            renderAll();
            renderParentModalValues();
            if (els.mediaPoolStatus) {
              els.mediaPoolStatus.textContent = `${activeThemeMeta.name} · ${step.title} 풀을 비웠습니다.`;
            }
          } catch (err) {
            if (els.mediaPoolStatus) els.mediaPoolStatus.textContent = err.message;
          }
        });

        actions.append(addLabel, clearBtn);
        box.append(cardHead, sample, actions);
        els.mediaPoolGrid.appendChild(box);
      });
    }

    els.customImageGrid.replaceChildren();
    CUSTOM_SLOTS.forEach((slot) => {
      const box = document.createElement("div");
      box.className = "image-slot-card";
      box.dataset.customCard = slot.key;
      const title = document.createElement("div");
      title.className = "image-slot-title";
      const hasCustom = Boolean(state.customImages[slot.key]);
      title.textContent = hasCustom ? `${slot.label} (등록됨)` : `${slot.label} (기본 그림)`;

      const actions = document.createElement("div");
      actions.className = "image-slot-actions";

      const fileLabel = document.createElement("label");
      fileLabel.className = "upload-file-label";
      fileLabel.textContent = "📷 바꾸기";
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.dataset.customSlot = slot.key;
      fileInput.addEventListener("change", async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        try {
          const resized = await resizeUploadedImage(file);
          persistState({
            ...state,
            customImages: { ...state.customImages, [slot.key]: resized },
          });
          renderAll();
          renderParentModalValues();
          els.saveStatusNote.textContent = `${slot.label} 그림을 변경했습니다.`;
        } catch (err) {
          els.saveStatusNote.textContent = err.message;
        }
      });
      fileLabel.appendChild(fileInput);

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "clear-img-btn";
      resetBtn.textContent = "기본";
      resetBtn.disabled = !hasCustom;
      resetBtn.dataset.resetCustomSlot = slot.key;
      resetBtn.addEventListener("click", () => {
        persistState({
          ...state,
          customImages: { ...state.customImages, [slot.key]: null },
        });
        renderAll();
        renderParentModalValues();
      });

      actions.append(fileLabel, resetBtn);
      box.append(title, actions);
      els.customImageGrid.appendChild(box);
    });
  }

  function renderAll() {
    if (activeStepMedia.theme !== state.theme || activeStepMedia.dateStr !== formatDateISO()) {
      rollStepMediaSelection("render-guard");
    }
    els.html.setAttribute("data-theme", state.theme);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute("content", state.theme === "pororo" ? "#1e88e5" : "#00acc1");
    }
    renderClockAndCountdown();
    renderWeather();
    renderProgress();
    renderCards();
  }

  async function refreshWeather() {
    const { lat, lon } = state.location;
    const forecastUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code&hourly=temperature_2m,precipitation_probability` +
      `&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FSeoul&forecast_days=1`;
    const airUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&current=pm10,pm2_5&timezone=Asia%2FSeoul`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const [wRes, aRes] = await Promise.all([
        fetch(forecastUrl, { signal: ctrl.signal }),
        fetch(airUrl, { signal: ctrl.signal }),
      ]);
      if (!wRes.ok) throw new Error("Weather fetch failed");
      const wJson = await wRes.json();
      const aJson = aRes.ok ? await aRes.json() : {};

      const times = wJson.hourly?.time || [];
      const temps = wJson.hourly?.temperature_2m || [];
      const probs = wJson.hourly?.precipitation_probability || [];
      const targetHours = [9, 12, 15, 18];
      const hourly = targetHours.map((hr) => {
        const idx = times.findIndex((iso) => iso.endsWith(`T${String(hr).padStart(2, "0")}:00`));
        return {
          hour: `${hr}시`,
          temp: idx >= 0 ? temps[idx] : wJson.current?.temperature_2m ?? 10,
        };
      });

      const morningProbs = probs.slice(7, 19);
      const maxPrecip = morningProbs.length ? Math.max(...morningProbs) : 0;

      weatherData = {
        locationId: FIXED_LOCATION.id,
        tempC: wJson.current?.temperature_2m ?? weatherData.tempC,
        weatherCode: wJson.current?.weather_code ?? 0,
        minTempC: wJson.daily?.temperature_2m_min?.[0] ?? weatherData.minTempC,
        maxTempC: wJson.daily?.temperature_2m_max?.[0] ?? weatherData.maxTempC,
        pm10: aJson.current?.pm10 ?? 20,
        pm25: aJson.current?.pm2_5 ?? 10,
        precipProb: maxPrecip,
        hourly,
        offline: false,
      };
      localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(weatherData));
      renderWeather();
    } catch {
      weatherData = { ...weatherData, offline: true };
      renderWeather();
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleSlotMediaUpload(stepId, stepTitle, files) {
    const items = [];
    let skipped = 0;
    for (const file of files) {
      const mimeType = getImageMimeType(file.name) || (file.type?.startsWith("image/") ? file.type : null);
      if (!mimeType) {
        skipped += 1;
        continue;
      }
      const relPath = normalizeRelPath(file.name);
      items.push({
        id: buildMediaRecordId(state.theme, stepId, relPath),
        theme: state.theme,
        step: stepId,
        relPath,
        displayName: extractDisplayName(relPath),
        mimeType,
        size: file.size,
        blob: file,
      });
    }
    try {
      if (items.length > 0) {
        await putMediaItems(items);
        mediaPoolCache = await loadMediaPoolByTheme();
        rollStepMediaSelection("slot-upload");
        renderAll();
        renderParentModalValues();
      }
      if (els.mediaPoolStatus) {
        els.mediaPoolStatus.textContent = `${THEMES[state.theme].name} · ${stepTitle}에 ${items.length}개 저장했습니다.${skipped ? ` (제외 ${skipped}개)` : ""}`;
      }
    } catch (err) {
      if (els.mediaPoolStatus) els.mediaPoolStatus.textContent = err.message;
    }
  }

  async function handleBatchMediaUpload(files) {
    const items = [];
    let skipped = 0;
    if (els.mediaPoolStatus) {
      els.mediaPoolStatus.textContent = "선택한 파일·ZIP을 정리하고 있습니다...";
    }
    try {
      for (const file of files) {
        const isZip =
          file.name.toLowerCase().endsWith(".zip") ||
          file.type === "application/zip" ||
          file.type === "application/x-zip-compressed";
        if (isZip) {
          for await (const entry of parseZipEntries(file, {
            shouldReadEntry: (entryPath) => classifyMediaPath(entryPath, state.theme) !== null,
          })) {
            const meta = classifyMediaPath(entry.path, state.theme);
            if (!meta) {
              skipped += 1;
              continue;
            }
            const blob = new Blob([entry.bytes], { type: meta.mimeType });
            items.push({
              id: buildMediaRecordId(meta.theme, meta.step, meta.relPath),
              theme: meta.theme,
              step: meta.step,
              relPath: meta.relPath,
              displayName: meta.displayName,
              mimeType: meta.mimeType,
              size: blob.size,
              blob,
            });
          }
        } else {
          const meta = classifyMediaPath(file.name, state.theme);
          if (!meta) {
            skipped += 1;
            continue;
          }
          items.push({
            id: buildMediaRecordId(meta.theme, meta.step, meta.relPath),
            theme: meta.theme,
            step: meta.step,
            relPath: meta.relPath,
            displayName: meta.displayName,
            mimeType: meta.mimeType,
            size: file.size,
            blob: file,
          });
        }
      }

      if (items.length > 0) {
        await putMediaItems(items);
        mediaPoolCache = await loadMediaPoolByTheme();
        rollStepMediaSelection("batch-import");
        renderAll();
        renderParentModalValues();
      }
      if (els.mediaPoolStatus) {
        const byTheme = {
          babyshark: items.filter((it) => it.theme === "babyshark").length,
          pororo: items.filter((it) => it.theme === "pororo").length,
        };
        els.mediaPoolStatus.textContent =
          items.length > 0
            ? `총 ${items.length}개 저장 완료 (아기상어 ${byTheme.babyshark}개 · 뽀로로 ${byTheme.pororo}개${skipped ? `, 제외 ${skipped}개` : ""})`
            : "일치하는 행동 GIF·WebP를 찾지 못했습니다. (각 단계의 '+ 파일 추가'를 이용해 보세요)";
      }
    } catch (err) {
      if (els.mediaPoolStatus) {
        els.mediaPoolStatus.textContent = err.message || "파일 가져오기에 실패했습니다.";
      }
    }
  }

  function applyParentFormChanges() {
    persistState({
      ...state,
      childName: (els.inputChildName.value || "우리 딸").trim().slice(0, 20),
      schoolLabel: (els.inputSchoolLabel.value || "어린이집").trim().slice(0, 20),
      prepStartTime: els.inputPrepStart.value || state.prepStartTime,
      departureTime: els.inputDepartureTime.value || state.departureTime,
      location: { ...FIXED_LOCATION },
      soundEnabled: els.chkSound.checked,
      ttsEnabled: els.chkTts.checked,
    });
    renderAll();
  }

  /* ---------- Event Wiring ---------- */
  // Strict child-lock guards on the main canvas
  document.addEventListener("contextmenu", (e) => {
    if (!els.parentDialog.open) e.preventDefault();
  });
  document.addEventListener("selectstart", (e) => {
    if (!els.parentDialog.open) e.preventDefault();
  });

  // Parent Lock: 3.0s continuous press on top-right 🔒
  attachHoldBehavior(
    els.parentLockBtn,
    PARENT_HOLD_MS,
    (ratio) => {
      const circumference = 126;
      els.parentHoldRing.style.strokeDashoffset = String(circumference * (1 - ratio));
    },
    () => {
      renderParentModalValues();
      els.parentDialog.showModal();
    }
  );

  // The touch that opened the dialog must finish without dismissing it.
  const isOutsideParentDialog = (e) => {
    const rect = els.parentDialog.getBoundingClientRect();
    return e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
  };
  let backdropPointerId = null;
  els.parentDialog.addEventListener("pointerdown", (e) => {
    backdropPointerId = isOutsideParentDialog(e) ? e.pointerId : null;
  });
  els.parentDialog.addEventListener("pointerup", (e) => {
    const startedOnBackdrop = backdropPointerId === e.pointerId;
    backdropPointerId = null;
    if (startedOnBackdrop && isOutsideParentDialog(e)) els.parentDialog.close();
  });

  els.parentDialog.addEventListener("close", () => {
    backdropPointerId = null;
    els.parentDialog.returnValue = "";
  });

  const closeDialog = () => {
    applyParentFormChanges();
    els.parentDialog.close();
  };
  els.btnCloseDialog.addEventListener("click", closeDialog);
  els.btnSaveClose.addEventListener("click", closeDialog);

  els.parentDialog.querySelectorAll("[data-theme-choice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const chosen = btn.dataset.themeChoice;
      const changed = chosen !== state.theme;
      persistState({ ...state, theme: chosen });
      if (changed) {
        rollStepMediaSelection("theme-switch");
      }
      renderAll();
      renderParentModalValues();
    });
  });

  if (els.inputBatchMedia) {
    els.inputBatchMedia.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = "";
      if (files.length === 0) return;
      await handleBatchMediaUpload(files);
    });
  }

  if (els.btnRerollMedia) {
    els.btnRerollMedia.addEventListener("click", () => {
      rollStepMediaSelection("manual-reroll");
      renderAll();
      renderParentModalValues();
      if (els.mediaPoolStatus) {
        els.mediaPoolStatus.textContent = `${THEMES[state.theme].name} 테마 그림을 새로 뽑았습니다.`;
      }
    });
  }

  if (els.btnClearThemeMedia) {
    els.btnClearThemeMedia.addEventListener("click", async () => {
      try {
        await clearMediaByTheme(state.theme);
        mediaPoolCache = await loadMediaPoolByTheme();
        rollStepMediaSelection("clear-theme");
        renderAll();
        renderParentModalValues();
        if (els.mediaPoolStatus) {
          els.mediaPoolStatus.textContent = `${THEMES[state.theme].name} 테마 풀을 모두 비웠습니다.`;
        }
      } catch (err) {
        if (els.mediaPoolStatus) els.mediaPoolStatus.textContent = err.message;
      }
    });
  }

  els.btnParentUndo.addEventListener("click", () => {
    handleUndoLast();
    renderParentModalValues();
  });

  els.btnParentReset.addEventListener("click", () => {
    persistState({
      ...state,
      stepsCompleted: [false, false, false, false],
      lastStampedDate: formatDateISO(),
    });
    renderAll();
    renderParentModalValues();
  });

  [els.inputChildName, els.inputSchoolLabel, els.inputPrepStart, els.inputDepartureTime].forEach((el) =>
    el.addEventListener("change", applyParentFormChanges)
  );
  [els.chkSound, els.chkTts].forEach((el) => el.addEventListener("change", applyParentFormChanges));

  els.btnTestCheer.addEventListener("click", () => {
    applyParentFormChanges();
    if (state.soundEnabled) playStampSound(false);
    if (state.ttsEnabled) {
      const theme = THEMES[state.theme];
      speakCheer(`${theme.cheerPrefix} ${state.childName} 참 잘했어요!`);
    }
  });

  els.btnFullscreen.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      els.saveStatusNote.textContent = "브라우저 메뉴의 '홈 화면에 추가'를 쓰면 전체화면으로 고정됩니다.";
    }
  });

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator && !wakeLockSentinel) {
        wakeLockSentinel = await navigator.wakeLock.request("screen");
        wakeLockSentinel.addEventListener("release", () => {
          wakeLockSentinel = null;
        });
      }
    } catch {
      // Ignore if wakeLock denied
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      requestWakeLock();
      renderClockAndCountdown();
    }
  });

  if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
  }

  window.addEventListener("pagehide", () => {
    const urls = [];
    STEP_IDS.forEach((stepId) => {
      const url = activeStepMedia.byStep?.[stepId]?.url;
      if (url) urls.push(url);
    });
    revokeUrls(urls);
    revokePendingUrls();
  });

  renderAll();
  loadMediaPoolByTheme()
    .then((loadedPool) => {
      mediaPoolCache = loadedPool;
      rollStepMediaSelection("init");
      renderCards();
      if (els.parentDialog.open) {
        renderParentModalValues();
      }
    })
    .catch(() => {
      // IndexedDB unavailable; keep built-in SVG illustrations
    });
  syncFromServerIfEmpty();
  refreshWeather();
  requestWakeLock();
  setInterval(renderClockAndCountdown, 5000);
  setInterval(refreshWeather, 15 * 60 * 1000);
}

if (typeof document !== "undefined") {
  initDashboardApp();
}
