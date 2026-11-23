const kst = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short" });
const clock = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const states = { READY: "준비물 있음", EMPTY: "준비물 없음", NEEDS_REVIEW: "확인 필요", AUTH_REQUIRED: "키즈노트 재인증 필요", PENDING: "갱신 대기" };
const deadlines = new Set(["PENDING", "ON_TIME", "LATE", "MISSED"]);
const sources = { report: "알림장", notice: "공지", calendar: "월간행사표" };
const ready = (state) => state === "READY" || state === "EMPTY";
const date = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().startsWith(value);
};
const stamp = (value) => typeof value === "string" && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const nullableText = (value) => value === null || typeof value === "string";
const calendarAudiences = {
  AGE_ONE: "만 1세 전용", INCLUDES_ONE: "만 1세 포함", SHARED: "전체 공통", OTHER: "다른 연령", UNCONFIRMED: "대상 미확인",
};
const hasOnlyKeys = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).every(key => keys.includes(key));

function calendarMonthFor(targetDate, offset) {
  const day = new Date(targetDate.slice(0, 7) + "-01T00:00:00Z");
  day.setUTCMonth(day.getUTCMonth() + offset);
  return day.toISOString().slice(0, 7);
}

function validPreparations(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 25) return false;
  const seen = new Set();
  for (const item of items) {
    if (!hasOnlyKeys(item, ["label", "dueDate"]) || typeof item.label !== "string" ||
        !item.label.trim() || [...item.label].length > 160 ||
        (Object.hasOwn(item, "dueDate") && !date(item.dueDate))) return false;
    const key = JSON.stringify([item.label, item.dueDate]);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export function validateMonthlyCalendar(calendar, targetDate, monthOffset = 0) {
  if (!date(targetDate) || ![0, 1].includes(monthOffset) || !hasOnlyKeys(calendar, ["month", "status", "events"]) ||
      calendar.month !== calendarMonthFor(targetDate, monthOffset) || !["AVAILABLE", "NEEDS_REVIEW", "PENDING"].includes(calendar.status) ||
      !Array.isArray(calendar.events) || (calendar.status === "PENDING" && calendar.events.length)) return false;
  return calendar.events.every(row => hasOnlyKeys(row, ["date", "title", "audience", "time", "preparations", "ageOneParticipation"]) &&
    date(row.date) && row.date.startsWith(calendar.month + "-") &&
    typeof row.title === "string" && row.title.trim().length > 0 && [...row.title].length <= 160 &&
    typeof row.audience === "string" && Object.hasOwn(calendarAudiences, row.audience) &&
    (!Object.hasOwn(row, "preparations") || validPreparations(row.preparations)) &&
    (!Object.hasOwn(row, "ageOneParticipation") || (row.ageOneParticipation === "CONFIRMED" && row.audience !== "OTHER")) &&
    (!Object.hasOwn(row, "time") || (typeof row.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.time))));
}
const bulletinStatuses = { VERIFIED: "확인됨", REVIEW_REQUIRED: "확인 필요" };
const bulletinLists = {
  PREPARATION: "kidsnote-upcoming-list",
  EVENT: "kidsnote-events-list",
  INFORMATION: "kidsnote-information-list",
};
function validBulletin(row) {
  return row && Object.hasOwn(bulletinStatuses, row.status) && Object.hasOwn(bulletinLists, row.kind) &&
    (row.date === null || date(row.date)) && date(row.sourceDate) &&
    typeof row.title === "string" && row.title.trim().length > 0 && row.title.length <= 160 &&
    typeof row.detail === "string" && row.detail.length <= 400;
}
const blockers = new Set(["DAILY_LIVE_DISABLED", "RELEASE_APPROVAL_MISSING", "LOGIN_PROOF_MISSING",
  "SOURCE_PROOF_MISSING", "SOURCE_PROOF_UNVERIFIED", "DAILY_CHECK_FAILED"]);

