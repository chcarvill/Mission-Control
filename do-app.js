/* ============================================================
   Do — Three a Day
   Vanilla JS. No build step. No frameworks.
   Data persists to localStorage. Seed activities on first run.
   ============================================================ */

const STORAGE_KEY = "do_three_a_day_v1";

const PALETTE = ["sage", "clay", "amber", "teal", "blue", "purple", "pink", "gray"];
// extra colors beyond the core 3 used in CSS vars already defined (sage/clay/amber);
// the rest reuse Communic8-style hues so new activities stay visually distinct.
const EXTRA_COLORS = {
  teal:   "#4D8C8C",
  blue:   "#5A7FB5",
  purple: "#8C6FB0",
  pink:   "#C97DA0",
  gray:   "#8C8C8C",
};

let STATE = {
  activities: [],   // [{id, label, color}]
  days: {},          // 'YYYY-MM-DD' -> { slots: [{id, activityId, status, detail, link, note}], log: [...] }
  timeWasters: {
    habits: [],   // [{id, label}]  -- catch mid-motion
    filters: [],  // [{id, label}]  -- filter before saying yes
  },
  timeLogs: [],   // [{id, itemType: 'activity'|'waster', itemId, itemLabel, minutes, date, loggedAt}]
  objectives: [], // [{id, label, detail}]  -- long-term objectives
  commitments: [], // [{id, activityId, activityLabel, mode, startDate, endDate, appliedCount, skippedCount, createdAt}]
  targetedAction: {
    ventures: {}, // activityId -> { outreachDay: null|0-6 (Mon=0), ratio: 'market-heavy'|'balanced'|'improve-heavy', sharpenMinutes: 20 }
  },
  taRuns: [], // [{id, weekLabel, marketApplied, improveApplied, skipped, createdAt}]
  categories: [], // [{id, label}] -- user-managed attribution categories for tasks/time
  nextWeekPlan: {
    weekOf: null,        // Monday ISO this plan is for
    strategic: "",        // rung 1: Strategic Objectives
    massPlan: {            // rung 2: Mass Communication -> Plan Content (guided)
      purpose: "",
      theme: "",
      location: "",
      backingTrack: "",
      script: "",
    },
    massExecute: "",       // rung 2: Mass Communication -> Execute Plan
    oneToOnePlan: "",      // rung 3: 1:1 Communication -> Plan Interactions
    oneToOneInstigate: "", // rung 3: 1:1 Communication -> Instigate Interactions
  },
  thisWeekPlan: {
    weekOf: null,          // Monday ISO of the week already underway
    focusProjects: "",     // 1-2 (max) projects to focus on this week
    communication: "",     // what needs communicating, mass market + particular people
    strategic: "",
    massPlan: { purpose: "", theme: "", location: "", backingTrack: "", script: "" },
    massExecute: "",
    oneToOnePlan: "",
    oneToOneInstigate: "",
  },
};

const TA_RATIO_LABELS = {
  "market-heavy": "Market-heavy — offer's proven, get it in front of people",
  "balanced": "Balanced — split attention evenly",
  "improve-heavy": "Improve-heavy — offer still needs work before pushing harder",
};

// how many non-outreach-day "improve" touches per week each ratio aims for
const TA_RATIO_IMPROVE_TOUCHES = {
  "market-heavy": 1,
  "balanced": 2,
  "improve-heavy": 3,
};

const TA_WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// The generator always drives outreach-day / ratio-fill slots through these two
// fixed category ids so its logic keeps working even if the person renames the
// labels. Any other category is free-form and only ever applied manually via
// the detail modal — it never gets auto-assigned by generateTargetedActionWeek().
const CAT_MARKET_ID = "cat_market";
const CAT_IMPROVE_ID = "cat_improve";
const RESERVED_CATEGORY_IDS = [CAT_MARKET_ID, CAT_IMPROVE_ID];

let pendingSlotIndex = null;   // which stone (0/1/2) the picker modal is filling
let pendingIso = null;         // which day's slot the picker modal is filling
let pendingPickerActivity = null; // the activity chosen in the picker, awaiting the optional details step
let pendingPickerDates = [];   // day(s) this task should land on, from the details step's multi-date list
let pendingC8Handoff = null;   // pre-fill text waiting from a "Send to Do" link (Communic8), used once

// Reads ?c8title=&c8desc=&c8strategic= from the URL -- the link Communic8's
// "Send to Do" button opens. If present, stashes the combined text and
// opens the picker on today's first empty slot so the person just needs
// to pick a project; the details step pre-fills with what was sent over.
function handleContentIdeaDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const title = params.get("c8title");
  const desc = params.get("c8desc");
  const strategic = params.get("c8strategic");
  if (!title && !desc) return;

  const parts = [];
  if (desc) parts.push(desc);
  else if (title) parts.push(title);
  if (strategic) parts.push("Strategic objective: " + strategic);
  pendingC8Handoff = parts.join(" — ");

  // Clean the URL so refreshing/sharing doesn't re-trigger it.
  const url = new URL(window.location.href);
  ["c8title", "c8desc", "c8strategic"].forEach((k) => url.searchParams.delete(k));
  window.history.replaceState({}, "", url.toString());

  if (typeof switchMasterTab === "function") switchMasterTab("do");
  switchTab("today");

  const today = todayISO();
  ensureDay(today);
  const emptyIdx = dayData(today).slots.findIndex((s) => s.status === "empty");
  if (emptyIdx === -1) {
    // No room today -- don't lose the handoff, just let them open a picker
    // themselves (e.g. on Plan week) and it'll still pre-fill when they do.
    alert("Today's three slots are already full. Pick an empty slot on Plan week to add this content idea — the description will still be ready to drop in.");
    return;
  }
  openPicker(today, emptyIdx);
}
let pendingCancelSlot = null;  // which stone is being cancelled/substituted, awaiting a reason
let pendingCancelIso = null;   // which day's stone is being cancelled/substituted
let pendingSubstituteActivityId = null; // if cancelling-to-substitute, the new activity chosen
let pendingDetailIso = null;   // which day's slot the detail modal is editing
let pendingDetailSlot = null;  // which slot index the detail modal is editing
let currentWeekStart = null;   // Monday ISO of the week currently shown in "This week"
let pendingLogItemType = null; // 'activity' | 'waster' — what the time-log modal is logging against
let pendingLogItemId = null;
let pendingLogItemLabel = null;
let pendingLogIsFreeform = false; // true when opened via the standalone "+ Log time" button
let pendingLogItemCategory = null; // prefilled category id when opened from a slot with one set
let commitMode = "single"; // 'single' | 'range' — current mode in the Strategize commit form
let insightsRange = "today";   // 'today' | 'week' | 'all' — current Insights tab filter

/* ---------------------------------------------------------- */
/* Bootstrapping                                                */
/* ---------------------------------------------------------- */

function boot() {
  const saved = loadFromStorage();
  if (saved) {
    STATE = saved;
  } else {
    STATE.activities = [
      { id: "a_oration", label: "Oration", color: "amber" },
      { id: "a_coding", label: "Coding", color: "blue" },
      { id: "a_bizplanning", label: "Targeted business planning", color: "clay" },
      { id: "a_networking", label: "Networking", color: "purple" },
      { id: "a_practice", label: "Occupational practice", color: "sage" },
      { id: "a_investing", label: "Investing", color: "teal" },
      { id: "a_exercise", label: "Physical exercise", color: "pink" },
    ];
    STATE.days = {};
  }

  // migrate: saved states from before the Time Wasters tab existed won't
  // have this field, so backfill it with defaults rather than crashing.
  if (!STATE.timeWasters) {
    STATE.timeWasters = {
      habits: [
        { id: "w_facebook", label: "Using Facebook" },
        { id: "w_browsing", label: "Aimlessly browsing the internet" },
      ],
      filters: [
        { id: "w_schmucks", label: "Working for arrogant schmucks" },
      ],
    };
  }

  if (!STATE.timeLogs) {
    STATE.timeLogs = [];
  }

  if (!STATE.objectives) {
    STATE.objectives = [];
  }

  if (!STATE.commitments) {
    STATE.commitments = [];
  }

  if (!STATE.targetedAction) {
    STATE.targetedAction = { ventures: {} };
  }

  if (!STATE.taRuns) {
    STATE.taRuns = [];
  }

  if (!STATE.categories || !STATE.categories.length) {
    STATE.categories = [
      { id: CAT_MARKET_ID, label: "Market" },
      { id: CAT_IMPROVE_ID, label: "Improve" },
    ];
  }

  // migrate: saved states from before "Prioritise Next Week" existed won't
  // have this field, so backfill it with empty defaults rather than crashing.
  if (!STATE.nextWeekPlan) {
    STATE.nextWeekPlan = {
      weekOf: null,
      strategic: "",
      massPlan: { purpose: "", theme: "", location: "", backingTrack: "", script: "" },
      massExecute: "",
      oneToOnePlan: "",
      oneToOneInstigate: "",
    };
  }
  // migrate: "Plan Content" used to be a single free-text field -- fold any
  // existing text into the new Script field so nothing typed before is lost.
  if (typeof STATE.nextWeekPlan.massPlan === "string") {
    STATE.nextWeekPlan.massPlan = {
      purpose: "",
      theme: "",
      location: "",
      backingTrack: "",
      script: STATE.nextWeekPlan.massPlan,
    };
  }

  // migrate: saved states from before "This week, prioritised" existed
  // won't have this field, so backfill it with empty defaults.
  if (!STATE.thisWeekPlan) {
    STATE.thisWeekPlan = {
      weekOf: null,
      focusProjects: "",
      communication: "",
      strategic: "",
      massPlan: { purpose: "", theme: "", location: "", backingTrack: "", script: "" },
      massExecute: "",
      oneToOnePlan: "",
      oneToOneInstigate: "",
    };
  }

  saveToStorage();
  currentWeekStart = mondayOf(todayISO());
  ensureToday();
  renderDo();
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("Could not load saved state, starting fresh.", e);
    return null;
  }
}

function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
  } catch (e) {
    console.warn("Could not save state.", e);
  }
}

// One-time import of a backup exported by the old standalone Do app
// (via "Backup my data"). Merges into the current STATE rather than
// replacing it -- so it's safe to run even after the merged app has
// already been used a little:
//  - activities: added only if not already present (matched by id, then
//    by label, since the same default 7 seed activities share ids here).
//  - days: filled in only for dates not already present, so nothing
//    already logged in the merged app gets overwritten.
//  - timeLogs/objectives/commitments/taRuns: concatenated, skipping
//    exact id duplicates.
//  - categories/timeWasters: merged by id.
function importDoHistoryBackup(jsonText) {
  const statusEl = document.getElementById("do-history-import-status");
  let backup;
  try {
    backup = JSON.parse(jsonText);
  } catch (err) {
    if (statusEl) statusEl.textContent = "Couldn't read that file -- is it a Do backup export?";
    return;
  }
  if (!backup || typeof backup !== "object") {
    if (statusEl) statusEl.textContent = "That file doesn't look like a Do backup.";
    return;
  }

  let daysAdded = 0, actsAdded = 0;

  (backup.activities || []).forEach((a) => {
    if (!a || !a.label) return;
    const existsById = STATE.activities.some((x) => x.id === a.id);
    const existsByLabel = STATE.activities.some((x) => x.label.toLowerCase() === a.label.toLowerCase());
    if (!existsById && !existsByLabel) {
      STATE.activities.push(a);
      actsAdded++;
    }
  });

  Object.keys(backup.days || {}).forEach((date) => {
    if (!STATE.days[date]) {
      STATE.days[date] = backup.days[date];
      daysAdded++;
    }
  });

  const mergeArrayById = (targetArr, sourceArr) => {
    (sourceArr || []).forEach((item) => {
      if (item && item.id && !targetArr.some((x) => x.id === item.id)) targetArr.push(item);
    });
  };
  mergeArrayById(STATE.timeLogs, backup.timeLogs);
  mergeArrayById(STATE.objectives, backup.objectives);
  mergeArrayById(STATE.commitments, backup.commitments);
  mergeArrayById(STATE.taRuns, backup.taRuns);
  mergeArrayById(STATE.categories, backup.categories);
  if (backup.timeWasters) {
    mergeArrayById(STATE.timeWasters.habits, backup.timeWasters.habits);
    mergeArrayById(STATE.timeWasters.filters, backup.timeWasters.filters);
  }

  saveToStorage();
  renderManageList();
  renderDo();
  if (statusEl) {
    statusEl.textContent = (daysAdded || actsAdded)
      ? `Imported ${daysAdded} day${daysAdded === 1 ? "" : "s"} of history and ${actsAdded} activit${actsAdded === 1 ? "y" : "ies"}.`
      : "Nothing new to import -- this history is already here.";
  }
}

