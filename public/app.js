"use strict";

const API = "/api";
const ACCEPTED = [".pdf", ".docx", ".txt"];
const MAX_FILES = 100;
const MAX_BYTES = 50 * 1024 * 1024;
const CATEGORIES = [
  { key: "ai_project_depth", label: "AI / agentic depth", max: 40, color: "var(--cat-1)" },
  { key: "python_backend", label: "Python & backend", max: 30, color: "var(--cat-2)" },
  { key: "cloud_fullstack", label: "Cloud / full stack", max: 15, color: "var(--cat-3)" },
  { key: "github", label: "GitHub activity", max: 10, color: "var(--cat-4)" },
  { key: "engineering_depth", label: "Engineering depth", max: 5, color: "var(--cat-5)" },
];
const GITHUB_BADGES = {
  ok: ["Enriched", "badge-good"],
  no_profile: ["No profile", ""],
  not_found: ["Not found", "badge-warn"],
  rate_limited: ["Rate-limited", "badge-warn"],
  error: ["Error", "badge-bad"],
};

const state = { files: [], report: null, source: "", tab: "ranked", query: "", controller: null };
const $ = (id) => document.getElementById(id);

/** Builds DOM nodes; text is always set via textContent, never parsed as HTML. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "style") Object.assign(node.style, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const fmt = (n) => (Math.round(n * 10) / 10).toString();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    return null;
  }
}

/* ---------------- theme ---------------- */
function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
applyTheme(storage("theme"));
$("theme-toggle").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  applyTheme(next);
  storage("theme", next);
});

/* ---------------- backend status ---------------- */
async function checkBackend() {
  const pill = $("backend-status");
  try {
    const res = await fetch(`${API}/openapi.json`, { cache: "no-store" });
    const online = res.ok;
    pill.className = `pill ${online ? "pill-online" : "pill-offline"}`;
    pill.querySelector(".pill-text").textContent = online ? "Backend online" : "Backend offline";
    return online;
  } catch {
    pill.className = "pill pill-offline";
    pill.querySelector(".pill-text").textContent = "Backend offline";
    return false;
  }
}
checkBackend();
setInterval(checkBackend, 15000);

/* ---------------- file selection ---------------- */
function addFiles(fileList) {
  const skipped = [];
  for (const file of fileList) {
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!ACCEPTED.includes(ext)) { skipped.push(file.name); continue; }
    if (state.files.some((f) => f.name === file.name && f.size === file.size)) continue;
    state.files.push(file);
  }
  if (state.files.length > MAX_FILES) state.files = state.files.slice(0, MAX_FILES);
  renderFiles();
  setStatus(skipped.length ? `Skipped unsupported: ${skipped.join(", ")}` : "", Boolean(skipped.length));
}

function renderFiles() {
  const list = $("file-list");
  list.replaceChildren(...state.files.map((file, i) =>
    el("li", { class: "file-chip", title: file.name },
      el("span", { text: file.name }),
      el("button", {
        type: "button", "aria-label": `Remove ${file.name}`, text: "✕",
        onclick: () => { state.files.splice(i, 1); renderFiles(); },
      }))));
  const total = state.files.reduce((sum, f) => sum + f.size, 0);
  const tooBig = total > MAX_BYTES;
  $("screen-btn").disabled = !state.files.length || tooBig || Boolean(state.controller);
  $("screen-btn").textContent = state.files.length ? `Screen ${plural(state.files.length, "resume")}` : "Screen resumes";
  if (tooBig) setStatus("Selected files exceed 50 MB. Remove some to continue.", true);
}

const dropzone = $("dropzone");
$("file-input").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
["dragenter", "dragover"].forEach((type) => dropzone.addEventListener(type, (e) => {
  e.preventDefault(); dropzone.classList.add("dragover");
}));
["dragleave", "drop"].forEach((type) => dropzone.addEventListener(type, (e) => {
  e.preventDefault(); dropzone.classList.remove("dragover");
}));
dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