export function validateSupplies(data) {
  if (!data || data.schemaVersion !== 1 || !date(data.targetDate) || !stamp(data.serverNow) ||
      kst.format(new Date(data.serverNow)) !== data.targetDate || !Object.hasOwn(states, data.state) ||
      !deadlines.has(data.deadlineState) || data.complete !== ready(data.state) ||
      ![data.checkedAt, data.publishedAt].every((value) => value === null || stamp(value)) ||
      !Array.isArray(data.items)) return false;
  if (ready(data.state) && (!data.checkedAt || !data.publishedAt)) return false;
  if (data.state === "READY" ? data.items.length === 0 : data.state !== "NEEDS_REVIEW" && data.items.length > 0) return false;
  if (data.guardianConfirmation !== undefined && (!data.guardianConfirmation ||
      data.guardianConfirmation.source !== "GUARDIAN" || !date(data.guardianConfirmation.sourceDate) ||
      data.guardianConfirmation.sourceDate > data.targetDate || data.complete || data.items.length)) return false;
  if (data.dailyAssessment !== undefined && (!Array.isArray(data.dailyAssessment?.blockers) ||
      !data.dailyAssessment.blockers.every(code=>blockers.has(code)))) return false;
  if (data.bulletins !== undefined && (!Array.isArray(data.bulletins) || data.bulletins.length > 20 ||
      !data.bulletins.every(validBulletin))) return false;
  if (data.weekPreparations !== undefined && (!Array.isArray(data.weekPreparations) ||
      !data.weekPreparations.every(row => validBulletin(row) && row.kind === "PREPARATION" && row.date))) return false;
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

// targetDate is already a Seoul calendar date. UTC arithmetic keeps device time zones out.
export function schoolWeek(targetDate) {
  const day = new Date(targetDate + "T00:00:00Z");
  const mondayOffset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - mondayOffset + (mondayOffset >= 5 ? 7 : 0));
  return Array.from({ length: 5 }, () => {
    const value = day.toISOString().slice(0, 10);
    day.setUTCDate(day.getUTCDate() + 1);
    return value;
  });
}

const weekday = new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", weekday: "short" });
const fullDate = new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", dateStyle: "full" });
function dayLabel(value) {
  return value.slice(5).replace("-", "/") + " (" + weekday.format(new Date(value + "T00:00:00Z")) + ")";
}

function preparationList(event) {
  const list = document.createElement("ul");
  list.className = "activity-preparations";
  list.setAttribute("aria-label", event.title + "에 사용할 준비물");
  for (const item of event.preparations) {
    const line = textElement("li", item.label);
    line.append(textElement("small", item.dueDate ? "제출일 " + item.dueDate : "사용 예정 · 제출일 미확인"));
    list.append(line);
  }
  return list;
}

function audienceLabel(event) {
  const audience = calendarAudiences[event.audience];
  return event.ageOneParticipation === "CONFIRMED" ? audience + " · 1세 참여 확인" : audience;
}