// One-off full-state export -- kept as a general backup tool, no longer
// required for cross-app sync now that Mission Control and Do share one
// page and one localStorage.
function backupData() {
  const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "do-app-backup.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------- */
/* Date helpers                                                  */
/* ---------------------------------------------------------- */

function fmtISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayISO() {
  return fmtISO(new Date());
}

function isoMinusDays(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - n);
  return fmtISO(d);
}

function isoPlusDays(iso, n) {
  return isoMinusDays(iso, -n);
}

function mondayOf(iso) {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return fmtISO(d);
}

function weekDates(mondayIso) {
  const out = [];
  for (let i = 0; i < 7; i++) out.push(isoPlusDays(mondayIso, i));
  return out;
}

function fmtDayLabelShort(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function fmtWeekRangeLabel(mondayIso) {
  const sunday = isoPlusDays(mondayIso, 6);
  const mondayLabel = new Date(mondayIso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const sundayLabel = new Date(sunday + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${mondayLabel} – ${sundayLabel}`;
}

function fmtDayLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/* ---------------------------------------------------------- */
/* Day / slot helpers                                            */
/* ---------------------------------------------------------- */

function ensureDay(iso) {
  if (!STATE.days[iso]) {
    STATE.days[iso] = {
      slots: [
        { id: "s_" + iso + "_0", activityId: null, status: "empty", detail: "", link: "", note: "", actionType: null },
        { id: "s_" + iso + "_1", activityId: null, status: "empty", detail: "", link: "", note: "", actionType: null },
        { id: "s_" + iso + "_2", activityId: null, status: "empty", detail: "", link: "", note: "", actionType: null },
      ],
      log: [],
    };
    saveToStorage();
  } else {
    // migrate: older saved days may predate detail/link/note fields
    let changed = false;
    STATE.days[iso].slots.forEach((s) => {
      if (s.detail === undefined) { s.detail = ""; changed = true; }
      if (s.link === undefined) { s.link = ""; changed = true; }
      if (s.note === undefined) { s.note = ""; changed = true; }
      if (s.actionType === undefined) { s.actionType = null; changed = true; }
      if (s.actionType === "market") { s.actionType = CAT_MARKET_ID; changed = true; }
      if (s.actionType === "improve") { s.actionType = CAT_IMPROVE_ID; changed = true; }
    });
    if (changed) saveToStorage();
  }
}

function ensureToday() {
  ensureDay(todayISO());
}

function ensureWeek(mondayIso) {
  weekDates(mondayIso).forEach(ensureDay);
}

function dayData(iso) {
  return STATE.days[iso];
}

function todayData() {
  return STATE.days[todayISO()];
}

function activityById(id) {
  return STATE.activities.find((a) => a.id === id);
}

function colorHex(colorName) {
  return EXTRA_COLORS[colorName] || `var(--${colorName})`;
}

/* ---------------------------------------------------------- */
/* Streak calculation                                            */
/* A day "counts" toward the streak if all 3 slots ended the    */
/* day marked done. Today never breaks an existing streak while */
/* still in progress — it only extends it once complete.        */
/* ---------------------------------------------------------- */

function dayIsComplete(dayData) {
  if (!dayData) return false;
  return dayData.slots.length === 3 && dayData.slots.every((s) => s.status === "done");
}

function computeStreak() {
  let streak = 0;
  let cursor = todayISO();
  const today = STATE.days[cursor];

  // if today is already fully done, it counts; otherwise start checking from yesterday
  if (dayIsComplete(today)) {
    streak++;
    cursor = isoMinusDays(cursor, 1);
  } else {
    cursor = isoMinusDays(cursor, 1);
  }

  while (STATE.days[cursor] && dayIsComplete(STATE.days[cursor])) {
    streak++;
    cursor = isoMinusDays(cursor, 1);
  }
  return streak;
}

/* ---------------------------------------------------------- */
/* Rendering                                                     */
/* ---------------------------------------------------------- */

function renderDo() {
  const added = syncPortfolioVenturesIntoActivities();
  const statusEl = document.getElementById("portfolio-sync-status");
  if (statusEl) {
    statusEl.textContent = added
      ? `✓ ${added} new project${added === 1 ? "" : "s"} synced in from the Portfolio.`
      : "";
  }
  renderHeader();
  renderOrationGate();
  renderStones();
  renderHistory();
  renderTimeWasters();
  renderWeekTab();
  renderInsights();
  renderStrategize();
  renderTargetedAction();
}

function renderHeader() {
  document.getElementById("today-label").textContent =
    new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const streak = computeStreak();
  document.getElementById("streak-badge").innerHTML =
    streak > 0
      ? `<b>${streak}</b> day${streak === 1 ? "" : "s"} strong`
      : `<span>start today</span>`;
}

// ══════════════════════════════════════════════
//  ORATION GATE
// ══════════════════════════════════════════════
// Requires an oration to be logged today before the three task slots
// unlock. This is a deliberate friction point, not a soft nudge -- the
// slots stay visibly locked (not just reminded) until one is logged.
// Where Orate lives is the single source of truth for oration history;
// this app only keeps a local flag ("did I log one today") to gate the
// slots, and pushes the actual log over to Orate via a deep link.
const ORATE_APP_URL = "https://chcarvill.github.io/Communic8---orate/";
const ORATION_TYPES = [
  "Informal conversation", "Formal conversation", "Engaging a live audience",
  "Presenting online", "Oration practice", "Storytelling / anecdote",
  "Teaching / explaining", "Persuasion / pitching", "Phone or video call",
];
const ORATION_LOG_KEY = "do_oration_log";

function loadOrationLog() {
  try { return JSON.parse(localStorage.getItem(ORATION_LOG_KEY)) || {}; }
  catch (e) { return {}; }
}
function hasOrationToday() {
  const log = loadOrationLog();
  return !!log[todayISO()];
}
function logOrationToday(type) {
  const log = loadOrationLog();
  log[todayISO()] = type;
  localStorage.setItem(ORATION_LOG_KEY, JSON.stringify(log));
}

function renderOrationGate() {
  const gate = document.getElementById("oration-gate");
  const done = document.getElementById("oration-gate-done");
  const log = loadOrationLog();
  const todayType = log[todayISO()];

  if (todayType) {
    gate.style.display = "none";
    done.style.display = "block";
    done.textContent = `✓ Oration logged today (${todayType}) — task slots unlocked.`;
    return;
  }

  done.style.display = "none";
  gate.style.display = "block";
  const grid = document.getElementById("oration-type-grid");
  grid.innerHTML = ORATION_TYPES.map(
    (t) => `<div class="type-btn" data-type="${escapeHtml(t)}">${escapeHtml(t)}</div>`
  ).join("");
  grid.querySelectorAll(".type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.getAttribute("data-type");
      logOrationToday(type);
      // Push the actual log over to Orate, which stays the source of
      // truth for oration history/streaks/stats -- this app only cares
      // about the daily gate.
      window.open(ORATE_APP_URL + "?logType=" + encodeURIComponent(type), "_blank", "noopener");
      renderDo();
    });
  });
}

function renderStones() {
  const row = document.getElementById("stones-row");
  row.innerHTML = "";
  const iso = todayISO();
  const day = dayData(iso);

  day.slots.forEach((slot, i) => {
    const stone = document.createElement("div");
    stone.dataset.slotIndex = i;

    if (slot.status === "empty") {
      const locked = !hasOrationToday();
      stone.className = locked ? "stone empty locked" : "stone empty";
      stone.innerHTML = locked
        ? `
        <span class="stone-number">${i + 1}</span>
        <span class="stone-plus">🔒</span>
        <span class="stone-cta">Log oration to unlock</span>
      `
        : `
        <span class="stone-number">${i + 1}</span>
        <span class="stone-plus">+</span>
        <span class="stone-cta">Pick a task</span>
      `;
      stone.addEventListener("click", () => {
        if (locked) {
          document.getElementById("oration-gate").scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        openPicker(iso, i);
      });
    } else {
      const activity = activityById(slot.activityId);
      const label = activity ? activity.label : "Unknown";
      const statusClass = slot.status === "done" ? "done" : "active";
      stone.className = `stone ${statusClass}`;
      stone.innerHTML = `
        <span class="stone-number">${i + 1}</span>
        <span class="stone-cancel" title="Cancel or swap this task">✕</span>
        <span class="stone-detail-btn" title="Add detail, link, or a note">✎</span>
        <span class="stone-time-btn" title="Log time spent">⏱</span>
        <span class="stone-activity">${escapeHtml(label)}</span>
        ${actionBadgeHtml(slot.actionType)}
        <span class="stone-indicators">${slotIndicatorsHtml(slot)}</span>
        ${
          slot.status === "done"
            ? `<span class="stone-check">✓ done</span>`
            : `<button class="stone-mark-done">Mark done</button>`
        }
      `;
      const cancelEl = stone.querySelector(".stone-cancel");
      cancelEl.addEventListener("click", (e) => {
        e.stopPropagation();
        openCancelReason(iso, i);
      });
      const detailEl = stone.querySelector(".stone-detail-btn");
      detailEl.addEventListener("click", (e) => {
        e.stopPropagation();
        openDetailModal(iso, i);
      });
      const timeEl = stone.querySelector(".stone-time-btn");
      timeEl.addEventListener("click", (e) => {
        e.stopPropagation();
        openLogTimeModal("activity", activity ? activity.id : slot.activityId, label, slot.actionType);
      });
      const linkEl = stone.querySelector(".stone-link");
      if (linkEl) linkEl.addEventListener("click", (e) => e.stopPropagation());
      const doneBtn = stone.querySelector(".stone-mark-done");
      if (doneBtn) {
        doneBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          markDone(iso, i);
        });
      }
      stone.addEventListener("click", () => openDetailModal(iso, i));
    }

    row.appendChild(stone);
  });
}

function categoryById(id) {
  return STATE.categories.find((c) => c.id === id);
}

function actionBadgeHtml(actionType) {
  if (!actionType) return "";
  const cat = categoryById(actionType);
  if (!cat) return "";
  if (actionType === CAT_MARKET_ID) {
    return `<span class="action-badge market" title="Targeted Action category">📣 ${escapeHtml(cat.label)}</span>`;
  }
  if (actionType === CAT_IMPROVE_ID) {
    return `<span class="action-badge improve" title="Targeted Action category">🔧 ${escapeHtml(cat.label)}</span>`;
  }
  return `<span class="action-badge custom" title="Category">🏷 ${escapeHtml(cat.label)}</span>`;
}

function slotIndicatorsHtml(slot) {
  let out = "";
  if (isSafeUrl(slot.link)) {
    out += `<a class="stone-link" href="${escapeAttr(slot.link)}" target="_blank" rel="noopener" title="Open link">🔗</a>`;
  }
  if (slot.detail) {
    out += `<span title="${escapeAttr(slot.detail)}">📝</span>`;
  }
  if (slot.note) {
    out += `<span title="${escapeAttr(slot.note)}">💡</span>`;
  }
  return out;
}

function renderHistory() {
  const list = document.getElementById("history-list");
  list.innerHTML = "";

  const todayIso = todayISO();
  const isoKeys = Object.keys(STATE.days)
    .filter((iso) => iso !== todayIso)
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, 14);

  if (!isoKeys.length) {
    const empty = document.createElement("div");
    empty.id = "history-empty";
    empty.textContent = "Your past days will show up here once today wraps up.";
    list.appendChild(empty);
    return;
  }

  isoKeys.forEach((iso) => {
    const day = STATE.days[iso];
    const row = document.createElement("div");
    row.className = "day-row";

    const dots = day.slots
      .map((s) => `<span class="day-dot ${s.status === "done" ? "done" : s.status === "cancelled" ? "cancelled" : ""}"></span>`)
      .join("");

    const doneCount = day.slots.filter((s) => s.status === "done").length;
    const namedDone = day.slots
      .filter((s) => s.status === "done")
      .map((s) => (activityById(s.activityId) || {}).label)
      .filter(Boolean)
      .join(", ");

    row.innerHTML = `
      <span class="day-date">${fmtDayLabel(iso)}</span>
      <span class="day-dots">${dots}</span>
      <span class="day-summary">${doneCount}/3 — ${escapeHtml(namedDone || "nothing logged")}</span>
    `;

    if (day.log && day.log.length) {
      row.style.cursor = "pointer";
      row.title = "Click to see what changed that day";
      row.addEventListener("click", () => toggleLogDetail(row, day.log));
    }

    list.appendChild(row);
  });
}

function toggleLogDetail(row, log) {
  const existing = row.nextElementSibling;
  if (existing && existing.classList.contains("log-entry-wrap")) {
    existing.remove();
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "log-entry-wrap";
  log.forEach((entry) => {
    const activity = activityById(entry.activityId);
    const div = document.createElement("div");
    div.className = "log-entry";
    const verb = entry.type === "substituted" ? "Swapped" : "Cancelled";
    div.innerHTML = `<b>${verb}</b> ${escapeHtml(activity ? activity.label : "a task")} — ${escapeHtml(entry.reason)}`;
    wrap.appendChild(div);
  });
  row.insertAdjacentElement("afterend", wrap);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isSafeUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

/* ---------------------------------------------------------- */
/* Slot actions                                                  */
/* ---------------------------------------------------------- */

function markDone(iso, slotIndex) {
  const day = dayData(iso);
  day.slots[slotIndex].status = "done";
  saveToStorage();
  renderDo();
}

function assignActivity(iso, slotIndex, activityId) {
  const day = dayData(iso);
  day.slots[slotIndex].activityId = activityId;
  day.slots[slotIndex].status = "active";
  saveToStorage();
  renderDo();
}

/* ---------------------------------------------------------- */
/* Picker modal (filling an empty stone)                         */
/* ---------------------------------------------------------- */

function openPicker(iso, slotIndex) {
  pendingIso = iso;
  pendingSlotIndex = slotIndex;
  pendingCancelIso = null;
  pendingCancelSlot = null;
  document.getElementById("picker-title").textContent = "Part of which project?";
  document.getElementById("picker-sub").textContent = "Pick the project (or activity) this task belongs to.";
  renderActivityList();
  document.getElementById("new-activity-input").value = "";
  showPickerListStep();
  document.getElementById("picker-overlay").classList.add("open");
}

function renderActivityList() {
  const list = document.getElementById("activity-list");
  list.innerHTML = "";
  STATE.activities.forEach((activity) => {
    const opt = document.createElement("div");
    opt.className = "activity-option";
    opt.innerHTML = `<span class="dot" style="background:${colorHex(activity.color)};"></span> ${escapeHtml(activity.label)}`;
    opt.addEventListener("click", () => {
      if (pendingCancelSlot !== null) {
        // we're substituting: this choice becomes the new activity, but only
        // after a reason is confirmed — so stash it and open the reason modal.
        pendingSubstituteActivityId = activity.id;
        document.getElementById("picker-overlay").classList.remove("open");
        openReasonModal(pendingCancelIso, pendingCancelSlot, "substituted", activity.id);
      } else {
        // Assigning a brand-new task: the fast path (immediate assign) still
        // happens here, same as always -- but we now offer an optional next
        // step to add a description/link/time before the picker closes,
        // rather than forcing it. "Skip" in that step is the exact old
        // one-click behavior.
        assignActivity(pendingIso, pendingSlotIndex, activity.id);
        pendingPickerActivity = activity;
        showPickerDetailsStep(activity);
      }
    });
    list.appendChild(opt);
  });
}

function showPickerListStep() {
  document.getElementById("picker-step-list").style.display = "";
  document.getElementById("picker-step-details").style.display = "none";
}
function showPickerDetailsStep(activity) {
  document.getElementById("picker-step-list").style.display = "none";
  document.getElementById("picker-step-details").style.display = "";
  document.getElementById("picker-details-sub").textContent = `For "${activity.label}" — optional, skip if you just want it logged.`;
  pendingPickerDates = [pendingIso];
  renderPickerDateChips();
  document.getElementById("picker-detail-day-input").value = "";
  document.getElementById("picker-detail-text").value = pendingC8Handoff || "";
  document.getElementById("picker-detail-link").value = "";
  document.getElementById("picker-detail-time").value = "";
  document.getElementById("picker-day-status").textContent = "";
  document.getElementById("picker-detail-text").focus();
  pendingC8Handoff = null; // one-time use, so re-opening the picker later starts blank again
}

function renderPickerDateChips() {
  const wrap = document.getElementById("picker-date-chips");
  wrap.innerHTML = pendingPickerDates
    .slice()
    .sort()
    .map((iso) => {
      const label = fmtDayLabelShort(iso);
      const removable = pendingPickerDates.length > 1;
      return `<span class="picker-date-chip" data-iso="${iso}">${escapeHtml(label)}${
        removable ? `<button type="button" data-remove="${iso}" title="Remove">✕</button>` : ""
      }</span>`;
    })
    .join("");
  wrap.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      pendingPickerDates = pendingPickerDates.filter((d) => d !== btn.dataset.remove);
      renderPickerDateChips();
    });
  });
}

function addPickerDate() {
  const input = document.getElementById("picker-detail-day-input");
  const val = input.value;
  if (!val) return;
  if (!pendingPickerDates.includes(val)) {
    pendingPickerDates.push(val);
    renderPickerDateChips();
  }
  input.value = "";
}

function finishPickerDetailsStep() {
  document.getElementById("picker-overlay").classList.remove("open");
  showPickerListStep(); // reset for next time it opens
  pendingIso = null;
  pendingSlotIndex = null;
  pendingPickerActivity = null;
  pendingPickerDates = [];
}

// "Skip" — exactly the original fast path. The activity's already assigned
// (that happened the moment it was picked); this just closes without
// adding any description/link/calendar entry.
function skipPickerDetails() {
  finishPickerDetailsStep();
}

// "Save" — carries the description/link into the slot's existing detail
// fields (same fields the ✎ button edits), and if a time was given (or
// even if not -- project + description is enough to be worth a calendar
// entry), pushes a color-coded block onto the Homepage weekly calendar.
// Runs once per date selected in the multi-date list.
function savePickerDetails() {
  const text = document.getElementById("picker-detail-text").value.trim();
  const link = document.getElementById("picker-detail-link").value.trim();
  const time = document.getElementById("picker-detail-time").value; // "" if not set
  const statusEl = document.getElementById("picker-day-status");
  const dates = pendingPickerDates.length ? pendingPickerDates : [pendingIso];
  const onlyOriginalDay = dates.length === 1 && dates[0] === pendingIso;

  if (!text && !link && !time && onlyOriginalDay) {
    // Nothing entered and no extra dates -- same as Skip, no point creating an empty calendar entry.
    finishPickerDetailsStep();
    return;
  }

  // If the original day got removed from the date list, the person no
  // longer wants the task there -- clear that slot and any calendar entry
  // it already had.
  if (!dates.includes(pendingIso)) {
    const original = dayData(pendingIso).slots[pendingSlotIndex];
    if (original.homepageEventId && typeof loadHomepageManual === "function") {
      const m = loadHomepageManual().filter((item) => item.id !== original.homepageEventId);
      saveHomepageManual(m);
    }
    original.activityId = null;
    original.status = "empty";
    original.detail = "";
    original.link = "";
    original.homepageEventId = null;
  }

  const skippedFull = [];
  const manual = typeof loadHomepageManual === "function" ? loadHomepageManual() : null;
  const start = time || HP_DEFAULT_START_DO;
  const [h, m] = start.split(":").map(Number);
  const endTotal = h * 60 + m + 30; // default 30-minute block
  const end = String(Math.floor(endTotal / 60) % 24).padStart(2, "0") + ":" + String(endTotal % 60).padStart(2, "0");

  dates.forEach((iso) => {
    let slotIndex;
    if (iso === pendingIso) {
      // Already assigned here from the initial pick -- reuse it.
      slotIndex = pendingSlotIndex;
    } else {
      ensureDay(iso);
      const targetDay = dayData(iso);
      const emptyIndex = targetDay.slots.findIndex((s) => s.status === "empty");
      if (emptyIndex === -1) {
        // Respect "three, no more" -- skip this day rather than overriding it.
        skippedFull.push(iso);
        return;
      }
      assignActivity(iso, emptyIndex, pendingPickerActivity.id);
      slotIndex = emptyIndex;
    }

    const slot = dayData(iso).slots[slotIndex];
    if (text) slot.detail = text;
    if (link) slot.link = link;

    if (manual) {
      const eventId = "hp" + Date.now() + Math.random().toString(36).slice(2, 6) + iso;
      manual.push({
        id: eventId,
        date: iso,
        text: text || pendingPickerActivity.label,
        start,
        end,
        color: colorHex(pendingPickerActivity.color),
        link: link || null,
      });
      slot.homepageEventId = eventId;
    }
  });

  saveToStorage();
  if (manual) saveHomepageManual(manual);

  if (skippedFull.length) {
    if (statusEl) statusEl.textContent = `${skippedFull.join(", ")} already had three tasks, so those were skipped — everything else saved.`;
    // Leave the modal open so this is actually seen, and remove the full
    // days from the list so a second Save doesn't retry them pointlessly.
    pendingPickerDates = dates.filter((d) => !skippedFull.includes(d));
    renderPickerDateChips();
    renderDo();
    if (typeof renderHomepage === "function") renderHomepage();
    return;
  }

  finishPickerDetailsStep();
  renderDo();
  if (typeof renderHomepage === "function") renderHomepage();
}
const HP_DEFAULT_START_DO = "09:00"; // matches Mission Control's own HP_DEFAULT_START

function closePicker() {
  document.getElementById("picker-overlay").classList.remove("open");
  showPickerListStep();
  pendingIso = null;
  pendingSlotIndex = null;
  pendingPickerActivity = null;
  pendingPickerDates = [];
}

/* ---------------------------------------------------------- */
/* Cancel / substitute flow — always requires a reason           */
/* ---------------------------------------------------------- */

function openCancelReason(iso, slotIndex) {
  pendingCancelIso = iso;
  pendingCancelSlot = slotIndex;
  pendingIso = null;
  pendingSlotIndex = null;
  // offer the choice: cancel outright, or pick a substitute first (which
  // re-opens the picker, then funnels into the same reason requirement)
  document.getElementById("picker-title").textContent = "Swap for a different task";
  document.getElementById("picker-sub").textContent = "Or cancel outright below — either way, you'll explain why.";
  renderActivityList();
  document.getElementById("new-activity-input").value = "";

  // add a "cancel outright, no substitute" action above the list
  const list = document.getElementById("activity-list");
  const cancelOutright = document.createElement("div");
  cancelOutright.className = "activity-option";
  cancelOutright.style.borderColor = "var(--clay)";
  cancelOutright.style.background = "var(--clay-tint)";
  cancelOutright.style.color = "var(--clay-dark)";
  cancelOutright.innerHTML = `<span class="dot" style="background:var(--clay);"></span> Cancel — leave this slot empty`;
  cancelOutright.addEventListener("click", () => {
    document.getElementById("picker-overlay").classList.remove("open");
    openReasonModal(iso, slotIndex, "cancelled", null);
  });
  list.insertBefore(cancelOutright, list.firstChild);

  document.getElementById("picker-overlay").classList.add("open");
}

function openReasonModal(iso, slotIndex, type, substituteActivityId) {
  pendingCancelIso = iso;
  pendingCancelSlot = slotIndex;
  pendingSubstituteActivityId = substituteActivityId;
  const day = dayData(iso);
  const currentActivity = activityById(day.slots[slotIndex].activityId);
  document.getElementById("reason-activity-name").textContent = currentActivity ? currentActivity.label : "this task";
  document.getElementById("reason-text").value = "";
  document.getElementById("btn-confirm-reason").disabled = true;
  document.getElementById("reason-overlay").dataset.type = type;
  document.getElementById("reason-overlay").classList.add("open");
}

function closeReasonModal() {
  document.getElementById("reason-overlay").classList.remove("open");
  pendingCancelIso = null;
  pendingCancelSlot = null;
  pendingSubstituteActivityId = null;
}

function confirmReason() {
  const reasonText = document.getElementById("reason-text").value.trim();
  if (!reasonText) return;
  const type = document.getElementById("reason-overlay").dataset.type;
  const day = dayData(pendingCancelIso);
  const slot = day.slots[pendingCancelSlot];

  day.log.push({
    ts: new Date().toISOString(),
    type,
    activityId: slot.activityId,
    reason: reasonText,
  });

  if (type === "substituted" && pendingSubstituteActivityId) {
    slot.activityId = pendingSubstituteActivityId;
    slot.status = "active";
  } else {
    if (slot.homepageEventId && typeof loadHomepageManual === "function") {
      const manual = loadHomepageManual().filter((m) => m.id !== slot.homepageEventId);
      saveHomepageManual(manual);
    }
    slot.activityId = null;
    slot.status = "empty";
    slot.actionType = null;
    slot.homepageEventId = null;
  }

  saveToStorage();
  closeReasonModal();
  renderDo();
  if (typeof renderHomepage === "function") renderHomepage();
}

/* ---------------------------------------------------------- */
/* Task detail modal — notes, link, and a static reminder note   */
/* ---------------------------------------------------------- */

function openDetailModal(iso, slotIndex) {
  pendingDetailIso = iso;
  pendingDetailSlot = slotIndex;
  const slot = dayData(iso).slots[slotIndex];
  const activity = activityById(slot.activityId);
  document.getElementById("detail-activity-name").textContent = activity ? activity.label : "this task";
  document.getElementById("detail-day").value = iso;
  document.getElementById("detail-day-status").textContent = "";
  document.getElementById("detail-text").value = slot.detail || "";
  document.getElementById("detail-link").value = slot.link || "";
  document.getElementById("detail-note").value = slot.note || "";
  const catSelect = document.getElementById("detail-category");
  catSelect.innerHTML = `<option value="">No category</option>` +
    STATE.categories.map((c) => `<option value="${c.id}" ${slot.actionType === c.id ? "selected" : ""}>${escapeHtml(c.label)}</option>`).join("");
  document.getElementById("detail-overlay").classList.add("open");
}

function closeDetailModal() {
  document.getElementById("detail-overlay").classList.remove("open");
  pendingDetailIso = null;
  pendingDetailSlot = null;
}

function saveDetail() {
  const chosenDay = document.getElementById("detail-day").value || pendingDetailIso;
  const statusEl = document.getElementById("detail-day-status");
  const dayChanged = chosenDay !== pendingDetailIso;

  let targetIso = pendingDetailIso;
  let targetSlot = pendingDetailSlot;

  if (dayChanged) {
    ensureDay(chosenDay);
    const targetDay = dayData(chosenDay);
    const emptyIdx = targetDay.slots.findIndex((s) => s.status === "empty");
    if (emptyIdx === -1) {
      // Respect "three, no more" -- don't move it, and say why, rather
      // than silently failing or overriding a slot that's already taken.
      if (statusEl) statusEl.textContent = `${chosenDay} already has three tasks. Pick a different day, or save again to keep it on ${pendingDetailIso}.`;
      document.getElementById("detail-day").value = pendingDetailIso;
      return;
    }
    const original = dayData(pendingDetailIso).slots[pendingDetailSlot];
    const moved = { ...original };
    original.activityId = null;
    original.status = "empty";
    original.detail = "";
    original.link = "";
    original.note = "";
    original.actionType = null;
    original.homepageEventId = null;
    const newSlot = targetDay.slots[emptyIdx];
    newSlot.activityId = moved.activityId;
    newSlot.status = moved.status === "done" ? "done" : "active";
    newSlot.homepageEventId = moved.homepageEventId || null;
    targetIso = chosenDay;
    targetSlot = emptyIdx;
  }

  const slot = dayData(targetIso).slots[targetSlot];
  slot.detail = document.getElementById("detail-text").value.trim();
  slot.link = document.getElementById("detail-link").value.trim();
  slot.note = document.getElementById("detail-note").value.trim();
  slot.actionType = document.getElementById("detail-category").value || null;

  // Keep the linked Homepage calendar block in sync -- and if this task
  // never had one (created with Skip, or from before this link existed,
  // or just never had detail/link filled in), give it one now if there's
  // now something worth showing: either a day was deliberately chosen
  // here, or there's a description/link to display.
  if (typeof loadHomepageManual === "function") {
    const manual = loadHomepageManual();
    if (slot.homepageEventId) {
      const item = manual.find((m) => m.id === slot.homepageEventId);
      if (item) {
        item.date = targetIso;
        const activity = activityById(slot.activityId);
        item.text = slot.detail || (activity ? activity.label : item.text);
        item.link = slot.link || null;
        saveHomepageManual(manual);
      }
    } else if (dayChanged || slot.detail || slot.link) {
      const activity = activityById(slot.activityId);
      const eventId = "hp" + Date.now() + Math.random().toString(36).slice(2, 6) + targetIso;
      manual.push({
        id: eventId,
        date: targetIso,
        text: slot.detail || (activity ? activity.label : "Task"),
        start: HP_DEFAULT_START_DO,
        end: (() => {
          const [h, m] = HP_DEFAULT_START_DO.split(":").map(Number);
          const t = h * 60 + m + 30;
          return String(Math.floor(t / 60) % 24).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
        })(),
        color: activity ? colorHex(activity.color) : "var(--sage)",
        link: slot.link || null,
      });
      slot.homepageEventId = eventId;
      saveHomepageManual(manual);
    }
  }

  saveToStorage();
  closeDetailModal();
  renderDo();
  if (typeof renderHomepage === "function") renderHomepage();
}

/* ---------------------------------------------------------- */
/* Log time modal — manual duration entry, any date, any item    */
/* ---------------------------------------------------------- */

function openLogTimeModal(itemType, itemId, itemLabel, category) {
  pendingLogIsFreeform = false;
  pendingLogItemType = itemType;
  pendingLogItemId = itemId;
  pendingLogItemLabel = itemLabel;
  pendingLogItemCategory = category || null;
  document.getElementById("log-time-item-name-wrap").style.display = "";
  document.getElementById("log-time-item-name").textContent = itemLabel;
  document.getElementById("log-time-picker-row").style.display = "none";
  document.getElementById("log-time-date").value = todayISO();
  document.getElementById("log-time-minutes").value = "";
  populateLogTimeCategorySelect(pendingLogItemCategory);
  document.getElementById("btn-save-log-time").disabled = true;
  document.getElementById("log-time-overlay").classList.add("open");
}

function openLogTimeModalFreeform() {
  pendingLogIsFreeform = true;
  pendingLogItemType = null;
  pendingLogItemId = null;
  pendingLogItemLabel = null;
  pendingLogItemCategory = null;
  document.getElementById("log-time-item-name-wrap").style.display = "none";
  document.getElementById("log-time-picker-row").style.display = "";
  document.getElementById("log-time-type-select").value = "activity";
  populateLogTimeItemSelect();
  document.getElementById("log-time-date").value = todayISO();
  document.getElementById("log-time-minutes").value = "";
  populateLogTimeCategorySelect(null);
  document.getElementById("btn-save-log-time").disabled = true;
  document.getElementById("log-time-overlay").classList.add("open");
}

function populateLogTimeCategorySelect(selectedId) {
  const select = document.getElementById("log-time-category-select");
  if (!select) return;
  select.innerHTML = `<option value="">No category</option>` +
    STATE.categories.map((c) => `<option value="${c.id}" ${selectedId === c.id ? "selected" : ""}>${escapeHtml(c.label)}</option>`).join("");
}

function populateLogTimeItemSelect() {
  const type = document.getElementById("log-time-type-select").value;
  const select = document.getElementById("log-time-item-select");
  select.innerHTML = "";
  const items = type === "activity"
    ? STATE.activities
    : [...STATE.timeWasters.habits, ...STATE.timeWasters.filters];

  if (!items.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = type === "activity" ? "No activities yet" : "No time wasters yet";
    select.appendChild(opt);
    return;
  }

  items.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.label;
    select.appendChild(opt);
  });
}

function closeLogTimeModal() {
  document.getElementById("log-time-overlay").classList.remove("open");
  pendingLogItemType = null;
  pendingLogItemId = null;
  pendingLogItemLabel = null;
  pendingLogItemCategory = null;
  pendingLogIsFreeform = false;
}

function saveLogTime() {
  const minutes = parseInt(document.getElementById("log-time-minutes").value, 10);
  if (!minutes || minutes <= 0) return;
  const date = document.getElementById("log-time-date").value || todayISO();

  let itemType, itemId, itemLabel;
  if (pendingLogIsFreeform) {
    itemType = document.getElementById("log-time-type-select").value;
    itemId = document.getElementById("log-time-item-select").value;
    if (!itemId) return; // nothing to log against (empty pool)
    const items = itemType === "activity"
      ? STATE.activities
      : [...STATE.timeWasters.habits, ...STATE.timeWasters.filters];
    const found = items.find((i) => i.id === itemId);
    itemLabel = found ? found.label : "Unknown";
  } else {
    itemType = pendingLogItemType;
    itemId = pendingLogItemId;
    itemLabel = pendingLogItemLabel;
  }

  STATE.timeLogs.push({
    id: "log_" + Date.now(),
    itemType,
    itemId,
    itemLabel,
    minutes,
    date,
    category: document.getElementById("log-time-category-select").value || null,
    loggedAt: new Date().toISOString(),
  });

  saveToStorage();
  closeLogTimeModal();
  renderDo();
}

/* ---------------------------------------------------------- */
/* Insights tab — combined pie chart of logged time, productive   */
/* (activity) vs wasted (time-waster), by proportion.              */
/* ---------------------------------------------------------- */

const WASTE_COLORS = ["#C97D5D", "#B85C3E", "#8A4F36", "#D98B6B", "#A85F45", "#E0A184"];

function setInsightsRange(range) {
  insightsRange = range;
  renderInsights();
}

function filterLogsByRange(range) {
  const todayIso = todayISO();
  if (range === "today") {
    return STATE.timeLogs.filter((e) => e.date === todayIso);
  }
  if (range === "week") {
    const monday = mondayOf(todayIso);
    const sunday = isoPlusDays(monday, 6);
    return STATE.timeLogs.filter((e) => e.date >= monday && e.date <= sunday);
  }
  return STATE.timeLogs.slice(); // all time
}

function fmtMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function buildPieSVG(slices, total) {
  const cx = 100, cy = 100, r = 90;
  if (slices.length === 1) {
    return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${slices[0].color}" /></svg>`;
  }
  let cumulative = 0;
  let paths = "";
  slices.forEach((slice) => {
    const fraction = slice.minutes / total;
    const startAngle = cumulative * 2 * Math.PI;
    cumulative += fraction;
    const endAngle = cumulative * 2 * Math.PI;
    const x1 = cx + r * Math.sin(startAngle);
    const y1 = cy - r * Math.cos(startAngle);
    const x2 = cx + r * Math.sin(endAngle);
    const y2 = cy - r * Math.cos(endAngle);
    const largeArc = fraction > 0.5 ? 1 : 0;
    paths += `<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${slice.color}"><title>${escapeAttr(slice.label)}</title></path>`;
  });
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

function renderInsights() {
  document.querySelectorAll(".range-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.range === insightsRange);
  });

  const wrap = document.getElementById("insights-chart-wrap");
  const legend = document.getElementById("insights-legend");
  const summary = document.getElementById("insights-summary");
  if (!wrap || !legend || !summary) return; // panel not in DOM yet on first paint

  wrap.innerHTML = "";
  legend.innerHTML = "";

  const entries = filterLogsByRange(insightsRange);
  if (!entries.length) {
    summary.textContent = "";
    wrap.innerHTML = `<div id="insights-empty">No time logged for this range yet — tap the ⏱ on a task or time waster to start.</div>`;
    renderInsightsCategoryBreakdown([]);
    return;
  }

  const map = new Map();
  entries.forEach((e) => {
    const key = e.itemType + ":" + e.itemId;
    if (!map.has(key)) {
      map.set(key, { label: e.itemLabel, itemType: e.itemType, itemId: e.itemId, minutes: 0 });
    }
    map.get(key).minutes += e.minutes;
  });

  const items = Array.from(map.values()).sort((a, b) => b.minutes - a.minutes);
  const total = items.reduce((sum, i) => sum + i.minutes, 0);

  let wasteIdx = 0;
  const slices = items.map((item) => {
    let color;
    if (item.itemType === "activity") {
      const activity = activityById(item.itemId);
      color = activity ? colorHex(activity.color) : "#9CA3AF";
    } else {
      color = WASTE_COLORS[wasteIdx % WASTE_COLORS.length];
      wasteIdx++;
    }
    return { label: item.label, minutes: item.minutes, color };
  });

  wrap.innerHTML = buildPieSVG(slices, total);

  const productiveMinutes = items.filter((i) => i.itemType === "activity").reduce((s, i) => s + i.minutes, 0);
  const prodPct = Math.round((productiveMinutes / total) * 100);
  const wastePct = 100 - prodPct;
  summary.textContent = `${fmtMinutes(total)} logged — ${prodPct}% constructive, ${wastePct}% time wasters`;

  items.forEach((item, i) => {
    const pct = Math.round((item.minutes / total) * 100);
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML = `
      <span class="dot" style="background:${slices[i].color};"></span>
      <span class="legend-label">${escapeHtml(item.label)}</span>
      <span class="legend-time">${fmtMinutes(item.minutes)}</span>
      <span class="legend-pct">${pct}%</span>
    `;
    legend.appendChild(row);
  });

  renderInsightsCategoryBreakdown(entries);
}

const CATEGORY_COLORS = ["#4D8C8C", "#5A7FB5", "#8C6FB0", "#C97DA0", "#D9A441", "#8C8C8C"];

function renderInsightsCategoryBreakdown(entries) {
  const wrap = document.getElementById("insights-category-legend");
  const heading = document.getElementById("insights-category-heading");
  if (!wrap) return;
  wrap.innerHTML = "";

  const categorized = entries.filter((e) => e.category);
  if (!categorized.length) {
    if (heading) heading.style.display = "none";
    wrap.style.display = "none";
    return;
  }
  if (heading) heading.style.display = "";
  wrap.style.display = "";

  const map = new Map();
  categorized.forEach((e) => {
    if (!map.has(e.category)) map.set(e.category, 0);
    map.set(e.category, map.get(e.category) + e.minutes);
  });

  const total = Array.from(map.values()).reduce((s, m) => s + m, 0);
  const rows = Array.from(map.entries())
    .map(([catId, minutes]) => ({ label: (categoryById(catId) || {}).label || "Removed category", minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  rows.forEach((r, i) => {
    const pct = Math.round((r.minutes / total) * 100);
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML = `
      <span class="dot" style="background:${CATEGORY_COLORS[i % CATEGORY_COLORS.length]};"></span>
      <span class="legend-label">${escapeHtml(r.label)}</span>
      <span class="legend-time">${fmtMinutes(r.minutes)}</span>
      <span class="legend-pct">${pct}%</span>
    `;
    wrap.appendChild(row);
  });
}

/* ---------------------------------------------------------- */
/* Add a brand-new activity (from picker or manage modal)        */
/* ---------------------------------------------------------- */

function addActivity(label) {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const usedColors = STATE.activities.map((a) => a.color);
  const color = PALETTE.find((c) => !usedColors.includes(c)) || PALETTE[STATE.activities.length % PALETTE.length];
  const activity = { id: "a_" + Date.now(), label: trimmed, color };
  STATE.activities.push(activity);
  saveToStorage();
  return activity;
}

// Adds an activity only if no existing activity has the same label
// (case-insensitive).
function addVentureIfMissing(label) {
  const trimmed = (label || "").trim();
  if (!trimmed) return null;
  const existing = STATE.activities.find(
    (a) => a.label.toLowerCase() === trimmed.toLowerCase()
  );
  if (existing) return existing;
  return addActivity(trimmed);
}

// Now that Mission Control and Do share one page and one localStorage,
// there's no export/import or deep link needed -- this just reads the
// Portfolio directly (loadPortfolio() is defined in Mission Control's own
// script, loaded before this file) and folds in any venture not already
// in the activity pool. One-way: doesn't remove activities that vanish
// from the Portfolio, since a Do activity may already have logged history
// (past days, time logs) attached to it that shouldn't disappear.
function syncPortfolioVenturesIntoActivities() {
  if (typeof loadPortfolio !== "function") return; // safety net if ever run standalone
  const ventures = loadPortfolio();
  let added = 0;
  ventures.forEach((v) => {
    if (!v || !v.name) return;
    const before = STATE.activities.length;
    addVentureIfMissing(v.name);
    if (STATE.activities.length > before) added++;
  });
  return added;
}

/* ---------------------------------------------------------- */
/* Manage activities modal                                       */
/* ---------------------------------------------------------- */

function openManageModal() {
  renderManageList();
  document.getElementById("new-activity-input-2").value = "";
  document.getElementById("manage-overlay").classList.add("open");
}

function renderManageList() {
  const list = document.getElementById("manage-list");
  list.innerHTML = "";
  STATE.activities.forEach((activity) => {
    const row = document.createElement("div");
    row.className = "manage-row";
    row.innerHTML = `
      <span class="dot" style="background:${colorHex(activity.color)};"></span>
      <span class="name">${escapeHtml(activity.label)}</span>
      <span class="remove-activity" title="Remove from your pool">✕</span>
    `;
    row.querySelector(".remove-activity").addEventListener("click", () => {
      STATE.activities = STATE.activities.filter((a) => a.id !== activity.id);
      saveToStorage();
      renderManageList();
    });
    list.appendChild(row);
  });
}

/* ---------------------------------------------------------- */
/* Time Wasters tab                                               */
/* Two flat lists, no statuses to track — just a checkpoint to     */
/* read before drifting, not a log of failures.                    */
/* ---------------------------------------------------------- */

function renderTimeWasters() {
  renderWasterList("habits", "waster-habits-list");
  renderWasterList("filters", "waster-filters-list");
}

function renderWasterList(group, containerId) {
  const list = document.getElementById(containerId);
  list.innerHTML = "";
  const items = STATE.timeWasters[group];

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "wasters-empty";
    empty.textContent = "Nothing here yet — add one below.";
    list.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "waster-row";
    row.innerHTML = `
      <span class="dot"></span>
      <span class="name">${escapeHtml(item.label)}</span>
      <span class="log-waster-time" title="Log time spent">⏱</span>
      <span class="remove-waster" title="Remove">✕</span>
    `;
    row.querySelector(".log-waster-time").addEventListener("click", () => {
      openLogTimeModal("waster", item.id, item.label);
    });
    row.querySelector(".remove-waster").addEventListener("click", () => {
      removeWaster(group, item.id);
    });
    list.appendChild(row);
  });
}

function addWaster(group, label) {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const item = { id: "w_" + Date.now(), label: trimmed };
  STATE.timeWasters[group].push(item);
  saveToStorage();
  return item;
}

function removeWaster(group, id) {
  STATE.timeWasters[group] = STATE.timeWasters[group].filter((w) => w.id !== id);
  saveToStorage();
  renderTimeWasters();
}

/* ---------------------------------------------------------- */
/* This week tab — plan ahead across a Mon–Sun grid, plus a       */
/* rolling agenda of everything upcoming across any days visited. */
/* ---------------------------------------------------------- */

function renderWeekTab() {
  if (!currentWeekStart) currentWeekStart = mondayOf(todayISO());
  ensureWeek(currentWeekStart);
  document.getElementById("week-range-label").textContent = fmtWeekRangeLabel(currentWeekStart);
  const carryBtn = document.getElementById("btn-carry-forward");
  const isPastWeek = currentWeekStart < mondayOf(todayISO());
  carryBtn.style.display = isPastWeek ? "" : "none";
  document.getElementById("carry-forward-status").textContent = "";
  renderWeekDays();
  renderUpcomingList();
}

function renderWeekDays() {
  const container = document.getElementById("week-days");
  container.innerHTML = "";
  const todayIso = todayISO();

  weekDates(currentWeekStart).forEach((iso) => {
    const day = dayData(iso);
    const card = document.createElement("div");
    card.className = "day-card" + (iso === todayIso ? " is-today" : "");
    card.innerHTML = `
      <div class="day-card-header">
        <span class="day-card-date">${fmtDayLabelShort(iso)}</span>
        ${iso === todayIso ? `<span class="day-card-today-tag">Today</span>` : ""}
      </div>
      <div class="day-card-slots"></div>
    `;
    const slotsWrap = card.querySelector(".day-card-slots");

    day.slots.forEach((slot, i) => {
      const chip = document.createElement("div");
      if (slot.status === "empty") {
        chip.className = "week-slot-chip empty";
        chip.innerHTML = `<span>+ Plan a task</span>`;
        chip.addEventListener("click", () => openPicker(iso, i));
      } else {
        const activity = activityById(slot.activityId);
        const label = activity ? activity.label : "Unknown";
        chip.className = `week-slot-chip ${slot.status}`;
        chip.innerHTML = `
          <span class="chip-label">${escapeHtml(label)}</span>
          ${actionBadgeHtml(slot.actionType)}
          <span class="stone-indicators">${slotIndicatorsHtml(slot)}</span>
          <span class="chip-actions">
            <span class="chip-time-btn" title="Log time spent">⏱</span>
            <span class="chip-detail-btn" title="Detail, link, or note">✎</span>
            <span class="chip-cancel-btn" title="Change or remove">✕</span>
          </span>
        `;
        chip.querySelector(".chip-time-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          openLogTimeModal("activity", activity ? activity.id : slot.activityId, label, slot.actionType);
        });
        chip.querySelector(".chip-detail-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          openDetailModal(iso, i);
        });
        chip.querySelector(".chip-cancel-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          openCancelReason(iso, i);
        });
        const linkEl = chip.querySelector(".stone-link");
        if (linkEl) linkEl.addEventListener("click", (e) => e.stopPropagation());
        chip.addEventListener("click", () => openDetailModal(iso, i));
      }
      slotsWrap.appendChild(chip);
    });

    container.appendChild(card);
  });
}