function setStatus(message, isError = false, busy = false) {
  const status = $("run-status");
  status.className = `run-status${isError ? " error" : ""}`;
  status.replaceChildren(...(busy ? [el("span", { class: "spinner", "aria-hidden": "true" })] : []), message);
}

/* ---------------- screening ---------------- */
$("screen-btn").addEventListener("click", async () => {
  if (!(await checkBackend())) {
    setStatus("Backend is not reachable. Start it, then run `python serve.py` (see README).", true);
    return;
  }
  const form = new FormData();
  state.files.forEach((file) => form.append("files", file, file.name));
  state.controller = new AbortController();
  $("cancel-btn").hidden = false;
  renderFiles();
  const started = performance.now();
  const timer = setInterval(() => {
    setStatus(`Screening ${plural(state.files.length, "resume")}… ${Math.round((performance.now() - started) / 1000)}s`, false, true);
  }, 500);
  setStatus(`Screening ${plural(state.files.length, "resume")}…`, false, true);
  try {
    const res = await fetch(`${API}/screen`, { method: "POST", body: form, signal: state.controller.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorMessage(body, res.status));
    showReport(body, `Live run · ${new Date().toLocaleString()}`);
    setStatus(`Done in ${fmt((performance.now() - started) / 1000)}s.`);
  } catch (err) {
    setStatus(err.name === "AbortError" ? "Cancelled." : `Screening failed: ${err.message}`, err.name !== "AbortError");
  } finally {
    clearInterval(timer);
    state.controller = null;
    $("cancel-btn").hidden = true;
    renderFiles();
  }
});
$("cancel-btn").addEventListener("click", () => state.controller?.abort());

function errorMessage(body, status) {
  if (typeof body.detail === "string") return body.detail;
  if (Array.isArray(body.detail)) return body.detail.map((d) => d.msg).join("; ");
  return `HTTP ${status}`;
}

$("demo-btn").addEventListener("click", async () => {
  try {
    const res = await fetch("demo/sample-results.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showReport(await res.json(), "Demo · 51 synthetic resumes with fictional candidates");
    setStatus("");
  } catch (err) {
    setStatus(`Could not load demo: ${err.message}`, true);
  }
});

$("json-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    showReport(JSON.parse(await file.text()), `File · ${file.name}`);
    setStatus("");
  } catch (err) {
    setStatus(`Not a valid results file: ${err.message}`, true);
  }
});

$("export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: "application/json" });
  const link = el("a", { href: URL.createObjectURL(blob), download: "results.json" });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

/* ---------------- results ---------------- */
function showReport(report, source) {
  if (!report || !report.summary || !Array.isArray(report.ranked)) throw new Error("missing summary/ranked");
  report.rejected ??= [];
  report.failed ??= [];
  state.report = report;
  state.source = source;
  $("results").hidden = false;
  $("results-source").textContent = source;
  renderTiles();
  renderTable();
  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderTiles() {
  const s = state.report.summary;
  const tiles = [
    [s.total_files, "Files"], [s.parsed, "Parsed"], [s.eligible, "Eligible"], [s.rejected, "Rejected"],
    [s.failed + (s.duplicates || 0), "Failed / duplicate"], [s.github_enriched, "GitHub enriched"],
    [`${fmt(s.duration_s)}s`, "Run time"],
  ];
  $("tiles").replaceChildren(...tiles.map(([value, label]) =>
    el("div", { class: "tile" }, el("div", { class: "value", text: value }), el("div", { class: "label", text: label }))));
  $("count-ranked").textContent = state.report.ranked.length;
  $("count-rejected").textContent = state.report.rejected.length;
  $("count-failed").textContent = state.report.failed.length;
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  state.tab = tab.dataset.tab;
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
  renderTable();
}));
$("search").addEventListener("input", (e) => { state.query = e.target.value.trim().toLowerCase(); renderTable(); });