function weekDayCell(value, data, rows, activities, submissions) {
  const today = value === data.targetDate;
  const cell = document.createElement("li");
  const header = document.createElement("div");
  const time = textElement("time", dayLabel(value));
  time.dateTime = value;
  header.append(time);
  if (today) {
    time.setAttribute("aria-current", "date");
    header.append(textElement("span", "오늘", "week-today"));
  }
  cell.append(header);
  const items = today ? data.items : [];
  const notices = rows.filter(row => row.status === "VERIFIED");
  if (items.length || notices.length) cell.classList.add("week-has-supplies");
  for (const item of items) {
    cell.append(textElement("strong", [item.label, item.quantity].filter(Boolean).join(" ")));
    if (item.condition) cell.append(textElement("small", item.condition));
  }
  for (const row of notices) {
    cell.append(textElement("strong", row.title));
    if (row.detail) cell.append(textElement("small", row.detail));
  }
  for (const event of submissions) {
    const section = document.createElement("section");
    section.className = "week-activity";
    section.append(textElement("strong", event.title + " 준비물 제출"), textElement("small", audienceLabel(event)));
    for (const item of event.preparations.filter(item => item.dueDate === value)) {
      section.append(textElement("strong", item.label));
    }
    cell.append(section);
  }
  for (const event of activities) {
    const section = document.createElement("section");
    section.className = "week-activity";
    section.append(textElement("strong", event.title + "에 사용"), textElement("small", audienceLabel(event)),
      preparationList(event));
    cell.append(section);
  }
  if ((today && !data.complete) || (!items.length && !notices.length && (today || (!activities.length && !submissions.length)))) {
    const label = today ? labelFor(data, "result") : rows.length ? "확정된 안내 없음" : "등록된 안내 없음";
    cell.append(textElement("small", label, "week-day-status"));
  }
  return cell;
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
  const week = document.getElementById("kidsnote-week");
  const weekDays = document.getElementById("week-days");
  const calendarButton = document.getElementById("calendar-button");
  const calendarDialog = document.getElementById("calendar-dialog");
  const calendarMonths = document.getElementById("calendar-months");
  const monthButtons = [document.getElementById("calendar-current"), document.getElementById("calendar-next")];
  const calendarStatus = document.getElementById("calendar-status");
  const calendarContent = document.getElementById("calendar-content");
  const calendarDays = document.getElementById("calendar-days");
  let renderedCalendar = null;
  let monthOffset = 0;
  let current = null;
  let mode = "checking";
  let pending;
  let suspended = false;
  let activeRequest;
  let observedServerTime = 0;
  let observedClientTime = 0;

  function renderWeek(data) {
    week.hidden = !data;
    weekDays.replaceChildren();
    const reviewList = document.getElementById("week-review-list");
    reviewList.replaceChildren();
    if (!data) return;
    const dates = schoolWeek(data.targetDate);
    const notices = (data.weekPreparations ?? data.bulletins ?? []).filter(row =>
      row.kind === "PREPARATION" && dates.includes(row.date));
    const activities = [data.monthlyCalendar, data.nextMonthlyCalendar].flatMap(month => month?.events ?? [])
      .filter(event => event.preparations && event.audience !== "OTHER");
    weekDays.append(...dates.map(value => weekDayCell(value, data, notices.filter(row => row.date === value),
      activities.filter(event => event.date === value),
      activities.filter(event => event.date !== value && event.preparations.some(item => item.dueDate === value)))));
    const pending = notices.filter(row => row.status === "REVIEW_REQUIRED");
    document.getElementById("week-review").hidden = pending.length === 0;
    reviewList.append(...pending.map(row => renderRow(row.title, row.detail,
      "게시 " + dayLabel(row.sourceDate), "지참일·조건 확인 필요")));
  }

  function renderCalendar(data) {
    const calendar = monthOffset === 0 ? data?.monthlyCalendar : data?.nextMonthlyCalendar;
    calendarButton.hidden = !data;
    calendarContent.hidden = !calendar || calendar.status === "PENDING";
    calendarMonths.hidden = !data || data.state === "AUTH_REQUIRED";
    monthButtons.forEach((control, offset) => {
      control.textContent = "";
      if (data) {
        const [year, month] = calendarMonthFor(data.targetDate, offset).split("-");
        control.textContent = year + "년 " + Number(month) + "월";
      }
      control.setAttribute("aria-pressed", String(offset === monthOffset));
    });
    let message = "월간 일정표 미확인";
    if (!data) {
      message = labelFor(null, mode);
    } else if (data.state === "AUTH_REQUIRED") {
      message = states.AUTH_REQUIRED;
    } else if (calendar) {
      message = "";
      if (calendar.status === "PENDING") message = "월간 일정표 갱신 대기";
      else if (!calendar.events.length) {
        message = calendar.status === "AVAILABLE" ? "등록된 행사 없음" : "아직 확인된 행사가 없습니다";
      }
      if (mode === "stale") message = [message, "이전 확인 결과"].filter(Boolean).join(" · ");
    }
    calendarStatus.hidden = !message;
    calendarStatus.textContent = message;
    // A routine poll must not reset focus or scroll inside a day's event list.
    const contentKey = calendarContent.hidden ? null : JSON.stringify([data.targetDate, calendar]);
    if (contentKey === renderedCalendar) return;
    renderedCalendar = contentKey;
    calendarDays.replaceChildren();
    if (calendarContent.hidden) return;
    const day = new Date(calendar.month + "-01T00:00:00Z");
    const monthIndex = day.getUTCMonth();
    const byDate = new Map();
    for (const event of calendar.events) {
      if (!byDate.has(event.date)) byDate.set(event.date, []);
      byDate.get(event.date).push(event);
    }
    while (day.getUTCMonth() === monthIndex) {
      const value = day.toISOString().slice(0, 10);
      const cell = document.createElement("li");
      const dayOfWeek = day.getUTCDay();
      if (day.getUTCDate() === 1) cell.style.gridColumnStart = String(dayOfWeek + 1);
      if (dayOfWeek === 0 || dayOfWeek === 6) cell.classList.add("calendar-weekend");
      const time = textElement("time", "", "calendar-date");
      time.dateTime = value;
      time.setAttribute("aria-label", fullDate.format(day));
      time.append(textElement("span", String(day.getUTCDate()), "calendar-day-number"),
        textElement("span", Number(calendar.month.slice(5)) + "월 " + day.getUTCDate() + "일 " + weekday.format(day) + "요일",
          "calendar-day-long"));
      if (value === data.targetDate) time.setAttribute("aria-current", "date");
      cell.append(time);
      const events = byDate.get(value) ?? [];
      const eventList = document.createElement("ul");
      if (events.length) {
        eventList.className = "calendar-events";
        eventList.tabIndex = 0;
        eventList.setAttribute("aria-label", fullDate.format(day) + " 행사 " + events.length + "개");
        if (events.length > 1) cell.append(textElement("small", events.length + "개", "calendar-count"));
        cell.append(eventList);
      }
      for (const event of events) {
        const row = document.createElement("li");
        row.className = "calendar-event";
        row.dataset.audience = event.audience;
        if (event.ageOneParticipation) row.dataset.participation = event.ageOneParticipation;
        row.append(textElement("span", audienceLabel(event), "calendar-audience"),
          textElement("strong", event.title));
        if (event.time) row.append(textElement("time", event.time));
        if (event.preparations) row.append(preparationList(event));
        eventList.append(row);
      }
      calendarDays.append(cell);
      day.setUTCDate(day.getUTCDate() + 1);
    }
  }

  function render() {
    const data = current;
    renderWeek(data);
    renderCalendar(data);
    login.hidden = dialogLogin.hidden = mode !== "auth";
    const items = data?.items ?? [];
    const bulletins = data?.bulletins ?? [];
    const hasItems = items.length > 0;
    const hasNotices = bulletins.length > 0 || (data?.weekPreparations ?? []).some(row => row.date >= data.targetDate);
    button.classList.toggle("has-items", hasItems || hasNotices);
    list.hidden = todayTitle.hidden = !hasItems;
    if (hasItems || hasNotices) {
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
    const failure = mode === "stale" || (ready(data?.state) && data?.latestAttempt?.status === "FAILED");
    const note = [checked, failure && "이전 확인 결과",
      data?.state === "AUTH_REQUIRED" && "보호자가 키즈노트 인증을 확인해 주세요"].filter(Boolean).join(" · ");
    const guidance = data?.state === "NEEDS_REVIEW" && !hasItems && !data.guardianConfirmation ?
        "오늘 준비물 확인이 아직 끝나지 않았어요." : "";
    status.textContent = [title + count, note].filter(Boolean).join(" · ");
    dialogState.textContent = data?.state === "READY" ? `오늘 준비물 ${items.length}개` : title + count;
    dialogNote.hidden = !note;
    dialogNote.textContent = note;
    dialogGuidance.hidden = !guidance;
    dialogGuidance.textContent = guidance;
    dialogDate.hidden = !data;
    if (data) {
      dialogDate.dateTime = data.targetDate;
      dialogDate.textContent = fullDate.format(new Date(data.targetDate + "T00:00:00Z"));
    }
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
        item.date ? (kind === "PREPARATION" && item.status === "REVIEW_REQUIRED" ? "안내 기준 " : "") +
          dayLabel(item.date) : kind === "INFORMATION" ? "" : "날짜 미확인",
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
        if (data.state === "AUTH_REQUIRED" || !validateMonthlyCalendar(data.monthlyCalendar, data.targetDate)) delete data.monthlyCalendar;
        if (data.state === "AUTH_REQUIRED" || !validateMonthlyCalendar(data.nextMonthlyCalendar, data.targetDate, 1)) delete data.nextMonthlyCalendar;
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
  calendarButton.addEventListener("click", () => {
    expireDate();
    if (current && dialog.open) {
      monthOffset = 0;
      renderCalendar(current);
      calendarDialog.showModal();
    }
  });
  monthButtons.forEach((control, offset) => control.addEventListener("click", () => {
    expireDate();
    monthOffset = offset;
    renderCalendar(current);
  }));
  calendarDialog.addEventListener("close", () => {
    if (dialog.open && !calendarDialog.open) {
      (calendarButton.hidden ? dialog.querySelector(".dialog-close-btn") : calendarButton).focus({ preventScroll: true });
    }
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