function renderUpcomingList() {
  const list = document.getElementById("upcoming-list");
  list.innerHTML = "";
  const todayIso = todayISO();

  const rows = [];
  Object.keys(STATE.days)
    .filter((iso) => iso >= todayIso)
    .sort()
    .forEach((iso) => {
      const day = STATE.days[iso];
      day.slots.forEach((slot) => {
        if (slot.activityId && slot.status !== "empty") {
          rows.push({ iso, slot });
        }
      });
    });

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.id = "upcoming-empty";
    empty.textContent = "Nothing planned ahead yet — assign a task on Plan week to see it here.";
    list.appendChild(empty);
    return;
  }

  rows.forEach(({ iso, slot }) => {
    const activity = activityById(slot.activityId);
    const label = activity ? activity.label : "Unknown";
    const row = document.createElement("div");
    row.className = "upcoming-row";
    row.innerHTML = `
      <span class="upcoming-date">${fmtDayLabelShort(iso)}</span>
      <span class="upcoming-label">${escapeHtml(label)}${slot.status === "done" ? " ✓" : ""}</span>
      <span class="stone-indicators">${slotIndicatorsHtml(slot)}</span>
    `;
    const linkEl = row.querySelector(".stone-link");
    if (linkEl) linkEl.addEventListener("click", (e) => e.stopPropagation());
    list.appendChild(row);
  });
}

