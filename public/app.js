import { activitiesForBiennium, availableBienniums, bienniumStartForYear } from "./biennium.js";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
let state = null;
let toastTimer = null;
let adminUsers = null;

const routes = ["home", "activities", "reflections", "audit", "admin", "settings"];
const currentRoute = () => routes.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
const titleCase = (value) => value.charAt(0).toUpperCase() + value.slice(1);
const formatDate = (value) => new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
const formatBytes = (bytes) => bytes === 0 ? "0 B" : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const today = () => new Date().toISOString().slice(0, 10);
const activeActivities = () => activitiesForBiennium(state.activities, state.settings.bienniumStart);
const currentBienniumStart = () => bienniumStartForYear(new Date().getFullYear());
const viewingCurrentBiennium = () => Number(state.settings.bienniumStart) === currentBienniumStart();

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const contentType = response.headers.get("content-type") || "";
  const result = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/api/auth/")) renderLogin("Your session ended. Enter your password to continue.");
    const error = new Error(result.error || result || "Something went wrong");
    error.status = response.status;
    throw error;
  }
  return result;
}

function notify(message, kind = "success") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast visible ${kind}`;
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 3200);
}

async function refresh(message) {
  state = await api("/api/state");
  if (location.hash === "#admin" && state.user.role !== "admin") history.replaceState(null, "", "#home");
  render();
  if (currentRoute() === "admin" && state.user.role === "admin") await loadAdminUsers();
  if (message) notify(message);
}

function renderLogin(message = "") {
  state = null;
  app.innerHTML = `<main class="login-page"><section class="login-card">
    <span class="login-mark" aria-hidden="true">M</span>
    <p class="eyebrow">Private CPD record</p>
    <h1>Welcome back.</h1>
    <p class="login-copy">Enter your CPD Manager password to open your activities, evidence and audit workspace.</p>
    ${message ? `<p class="login-message">${escapeHtml(message)}</p>` : ""}
    <form id="login-form">
      <label>Username<input name="username" required autocomplete="username" autofocus /></label>
      <label>Password<input type="password" name="password" required minlength="12" autocomplete="current-password" /></label>
      <button class="primary-action plain" type="submit">Unlock CPD Manager</button>
    </form>
  </section></main>`;
}

function renderPasswordChange(user) {
  state = null;
  app.innerHTML = `<main class="login-page"><section class="login-card">
    <span class="login-mark" aria-hidden="true">M</span>
    <p class="eyebrow">Welcome, ${escapeHtml(user.displayName)}</p>
    <h1>Choose your password.</h1>
    <p class="login-copy">Your temporary password worked. Replace it before opening your CPD record.</p>
    <form id="forced-password-form">
      <label>New password<input type="password" name="newPassword" required minlength="12" autocomplete="new-password" autofocus /></label>
      <label>Confirm password<input type="password" name="confirmPassword" required minlength="12" autocomplete="new-password" /></label>
      <button class="primary-action plain" type="submit">Save password and continue</button>
    </form>
  </section></main>`;
}

function shell(content) {
  const route = currentRoute();
  const start = state.settings.bienniumStart;
  const bienniums = availableBienniums(state.activities, start);
  return `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="#home" aria-label="MIT CPD Manager home">
          <span class="brand-mark" aria-hidden="true">M</span>
          <span><strong>CPD Manager</strong><small>${escapeHtml(state.user.displayName)} · @${escapeHtml(state.user.username)}</small></span>
        </a>
        <div class="topbar-actions">
          <div class="biennium-picker">
            <button class="cycle-pill" data-action="toggle-biennium" type="button" aria-haspopup="listbox" aria-expanded="false">${start}—${start + 1}<span aria-hidden="true">⌄</span></button>
            <div class="biennium-menu" data-biennium-menu role="listbox" aria-label="View biennium" hidden>
              <p>View biennium</p>
              ${bienniums.map((year) => `<button class="${year === Number(start) ? "selected" : ""}" data-action="select-biennium" data-start="${year}" type="button" role="option" aria-selected="${year === Number(start)}"><span>${year}—${year + 1}</span>${year === currentBienniumStart() ? "<small>Current</small>" : ""}</button>`).join("")}
            </div>
          </div>
          <button class="lock-button" data-action="logout" type="button">Lock</button>
        </div>
      </header>
      <main>${viewingCurrentBiennium() ? "" : `<div class="past-biennium-notice"><span>Viewing past biennium</span><strong>${start}—${start + 1}</strong><button data-action="select-biennium" data-start="${currentBienniumStart()}" type="button">Return to current</button></div>`}${content}</main>
      <nav class="bottom-nav" aria-label="Primary navigation">
        ${[
          ["home", "●", "Home"], ["activities", "□", "Activities"], ["reflections", "◇", "Reflections"], ["audit", "✓", "Audit"], ...(state.user.role === "admin" ? [["admin", "♙", "Users"]] : []), ["settings", "⋯", "Settings"]
        ].map(([id, symbol, label]) => `<a class="${route === id ? "active" : ""}" href="#${id}"><span aria-hidden="true">${symbol}</span>${label}</a>`).join("")}
      </nav>
    </div>`;
}

function homeView() {
  const { audit, requirements } = state;
  const percent = Math.min(100, Math.round((audit.totals.total / requirements.totalHours) * 100));
  const recent = activeActivities().slice(0, 3);
  return `
    <section class="welcome-grid" aria-labelledby="page-title">
      <div>
        <p class="eyebrow">Your ${viewingCurrentBiennium() ? "current" : "selected"} biennium</p>
        <h1 id="page-title">Keep the record now.<br />Build the audit later.</h1>
        <p class="intro">A quiet place for CPD activities, evidence and reflections—kept on your own server.</p>
        <button class="primary-action" data-action="new-activity" type="button">Log an activity <span aria-hidden="true">＋</span></button>
      </div>
      <article class="progress-card">
        <div class="progress-ring" style="--progress:${percent * 3.6}deg" aria-label="${audit.totals.total} of ${requirements.totalHours} CPD hours complete"><span>${audit.totals.total}<small>/ ${requirements.totalHours} hrs</small></span></div>
        <div><p class="card-label">Overall progress</p><h2>${percent ? `${percent}% recorded` : "Ready for your first entry"}</h2><p>${audit.ready ? "Your selected audit package passes every current readiness check." : "Substantive, general and annual totals stay visible here."}</p></div>
      </article>
    </section>
    <section class="status-grid" aria-label="CPD status summary">
      <article><span class="status-dot teal"></span><p>Substantive</p><strong>${audit.totals.substantive} / ${requirements.minimumSubstantiveHours} hours</strong></article>
      <article><span class="status-dot ochre"></span><p>Evidence selected</p><strong>${audit.selectedEvidence.length} / ${requirements.evidenceFiles} files</strong></article>
      <article><span class="status-dot coral"></span><p>Reflections ready</p><strong>${audit.selectedReflections.length} / 4 statements</strong></article>
    </section>
    ${recent.length ? `
      <section class="section-block"><div class="section-heading"><div><p class="eyebrow">Recent work</p><h2>Latest activities</h2></div><a class="text-link" href="#activities">View all</a></div>
        <div class="activity-list compact">${recent.map(activityCard).join("")}</div>
      </section>` : emptyActivities()}
    ${activityDialog()}`;
}

function emptyActivities() {
  const start = Number(state.settings.bienniumStart);
  return `<section class="empty-state"><div class="empty-date cycle" aria-hidden="true"><span>CPD</span><strong>${String(start).slice(-2)}</strong></div><div><p class="eyebrow">Activity log</p><h2>No activities in ${start}—${start + 1}</h2><p>Add an activity for this period or use the selector beside Lock to view another biennium.</p></div><button class="secondary-action" data-action="new-activity" type="button">Add activity</button></section>`;
}

function activitiesView() {
  const activities = activeActivities();
  return `
    <section class="page-heading"><div><p class="eyebrow">Continuous record</p><h1>Activities</h1><p>Capture enough detail now that the logbook makes sense years later.</p></div><button class="primary-action" data-action="new-activity" type="button">New activity <span aria-hidden="true">＋</span></button></section>
    ${activities.length ? `<div class="activity-list">${activities.map(activityCard).join("")}</div>` : emptyActivities()}
    ${activityDialog()}`;
}

function activityCard(activity) {
  return `<article class="activity-card">
    <div class="activity-date"><span>${new Date(`${activity.activityDate}T12:00:00`).toLocaleString("en-NZ", { month: "short" }).toUpperCase()}</span><strong>${activity.activityDate.slice(8, 10)}</strong><small>${activity.activityYear}</small></div>
    <div class="activity-main">
      <div class="activity-title-row"><div><span class="type-pill ${activity.type}">${titleCase(activity.type)}</span><h3>${escapeHtml(activity.name)}</h3></div><strong class="hours">${activity.hours} h</strong></div>
      <p class="activity-meta">${escapeHtml(activity.provider || "Provider not recorded")}${activity.location ? ` · ${escapeHtml(activity.location)}` : ""}</p>
      ${activity.summary ? `<p class="activity-summary">${escapeHtml(activity.summary)}</p>` : ""}
      <div class="file-chips">${activity.attachments.map((file) => `<a href="/api/attachments/${file.id}/download">${escapeHtml(file.originalName)} <small>${formatBytes(file.sizeBytes)}</small></a>`).join("")}</div>
      <div class="activity-actions">
        <form class="inline-upload" data-activity-id="${activity.id}"><label class="small-button">Attach evidence<input type="file" name="file" required /></label></form>
        <button class="small-button ghost" data-action="edit-activity" data-id="${activity.id}" type="button">Edit</button>
        <button class="small-button danger" data-action="delete-activity" data-id="${activity.id}" type="button">Delete</button>
      </div>
    </div>
  </article>`;
}

function activityDialog() {
  const start = Number(state.settings.bienniumStart);
  return `<dialog id="activity-dialog" class="editor-dialog"><form id="activity-form" method="dialog">
    <div class="dialog-heading"><div><p class="eyebrow">CPD logbook</p><h2 data-dialog-title>Log an activity</h2></div><button class="icon-button" data-action="close-dialog" type="button" aria-label="Close">×</button></div>
    <input type="hidden" name="recordId" />
    <div class="form-grid two"><label>Date<input type="date" name="activityDate" min="${start}-01-01" max="${start + 1}-12-31" required /></label><label>Hours<input type="number" name="hours" min="0.25" step="0.25" required /></label></div>
    <label>Activity name<input name="name" maxlength="180" required placeholder="e.g. CT dose optimisation workshop" /></label>
    <div class="form-grid two"><label>Source or provider<input name="provider" maxlength="180" placeholder="Provider, journal or facilitator" /></label><label>Location<input name="location" maxlength="140" placeholder="Online, workplace, venue…" /></label></div>
    <fieldset><legend>CPD type</legend><div class="segmented"><label><input type="radio" name="type" value="substantive" checked /><span>Substantive</span></label><label><input type="radio" name="type" value="general" /><span>General</span></label></div></fieldset>
    <label>Short summary <span class="optional">Optional</span><textarea name="summary" rows="3" placeholder="What was the activity about?"></textarea></label>
    <label>Evidence file <span class="optional">Optional — originals are preserved</span><input type="file" name="evidence" /></label>
    <div class="dialog-actions"><button class="secondary-action" data-action="close-dialog" type="button">Cancel</button><button class="primary-action plain" type="submit">Save activity</button></div>
  </form></dialog>`;
}

function reflectionsView() {
  const activities = activeActivities();
  const reflections = activities.flatMap((activity) => activity.reflections.map((item) => ({ ...item, activity })));
  return `
    <section class="page-heading"><div><p class="eyebrow">Practice, considered</p><h1>Reflections</h1><p>Write against the questions MRTB actually asks, then choose one statement for each audit slot.</p></div><button class="primary-action" data-action="new-reflection" type="button" ${activities.length ? "" : "disabled"}>New reflection <span aria-hidden="true">＋</span></button></section>
    <section class="reflection-slots">${state.requirements.reflectionCategories.map((category) => {
      const selected = reflections.find((item) => item.category === category && item.auditSelected);
      return `<article class="${selected ? "complete" : ""}"><span class="check-mark">${selected ? "✓" : ""}</span><p>${escapeHtml(state.reflectionLabels[category])}</p><strong>${selected ? escapeHtml(selected.activity.name) : "Not selected"}</strong></article>`;
    }).join("")}</section>
    ${reflections.length ? `<div class="reflection-list">${reflections.map(reflectionCard).join("")}</div>` : `<section class="empty-panel"><h2>No reflective statements yet</h2><p>Link a reflection to an activity and answer the three required questions. Your words remain editable until export.</p></section>`}
    ${reflectionDialog()}`;
}

function reflectionCard(item) {
  return `<article class="reflection-card ${item.auditSelected ? "selected" : ""}">
    <div class="reflection-top"><div><span class="type-pill reflection">${escapeHtml(state.reflectionLabels[item.category])}</span><h3>${escapeHtml(item.activity.name)}</h3><p>${formatDate(item.activity.activityDate)}</p></div><span class="selection-state">${item.auditSelected ? "Selected for audit" : "Draft / alternate"}</span></div>
    <blockquote>${escapeHtml(item.learned)}</blockquote>
    <div class="activity-actions"><button class="small-button" data-action="select-reflection" data-id="${item.id}" type="button">${item.auditSelected ? "Selected" : "Use for audit"}</button><a class="small-button ghost" href="/api/audit/reflections/${item.id}.docx">Download</a><button class="small-button ghost" data-action="edit-reflection" data-id="${item.id}" type="button">Edit</button><button class="small-button danger" data-action="delete-reflection" data-id="${item.id}" type="button">Delete</button></div>
  </article>`;
}

function reflectionDialog() {
  const activities = activeActivities();
  return `<dialog id="reflection-dialog" class="editor-dialog"><form id="reflection-form" method="dialog">
    <div class="dialog-heading"><div><p class="eyebrow">Reflective statement</p><h2 data-dialog-title>New reflection</h2></div><button class="icon-button" data-action="close-dialog" type="button" aria-label="Close">×</button></div>
    <input type="hidden" name="recordId" />
    <label>Linked CPD activity<select name="activityId" required><option value="">Choose an activity</option>${activities.map((activity) => `<option value="${activity.id}">${escapeHtml(activity.name)} — ${formatDate(activity.activityDate)}</option>`).join("")}</select></label>
    <label>Audit category<select name="category" required>${state.requirements.reflectionCategories.map((category) => `<option value="${category}">${escapeHtml(state.reflectionLabels[category])}</option>`).join("")}</select></label>
    <label>What did I do?<textarea name="did" rows="3" required></textarea></label>
    <label>What did I learn?<textarea name="learned" rows="4" required></textarea></label>
    <label>How did this affect my practice?<textarea name="impact" rows="4" required></textarea></label>
    <label>What further learning could I undertake? <span class="optional">Optional</span><textarea name="furtherLearning" rows="3"></textarea></label>
    <label class="check-row"><input type="checkbox" name="auditSelected" /> Select this statement for its audit slot</label>
    <div class="dialog-actions"><button class="secondary-action" data-action="close-dialog" type="button">Cancel</button><button class="primary-action plain" type="submit">Save reflection</button></div>
  </form></dialog>`;
}

const checkLabels = {
  profile: "Name and registration number recorded",
  totalHours: "40 total CPD hours",
  substantiveHours: "At least 25 substantive hours",
  generalHours: "No more than 15 general hours",
  annualHours: "At least 15 hours in each year",
  evidenceCount: "Exactly six evidence files selected",
  substantiveEvidence: "At least four selected files are substantive",
  evidenceAcrossYears: "Selected evidence covers both years",
  evidenceIdentity: "Every selected file confirmed as named and dated",
  reflections: "One reflection selected for each of four slots",
  peerDeclaration: "Peer or manager declaration attached"
};

function auditView() {
  const { audit } = state;
  return `
    <section class="page-heading audit-heading"><div><p class="eyebrow">Submission workspace</p><h1>Audit pack</h1><p>Select what you will submit. The app keeps the portal’s individual upload slots intact.</p></div><div class="readiness ${audit.ready ? "ready" : ""}"><span>${audit.ready ? "✓" : Object.values(audit.checks).filter(Boolean).length}</span><div><small>${audit.ready ? "Ready" : "Checks passed"}</small><strong>${audit.ready ? "Package complete" : `${Object.values(audit.checks).filter(Boolean).length} of ${Object.keys(audit.checks).length}`}</strong></div></div></section>
    <section class="audit-layout">
      <div class="audit-main">
        <section class="audit-section"><div class="section-heading"><div><p class="eyebrow">1 · Logbook</p><h2>Generated from your activities</h2></div><a class="small-button" href="/api/audit/logbook.docx">Download logbook</a></div><p class="section-copy">The exported Word file follows the current MRTB column structure and includes your substantive/general totals.</p></section>
        <section class="audit-section"><div class="section-heading"><div><p class="eyebrow">2 · Peer declaration</p><h2>${state.peerDeclaration ? escapeHtml(state.peerDeclaration.originalName) : "Attach the signed form"}</h2></div>${state.peerDeclaration ? `<a class="small-button ghost" href="/api/attachments/${state.peerDeclaration.id}/download">Download</a>` : ""}</div>
          <form id="peer-upload" class="upload-well"><label><strong>${state.peerDeclaration ? "Replace declaration" : "Choose completed declaration"}</strong><span>PDF or Word, up to 25 MB</span><input type="file" name="file" required /></label></form>
        </section>
        <section class="audit-section"><div class="section-heading"><div><p class="eyebrow">3 · Evidence</p><h2>Choose six individual files</h2></div><span class="count-pill">${audit.selectedEvidence.length} / ${state.requirements.evidenceFiles}</span></div>
          ${audit.evidence.length ? `<div class="evidence-list">${audit.evidence.map(evidenceRow).join("")}</div>` : `<p class="section-copy">Attach evidence to activities first. Every original file remains unchanged.</p>`}
        </section>
        <section class="audit-section"><div class="section-heading"><div><p class="eyebrow">4 · Reflective statements</p><h2>One file for each portal slot</h2></div><span class="count-pill">${audit.selectedReflections.length} / 4</span></div>
          <div class="download-list">${state.requirements.reflectionCategories.map((category) => {
            const options = activeActivities().flatMap((activity) => activity.reflections.map((reflection) => ({ ...reflection, activity }))).filter((item) => item.category === category);
            const selected = options.find((item) => item.auditSelected);
            return `<div><span class="check-mark">${selected ? "✓" : ""}</span><div><strong>${escapeHtml(state.reflectionLabels[category])}</strong><small>${selected ? escapeHtml(selected.activity.name) : "Choose on the Reflections page"}</small></div>${selected ? `<a class="small-button ghost" href="/api/audit/reflections/${selected.id}.docx">Download</a>` : `<a class="text-link" href="#reflections">Add</a>`}</div>`;
          }).join("")}</div>
        </section>
        <section class="pack-download ${audit.ready ? "ready" : ""}"><div><p class="eyebrow">Convenience copy</p><h2>${audit.ready ? "Your audit pack is ready" : "Download a working pack"}</h2><p>The ZIP is for safekeeping. Extract it and upload each file separately to MRTB.</p></div><a class="primary-action plain" href="/api/audit/pack.zip">Download ZIP</a></section>
      </div>
      <aside class="checklist"><p class="eyebrow">Readiness</p><h2>Current checks</h2>${Object.entries(audit.checks).map(([key, complete]) => `<div class="${complete ? "complete" : ""}"><span>${complete ? "✓" : ""}</span><p>${checkLabels[key]}</p></div>`).join("")}<a href="${state.requirements.sourceUrl}" target="_blank" rel="noreferrer">${escapeHtml(state.requirements.version)} ↗</a></aside>
    </section>`;
}

function evidenceRow(item) {
  return `<article class="evidence-row ${item.auditSelected ? "selected" : ""}">
    <label class="evidence-select"><input type="checkbox" data-action="patch-evidence" data-field="auditSelected" data-id="${item.id}" ${item.auditSelected ? "checked" : ""} /><span></span></label>
    <div class="evidence-name"><strong>${escapeHtml(item.originalName)}</strong><small>${escapeHtml(item.activityName)} · ${item.activityYear} · ${titleCase(item.activityType)}</small></div>
    <label class="mini-check"><input type="checkbox" data-action="patch-evidence" data-field="nameConfirmed" data-id="${item.id}" ${item.nameConfirmed ? "checked" : ""} /> Name visible</label>
    <label class="mini-check"><input type="checkbox" data-action="patch-evidence" data-field="dateConfirmed" data-id="${item.id}" ${item.dateConfirmed ? "checked" : ""} /> Date visible</label>
    <a class="icon-button small" href="/api/attachments/${item.id}/download" aria-label="Download ${escapeHtml(item.originalName)}">↓</a>
    <button class="icon-button small danger" data-action="delete-attachment" data-id="${item.id}" type="button" aria-label="Delete ${escapeHtml(item.originalName)}">×</button>
  </article>`;
}

function adminView() {
  if (state.user.role !== "admin") return `<section class="empty-panel"><h2>Administrator access required</h2></section>`;
  const users = adminUsers || [];
  const totals = users.reduce((result, user) => ({ activities: result.activities + user.activityCount, documents: result.documents + user.documentCount, storage: result.storage + user.storageBytes }), { activities: 0, documents: 0, storage: 0 });
  return `<section class="page-heading"><div><p class="eyebrow">Private administration</p><h1>Users</h1><p>Create accounts and monitor broad usage. CPD titles, reflections and files remain private to each user.</p></div><button class="primary-action" data-action="new-user" type="button">Add user <span aria-hidden="true">＋</span></button></section>
    ${adminUsers ? `<section class="admin-summary"><article><small>Accounts</small><strong>${users.length}</strong></article><article><small>Activities</small><strong>${totals.activities}</strong></article><article><small>Documents</small><strong>${totals.documents}</strong></article><article><small>Storage</small><strong>${formatBytes(totals.storage)}</strong></article></section>
    <div class="user-list">${users.map(userCard).join("")}</div>` : `<section class="empty-panel"><h2>Loading users…</h2></section>`}
    ${userDialog()}${resetPasswordDialog()}`;
}

function userCard(user) {
  const lastLogin = user.lastLoginAt ? new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(user.lastLoginAt)) : "Never";
  return `<article class="user-card ${user.status === "disabled" ? "disabled" : ""}">
    <div class="user-identity"><span>${escapeHtml(user.displayName.slice(0, 1).toUpperCase())}</span><div><h2>${escapeHtml(user.displayName)}</h2><p>@${escapeHtml(user.username)} · ${user.role === "admin" ? "Administrator" : user.status === "active" ? "Active" : "Disabled"}</p></div></div>
    <dl><div><dt>Last login</dt><dd>${escapeHtml(lastLogin)}</dd></div><div><dt>Activities</dt><dd>${user.activityCount}</dd></div><div><dt>Documents</dt><dd>${user.documentCount}</dd></div><div><dt>Reflections</dt><dd>${user.reflectionCount}</dd></div><div><dt>Storage</dt><dd>${formatBytes(user.storageBytes)}</dd></div></dl>
    <div class="user-actions">${user.id === state.user.id ? `<span class="account-you">Your account</span>` : `<button class="small-button ghost" data-action="reset-user-password" data-id="${user.id}" data-name="${escapeHtml(user.displayName)}" type="button">Reset password</button><button class="small-button ${user.status === "active" ? "danger" : ""}" data-action="set-user-status" data-id="${user.id}" data-status="${user.status === "active" ? "disabled" : "active"}" type="button">${user.status === "active" ? "Disable" : "Enable"}</button>`}</div>
  </article>`;
}

function userDialog() {
  return `<dialog id="user-dialog" class="editor-dialog"><form id="user-form" method="dialog">
    <div class="dialog-heading"><div><p class="eyebrow">Account management</p><h2>Create user</h2></div><button class="icon-button" data-action="close-dialog" type="button" aria-label="Close">×</button></div>
    <label>Display name<input name="displayName" maxlength="100" required autocomplete="off" /></label>
    <label>Username<input name="username" minlength="3" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,63}" required autocomplete="off" /><small>Letters, numbers, dots, dashes or underscores.</small></label>
    <label>Temporary password<input type="password" name="temporaryPassword" minlength="12" required autocomplete="new-password" /><small>The user must replace this on first login.</small></label>
    <div class="dialog-actions"><button class="secondary-action" data-action="close-dialog" type="button">Cancel</button><button class="primary-action plain" type="submit">Create user</button></div>
  </form></dialog>`;
}

function resetPasswordDialog() {
  return `<dialog id="reset-password-dialog" class="editor-dialog"><form id="reset-password-form" method="dialog">
    <div class="dialog-heading"><div><p class="eyebrow">Account recovery</p><h2>Reset password</h2><p data-reset-user-name></p></div><button class="icon-button" data-action="close-dialog" type="button" aria-label="Close">×</button></div>
    <input type="hidden" name="userId" />
    <label>New temporary password<input type="password" name="temporaryPassword" minlength="12" required autocomplete="new-password" /><small>All existing sessions will be signed out.</small></label>
    <div class="dialog-actions"><button class="secondary-action" data-action="close-dialog" type="button">Cancel</button><button class="primary-action plain" type="submit">Reset password</button></div>
  </form></dialog>`;
}

function settingsView() {
  return `<section class="page-heading"><div><p class="eyebrow">Personal setup</p><h1>Settings</h1><p>These details appear on your generated logbook and reflective statements.</p></div></section>
    <section class="settings-card"><form id="settings-form">
      <label>Full name<input name="fullName" required value="${escapeHtml(state.settings.fullName)}" autocomplete="name" /></label>
      <label>MRTB registration number<input name="registrationNumber" required value="${escapeHtml(state.settings.registrationNumber)}" /></label>
      <label>Selected biennium starts<input type="number" name="bienniumStart" min="2001" max="2099" step="2" required value="${state.settings.bienniumStart}" /><small>This is also controlled by the biennium selector beside Lock.</small></label>
      <button class="primary-action plain" type="submit">Save details</button>
    </form>
    <div class="settings-side"><div class="privacy-note"><span aria-hidden="true">⌂</span><div><strong>Private by account</strong><p>Your records and original files are separated from every other user and remain inside the mounted Docker data folder.</p></div></div><div class="backup-note"><p class="eyebrow">Portable backup</p><h2>Take everything with you</h2><p>Download your structured record and every untouched original file in one private archive.</p><a class="small-button" href="/api/backup.zip">Download my backup</a></div><form id="password-form" class="password-card"><p class="eyebrow">Account security</p><h2>Change password</h2><label>Current password<input type="password" name="currentPassword" required autocomplete="current-password" /></label><label>New password<input type="password" name="newPassword" required minlength="12" autocomplete="new-password" /></label><label>Confirm password<input type="password" name="confirmPassword" required minlength="12" autocomplete="new-password" /></label><button class="small-button" type="submit">Change password</button></form></div></section>`;
}

function render() {
  if (!state) return;
  const views = { home: homeView, activities: activitiesView, reflections: reflectionsView, audit: auditView, admin: adminView, settings: settingsView };
  app.innerHTML = shell(views[currentRoute()]());
}

async function loadAdminUsers() {
  if (!state || state.user.role !== "admin") return;
  adminUsers = (await api("/api/admin/users")).users;
  if (currentRoute() === "admin") render();
}

function findActivity(id) { return state.activities.find((activity) => activity.id === id); }
function findReflection(id) { return state.activities.flatMap((activity) => activity.reflections).find((reflection) => reflection.id === id); }

function openActivityDialog(id) {
  const dialog = document.querySelector("#activity-dialog");
  const form = dialog.querySelector("form");
  const activity = id ? findActivity(id) : null;
  form.reset();
  form.elements.recordId.value = activity?.id || "";
  form.elements.activityDate.value = activity?.activityDate || (viewingCurrentBiennium() ? today() : "");
  form.elements.name.value = activity?.name || "";
  form.elements.hours.value = activity?.hours || "";
  form.elements.provider.value = activity?.provider || "";
  form.elements.location.value = activity?.location || "";
  form.elements.summary.value = activity?.summary || "";
  form.elements.type.value = activity?.type || "substantive";
  dialog.querySelector("[data-dialog-title]").textContent = activity ? "Edit activity" : "Log an activity";
  dialog.showModal();
}

function openReflectionDialog(id) {
  const dialog = document.querySelector("#reflection-dialog");
  const form = dialog.querySelector("form");
  const reflection = id ? findReflection(id) : null;
  form.reset();
  form.elements.recordId.value = reflection?.id || "";
  form.elements.activityId.value = reflection?.activityId || "";
  form.elements.category.value = reflection?.category || "ethical";
  form.elements.did.value = reflection?.did || "";
  form.elements.learned.value = reflection?.learned || "";
  form.elements.impact.value = reflection?.impact || "";
  form.elements.furtherLearning.value = reflection?.furtherLearning || "";
  form.elements.auditSelected.checked = reflection?.auditSelected || false;
  dialog.querySelector("[data-dialog-title]").textContent = reflection ? "Edit reflection" : "New reflection";
  dialog.showModal();
}

app.addEventListener("click", async (event) => {
  const picker = document.querySelector(".biennium-picker");
  if (picker && !event.target.closest(".biennium-picker")) {
    picker.querySelector("[data-biennium-menu]").hidden = true;
    picker.querySelector("[data-action='toggle-biennium']").setAttribute("aria-expanded", "false");
  }
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const { action, id } = control.dataset;
  try {
    if (action === "toggle-biennium") {
      const menu = control.closest(".biennium-picker").querySelector("[data-biennium-menu]");
      menu.hidden = !menu.hidden;
      control.setAttribute("aria-expanded", String(!menu.hidden));
      if (!menu.hidden) menu.querySelector(".selected")?.focus();
    }
    if (action === "select-biennium") {
      const start = Number(control.dataset.start);
      await api("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ bienniumStart: start }) });
      await refresh(`Viewing ${start}—${start + 1}`);
    }
    if (action === "new-activity") openActivityDialog();
    if (action === "new-user") {
      const dialog = document.querySelector("#user-dialog");
      dialog.querySelector("form").reset();
      dialog.showModal();
    }
    if (action === "reset-user-password") {
      const dialog = document.querySelector("#reset-password-dialog");
      const form = dialog.querySelector("form");
      form.reset();
      form.elements.userId.value = id;
      dialog.querySelector("[data-reset-user-name]").textContent = `Set a temporary password for ${control.dataset.name}.`;
      dialog.showModal();
    }
    if (action === "set-user-status") {
      const verb = control.dataset.status === "disabled" ? "disable" : "enable";
      if (confirm(`${titleCase(verb)} this account?${verb === "disable" ? " They will be signed out immediately." : ""}`)) {
        await api(`/api/admin/users/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: control.dataset.status }) });
        await loadAdminUsers();
        notify(`User ${verb}d`);
      }
    }
    if (action === "edit-activity") openActivityDialog(id);
    if (action === "new-reflection") openReflectionDialog();
    if (action === "edit-reflection") openReflectionDialog(id);
    if (action === "close-dialog") control.closest("dialog").close();
    if (action === "logout") {
      await api("/api/auth/logout", { method: "POST" });
      renderLogin("CPD Manager is locked.");
    }
    if (action === "delete-activity" && confirm("Delete this activity, its evidence and linked reflections?")) {
      await api(`/api/activities/${id}`, { method: "DELETE" }); await refresh("Activity deleted");
    }
    if (action === "delete-reflection" && confirm("Delete this reflective statement?")) {
      await api(`/api/reflections/${id}`, { method: "DELETE" }); await refresh("Reflection deleted");
    }
    if (action === "select-reflection") {
      await api(`/api/reflections/${id}/select`, { method: "POST" }); await refresh("Audit reflection selected");
    }
    if (action === "delete-attachment" && confirm("Delete this evidence file? The original will be removed from the app.")) {
      await api(`/api/attachments/${id}`, { method: "DELETE" }); await refresh("Evidence deleted");
    }
  } catch (error) { notify(error.message, "error"); }
});

