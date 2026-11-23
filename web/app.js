import { DAYCARE_SVG, FIXED_LOCATION, STEP_ILLUSTRATIONS, STEP_META, THEMES } from "./assets.js?release=v17";
import { createStampAudio } from "./stamp-audio.js?release=v17";
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
} from "./media_store.js?release=v17";

export const UNDO_HOLD_MS = 1500;
export const PARENT_HOLD_MS = 3000;

const STORAGE_KEY = "family_dashboard_state_v1";
const FEEDBACK_KEY = "family_dashboard_stamp_feedback_v1";
const CELEBRATION_DAY_KEY = "family_dashboard_stamp_celebration_day";
const STAMP_SETTLE_MS = 320;
const WEATHER_CACHE_KEY = "family_dashboard_weather_cache_v2";
const SEOUL_WEATHER_DATE = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short" });
const WEATHER_HOURS = [9, 12, 15, 18];
const COMMUTE_HOURS = [9, 16];
const WEATHER_CACHE_MAX_MS = 3 * 60 * 60 * 1000;
const CURRENT_MAX_MS = 60 * 60 * 1000;
const SEOUL_LONG_DATE = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric",
  month: "long", day: "numeric", weekday: "long" });
const SEOUL_SHORT_DATE = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric",
  day: "numeric", weekday: "short" });
const MAX_INLINE_ANIMATED_BYTES = 900_000;
const DEFAULT_CHILD_NAME = "친구야";
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
    childName: DEFAULT_CHILD_NAME,
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
  const childName = typeof state.childName === "string" ? state.childName.trim().slice(0, 20) : "";
  state.childName = !childName || ["우리 딸"].includes(childName) ? DEFAULT_CHILD_NAME : childName;
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

const WEATHER_CODES = [
  [[0], "☀️", "맑음"],
  [[1, 2], "⛅", "구름 조금"],
  [[3], "☁️", "흐림"],
  [[45, 48], "🌫️", "안개"],
  [[51, 53, 55, 56, 57], "🌧️", "이슬비"],
  [[61, 63, 65, 66, 67], "🌧️", "비"],
  [[71, 73, 75, 77, 85, 86], "❄️", "눈"],
  [[80, 81, 82], "🌦️", "소나기"],
  [[95, 96, 99], "⛈️", "뇌우"],
];

function weatherCodeToDisplay(code) {
  const match = WEATHER_CODES.find(([codes]) => codes.includes(code));
  return match ? { emoji: match[1], text: match[2] } : null;
}

function timely(timestamp, now, maxAge) {
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAge;
}

function seoulMeasurementTime(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? Date.parse(value + "+09:00") : NaN;
}

function datedForecast(daily, date) {
  const index = Array.isArray(daily?.time) ? daily.time.indexOf(date) : -1;
  if (index < 0) return null;
  const min = daily.temperature_2m_min?.[index];
  const max = daily.temperature_2m_max?.[index];
  const code = daily.weather_code?.[index];
  return {
    date,
    code: weatherCodeToDisplay(code) ? code : null,
    min: Number.isFinite(min) && (!Number.isFinite(max) || min <= max) ? min : null,
    max: Number.isFinite(max) && (!Number.isFinite(min) || min <= max) ? max : null,
  };
}

function forecastSnapshot(payload, now) {
  const date = SEOUL_WEATHER_DATE.format(now);
  const hours = payload.hourly;
  const times = Array.isArray(hours?.time) ? hours.time : [];
  const hourIndex = hour => times.indexOf(`${date}T${String(hour).padStart(2, "0")}:00`);
  const commute = Object.fromEntries(COMMUTE_HOURS.map(hour => {
    const index = hourIndex(hour);
    const rain = hours?.precipitation_probability?.[index];
    return [hour, {
      feelsLike: hours?.apparent_temperature?.[index],
      rain: Number.isFinite(rain) && rain >= 0 && rain <= 100 ? rain : null,
    }];
  }));
  return {
    date, fetchedAt: now, measuredAt: seoulMeasurementTime(payload.current?.time),
    tempC: payload.current?.temperature_2m, weatherCode: payload.current?.weather_code,
    daily: datedForecast(payload.daily, date),
    tomorrow: datedForecast(payload.daily, SEOUL_WEATHER_DATE.format(now + 86_400_000)),
    hourly: WEATHER_HOURS.map(hour => hours?.temperature_2m?.[hourIndex(hour)] ?? null),
    commute,
  };
}