function goToWeek(offsetDays) {
  currentWeekStart = isoPlusDays(currentWeekStart, offsetDays);
  renderWeekTab();
}

// Carries any unfinished tasks (assigned but never marked done) from the
// week currently being viewed into the actual current week -- so a task
// that didn't happen isn't just silently lost. Only pulls "active" slots,
// since an empty slot never had anything in it to carry. The original
// slot is left exactly as it was, since a past week is history -- this
// only adds a copy into the current week, it doesn't rewrite what did or
// didn't happen back then.
function carryWeekForward() {
  const statusEl = document.getElementById("carry-forward-status");
  const actualCurrentWeekStart = mondayOf(todayISO());
  if (currentWeekStart >= actualCurrentWeekStart) {
    if (statusEl) statusEl.textContent = "You're already on the current week.";
    return;
  }

  const toCarry = [];
  weekDates(currentWeekStart).forEach((iso) => {
    const day = dayData(iso);
    if (!day) return;
    day.slots.forEach((slot) => {
      if (slot.status === "active" && slot.activityId) {
        toCarry.push({ activityId: slot.activityId, detail: slot.detail || "", link: slot.link || "" });
      }
    });
  });

  if (!toCarry.length) {
    if (statusEl) statusEl.textContent = "Nothing unfinished that week — nothing to carry forward.";
    return;
  }

  ensureWeek(actualCurrentWeekStart);
  const currentDates = weekDates(actualCurrentWeekStart);
  let carried = 0;

  toCarry.forEach((item) => {
    for (const iso of currentDates) {
      ensureDay(iso);
      const day = dayData(iso);
      const emptyIdx = day.slots.findIndex((s) => s.status === "empty");
      if (emptyIdx !== -1) {
        day.slots[emptyIdx].activityId = item.activityId;
        day.slots[emptyIdx].status = "active";
        if (item.detail) day.slots[emptyIdx].detail = item.detail;
        if (item.link) day.slots[emptyIdx].link = item.link;
        carried++;
        break;
      }
    }
  });

  saveToStorage();
  renderDo();
  const notCarried = toCarry.length - carried;
  const msg = notCarried
    ? `Carried ${carried} task${carried === 1 ? "" : "s"} into this week. ${notCarried} couldn't fit — this week's already full.`
    : `Carried ${carried} task${carried === 1 ? "" : "s"} into this week.`;
  document.getElementById("carry-forward-status").textContent = msg;
}

