/**
 * Tablet-local IndexedDB media pool, zero-dep ZIP slice parser, and session random picker.
 * Works in both browser ES modules and Node.js unit tests (pure functions).
 */

export const MEDIA_DB_NAME = "family_dashboard_media_v1";
export const MEDIA_DB_VERSION = 1;
export const MEDIA_STORE_NAME = "mediaPool";
export const STEP_IDS = Object.freeze(["step1", "step2", "step3", "step4"]);
export const SUPPORTED_THEMES = Object.freeze(["babyshark", "pororo"]);
export const MAX_ZIP_ENTRY_BYTES = 52_428_800; // 50 MB per animation file

const IMAGE_MIME_BY_EXT = Object.freeze({
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
});

export function createEmptyMediaBuckets() {
  return { step1: [], step2: [], step3: [], step4: [] };
}

export function normalizeRelPath(rawPath) {
  return String(rawPath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

export function extractDisplayName(relPath) {
  const norm = normalizeRelPath(relPath);
  const parts = norm.split("/");
  return parts[parts.length - 1] || norm;
}

export function buildMediaRecordId(theme, step, relPath) {
  return `${theme}:${step}:${normalizeRelPath(relPath)}`;
}

export function getImageMimeType(fileName) {
  const lower = String(fileName || "").toLowerCase();
  const dotIdx = lower.lastIndexOf(".");
  if (dotIdx < 0) return null;
  return IMAGE_MIME_BY_EXT[lower.slice(dotIdx)] || null;
}

const POSTER_DIRECTORY = /(^|\/)posters?\//i;

/**
 * Classify a ZIP or batch-uploaded image path into { theme, step, relPath, displayName, mimeType }.
 * Returns null for macOS metadata, hidden files, poster PNGs, unsupported extensions, or unknown steps.
 */
export function classifyMediaPath(entryPath, fallbackTheme = "pororo") {
  const relPath = normalizeRelPath(entryPath);
  if (!relPath || relPath.endsWith("/")) return null;
  if (/(^|\/)__MACOSX(\/|$)/i.test(relPath)) return null;
  if (/(^|\/)\./.test(relPath)) return null;
  if (POSTER_DIRECTORY.test(relPath)) return null;

  const mimeType = getImageMimeType(relPath);
  if (!mimeType) return null;

  let theme = SUPPORTED_THEMES.includes(fallbackTheme) ? fallbackTheme : "pororo";
  if (/아기상어|(?:아빠|엄마|할머니|할아버지)상어|shark/i.test(relPath)) {
    theme = "babyshark";
  } else if (/뽀로로|pororo|crong|eddy|loopy|petty/i.test(relPath)) {
    theme = "pororo";
  }

  let step = null;
  if (/breakfast|01[_-]?breakfast|아침/i.test(relPath)) {
    step = "step1";
  } else if (/hygiene|wash[_-]?brush|02[_-]?wash|세수|양치/i.test(relPath)) {
    step = "step2";
  } else if (/dress|get[_-]?dressed|03[_-]?get|옷/i.test(relPath)) {
    step = "step3";
  } else if (/bag|pack[_-]?bag|04[_-]?pack|가방/i.test(relPath)) {
    step = "step4";
  }

  if (!step) return null;
  return {
    theme,
    step,
    relPath,
    displayName: extractDisplayName(relPath),
    mimeType,
  };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function readByteRange(source, start, end) {
  if (source instanceof Uint8Array) {
    return source.subarray(start, end);
  }
  if (source && typeof source.slice === "function") {
    const buf = await source.slice(start, end).arrayBuffer();
    return new Uint8Array(buf);
  }
  throw new Error("지원하지 않는 ZIP 입력 형식입니다.");
}

function getSourceLength(source) {
  if (source instanceof Uint8Array) return source.byteLength;
  if (source && typeof source.size === "number") return source.size;
  throw new Error("ZIP 크기를 확인할 수 없습니다.");
}

function decodeZipFilename(nameBytes, flags) {
  const utf8Decoder = new TextDecoder("utf-8", { fatal: (flags & 0x0800) !== 0 });
  try {
    return utf8Decoder.decode(nameBytes);
  } catch {
    return new TextDecoder("utf-8").decode(nameBytes);
  }
}

async function inflateDeflateRaw(compressedBytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("이 브라우저는 ZIP 압축 해제를 지원하지 않습니다.");
  }
  const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Stream-parse ZIP entries via Central Directory and File.slice() without loading whole archive in RAM.
 */
export async function* parseZipEntries(source, options = {}) {
  const shouldReadEntry = typeof options.shouldReadEntry === "function" ? options.shouldReadEntry : () => true;
  const totalLen = getSourceLength(source);
  if (totalLen < 22) {
    throw new Error("올바른 ZIP 파일이 아닙니다.");
  }

  const tailSize = Math.min(totalLen, 65557);
  const tailStart = totalLen - tailSize;
  const tailBytes = await readByteRange(source, tailStart, totalLen);
  const tailView = new DataView(tailBytes.buffer, tailBytes.byteOffset, tailBytes.byteLength);

  let eocdRel = -1;
  for (let i = tailBytes.length - 22; i >= 0; i -= 1) {
    if (tailView.getUint32(i, true) === 0x06054b50) {
      const commentLen = tailView.getUint16(i + 20, true);
      if (i + 22 + commentLen === tailBytes.length) {
        eocdRel = i;
        break;
      }
    }
  }
  if (eocdRel < 0) {
    throw new Error("ZIP 중앙 디렉터리 끝(EOCD)을 찾을 수 없습니다.");
  }

  const diskNumber = tailView.getUint16(eocdRel + 4, true);
  const cdDisk = tailView.getUint16(eocdRel + 6, true);
  const entriesOnDisk = tailView.getUint16(eocdRel + 8, true);
  const totalEntries = tailView.getUint16(eocdRel + 10, true);
  const cdSize = tailView.getUint32(eocdRel + 12, true);
  const cdOffset = tailView.getUint32(eocdRel + 16, true);

  if (diskNumber !== 0 || cdDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new Error("분할 압축(멀티디스크) ZIP은 지원하지 않습니다.");
  }
  if (
    totalEntries === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff ||
    cdOffset + cdSize > tailStart + eocdRel
  ) {
    throw new Error("Zip64 또는 손상된 ZIP 파일은 지원하지 않습니다.");
  }

  const cdBytes = await readByteRange(source, cdOffset, cdOffset + cdSize);
  const cdView = new DataView(cdBytes.buffer, cdBytes.byteOffset, cdBytes.byteLength);

  let cursor = 0;
  for (let idx = 0; idx < totalEntries; idx += 1) {
    if (cursor + 46 > cdBytes.length || cdView.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error("ZIP 중앙 디렉터리 헤더가 손상되었습니다.");
    }
    const flags = cdView.getUint16(cursor + 8, true);
    const method = cdView.getUint16(cursor + 10, true);
    const expectedCrc = cdView.getUint32(cursor + 16, true);
    const compressedSize = cdView.getUint32(cursor + 20, true);
    const uncompressedSize = cdView.getUint32(cursor + 24, true);
    const nameLen = cdView.getUint16(cursor + 28, true);
    const extraLen = cdView.getUint16(cursor + 30, true);
    const commentLen = cdView.getUint16(cursor + 32, true);
    const localHeaderOffset = cdView.getUint32(cursor + 42, true);

    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd + extraLen + commentLen > cdBytes.length) {
      throw new Error("ZIP 파일 목록 길이가 잘못되었습니다.");
    }
    const entryPath = decodeZipFilename(cdBytes.subarray(nameStart, nameEnd), flags);
    cursor = nameEnd + extraLen + commentLen;

    if (entryPath.endsWith("/")) continue;
    if (!shouldReadEntry(entryPath)) continue;

    if ((flags & 0x0001) !== 0) {
      throw new Error(`암호화된 ZIP 파일(${entryPath})은 지원하지 않습니다.`);
    }
    if (method !== 0 && method !== 8) {
      throw new Error(`지원하지 않는 ZIP 압축 방식(method=${method}): ${entryPath}`);
    }
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
      throw new Error(`파일이 너무 큽니다(최대 50MB): ${entryPath}`);
    }
    if (localHeaderOffset + 30 > totalLen) {
      throw new Error(`손상된 ZIP 로컬 헤더 오프셋: ${entryPath}`);
    }

    const lfhBytes = await readByteRange(source, localHeaderOffset, localHeaderOffset + 30);
    const lfhView = new DataView(lfhBytes.buffer, lfhBytes.byteOffset, lfhBytes.byteLength);
    if (lfhView.getUint32(0, true) !== 0x04034b50) {
      throw new Error(`ZIP 로컬 헤더 시그니처 불일치: ${entryPath}`);
    }
    const lfhNameLen = lfhView.getUint16(26, true);
    const lfhExtraLen = lfhView.getUint16(28, true);
    const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > totalLen) {
      throw new Error(`ZIP 압축 데이터 범위 초과: ${entryPath}`);
    }

    const compressedBytes = await readByteRange(source, dataStart, dataEnd);
    const bytes = method === 0 ? new Uint8Array(compressedBytes) : await inflateDeflateRaw(compressedBytes);

    if (bytes.byteLength !== uncompressedSize) {
      throw new Error(`ZIP 해제 크기 불일치: ${entryPath}`);
    }
    if (crc32(bytes) !== expectedCrc) {
      throw new Error(`ZIP CRC-32 검증 실패: ${entryPath}`);
    }

    yield { path: entryPath, bytes };
  }
}

