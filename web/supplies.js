const kst = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short" });
const clock = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const states = { READY: "준비물 있음", EMPTY: "준비물 없음", NEEDS_REVIEW: "확인 필요", AUTH_REQUIRED: "키즈노트 재인증 필요", PENDING: "갱신 대기" };
const deadlines = { PENDING: "", ON_TIME: "마감 준수", LATE: "지연 게시", MISSED: "마감 미충족" };
const sources = { report: "알림장", notice: "공지", calendar: "월간행사표" };
const ready = (state) => state === "READY" || state === "EMPTY";
const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const stamp = (value) => typeof value === "string" && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const nullableText = (value) => value === null || typeof value === "string";
const bulletinStatuses = { VERIFIED: "확인됨", REVIEW_REQUIRED: "확인 필요" };
const bulletinKinds = { EVENT: "행사", PREPARATION: "준비", INFORMATION: "안내" };
const blockers = {
  DAILY_LIVE_DISABLED: "자동 판정 비활성",
  RELEASE_APPROVAL_MISSING: "운영 승인 설정 미등록",
  LOGIN_PROOF_MISSING: "로그인 검증 미등록",
  SOURCE_PROOF_MISSING: "자료 충분성 검증 미등록",
  SOURCE_PROOF_UNVERIFIED: "자료 충분성 검증 재확인 필요",
  DAILY_CHECK_FAILED: "판정 시작 조건 확인 실패",
};

export function validateSupplies(data) {
  if (!data || data.schemaVersion !== 1 || !date(data.targetDate) || !stamp(data.serverNow) ||
      kst.format(new Date(data.serverNow)) !== data.targetDate || !Object.hasOwn(states, data.state) ||
      !Object.hasOwn(deadlines, data.deadlineState) || data.complete !== ready(data.state) ||
      ![data.checkedAt, data.publishedAt].every((value) => value === null || stamp(value)) ||
      !Array.isArray(data.items)) return false;
  if (ready(data.state) && (!data.checkedAt || !data.publishedAt)) return false;
  if (data.state === "READY" ? data.items.length === 0 : data.state !== "NEEDS_REVIEW" && data.items.length > 0) return false;
  if (data.guardianConfirmation !== undefined && (!data.guardianConfirmation ||
      data.guardianConfirmation.source !== "GUARDIAN" || !date(data.guardianConfirmation.sourceDate) ||
      data.guardianConfirmation.sourceDate > data.targetDate || data.complete || data.items.length)) return false;
  if (data.dailyAssessment !== undefined && (!Array.isArray(data.dailyAssessment?.blockers) ||
      !data.dailyAssessment.blockers.every(code=>Object.hasOwn(blockers,code)))) return false;
  if (data.bulletins !== undefined && (!Array.isArray(data.bulletins) || data.bulletins.length > 20 ||
      !data.bulletins.every((row) => row && Object.hasOwn(bulletinStatuses, row.status) &&
        Object.hasOwn(bulletinKinds, row.kind) && (row.date === null || date(row.date)) &&
        date(row.sourceDate) && typeof row.title === "string" && row.title.length <= 160 &&
        typeof row.detail === "string" && row.detail.length <= 400))) return false;
  return data.items.every((item) => item && typeof item.label === "string" && item.label.trim() &&
    (nullableText(item.quantity) || (Number.isFinite(item.quantity) && item.quantity > 0)) &&
    nullableText(item.condition) && item.applicableDate === data.targetDate &&
    Object.hasOwn(sources, item.sourceType) && date(item.sourceDate) && typeof item.sourceRef === "string");
}

function labelFor(data, mode) {
  if (mode === "auth") return "가족 보드 로그인 필요";
  if (mode === "checking") return "갱신 대기";
  if (mode === "connect") return "확인 필요 · 연결 후 확인";
  if (!data || (data.state === "PENDING" && data.deadlineState === "MISSED")) return "확인 필요";
  if (data.guardianConfirmation) return "준비물 없음 (보호자 확인)";
  return states[data.state];
}

function itemText(item) {
  return [item.label, item.quantity, item.condition].filter((part) => part !== null && part !== "").join(" · ");
}