function emailWeek() {
  const dates = weekDates(currentWeekStart);
  let body = `Do — Week of ${fmtWeekRangeLabel(currentWeekStart)}\n\n`;

  dates.forEach((iso) => {
    const day = dayData(iso);
    body += `${fmtDayLabelShort(iso)}\n`;
    const filled = day.slots.filter((s) => s.activityId);
    if (!filled.length) {
      body += "  (nothing planned)\n";
    } else {
      filled.forEach((s) => {
        const activity = activityById(s.activityId);
        const label = activity ? activity.label : "Unknown";
        const tag = s.actionType === "market" ? " [MARKET]" : s.actionType === "improve" ? " [IMPROVE]" : "";
        body += `  - ${label}${tag}${s.status === "done" ? " (done)" : ""}\n`;
        if (s.detail) body += `      detail: ${s.detail}\n`;
        if (s.link) body += `      link: ${s.link}\n`;
        if (s.note) body += `      worth checking: ${s.note}\n`;
      });
    }
    body += "\n";
  });

  sendMailto(`Do — Week of ${fmtWeekRangeLabel(currentWeekStart)}`, body);
}

function emailToday() {
  const iso = todayISO();
  const day = dayData(iso);
  const dayLabel = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  let body = `Do — ${dayLabel}\n\n`;

  const filled = day.slots.filter((s) => s.activityId);
  if (!filled.length) {
    body += "(nothing planned yet)\n";
  } else {
    filled.forEach((s) => {
      const activity = activityById(s.activityId);
      const label = activity ? activity.label : "Unknown";
      body += `- ${label}${s.status === "done" ? " (done)" : ""}\n`;
      if (s.detail) body += `    detail: ${s.detail}\n`;
      if (s.link) body += `    link: ${s.link}\n`;
      if (s.note) body += `    worth checking: ${s.note}\n`;
    });
  }

  sendMailto(`Do — ${dayLabel}`, body);
}

