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
const bulletinLists = {
  PREPARATION: "kidsnote-upcoming-list",
  EVENT: "kidsnote-events-list",
  INFORMATION: "kidsnote-information-list",
};
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
        Object.hasOwn(bulletinLists, row.kind) && (row.date === null || date(row.date)) &&
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

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function renderRow(title, detail, source, badge, dateValue, needsReview = false) {
  const row = document.createElement("li");
  const heading = document.createElement("div");
  heading.className = "kidsnote-row-heading";
  heading.append(textElement("strong", title));
  if (dateValue || badge) {
    const tag = textElement(dateValue ? "time" : "span", badge, "kidsnote-tag");
    if (dateValue) {
      tag.dateTime = dateValue;
      heading.prepend(tag);
    } else {
      heading.append(tag);
    }
  }
  row.append(heading);
  if (needsReview) row.append(textElement("span", bulletinStatuses.REVIEW_REQUIRED, "kidsnote-review"));
  if (detail) row.append(textElement("p", detail, "kidsnote-row-detail"));
  row.append(textElement("small", source, "kidsnote-source"));
  return row;
}

function start() {
  const button = document.getElementById("supplies-button");
  const dialog = document.getElementById("supplies-dialog");
  if (!button || !dialog) return;
  const details = document.getElementById("supplies-details");
  const status = document.getElementById("supplies-status");
  const dialogDate = document.getElementById("kidsnote-date");
  const dialogState = document.getElementById("kidsnote-state");
  const dialogNote = document.getElementById("kidsnote-status-note");
  const dialogGuidance = document.getElementById("kidsnote-guidance");
  const list = document.getElementById("supplies-list");
  const todayTitle = document.getElementById("kidsnote-today-title");
  const upcomingTitle = document.getElementById("kidsnote-upcoming-title");
  const preparation = document.getElementById("kidsnote-preparation");
  const bulletinGroups = Object.entries(bulletinLists).map(([kind, id]) => [kind, document.getElementById(id)]);
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
    list.hidden = todayTitle.hidden = !hasItems;
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
    const note = [checked, deadline, failure && "갱신 실패",
      data?.state === "PENDING" && data.deadlineState === "PENDING" && !data.guardianConfirmation && "05:10 KST 수집 예정",
      data?.state === "AUTH_REQUIRED" && "보호자가 키즈노트 인증을 확인해 주세요"].filter(Boolean).join(" · ");
    const decisionBlockers = data?.dailyAssessment?.blockers.map(code=>blockers[code]) ?? [];
    const guidance = !data?.complete && decisionBlockers.length ? "자동 판정 대기 (" + decisionBlockers.join(", ") + ")" :
      data?.state === "NEEDS_REVIEW" && !hasItems && !data.guardianConfirmation ?
        "오늘 준비물 확인이 아직 끝나지 않았어요." : "";
    status.textContent = [title + count, note].filter(Boolean).join(" · ");
    dialogState.textContent = data?.state === "READY" ? `오늘 준비물 ${items.length}개` : title + count;
    dialogNote.hidden = !note;
    dialogNote.textContent = note;
    dialogGuidance.hidden = !guidance;
    dialogGuidance.textContent = guidance;
    dialogDate.hidden = !data;
    if (data) dialogDate.dateTime = dialogDate.textContent = data.targetDate;
    list.replaceChildren(...items.map((item) => renderRow(item.label, item.condition,
      `${sources[item.sourceType]} · ${item.sourceDate}`, item.quantity)));
    for (const [kind, groupList] of bulletinGroups) {
      const rows = bulletins.filter((item) => item.kind === kind);
      if (kind !== "INFORMATION") rows.sort((a, b) => (a.date ?? "\uffff").localeCompare(b.date ?? "\uffff"));
      if (kind === "PREPARATION") {
        groupList.hidden = upcomingTitle.hidden = rows.length === 0;
        preparation.hidden = !hasItems && rows.length === 0;
      } else {
        groupList.parentElement.hidden = rows.length === 0;
      }
      groupList.replaceChildren(...rows.map((item) => renderRow(item.title, item.detail,
        `${item.status === "VERIFIED" ? `${bulletinStatuses.VERIFIED} · ` : ""}게시 ${item.sourceDate}`,
        item.date ? item.date.slice(5).replace("-", "/") : kind === "INFORMATION" ? "" : "날짜 미확인",
        item.date, item.status === "REVIEW_REQUIRED")));
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