function matches(...fields) {
  if (!state.query) return true;
  return fields.flat().filter(Boolean).join(" ").toLowerCase().includes(state.query);
}

function renderTable() {
  const table = $("table");
  const { ranked, rejected, failed } = state.report;
  $("legend").hidden = state.tab !== "ranked";
  $("legend").replaceChildren(...CATEGORIES.map((c) =>
    el("span", {}, el("i", { class: "swatch", style: { background: c.color } }), `${c.label} (${c.max})`)),
    el("span", {}, el("i", { class: "swatch seg-penalty" }), "Penalty"));

  let head;
  let rows;
  if (state.tab === "ranked") {
    head = [["#"], ["Candidate"], ["Score breakdown"], ["Total", "num"], ["GitHub", "col-hide-sm"]];
    rows = ranked.filter((c) => matches(c.candidate_name, c.file, c.matched_skills, c.project_summary))
      .map((c) => el("tr", { class: "clickable", tabindex: "0", onclick: () => openRanked(c), onkeydown: enterOpens(() => openRanked(c)) },
        el("td", { class: "rank", text: c.rank }),
        el("td", {}, el("span", { class: "name", text: c.candidate_name }), el("span", { class: "sub", text: c.file })),
        el("td", {}, scoreBar(c.score_breakdown)),
        el("td", { class: "num total", text: fmt(c.total_score) }),
        el("td", { class: "col-hide-sm" }, githubBadge(c.github_status))));
  } else if (state.tab === "rejected") {
    head = [["Candidate"], ["Why rejected"], ["Matched skills", "col-hide-sm"]];
    rows = rejected.filter((c) => matches(c.candidate_name, c.file, c.rejection_reasons, c.matched_skills))
      .map((c) => el("tr", { class: "clickable", tabindex: "0", onclick: () => openRejected(c), onkeydown: enterOpens(() => openRejected(c)) },
        el("td", {}, el("span", { class: "name", text: c.candidate_name }), el("span", { class: "sub", text: c.file })),
        el("td", {}, el("ul", { class: "reasons" }, c.rejection_reasons.map((r) => el("li", { text: r })))),
        el("td", { class: "col-hide-sm" }, chips(c.matched_skills.slice(0, 8)))));
  } else {
    head = [["File"], ["Status"], ["Reason"]];
    rows = failed.filter((f) => matches(f.file, f.error, f.status))
      .map((f) => el("tr", {},
        el("td", { class: "name", text: f.file }),
        el("td", {}, el("span", { class: `badge ${f.status === "failed" ? "badge-bad" : "badge-warn"}`, text: f.status })),
        el("td", { class: "muted", text: f.error })));
  }
  table.replaceChildren(
    el("thead", {}, el("tr", {}, head.map(([label, cls]) => el("th", { class: cls, text: label })))),
    el("tbody", {}, rows));
  $("empty").hidden = rows.length > 0;
}

const enterOpens = (open) => (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };

function scoreBar(breakdown) {
  const segments = CATEGORIES.filter((c) => breakdown[c.key] > 0).map((c) =>
    el("span", {
      class: "seg", style: { width: `${breakdown[c.key]}%`, background: c.color },
      "data-tip": `${c.label}: ${fmt(breakdown[c.key])} / ${c.max}`,
    }));
  if (breakdown.penalties < 0) {
    segments.push(el("span", {
      class: "seg seg-penalty", style: { width: `${-breakdown.penalties}%` },
      "data-tip": `Penalty: ${fmt(breakdown.penalties)}`,
    }));
  }
  return el("div", { class: "bar", role: "img", "aria-label": CATEGORIES.map((c) => `${c.label} ${fmt(breakdown[c.key])}`).join(", ") }, segments);
}

function githubBadge(status) {
  const [label, cls] = GITHUB_BADGES[status] || [status, ""];
  return el("span", { class: `badge ${cls}`, text: label });
}