function emailWasters() {
  let body = `Do — Time Wasters\n\n`;

  body += `Catch mid-motion\n`;
  if (!STATE.timeWasters.habits.length) {
    body += "  (none yet)\n";
  } else {
    STATE.timeWasters.habits.forEach((h) => (body += `  - ${h.label}\n`));
  }

  body += `\nFilter before saying yes\n`;
  if (!STATE.timeWasters.filters.length) {
    body += "  (none yet)\n";
  } else {
    STATE.timeWasters.filters.forEach((f) => (body += `  - ${f.label}\n`));
  }

  sendMailto("Do — Time Wasters", body);
}

function sendMailto(subject, body) {
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);
  window.location.href = `mailto:?subject=${encodedSubject}&body=${encodedBody}`;
}

/* ---------------------------------------------------------- */
/* Strategize tab                                                 */
/* Long-term objectives up top; below that, a tool to stipulate   */
/* an activity for specific days or a range — it auto-fills the   */
/* first open slot on each day, skipping any day already full.    */
/* ---------------------------------------------------------- */

function renderStrategize() {
  renderObjectives();
  renderCommitActivitySelect();
  renderCommitHistory();
}

function renderObjectives() {
  const list = document.getElementById("objectives-list");
  list.innerHTML = "";

  if (!STATE.objectives.length) {
    list.innerHTML = `<div class="wasters-empty">Nothing here yet — add your first objective below.</div>`;
    return;
  }

  STATE.objectives.forEach((obj) => {
    const row = document.createElement("div");
    row.className = "objective-row";
    row.innerHTML = `
      <div class="objective-main">
        <span class="objective-label">${escapeHtml(obj.label)}</span>
        ${obj.detail ? `<div class="objective-detail">${escapeHtml(obj.detail)}</div>` : ""}
      </div>
      <span class="remove-objective" title="Remove">✕</span>
    `;
    row.querySelector(".remove-objective").addEventListener("click", () => removeObjective(obj.id));
    list.appendChild(row);
  });
}

function addObjective(label, detail) {
  const trimmed = (label || "").trim();
  if (!trimmed) return null;
  const obj = { id: "obj_" + Date.now(), label: trimmed, detail: (detail || "").trim() };
  STATE.objectives.push(obj);
  saveToStorage();
  return obj;
}

function removeObjective(id) {
  STATE.objectives = STATE.objectives.filter((o) => o.id !== id);
  saveToStorage();
  renderObjectives();
}

/* ---------------------------------------------------------- */
/* Prioritise Next Week — three-rung pyramid of free-text      */
/* areas (Strategic Objectives / Mass Communication / 1:1      */
/* Communication) tied to the upcoming Monday.                  */
/* ---------------------------------------------------------- */

function upcomingMondayISO() {
  return isoPlusDays(mondayOf(todayISO()), 7);
}

function renderNextWeek() {
  const nextMonday = upcomingMondayISO();

  // If the saved plan was for an earlier week (it's now this week or past),
  // roll it forward into a fresh blank plan for the new upcoming week --
  // but keep the old text nowhere near the new fields so nothing is lost
  // silently; the user re-enters intentionally each planning session.
  if (STATE.nextWeekPlan.weekOf && STATE.nextWeekPlan.weekOf !== nextMonday) {
    STATE.nextWeekPlan = {
      weekOf: nextMonday,
      strategic: "",
      massPlan: { purpose: "", theme: "", location: "", backingTrack: "", script: "" },
      massExecute: "",
      oneToOnePlan: "",
      oneToOneInstigate: "",
    };
    saveToStorage();
  } else if (!STATE.nextWeekPlan.weekOf) {
    STATE.nextWeekPlan.weekOf = nextMonday;
    saveToStorage();
  }

  document.getElementById("nextweek-range-label").textContent =
    "Week of " + fmtWeekRangeLabel(nextMonday);

  document.getElementById("nw-strategic").value = STATE.nextWeekPlan.strategic || "";
  document.getElementById("nw-mass-purpose").value = STATE.nextWeekPlan.massPlan.purpose || "";
  document.getElementById("nw-mass-theme").value = STATE.nextWeekPlan.massPlan.theme || "";
  document.getElementById("nw-mass-location").value = STATE.nextWeekPlan.massPlan.location || "";
  document.getElementById("nw-mass-track").value = STATE.nextWeekPlan.massPlan.backingTrack || "";
  document.getElementById("nw-mass-script").value = STATE.nextWeekPlan.massPlan.script || "";
  document.getElementById("nw-mass-execute").value = STATE.nextWeekPlan.massExecute || "";
  document.getElementById("nw-1to1-plan").value = STATE.nextWeekPlan.oneToOnePlan || "";
  document.getElementById("nw-1to1-instigate").value = STATE.nextWeekPlan.oneToOneInstigate || "";

  setNextWeekSaveStatus("");
}

function saveNextWeekPlan() {
  STATE.nextWeekPlan.weekOf = STATE.nextWeekPlan.weekOf || upcomingMondayISO();
  STATE.nextWeekPlan.strategic = document.getElementById("nw-strategic").value;
  STATE.nextWeekPlan.massPlan = {
    purpose: document.getElementById("nw-mass-purpose").value,
    theme: document.getElementById("nw-mass-theme").value,
    location: document.getElementById("nw-mass-location").value,
    backingTrack: document.getElementById("nw-mass-track").value,
    script: document.getElementById("nw-mass-script").value,
  };
  STATE.nextWeekPlan.massExecute = document.getElementById("nw-mass-execute").value;
  STATE.nextWeekPlan.oneToOnePlan = document.getElementById("nw-1to1-plan").value;
  STATE.nextWeekPlan.oneToOneInstigate = document.getElementById("nw-1to1-instigate").value;
  saveToStorage();
  setNextWeekSaveStatus("Saved.");
}

let nextWeekSaveStatusTimer = null;
function setNextWeekSaveStatus(msg) {
  const el = document.getElementById("nextweek-save-status");
  if (!el) return;
  el.textContent = msg;
  if (nextWeekSaveStatusTimer) clearTimeout(nextWeekSaveStatusTimer);
  if (msg) {
    nextWeekSaveStatusTimer = setTimeout(() => { el.textContent = ""; }, 2500);
  }
}

/* ---------------------------------------------------------- */
/* This Week, Prioritised — same pyramid, plus focus projects   */
/* and a communication question, tied to the week already      */
/* underway (this week's Monday) rather than next week's.       */
/* ---------------------------------------------------------- */

function thisWeekMondayISO() {
  return mondayOf(todayISO());
}

function renderThisWeek() {
  const thisMonday = thisWeekMondayISO();

  // Same roll-forward pattern as Prioritise Next Week: if the saved plan
  // is for an earlier week, start fresh for the current one rather than
  // silently carrying old text into a new week's fields.
  if (STATE.thisWeekPlan.weekOf && STATE.thisWeekPlan.weekOf !== thisMonday) {
    STATE.thisWeekPlan = {
      weekOf: thisMonday,
      focusProjects: "",
      communication: "",
      strategic: "",
      massPlan: { purpose: "", theme: "", location: "", backingTrack: "", script: "" },
      massExecute: "",
      oneToOnePlan: "",
      oneToOneInstigate: "",
    };
    saveToStorage();
  } else if (!STATE.thisWeekPlan.weekOf) {
    STATE.thisWeekPlan.weekOf = thisMonday;
    saveToStorage();
  }

  document.getElementById("thisweek-range-label").textContent =
    "Week of " + fmtWeekRangeLabel(thisMonday);

  document.getElementById("tw-focus-projects").value = STATE.thisWeekPlan.focusProjects || "";
  document.getElementById("tw-communication").value = STATE.thisWeekPlan.communication || "";
  document.getElementById("tw-strategic").value = STATE.thisWeekPlan.strategic || "";
  document.getElementById("tw-mass-purpose").value = STATE.thisWeekPlan.massPlan.purpose || "";
  document.getElementById("tw-mass-theme").value = STATE.thisWeekPlan.massPlan.theme || "";
  document.getElementById("tw-mass-location").value = STATE.thisWeekPlan.massPlan.location || "";
  document.getElementById("tw-mass-track").value = STATE.thisWeekPlan.massPlan.backingTrack || "";
  document.getElementById("tw-mass-script").value = STATE.thisWeekPlan.massPlan.script || "";
  document.getElementById("tw-mass-execute").value = STATE.thisWeekPlan.massExecute || "";
  document.getElementById("tw-1to1-plan").value = STATE.thisWeekPlan.oneToOnePlan || "";
  document.getElementById("tw-1to1-instigate").value = STATE.thisWeekPlan.oneToOneInstigate || "";

  setThisWeekSaveStatus("");
}