function airQualityDisplay(pm25, pm10) {
  if (![pm25, pm10].every(value => Number.isFinite(value) && value >= 0)) return { grade: "확인 불가", cls: "" };
  const v25 = pm25;
  const v10 = pm10;
  if (v25 <= 15 && v10 <= 30) return { grade: "좋음", cls: "good" };
  if (v25 <= 35 && v10 <= 80) return { grade: "보통", cls: "moderate" };
  if (v25 <= 75 && v10 <= 150) return { grade: "나쁨", cls: "bad" };
  return { grade: "매우나쁨", cls: "very-bad" };
}

function formatKoreanTimeLabel(hhmm) {
  const [hStr, mStr] = String(hhmm || "08:50").split(":");
  const h = Number(hStr);
  const period = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${h12}:${mStr}`;
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
  const feedback = loadFeedbackSettings();
  const systemMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const stampAudio = createStampAudio();
  let stampInputReadyAt = 0;
  let celebratedOn = "";
  let previousProgress = "";
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
  let weatherData = loadCachedWeather();
  let airData = null;
  let weatherPending;
  let weatherDay;

  const els = {
    html: document.documentElement,
    headerMascot: document.getElementById("header-mascot"),
    datePill: document.getElementById("date-pill"),
    clockFace: document.getElementById("clock-face"),
    airBadge: document.getElementById("air-badge"),
    airGrade: document.getElementById("air-grade"),
    airPM25: document.getElementById("air-pm25"),
    weatherEmoji: document.getElementById("weather-emoji"),
    weatherTemp: document.getElementById("weather-temp"),
    weatherCond: document.getElementById("weather-cond"),
    weatherSource: document.getElementById("weather-source"),
    weatherRange: document.getElementById("weather-range"),
    tomorrowDate: document.getElementById("tomorrow-date"),
    tomorrowIcon: document.getElementById("tomorrow-icon"),
    tomorrowLow: document.getElementById("tomorrow-low"),
    tomorrowHigh: document.getElementById("tomorrow-high"),
    tomorrowCondition: document.getElementById("tomorrow-condition"),
    tomorrowRange: document.getElementById("tomorrow-range"),
    hourlyStrip: document.getElementById("hourly-strip"),
    commuteForecasts: [...document.querySelectorAll(".commute-forecast")].map(card => ({
      feelsLike: card.querySelector("[data-feels]"),
      rain: card.querySelector("[data-rain]"),
    })),
    countdownLabel: document.getElementById("countdown-label"),
    countdownValue: document.getElementById("countdown-value"),
    cheerBubble: document.getElementById("cheer-bubble"),
    progressCountPill: document.getElementById("progress-count-pill"),
    progressFill: document.getElementById("progress-fill"),
    trackMascot: document.getElementById("track-mascot"),
    daycareIcon: document.getElementById("daycare-icon"),
    departureBadge: document.getElementById("departure-badge"),
    cardsGrid: document.getElementById("cards-grid"),
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
    chkFinalJingle: document.getElementById("chk-final-jingle"),
    chkReduceMotion: document.getElementById("chk-reduce-motion"),
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
          mimeType: rec.mimeType,
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

  function loadFeedbackSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(FEEDBACK_KEY));
      return { finalJingle: saved?.finalJingle !== false, reduceMotion: saved?.reduceMotion === true };
    } catch {
      return { finalJingle: true, reduceMotion: false };
    }
  }

  function applyFeedbackMotion() {
    els.html.toggleAttribute("data-reduced-motion", feedback.reduceMotion || systemMotion.matches);
  }

  function visibleImage(url, mimeType) {
    if (!els.html.hasAttribute("data-reduced-motion")) return url;
    return /^image\/(?:gif|webp)$/i.test(mimeType || "") || /^data:image\/(?:gif|webp)[;,]/i.test(url || "")
      ? null
      : url;
  }

  function claimDailyCelebration(day) {
    if (celebratedOn === day) return false;
    celebratedOn = day;
    try {
      if (localStorage.getItem(CELEBRATION_DAY_KEY) === day) return false;
      localStorage.setItem(CELEBRATION_DAY_KEY, day);
    } catch {
      // The in-memory date still prevents replay during this session.
    }
    return true;
  }

  function loadCachedWeather() {
    try {
      const raw = localStorage.getItem(WEATHER_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.locationId === FIXED_LOCATION.id) {
          return { ...parsed, cached: true };
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
      if (localStorage.getItem(STORAGE_KEY)) return;
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
      if (activePointerId !== null || (e.isTrusted && !e.isPrimary)) return;
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

    const resetFromActivePointer = (e) => {
      if (e.pointerId === activePointerId) reset();
    };
    buttonEl.addEventListener("pointerup", resetFromActivePointer);
    buttonEl.addEventListener("pointercancel", resetFromActivePointer);
  }

  function handleStepStamp(stepIndex) {
    const now = performance.now();
    const today = formatDateISO();
    if (state.lastStampedDate !== today) {
      renderAll();
      return;
    }
    if (now < stampInputReadyAt || getActiveStepIndex(state.stepsCompleted) !== stepIndex) return;

    const next = applyStamp(state, stepIndex, today);
    const nextIndex = getActiveStepIndex(next.stepsCompleted);
    const celebrate = nextIndex === -1 && claimDailyCelebration(today);
    stampInputReadyAt = now + STAMP_SETTLE_MS;
    persistState(next);
    renderAll();

    const stampedCard = els.cardsGrid.children[stepIndex];
    stampedCard.classList.add("just-stamped");
    if (celebrate) stampedCard.classList.add("final-celebration");
    if (nextIndex !== -1) els.cardsGrid.children[nextIndex].classList.add("next-step-cue");
    if (state.soundEnabled) stampAudio.stamp(celebrate && feedback.finalJingle);
  }

  function handleUndoLast(expectedIndex = getLastCompletedIndex(state.stepsCompleted)) {
    const prevLast = getLastCompletedIndex(state.stepsCompleted);
    if (prevLast < 0 || prevLast !== expectedIndex) return;
    stampAudio.stop();
    stampInputReadyAt = performance.now() + STAMP_SETTLE_MS;
    persistState(undoLastStamp(state));
    renderAll();
    els.cardsGrid.children[prevLast].classList.add("just-unstamped");
    if (state.soundEnabled) stampAudio.undo();
  }

  function renderClockAndCountdown() {
    const now = new Date();
    const todayStr = formatDateISO(now);
    if (state.lastStampedDate !== todayStr) {
      stampAudio.stop();
      stampInputReadyAt = 0;
      persistState(normalizeDailyState(state, todayStr));
      rollStepMediaSelection("date-change");
      renderProgress();
      renderCards();

    }

    const seoulDay = SEOUL_WEATHER_DATE.format(now);
    if (weatherDay !== seoulDay) {
      const changed = weatherDay !== undefined;
      weatherDay = seoulDay;
      renderWeather();
      if (changed) refreshWeather();
    }

    els.datePill.dateTime = seoulDay;
    els.datePill.textContent = SEOUL_LONG_DATE.format(now);

    const h24 = now.getHours();
    const minutes = now.getMinutes();
    const timeLabel = formatKoreanTimeLabel(`${String(h24).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`);
    els.clockFace.setAttribute("aria-label", `현재 시각 ${timeLabel}`);
    els.clockFace.style.setProperty("--hour-angle", `${(h24 % 12) * 30 + minutes / 2}deg`);
    els.clockFace.style.setProperty("--minute-angle", `${minutes * 6}deg`);
    els.clockFace.style.setProperty("--second-angle", `${now.getSeconds() * 6}deg`);

    const countdown = computeCountdown(now, state.prepStartTime, state.departureTime);
    els.countdownLabel.textContent = `${state.schoolLabel} 출발까지`;
    els.countdownValue.textContent = countdown.formattedRemaining;
    els.countdownValue.classList.toggle("is-urgent", countdown.remainingMinutes <= 15);
    els.departureBadge.textContent = `출발 ${formatKoreanTimeLabel(state.departureTime)}`;
  }

  function renderTomorrowWeather(forecast, now) {
    const instant = now + 86_400_000;
    const date = SEOUL_WEATHER_DATE.format(instant);
    els.tomorrowDate.dateTime = date;
    els.tomorrowDate.textContent = SEOUL_SHORT_DATE.format(instant);
    const available = forecast?.date === date ? forecast : null;
    const condition = weatherCodeToDisplay(available?.code);
    const hasRange = [available?.min, available?.max].some(Number.isFinite);
    els.tomorrowIcon.hidden = !condition;
    els.tomorrowIcon.textContent = condition?.emoji ?? "";
    els.tomorrowCondition.textContent = condition?.text ??
      (hasRange ? "날씨 미확인" : weatherPending ? "예보 확인 중" : "예보 확인 불가");
    els.tomorrowRange.hidden = !hasRange;
    for (const [element, value] of [[els.tomorrowLow, available?.min], [els.tomorrowHigh, available?.max]]) {
      element.textContent = Number.isFinite(value) ? `${Math.round(value)}°` : "—";
    }
  }

  function renderWeather() {
    const now = Date.now();
    const available = timely(weatherData?.fetchedAt, now, WEATHER_CACHE_MAX_MS) ? weatherData : null;
    const date = SEOUL_WEATHER_DATE.format(now);
    const today = available?.date === date ? available : null;
    // A cached tomorrow row may still serve today's range after midnight with its actual date.
    const daily = today?.daily ?? (available?.tomorrow?.date === date ? available.tomorrow : null);
    const current = timely(today?.measuredAt, now, CURRENT_MAX_MS) &&
      SEOUL_WEATHER_DATE.format(today.measuredAt) === date ? today : null;
    const cond = weatherCodeToDisplay(current?.weatherCode);
    const measured = timely(airData?.measuredAt, now, CURRENT_MAX_MS) &&
      SEOUL_WEATHER_DATE.format(airData.measuredAt) === date ? airData : null;
    const air = airQualityDisplay(measured?.pm25, measured?.pm10);

    els.airBadge.className = `air-badge ${air.cls}`;
    els.airGrade.textContent = air.cls || !weatherPending ? air.grade : "확인 중";
    els.airPM25.hidden = !Number.isFinite(measured?.pm25);
    els.airPM25.textContent = els.airPM25.hidden ? "" : `초미세 ${Math.round(measured.pm25)}`;

    els.weatherEmoji.hidden = !cond;
    els.weatherEmoji.textContent = cond?.emoji ?? "";
    els.weatherTemp.hidden = !Number.isFinite(current?.tempC);
    els.weatherTemp.textContent = els.weatherTemp.hidden ? "" : `${Math.round(current.tempC)}°`;
    els.weatherCond.textContent = cond?.text ?? (weatherPending ? "날씨 확인 중" : "현재 날씨 미확인");
    els.weatherSource.hidden = !(available?.cached || (!today && daily));
    const range = [[daily?.min, "최저"], [daily?.max, "최고"]]
      .filter(([value]) => Number.isFinite(value)).map(([value, label]) => `${label} ${Math.round(value)}°`);
    els.weatherRange.hidden = !range.length;
    els.weatherRange.textContent = range.join(" · ");
    renderTomorrowWeather(available?.tomorrow, now);

    for (const [index, cell] of [...els.hourlyStrip.children].entries()) {
      const temp = today?.hourly?.[index];
      cell.lastElementChild.textContent = Number.isFinite(temp) ? `${Math.round(temp)}°` : "—";
    }
    const temperature = value => Number.isFinite(value) ? `${Math.round(value)}°C` : "미확인";
    for (const [index, hour] of COMMUTE_HOURS.entries()) {
      const forecast = today?.commute?.[hour];
      const card = els.commuteForecasts[index];
      card.feelsLike.textContent = temperature(forecast?.feelsLike);
      card.rain.textContent = Number.isFinite(forecast?.rain) ? `${Math.round(forecast.rain)}%` : "미확인";
    }
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
      claimDailyCelebration(state.lastStampedDate);
      els.cheerBubble.textContent = "🏫 준비 끝! 이제 출발해요!";
    } else {
      const step = STEP_META[activeIdx];
      els.cheerBubble.textContent = `${state.childName}, 같이 '${step.title}' 해볼까?`;
    }

    const mascotUrl = visibleImage(resolveThemeMascotUrl(state));
    const clockMascotUrl = visibleImage(state.customImages?.[`mascot_${state.theme}`]);
    setMediaSlot(els.headerMascot, clockMascotUrl, theme.mascotSvg, theme.name);
    setMediaSlot(els.trackMascot, mascotUrl, theme.mascotSvg, theme.name);
    const progress = `${state.theme}:${state.lastStampedDate}:${doneCount}`;
    if (progress !== previousProgress && state.theme === "babyshark" && activeIdx !== -1) {
      els.trackMascot.firstElementChild?.classList.add("swim-forward");
    }
    previousProgress = progress;
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
      if (isActive) card.setAttribute("aria-current", "step");

      const head = document.createElement("div");
      head.className = "step-card-head";
      const badge = document.createElement("span");
      badge.className = "step-num-badge";
      badge.textContent = isDone ? "✓" : String(step.number);

      const helper = document.createElement("div");
      helper.className = "active-helper";
      const speech = document.createElement("span");
      speech.className = "active-speech";
      speech.textContent = "지금 할 일";
      const miniMascot = document.createElement("div");
      miniMascot.className = "mini-mascot";
      const mascotUrl = visibleImage(resolveThemeMascotUrl(state));
      setMediaSlot(miniMascot, mascotUrl, theme.mascotSvg, theme.name);
      helper.append(speech, miniMascot);
      head.append(badge, helper);

      const artWrap = document.createElement("div");
      artWrap.className = "step-art-wrap";
      const art = document.createElement("div");
      art.className = "step-art";
      const pooledMedia = activeStepMedia.byStep[step.id];
      const stepMediaUrl = visibleImage(state.customImages[step.id]) ||
        visibleImage(pooledMedia?.url, pooledMedia?.mimeType);
      setMediaSlot(art, stepMediaUrl, STEP_ILLUSTRATIONS[step.id], step.title);

      const stampOverlay = document.createElement("div");
      stampOverlay.className = "stamp-overlay";
      const stampInner = document.createElement("div");
      stampInner.className = "stamp-badge-inner";
      setStampSlot(stampInner, visibleImage(resolveThemeStampUrl(state)), mascotUrl, theme);
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
          if (performance.now() < stampInputReadyAt || (e.isTrusted && !e.isPrimary)) return;
          pressedPointerId = e.pointerId;
        });
        ctaBtn.addEventListener("pointercancel", (e) => {
          if (e.pointerId === pressedPointerId) pressedPointerId = null;
        });
        ctaBtn.addEventListener("click", (e) => {
          // A completed undo hold can place this button under the released pointer.
          if (e.pointerType && e.pointerId !== pressedPointerId) return;
          pressedPointerId = null;
          e.stopPropagation();
          handleStepStamp(idx);
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
            handleUndoLast(idx);
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
    els.chkFinalJingle.checked = feedback.finalJingle;
    els.chkReduceMotion.checked = feedback.reduceMotion;

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
      metaTheme.setAttribute("content", state.theme === "pororo" ? "#1e88e5" : "#ffeb3b");
    }
    renderClockAndCountdown();
    renderWeather();
    renderProgress();
    renderCards();
  }

  function refreshWeather() {
    if (weatherPending) return weatherPending;
    const { lat, lon } = state.location;
    const forecastUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code&hourly=temperature_2m,apparent_temperature,precipitation_probability` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=Asia%2FSeoul&forecast_days=2`;
    const airUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&current=pm10,pm2_5&timezone=Asia%2FSeoul`;

    async function readWeather(url) {
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error("Weather fetch failed");
      return response.json();
    }

    const updateForecast = readWeather(forecastUrl).then(payload => {
      if (!payload || payload.error || !payload.current && !payload.daily && !payload.hourly) {
        throw new Error("Weather payload missing");
      }
      weatherData = { ...forecastSnapshot(payload, Date.now()), locationId: FIXED_LOCATION.id };
      try { localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(weatherData)); }
      catch { /* The live forecast remains usable. */ }
    }, () => { if (weatherData) weatherData.cached = true; });
    const updateAir = readWeather(airUrl).then(payload => {
      const current = payload?.current;
      airData = current ? { measuredAt: seoulMeasurementTime(current.time),
        pm10: current.pm10, pm25: current.pm2_5 } : null;
    }, () => { airData = null; });
    weatherPending = Promise.allSettled([updateForecast, updateAir]).then(([forecast]) => {
      if (forecast.status === "rejected" && weatherData) weatherData.cached = true;
      weatherPending = null;
      renderWeather();
    });
    renderWeather();
    return weatherPending;
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
    if (!els.chkSound.checked || feedback.finalJingle !== els.chkFinalJingle.checked) stampAudio.stop();
    feedback.finalJingle = els.chkFinalJingle.checked;
    feedback.reduceMotion = els.chkReduceMotion.checked;
    try {
      localStorage.setItem(FEEDBACK_KEY, JSON.stringify(feedback));
    } catch {
      els.saveStatusNote.textContent = "이 탭을 닫으면 효과 설정이 초기화될 수 있어요.";
    }
    applyFeedbackMotion();
    persistState({
      ...state,
      childName: els.inputChildName.value,
      schoolLabel: (els.inputSchoolLabel.value || "어린이집").trim().slice(0, 20),
      prepStartTime: els.inputPrepStart.value || state.prepStartTime,
      departureTime: els.inputDepartureTime.value || state.departureTime,
      location: { ...FIXED_LOCATION },
      soundEnabled: els.chkSound.checked,
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
    stampAudio.stop();
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
      const themeBuckets = mediaPoolCache[state.theme] || createEmptyMediaBuckets();
      const counts = STEP_IDS.map((stepId) => (themeBuckets[stepId] || []).length);
      const totalItems = counts.reduce((acc, n) => acc + n, 0);
      const rerollableSteps = counts.filter((n) => n >= 2).length;
      const visibleRerolls = STEP_IDS.some((stepId, idx) => counts[idx] >= 2 && !state.customImages[stepId]);
      const fixedSteps = STEP_IDS.filter((stepId) => Boolean(state.customImages[stepId])).length;

      rollStepMediaSelection("manual-reroll");
      renderAll();
      renderParentModalValues();

      if (els.mediaPoolStatus) {
        const themeName = THEMES[state.theme].name;
        if (totalItems === 0) {
          els.mediaPoolStatus.textContent = `${themeName} 테마에 등록된 행동 그림이 없습니다. 먼저 ZIP이나 파일을 추가해 주세요.`;
        } else if (rerollableSteps === 0) {
          els.mediaPoolStatus.textContent = `${themeName} 테마는 단계별로 1개만 있어 바꿀 다른 그림이 없습니다. (2개 이상 등록 시 랜덤 변경)`;
        } else if (!visibleRerolls) {
          els.mediaPoolStatus.textContent = "후보가 있는 단계에 섹션 6 고정 그림이 설정되어 있습니다. 랜덤 그림을 표시하려면 해당 단계의 고정 그림을 초기화해 주세요.";
        } else {
          const fixedNote = fixedSteps > 0 ? ` (섹션 6 고정 그림 ${fixedSteps}개는 유지됨)` : "";
          els.mediaPoolStatus.textContent = `${themeName} 테마 그림을 새로 뽑았습니다.${fixedNote}`;
        }
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
    stampAudio.stop();
    stampInputReadyAt = 0;
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
  [els.chkSound, els.chkFinalJingle, els.chkReduceMotion].forEach((el) =>
    el.addEventListener("change", applyParentFormChanges)
  );
  els.parentDialog.querySelectorAll("[data-preview-sound]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.previewSound;
      if (kind === "undo") stampAudio.undo();
      else stampAudio.stamp(kind === "final" && feedback.finalJingle);
    });
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
    } else {
      stampAudio.stop();
    }
  });

  if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
    const worker = navigator.serviceWorker;
    const release = document.querySelector('meta[name="family-dashboard-release"]')?.content;
    const updateButton = document.getElementById("shell-update");
    const boardName = els.html.dataset.suppliesEnabled === "true" ? "가족 보드" : "공개 보드";
    if (release) document.getElementById("shell-release").textContent = `${boardName} · ${release}`;
    const showAvailableUpdate = () => {
      if (!worker.controller || !updateButton) return;
      const channel = new MessageChannel();
      const timeout = setTimeout(() => channel.port1.close(), 2000);
      channel.port1.onmessage = ({ data: installedRelease }) => {
        clearTimeout(timeout);
        channel.port1.close();
        updateButton.hidden = installedRelease === release;
      };
      worker.controller.postMessage("family-dashboard-release", [channel.port2]);
    };
    worker.addEventListener("controllerchange", showAvailableUpdate);
    updateButton?.addEventListener("click", () => location.replace(new URL("./", location.href)));
    const registration = worker.register("./sw.js", { scope: "./", updateViaCache: "none" });
    registration.then(showAvailableUpdate).catch(() => {});
    const update = () => {
      if (document.hidden) return;
      showAvailableUpdate();
      registration.then((registered) => registered.update()).catch(() => {});
    };
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pageshow", update);
    window.addEventListener("online", update);
    setInterval(update, 5 * 60 * 1000);
  }

  window.addEventListener("pagehide", () => {
    stampAudio.stop();
    const urls = [];
    STEP_IDS.forEach((stepId) => {
      const url = activeStepMedia.byStep?.[stepId]?.url;
      if (url) urls.push(url);
    });
    revokeUrls(urls);
    revokePendingUrls();
  });

  systemMotion.addEventListener("change", () => {
    applyFeedbackMotion();
    renderAll();
  });
  applyFeedbackMotion();
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
  setInterval(renderClockAndCountdown, 1000);
  setInterval(refreshWeather, 15 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshWeather();
  });
}

if (typeof document !== "undefined") {
  initDashboardApp();
}