export function pickRandomFromPool(items, rng = Math.random, excludeId = null) {
  if (!Array.isArray(items) || items.length === 0) return null;
  if (items.length === 1) return items[0];
  const candidates = excludeId ? items.filter((item) => item?.id !== excludeId) : items;
  const pool = candidates.length > 0 ? candidates : items;
  const raw = Number(rng());
  const clamped = Number.isFinite(raw) ? Math.min(0.999999999, Math.max(0, raw)) : 0;
  return pool[Math.floor(clamped * pool.length)];
}

export function buildStepMediaSelection(poolByStep, rng = Math.random, prevSelection = null) {
  const out = {};
  STEP_IDS.forEach((stepId) => {
    const excludeId = prevSelection?.[stepId]?.id || null;
    out[stepId] = pickRandomFromPool(poolByStep?.[stepId] || [], rng, excludeId);
  });
  return out;
}

/* ---------- Browser IndexedDB Storage ---------- */
export function openMediaDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB를 지원하지 않는 환경입니다."));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MEDIA_DB_NAME, MEDIA_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE_NAME)) {
        const store = db.createObjectStore(MEDIA_STORE_NAME, { keyPath: "id" });
        store.createIndex("byThemeStep", ["theme", "step"], { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB 열기에 실패했습니다."));
  });
}