function saveThisWeekPlan() {
  STATE.thisWeekPlan.weekOf = STATE.thisWeekPlan.weekOf || thisWeekMondayISO();
  STATE.thisWeekPlan.focusProjects = document.getElementById("tw-focus-projects").value;
  STATE.thisWeekPlan.communication = document.getElementById("tw-communication").value;
  STATE.thisWeekPlan.strategic = document.getElementById("tw-strategic").value;
  STATE.thisWeekPlan.massPlan = {
    purpose: document.getElementById("tw-mass-purpose").value,
    theme: document.getElementById("tw-mass-theme").value,
    location: document.getElementById("tw-mass-location").value,
    backingTrack: document.getElementById("tw-mass-track").value,
    script: document.getElementById("tw-mass-script").value,
  };
  STATE.thisWeekPlan.massExecute = document.getElementById("tw-mass-execute").value;
  STATE.thisWeekPlan.oneToOnePlan = document.getElementById("tw-1to1-plan").value;
  STATE.thisWeekPlan.oneToOneInstigate = document.getElementById("tw-1to1-instigate").value;
  saveToStorage();
  setThisWeekSaveStatus("Saved.");
}

let thisWeekSaveStatusTimer = null;
function setThisWeekSaveStatus(msg) {
  const el = document.getElementById("thisweek-save-status");
  if (!el) return;
  el.textContent = msg;
  if (thisWeekSaveStatusTimer) clearTimeout(thisWeekSaveStatusTimer);
  if (msg) {
    thisWeekSaveStatusTimer = setTimeout(() => { el.textContent = ""; }, 2500);
  }
}

function renderCommitActivitySelect() {
  const select = document.getElementById("commit-activity-select");
  if (!select) return;
  const prevValue = select.value;
  select.innerHTML = "";

  if (!STATE.activities.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No activities yet — add one from Today first";
    select.appendChild(opt);
    return;
  }

  STATE.activities.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.label;
    select.appendChild(opt);
  });

  if (prevValue && STATE.activities.some((a) => a.id === prevValue)) {
    select.value = prevValue;
  }
}

function setCommitMode(mode) {
  commitMode = mode;
  document.querySelectorAll(".commit-mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
  document.getElementById("commit-single-row").style.display = mode === "single" ? "" : "none";
  document.getElementById("commit-range-row").style.display = mode === "range" ? "" : "none";
}

function applyCommit() {
  const resultEl = document.getElementById("commit-result");
  resultEl.textContent = "";

  const activityId = document.getElementById("commit-activity-select").value;
  const activity = activityById(activityId);
  if (!activity) {
    resultEl.textContent = "Pick an activity first.";
    return;
  }

  let dates = [];
  if (commitMode === "single") {
    const d = document.getElementById("commit-date-single").value;
    if (!d) {
      resultEl.textContent = "Pick a date.";
      return;
    }
    dates = [d];
  } else {
    const start = document.getElementById("commit-date-start").value;
    const end = document.getElementById("commit-date-end").value;
    if (!start || !end || end < start) {
      resultEl.textContent = "Pick a valid start and end date.";
      return;
    }
    let cursor = start;
    let guard = 0;
    while (cursor <= end && guard < 366) {
      dates.push(cursor);
      cursor = isoPlusDays(cursor, 1);
      guard++;
    }
  }

  let applied = 0;
  let skipped = 0;
  dates.forEach((iso) => {
    ensureDay(iso);
    const day = dayData(iso);
    const emptySlot = day.slots.find((s) => s.status === "empty");
    if (emptySlot) {
      emptySlot.activityId = activity.id;
      emptySlot.status = "active";
      applied++;
    } else {
      skipped++;
    }
  });

  STATE.commitments.push({
    id: "commit_" + Date.now(),
    activityId: activity.id,
    activityLabel: activity.label,
    mode: commitMode,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    appliedCount: applied,
    skippedCount: skipped,
    createdAt: new Date().toISOString(),
  });

  saveToStorage();

  resultEl.textContent = skipped > 0
    ? `Filled ${applied} day${applied === 1 ? "" : "s"} — ${skipped} day${skipped === 1 ? "" : "s"} already had 3 tasks, so ${skipped === 1 ? "it was" : "those were"} skipped.`
    : `Filled ${applied} day${applied === 1 ? "" : "s"}.`;

  renderDo();
}

function renderCommitHistory() {
  const wrap = document.getElementById("commit-history");
  if (!wrap) return;
  wrap.innerHTML = "";

  if (!STATE.commitments.length) {
    wrap.innerHTML = `<div class="wasters-empty">Nothing stipulated yet.</div>`;
    return;
  }

  [...STATE.commitments].reverse().forEach((c) => {
    const rangeLabel = c.startDate === c.endDate
      ? fmtDayLabelShort(c.startDate)
      : `${fmtDayLabelShort(c.startDate)} – ${fmtDayLabelShort(c.endDate)}`;
    const row = document.createElement("div");
    row.className = "commit-row";
    row.innerHTML = `
      <div class="commit-main">
        <span class="commit-label">${escapeHtml(c.activityLabel)}</span>
        <span class="commit-range">${rangeLabel} — ${c.appliedCount} filled${c.skippedCount ? `, ${c.skippedCount} skipped` : ""}</span>
      </div>
      <span class="remove-commit" title="Remove from this list (does not undo filled slots)">✕</span>
    `;
    row.querySelector(".remove-commit").addEventListener("click", () => {
      STATE.commitments = STATE.commitments.filter((x) => x.id !== c.id);
      saveToStorage();
      renderCommitHistory();
    });
    wrap.appendChild(row);
  });
}

/* ---------------------------------------------------------- */
/* Targeted Action tab                                            */
/* Marries marketing (outreach) with product improvement.        */
/* Per venture: an assigned outreach day (which gets a market     */
/* slot, with a sharpen-first note), and a ratio that sets how    */
/* many non-outreach days that week should carry an improve       */
/* touch. "Generate this week" writes it into open slots the      */
/* same way Strategize's commit tool does — it never overwrites   */
/* an already-filled slot.                                        */
/* ---------------------------------------------------------- */

function getVentureConfig(activityId) {
  const existing = STATE.targetedAction.ventures[activityId];
  return existing || { outreachDay: null, ratio: "balanced", sharpenMinutes: 20 };
}

function setVentureConfig(activityId, patch) {
  const current = getVentureConfig(activityId);
  STATE.targetedAction.ventures[activityId] = { ...current, ...patch };
  saveToStorage();
}

function renderTargetedAction() {
  renderTaCategoryList();
  renderTaVentureList();
  renderTaHistory();
}

function addCategory(label) {
  const trimmed = (label || "").trim();
  if (!trimmed) return null;
  const cat = { id: "cat_" + Date.now(), label: trimmed };
  STATE.categories.push(cat);
  saveToStorage();
  return cat;
}

function removeCategory(id) {
  if (RESERVED_CATEGORY_IDS.includes(id)) return; // Market/Improve power the generator — rename, don't remove
  STATE.categories = STATE.categories.filter((c) => c.id !== id);
  // clear it off anywhere it was applied so nothing points at a dead category
  Object.values(STATE.days).forEach((day) => {
    day.slots.forEach((s) => {
      if (s.actionType === id) s.actionType = null;
    });
  });
  saveToStorage();
  renderDo();
}

function renameCategory(id, label) {
  const trimmed = (label || "").trim();
  if (!trimmed) return;
  const cat = categoryById(id);
  if (cat) {
    cat.label = trimmed;
    saveToStorage();
    renderDo();
  }
}

function renderTaCategoryList() {
  const list = document.getElementById("ta-categories-list");
  if (!list) return;
  list.innerHTML = "";

  STATE.categories.forEach((cat) => {
    const reserved = RESERVED_CATEGORY_IDS.includes(cat.id);
    const row = document.createElement("div");
    row.className = "waster-row";
    row.innerHTML = `
      <span class="dot"></span>
      <input class="ta-category-name-input" type="text" value="${escapeAttr(cat.label)}" />
      ${reserved ? `<span class="ta-category-reserved" title="Used by the generator — rename freely, can't remove">generator</span>` : `<span class="remove-waster" title="Remove">✕</span>`}
    `;
    row.querySelector(".ta-category-name-input").addEventListener("change", (e) => {
      renameCategory(cat.id, e.target.value);
    });
    const removeEl = row.querySelector(".remove-waster");
    if (removeEl) {
      removeEl.addEventListener("click", () => removeCategory(cat.id));
    }
    list.appendChild(row);
  });
}

function renderTaVentureList() {
  const list = document.getElementById("ta-ventures-list");
  if (!list) return;
  list.innerHTML = "";

  if (!STATE.activities.length) {
    list.innerHTML = `<div class="wasters-empty">No projects yet — add one from Today first.</div>`;
    return;
  }

  STATE.activities.forEach((a) => {
    const cfg = getVentureConfig(a.id);
    const row = document.createElement("div");
    row.className = "ta-venture-row";

    const dayOptions = [`<option value="">No outreach day set</option>`]
      .concat(TA_WEEKDAY_LABELS.map((label, i) => `<option value="${i}" ${cfg.outreachDay === i ? "selected" : ""}>${label}</option>`))
      .join("");

    const ratioOptions = Object.keys(TA_RATIO_LABELS)
      .map((key) => `<option value="${key}" ${cfg.ratio === key ? "selected" : ""}>${TA_RATIO_LABELS[key]}</option>`)
      .join("");

    row.innerHTML = `
      <div class="ta-venture-name">${escapeHtml(a.label)}</div>
      <label class="do-detail-label">Outreach day</label>
      <select class="ta-day-select">${dayOptions}</select>
      <label class="do-detail-label">Stage / ratio</label>
      <select class="ta-ratio-select">${ratioOptions}</select>
      <label class="do-detail-label">Sharpen first (minutes)</label>
      <input class="ta-sharpen-input" type="number" min="0" max="180" step="5" value="${cfg.sharpenMinutes}" />
    `;

    row.querySelector(".ta-day-select").addEventListener("change", (e) => {
      const val = e.target.value;
      setVentureConfig(a.id, { outreachDay: val === "" ? null : parseInt(val, 10) });
    });
    row.querySelector(".ta-ratio-select").addEventListener("change", (e) => {
      setVentureConfig(a.id, { ratio: e.target.value });
    });
    row.querySelector(".ta-sharpen-input").addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      setVentureConfig(a.id, { sharpenMinutes: val > 0 ? val : 0 });
    });

    list.appendChild(row);
  });
}