function start() {
  const button = document.getElementById("supplies-button");
  const dialog = document.getElementById("supplies-dialog");
  if (!button || !dialog) return;
  const details = document.getElementById("supplies-details");
  const status = document.getElementById("supplies-status");
  const dialogStatus = document.getElementById("supplies-dialog-status");
  const list = document.getElementById("supplies-list");
  const bulletinsSection = document.getElementById("kidsnote-bulletins");
  const bulletinList = document.getElementById("kidsnote-bulletin-list");
  const login = document.getElementById("supplies-login");
  const dialogLogin = document.getElementById("supplies-dialog-login");
  const endpoint = new URL("./api/supplies/today", location.href);
  let current = null;
  let mode = "checking";
  let pending;
  let suspended = false;
  let activeRequest;
  let observedServerTime = 0;
  let observedClientTime = 0;

  function render() {
    const data = current;
    login.hidden = dialogLogin.hidden = mode !== "auth";
    const items = data?.items ?? [];
    const bulletins = data?.bulletins ?? [];
    const hasItems = items.length > 0;
    button.classList.toggle("has-items", hasItems || bulletins.length > 0);
    list.hidden = !hasItems;
    if (hasItems || bulletins.length) {
      button.setAttribute("aria-description", hasItems ? "오늘 표시할 준비물이 있습니다. 상세 내용을 확인해 주세요." :
        "확인할 일정과 안내가 있습니다.");
    } else {
      button.removeAttribute("aria-description");
    }
    const title = labelFor(data, mode);
    const count = data?.state === "READY" ? ` · 전체 ${items.length}개` :
      data?.state === "NEEDS_REVIEW" && items.length ? ` · 확인 ${items.length}개` : "";
    const checkedAt = data?.checkedAt ? new Date(data.checkedAt) : null;
    const checkedDay = checkedAt && kst.format(checkedAt);
    const checked = checkedAt ? [
      checkedDay !== data.targetDate && checkedDay.slice(5).replace("-", "/"),
      clock.format(checkedAt) + " 확인",
    ].filter(Boolean).join(" ") : "";
    const deadline = data?.guardianConfirmation ? (data.deadlineState === "MISSED" ? "자동 판정 마감 미충족" : "") :
      data?.reasonCode === "NO_RESULT_EVIDENCE" && data.deadlineState === "MISSED" ?
      "마감 미충족 · 실행 미확인" : data ? deadlines[data.deadlineState] : "";
    const failure = mode === "stale" || (ready(data?.state) && data?.latestAttempt?.status === "FAILED");
    const summary = [title + count, checked, deadline, failure && "갱신 실패"].filter(Boolean).join(" · ");
    const decisionBlockers = data?.dailyAssessment?.blockers.map(code=>blockers[code]) ?? [];
    const guidance = !data?.complete && decisionBlockers.length ? "자동 판정 대기 (" + decisionBlockers.join(", ") + ")" :
      data?.state === "NEEDS_REVIEW" && !hasItems && !data.guardianConfirmation ?
        "오늘 준비물 확인이 아직 끝나지 않았어요." : "";
    status.textContent = [summary,
      data?.state === "PENDING" && data.deadlineState === "PENDING" && !data.guardianConfirmation && "05:10 KST 수집 예정",
      data?.state === "AUTH_REQUIRED" && "보호자가 키즈노트 인증을 확인해 주세요"].filter(Boolean).join(" · ");
    dialogStatus.textContent = [status.textContent, guidance].filter(Boolean).join(" · ");
    list.replaceChildren(...items.map((item) => {
      const row = document.createElement("li");
      const source = document.createElement("small");
      source.textContent = `${sources[item.sourceType]} · ${item.sourceDate}`;
      row.append(itemText(item), source);
      return row;
    }));
    if (bulletinsSection && bulletinList) {
      bulletinsSection.hidden = bulletins.length === 0;
      bulletinList.replaceChildren(...bulletins.map((item) => {
        const row = document.createElement("li");
        const note = document.createElement("small");
        const day = item.date ? item.date.slice(5).replace("-", "/") + " " : "";
        note.textContent = [bulletinKinds[item.kind], bulletinStatuses[item.status], item.detail].filter(Boolean).join(" · ");
        row.append(day + item.title, note);
        return row;
      }));
    }
  }

  function update(next, nextMode) {
    current = next;
    mode = nextMode;
    render();
  }

  function expireDate() {
    if (!current) return;
    const elapsed = Date.now() - observedClientTime;
    if (elapsed < 0 || kst.format(new Date(observedServerTime + elapsed)) !== current.targetDate) {
      update(null, "connect");
      refresh();
    }
  }

  function onConnectionFailure() {
    expireDate();
    if (mode === "auth") return;
    if (ready(current?.state)) update(current, "stale");
    else update(null, "connect");
  }

  async function refresh() {
    if (activeRequest || suspended) return;
    clearTimeout(pending);
    const request = new AbortController();
    activeRequest = request;
    const startedAt = Date.now();
    const timeout = setTimeout(() => request.abort(), 8000);
    let receivedResponse = false;
    try {
      const response = await fetch(endpoint, {
        cache: "no-store", credentials: "same-origin", redirect: "manual", signal: request.signal,
        headers: { Accept: "application/json" },
      });
      if (suspended || activeRequest !== request) return;
      receivedResponse = true;
      if ([401, 403].includes(response.status) || response.type === "opaqueredirect" || response.redirected) {
        update(null, "auth");
      } else if (response.status >= 500) {
        onConnectionFailure();
      } else if (!response.ok || !/^application\/json\b/i.test(response.headers.get("content-type") ?? "")) {
        update(null, "connect");
      } else {
        const data = await response.json();
        if (suspended || activeRequest !== request) return;
        if (!validateSupplies(data)) return update(null, "connect");
        const receivedAt = Date.now();
        const duration = receivedAt - startedAt;
        // Upper bound the server time to avoid accepting a result in flight across midnight.
        const previousEstimate = observedServerTime ? observedServerTime + Math.max(0, receivedAt - observedClientTime) : 0;
        const serverTime = Math.max(Date.parse(data.serverNow) + duration, previousEstimate);
        if (duration < 0 || kst.format(new Date(serverTime)) !== data.targetDate) return update(null, "connect");
        observedServerTime = serverTime;
        observedClientTime = receivedAt;
        update(data, "result");
      }
    } catch {
      if (!suspended && activeRequest === request) {
        if (receivedResponse) update(null, "connect");
        else onConnectionFailure();
      }
    } finally {
      clearTimeout(timeout);
      if (activeRequest === request) {
        activeRequest = null;
        if (!suspended) pending = setTimeout(refresh, 30000);
      }
    }
  }

  button.hidden = details.hidden = false;
  button.addEventListener("click", () => {
    expireDate();
    dialog.showModal();
  });
  render();
  function suspend() {
    suspended = true;
    clearTimeout(pending);
    activeRequest?.abort();
    activeRequest = null;
    update(null, "checking");
  }
  function resume() {
    suspended = false;
    refresh();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspend();
    else resume();
  });
  window.addEventListener("online", refresh);
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) resume();
  });
  setInterval(expireDate, 1000);
  refresh();
}

if (typeof document !== "undefined" && document.documentElement.dataset.suppliesEnabled === "true") start();