function requestPersistentStorage() {
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {});
    }
  } catch {
    // Ignore storage persistence check errors
  }
}

export async function putMediaItems(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  requestPersistentStorage();
  const db = await openMediaDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE_NAME, "readwrite");
      const store = tx.objectStore(MEDIA_STORE_NAME);
      const now = Date.now();
      items.forEach((item) => {
        store.put({
          id: item.id,
          theme: item.theme,
          step: item.step,
          relPath: item.relPath,
          displayName: item.displayName,
          mimeType: item.mimeType,
          size: item.size ?? item.blob?.size ?? 0,
          blob: item.blob,
          addedAt: item.addedAt ?? now,
        });
      });
      tx.oncomplete = () => resolve(items.length);
      tx.onerror = () => reject(tx.error || new Error("미디어 저장에 실패했습니다."));
      tx.onabort = () => reject(tx.error || new Error("미디어 저장 트랜잭션이 중단되었습니다."));
    });
  } finally {
    db.close();
  }
}

export async function loadMediaPoolByTheme() {
  const result = {
    babyshark: createEmptyMediaBuckets(),
    pororo: createEmptyMediaBuckets(),
  };
  if (typeof indexedDB === "undefined") return result;

  const db = await openMediaDb();
  try {
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE_NAME, "readonly");
      const req = tx.objectStore(MEDIA_STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error("미디어 목록 조회에 실패했습니다."));
    });
    records.forEach((rec) => {
      if (!POSTER_DIRECTORY.test(rec.relPath) && result[rec.theme] && result[rec.theme][rec.step]) {
        result[rec.theme][rec.step].push(rec);
      }
    });
    return result;
  } finally {
    db.close();
  }
}

export async function clearMediaBySlot(theme, step) {
  const db = await openMediaDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE_NAME, "readwrite");
      const index = tx.objectStore(MEDIA_STORE_NAME).index("byThemeStep");
      const req = index.openCursor(IDBKeyRange.only([theme, step]));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("슬롯 비우기에 실패했습니다."));
    });
  } finally {
    db.close();
  }
}

export async function clearMediaByTheme(theme) {
  const db = await openMediaDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE_NAME, "readwrite");
      const store = tx.objectStore(MEDIA_STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if (cursor.value?.theme === theme) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("테마 풀 비우기에 실패했습니다."));
    });
  } finally {
    db.close();
  }
}