function generateTargetedActionWeek() {
  const resultEl = document.getElementById("ta-generate-result");
  if (resultEl) resultEl.textContent = "";

  if (!STATE.activities.length) {
    if (resultEl) resultEl.textContent = "Add a project from Today first.";
    return;
  }

  ensureWeek(currentWeekStart);
  const dates = weekDates(currentWeekStart); // index 0=Mon..6=Sun, matches TA_WEEKDAY_LABELS

  let marketApplied = 0;
  let improveApplied = 0;
  let skipped = 0;

  // Pass 1: outreach-day market slots take priority, venture by venture.
  const marketCat = categoryById(CAT_MARKET_ID) || { label: "Market" };
  STATE.activities.forEach((a) => {
    const cfg = getVentureConfig(a.id);
    if (cfg.outreachDay === null || cfg.outreachDay === undefined) return;
    const iso = dates[cfg.outreachDay];
    const day = dayData(iso);
    const emptySlot = day.slots.find((s) => s.status === "empty");
    if (emptySlot) {
      emptySlot.activityId = a.id;
      emptySlot.status = "active";
      emptySlot.actionType = CAT_MARKET_ID;
      emptySlot.note = `${marketCat.label} — outreach. Sharpen ${cfg.sharpenMinutes} min first, then go out.`;
      marketApplied++;
    } else {
      skipped++;
    }
  });

  // Pass 2: improve touches on non-outreach days, spread across the week,
  // count driven by each venture's ratio.
  const improveCat = categoryById(CAT_IMPROVE_ID) || { label: "Improve" };
  STATE.activities.forEach((a) => {
    const cfg = getVentureConfig(a.id);
    const target = TA_RATIO_IMPROVE_TOUCHES[cfg.ratio] ?? 2;
    let placed = 0;
    for (let i = 0; i < dates.length && placed < target; i++) {
      if (i === cfg.outreachDay) continue; // that day's slot is for marketing
      const iso = dates[i];
      const day = dayData(iso);
      const emptySlot = day.slots.find((s) => s.status === "empty");
      if (emptySlot) {
        emptySlot.activityId = a.id;
        emptySlot.status = "active";
        emptySlot.actionType = CAT_IMPROVE_ID;
        emptySlot.note = `${improveCat.label} — sharpen/build session.`;
        improveApplied++;
        placed++;
      }
    }
    if (placed < target) skipped += target - placed;
  });

  STATE.taRuns.push({
    id: "ta_" + Date.now(),
    weekLabel: fmtWeekRangeLabel(currentWeekStart),
    marketApplied,
    improveApplied,
    skipped,
    createdAt: new Date().toISOString(),
  });

  saveToStorage();

  if (resultEl) {
    resultEl.textContent = `Filled ${marketApplied} market slot${marketApplied === 1 ? "" : "s"} and ${improveApplied} improve slot${improveApplied === 1 ? "" : "s"}` +
      (skipped ? ` — ${skipped} touch${skipped === 1 ? "" : "es"} couldn't fit (days already full).` : ".");
  }

  renderDo();
}

function renderTaHistory() {
  const wrap = document.getElementById("ta-history");
  if (!wrap) return;
  wrap.innerHTML = "";

  if (!STATE.taRuns.length) {
    wrap.innerHTML = `<div class="wasters-empty">No runs yet — generate this week's schedule above.</div>`;
    return;
  }

  [...STATE.taRuns].reverse().slice(0, 10).forEach((r) => {
    const row = document.createElement("div");
    row.className = "commit-row";
    row.innerHTML = `
      <div class="commit-main">
        <span class="commit-label">${escapeHtml(r.weekLabel)}</span>
        <span class="commit-range">${r.marketApplied} market, ${r.improveApplied} improve${r.skipped ? `, ${r.skipped} skipped` : ""}</span>
      </div>
      <span class="remove-commit" title="Remove from this list (does not undo filled slots)">✕</span>
    `;
    row.querySelector(".remove-commit").addEventListener("click", () => {
      STATE.taRuns = STATE.taRuns.filter((x) => x.id !== r.id);
      saveToStorage();
      renderTaHistory();
    });
    wrap.appendChild(row);
  });
}

/* ---------------------------------------------------------- */
/* Tab switching                                                  */
/* ---------------------------------------------------------- */

function switchTab(tab) {
  document.getElementById("tab-today-panel").style.display = tab === "today" ? "" : "none";
  document.getElementById("tab-week-panel").style.display = tab === "week" ? "" : "none";
  document.getElementById("tab-strategize-panel").style.display = tab === "strategize" ? "" : "none";
  document.getElementById("tab-targeted-action-panel").style.display = tab === "targeted-action" ? "" : "none";
  document.getElementById("tab-thisweek-panel").style.display = tab === "thisweek" ? "" : "none";
  document.getElementById("tab-nextweek-panel").style.display = tab === "nextweek" ? "" : "none";
  document.getElementById("tab-wasters-panel").style.display = tab === "wasters" ? "" : "none";
  document.getElementById("tab-insights-panel").style.display = tab === "insights" ? "" : "none";
  document.getElementById("tab-today").classList.toggle("active", tab === "today");
  document.getElementById("tab-week").classList.toggle("active", tab === "week");
  document.getElementById("tab-strategize").classList.toggle("active", tab === "strategize");
  document.getElementById("tab-targeted-action").classList.toggle("active", tab === "targeted-action");
  document.getElementById("tab-thisweek").classList.toggle("active", tab === "thisweek");
  document.getElementById("tab-nextweek").classList.toggle("active", tab === "nextweek");
  document.getElementById("tab-wasters").classList.toggle("active", tab === "wasters");
  document.getElementById("tab-insights").classList.toggle("active", tab === "insights");
  if (tab === "week") renderWeekTab();
  if (tab === "insights") renderInsights();
  if (tab === "strategize") renderStrategize();
  if (tab === "targeted-action") renderTargetedAction();
  if (tab === "thisweek") renderThisWeek();
  if (tab === "nextweek") renderNextWeek();
}

/* ---------------------------------------------------------- */
/* Wiring                                                         */
/* ---------------------------------------------------------- */

function wireUI() {
  document.getElementById("btn-cancel-picker").addEventListener("click", closePicker);
  document.getElementById("btn-picker-skip").addEventListener("click", skipPickerDetails);
  document.getElementById("btn-picker-save-detail").addEventListener("click", savePickerDetails);
  document.getElementById("btn-add-picker-date").addEventListener("click", addPickerDate);

  document.getElementById("btn-add-activity").addEventListener("click", () => {
    const input = document.getElementById("new-activity-input");
    const activity = addActivity(input.value);
    if (activity) {
      input.value = "";
      renderActivityList();
    }
  });
  document.getElementById("new-activity-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-add-activity").click();
  });

  document.getElementById("btn-cancel-reason").addEventListener("click", closeReasonModal);
  document.getElementById("reason-text").addEventListener("input", (e) => {
    document.getElementById("btn-confirm-reason").disabled = !e.target.value.trim();
  });
  document.getElementById("btn-confirm-reason").addEventListener("click", confirmReason);

  document.getElementById("manage-link").addEventListener("click", openManageModal);
  document.getElementById("btn-close-manage").addEventListener("click", () => {
    document.getElementById("manage-overlay").classList.remove("open");
    renderDo(); // in case activities were removed, refresh stones/history labels
  });
  document.getElementById("btn-add-activity-2").addEventListener("click", () => {
    const input = document.getElementById("new-activity-input-2");
    const activity = addActivity(input.value);
    if (activity) {
      input.value = "";
      renderManageList();
    }
  });
  document.getElementById("new-activity-input-2").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-add-activity-2").click();
  });

  document.getElementById("btn-backup-data").addEventListener("click", backupData);

  document.getElementById("btn-import-do-history").addEventListener("click", () => {
    document.getElementById("do-history-import-file").click();
  });
  document.getElementById("do-history-import-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      importDoHistoryBackup(reader.result);
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  document.getElementById("tab-today").addEventListener("click", () => switchTab("today"));
  document.getElementById("tab-week").addEventListener("click", () => switchTab("week"));
  document.getElementById("tab-strategize").addEventListener("click", () => switchTab("strategize"));
  document.getElementById("tab-targeted-action").addEventListener("click", () => switchTab("targeted-action"));
  document.getElementById("tab-thisweek").addEventListener("click", () => switchTab("thisweek"));
  document.getElementById("tab-nextweek").addEventListener("click", () => switchTab("nextweek"));
  document.getElementById("tab-wasters").addEventListener("click", () => switchTab("wasters"));
  document.getElementById("tab-insights").addEventListener("click", () => switchTab("insights"));

  document.getElementById("btn-save-nextweek").addEventListener("click", saveNextWeekPlan);
  document.getElementById("btn-save-thisweek").addEventListener("click", saveThisWeekPlan);

  document.getElementById("btn-ta-generate").addEventListener("click", generateTargetedActionWeek);

  document.getElementById("btn-add-ta-category").addEventListener("click", () => {
    const input = document.getElementById("ta-category-input");
    if (addCategory(input.value)) {
      input.value = "";
      renderTaCategoryList();
    }
  });
  document.getElementById("ta-category-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-add-ta-category").click();
  });

  document.getElementById("btn-add-objective").addEventListener("click", () => {
    const input = document.getElementById("objective-input");
    const detailInput = document.getElementById("objective-detail-input");
    if (addObjective(input.value, detailInput.value)) {
      input.value = "";
      detailInput.value = "";
      renderObjectives();
    }
  });
  document.getElementById("objective-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-add-objective").click();
  });

  document.querySelectorAll(".commit-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setCommitMode(btn.dataset.mode));
  });
  document.getElementById("btn-apply-commit").addEventListener("click", applyCommit);

  document.getElementById("btn-prev-week").addEventListener("click", () => goToWeek(-7));
  document.getElementById("btn-next-week").addEventListener("click", () => goToWeek(7));
  document.getElementById("btn-email-week").addEventListener("click", emailWeek);
  document.getElementById("btn-carry-forward").addEventListener("click", carryWeekForward);
  document.getElementById("btn-email-today").addEventListener("click", emailToday);
  document.getElementById("btn-email-wasters").addEventListener("click", emailWasters);

  document.getElementById("btn-cancel-detail").addEventListener("click", closeDetailModal);
  document.getElementById("btn-save-detail").addEventListener("click", saveDetail);

  document.querySelectorAll(".range-btn").forEach((btn) => {
    btn.addEventListener("click", () => setInsightsRange(btn.dataset.range));
  });

  document.getElementById("btn-cancel-log-time").addEventListener("click", closeLogTimeModal);
  document.getElementById("btn-save-log-time").addEventListener("click", saveLogTime);
  document.getElementById("log-time-minutes").addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    document.getElementById("btn-save-log-time").disabled = !(val > 0);
  });
  document.getElementById("btn-log-time-freeform").addEventListener("click", openLogTimeModalFreeform);
  document.getElementById("log-time-type-select").addEventListener("change", populateLogTimeItemSelect);

  document.getElementById("btn-add-waster-habit").addEventListener("click", () => {
    const input = document.getElementById("waster-habit-input");
    if (addWaster("habits", input.value)) {
      input.value = "";
      renderWasterList("habits", "waster-habits-list");
    }
  });
  document.getElementById("waster-habit-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-add-waster-habit").click();
  });

  document.getElementById("btn-add-waster-filter").addEventListener("click", () => {
    const input = document.getElementById("waster-filter-input");
    if (addWaster("filters", input.value)) {
      input.value = "";
      renderWasterList("filters", "waster-filters-list");
    }
  });
  document.getElementById("waster-filter-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("btn-add-waster-filter").click();
  });

  // close modals on overlay background click (not when clicking the modal itself)
  [
    ["picker-overlay", closePicker],
    ["reason-overlay", closeReasonModal],
    ["manage-overlay", () => document.getElementById("manage-overlay").classList.remove("open")],
    ["detail-overlay", closeDetailModal],
    ["log-time-overlay", closeLogTimeModal],
  ].forEach(([id, closeFn]) => {
    document.getElementById(id).addEventListener("click", (e) => {
      if (e.target.id === id) closeFn();
    });
  });
}

/* ---------------------------------------------------------- */
/* Go                                                              */
/* ---------------------------------------------------------- */

function init() {
  wireUI();
  boot();
  renderDo();
  handleContentIdeaDeepLink();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

/* ---------------------------------------------------------- */
/* Note: no separate service worker registration here -- this  */
/* file now runs as part of the merged Mission Control app,    */
/* which registers its own single service worker (mc-sw.js).   */
/* ---------------------------------------------------------- */