app.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const picker = document.querySelector(".biennium-picker");
  const menu = picker?.querySelector("[data-biennium-menu]");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  const button = picker.querySelector("[data-action='toggle-biennium']");
  button.setAttribute("aria-expanded", "false");
  button.focus();
});

app.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const formId = form.getAttribute("id");
  try {
    if (formId === "login-form") {
      const data = new FormData(form);
      const result = await api("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: data.get("username"), password: data.get("password") }) });
      if (result.user.mustChangePassword) renderPasswordChange(result.user);
      else await refresh("CPD Manager unlocked");
    }
    if (formId === "forced-password-form" || formId === "password-form") {
      const data = new FormData(form);
      if (data.get("newPassword") !== data.get("confirmPassword")) throw new Error("The new passwords do not match");
      await api("/api/auth/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: data.get("currentPassword") || "", newPassword: data.get("newPassword") }) });
      if (formId === "forced-password-form") await refresh("Password saved");
      else { form.reset(); notify("Password changed"); }
    }
    if (formId === "user-form") {
      const data = new FormData(form);
      await api("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(data)) });
      form.closest("dialog").close();
      await loadAdminUsers();
      notify("User created");
    }
    if (formId === "reset-password-form") {
      const data = new FormData(form);
      await api(`/api/admin/users/${data.get("userId")}/reset-password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ temporaryPassword: data.get("temporaryPassword") }) });
      form.closest("dialog").close();
      await loadAdminUsers();
      notify("Temporary password set");
    }
    if (formId === "activity-form") {
      const data = new FormData(form);
      const id = data.get("recordId");
      const payload = Object.fromEntries(["activityDate", "name", "hours", "provider", "location", "type", "summary"].map((key) => [key, data.get(key)]));
      const activity = await api(id ? `/api/activities/${id}` : "/api/activities", { method: id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const evidence = data.get("evidence");
      if (evidence?.size) { const upload = new FormData(); upload.append("file", evidence); await api(`/api/activities/${activity.id}/attachments`, { method: "POST", body: upload }); }
      form.closest("dialog").close(); await refresh(id ? "Activity updated" : "Activity logged");
    }
    if (formId === "reflection-form") {
      const data = new FormData(form); const id = data.get("recordId");
      const payload = Object.fromEntries(["activityId", "category", "did", "learned", "impact", "furtherLearning"].map((key) => [key, data.get(key)]));
      payload.auditSelected = data.get("auditSelected") === "on";
      await api(id ? `/api/reflections/${id}` : "/api/reflections", { method: id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      form.closest("dialog").close(); await refresh(id ? "Reflection updated" : "Reflection saved");
    }
    if (formId === "settings-form") {
      const payload = Object.fromEntries(new FormData(form));
      await api("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); await refresh("Details saved");
    }
  } catch (error) { notify(error.message, "error"); }
});

app.addEventListener("change", async (event) => {
  const input = event.target;
  try {
    if (input.closest(".inline-upload") && input.files?.length) {
      const form = input.closest("form"); const upload = new FormData(); upload.append("file", input.files[0]);
      await api(`/api/activities/${form.dataset.activityId}/attachments`, { method: "POST", body: upload }); await refresh("Evidence attached");
    }
    if (input.closest("#peer-upload") && input.files?.length) {
      const upload = new FormData(); upload.append("file", input.files[0]);
      await api("/api/peer-declaration", { method: "POST", body: upload }); await refresh("Peer declaration attached");
    }
    if (input.dataset.action === "patch-evidence") {
      await api(`/api/attachments/${input.dataset.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ [input.dataset.field]: input.checked }) }); await refresh();
    }
  } catch (error) { notify(error.message, "error"); }
});

window.addEventListener("hashchange", async () => {
  render();
  if (currentRoute() === "admin" && state?.user.role === "admin") await loadAdminUsers().catch((error) => notify(error.message, "error"));
});
api("/api/auth/status").then((auth) => {
  if (!auth.authenticated) return renderLogin();
  if (auth.user.mustChangePassword) return renderPasswordChange(auth.user);
  return refresh();
}).catch((error) => { app.innerHTML = `<section class="fatal-error"><h1>Couldn’t open the CPD log</h1><p>${escapeHtml(error.message)}</p><button onclick="location.reload()">Try again</button></section>`; });