const chips = (items) => el("div", { class: "chips" }, items.map((s) => el("span", { class: "chip", text: s })));
const list = (items, cls = "list") => items.length ? el("ul", { class: cls }, items.map((i) => el("li", { text: i }))) : el("p", { class: "muted small", text: "None" });

/* tooltip for bar segments */
const tooltip = $("tooltip");
document.addEventListener("mouseover", (e) => {
  const tip = e.target.closest("[data-tip]");
  if (!tip) { tooltip.hidden = true; return; }
  tooltip.textContent = tip.dataset.tip;
  tooltip.hidden = false;
});
document.addEventListener("mousemove", (e) => {
  if (tooltip.hidden) return;
  tooltip.style.left = `${Math.min(e.clientX + 12, innerWidth - tooltip.offsetWidth - 8)}px`;
  tooltip.style.top = `${e.clientY + 14}px`;
});

/* ---------------- detail drawer ---------------- */
let lastFocus = null;

function openDrawer(kicker, title, sub, body) {
  lastFocus = document.activeElement;
  $("drawer-kicker").textContent = kicker;
  $("drawer-title").textContent = title;
  $("drawer-sub").textContent = sub;
  $("drawer-body").replaceChildren(...body);
  $("drawer-backdrop").hidden = false;
  const drawer = $("drawer");
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  drawer.focus();
}

function closeDrawer() {
  $("drawer").classList.remove("open");
  $("drawer").setAttribute("aria-hidden", "true");
  $("drawer-backdrop").hidden = true;
  lastFocus?.focus();
}
$("drawer-close").addEventListener("click", closeDrawer);
$("drawer-backdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("drawer").classList.contains("open")) closeDrawer(); });

function section(title, ...content) {
  return el("section", {}, el("h3", { text: title }), ...content);
}

function openRanked(c) {
  const b = c.score_breakdown;
  const ev = c.score_evidence || {};
  const categories = CATEGORIES.map((cat) => el("div", { class: "cat" },
    el("div", { class: "cat-head" }, el("span", { text: cat.label }), el("span", { class: "num", text: `${fmt(b[cat.key])} / ${cat.max}` })),
    el("div", { class: "cat-meter" }, el("span", { style: { width: `${(100 * b[cat.key]) / cat.max}%`, background: cat.color } })),
    list(ev[cat.key] || [])));
  const body = [
    el("div", { class: "summary-box", text: c.project_summary }),
    section("Score breakdown", el("div", { style: { display: "grid", gap: "8px" } }, categories)),
  ];
  if ((ev.penalties || []).length) body.push(section(`Penalties & caps (${fmt(b.penalties)})`, list(ev.penalties)));
  body.push(
    el("div", { class: "two-col" }, section("Strengths", list(c.strengths)), section("Concerns", list(c.concerns))),
    section("GitHub",
      githubBadge(c.github_status), " ",
      c.github_url && c.github_status === "ok" ? el("a", { href: c.github_url, target: "_blank", rel: "noopener noreferrer", text: c.github_url.replace("https://", "") }) : null,
      el("p", { class: "muted small", text: c.github_summary })),
    section("Resume evidence", ...(c.evidence.length ? c.evidence.map((q) => el("p", { class: "quote", text: q })) : [el("p", { class: "muted small", text: "None" })])),
    section("Projects", chips(c.projects || [])),
    section("Matched skills", chips(c.matched_skills)),
    el("p", { class: "muted small", text: `LLM review: ${c.llm_status}` }),
  );
  openDrawer(`Rank #${c.rank} · ${fmt(c.total_score)} / 100`, c.candidate_name, [c.file, c.email].filter(Boolean).join(" · "), body);
}

function openRejected(c) {
  openDrawer("Rejected", c.candidate_name, [c.file, c.email].filter(Boolean).join(" · "), [
    section("Rejection reasons", list(c.rejection_reasons)),
    section("Evidence the rules looked at", list(c.evidence)),
    section("Matched skills", chips(c.matched_skills)),
  ]);
}
