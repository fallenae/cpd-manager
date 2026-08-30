const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
let state = null;
let toastTimer = null;

const routes = ["home", "activities", "reflections", "audit", "settings"];
const currentRoute = () => routes.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
const titleCase = (value) => value.charAt(0).toUpperCase() + value.slice(1);
const formatDate = (value) => new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
const formatBytes = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const today = () => new Date().toISOString().slice(0, 10);

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
  render();
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
      <label>Password<input type="password" name="password" required minlength="12" autocomplete="current-password" autofocus /></label>
      <button class="primary-action plain" type="submit">Unlock CPD Manager</button>
    </form>
  </section></main>`;
}

function shell(content) {
  const route = currentRoute();
  const start = state.settings.bienniumStart;
  return `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="#home" aria-label="MIT CPD Manager home">
          <span class="brand-mark" aria-hidden="true">M</span>
          <span><strong>CPD Manager</strong><small>${state.settings.fullName ? escapeHtml(state.settings.fullName) : "Private practice log"}</small></span>
        </a>
        <div class="topbar-actions"><span class="cycle-pill">${start}—${start + 1}</span><button class="lock-button" data-action="logout" type="button">Lock</button></div>
      </header>
      <main>${content}</main>
      <nav class="bottom-nav" aria-label="Primary navigation">
        ${[
          ["home", "●", "Home"], ["activities", "□", "Activities"], ["reflections", "◇", "Reflections"], ["audit", "✓", "Audit"], ["settings", "⋯", "Settings"]
        ].map(([id, symbol, label]) => `<a class="${route === id ? "active" : ""}" href="#${id}"><span aria-hidden="true">${symbol}</span>${label}</a>`).join("")}
      </nav>
    </div>`;
}

function homeView() {
  const { audit, requirements } = state;
  const percent = Math.min(100, Math.round((audit.totals.total / requirements.totalHours) * 100));
  const recent = state.activities.slice(0, 3);
  return `
    <section class="welcome-grid" aria-labelledby="page-title">
      <div>
        <p class="eyebrow">Your current biennium</p>
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
  const date = new Date();
  return `<section class="empty-state"><div class="empty-date" aria-hidden="true"><span>${date.toLocaleString("en-NZ", { month: "short" }).toUpperCase()}</span><strong>${date.getDate()}</strong></div><div><p class="eyebrow">Activity log</p><h2>Nothing to tidy up yet</h2><p>Start with the CPD you completed most recently. Evidence can be attached now or added later.</p></div><button class="secondary-action" data-action="new-activity" type="button">Add first activity</button></section>`;
}

function activitiesView() {
  return `
    <section class="page-heading"><div><p class="eyebrow">Continuous record</p><h1>Activities</h1><p>Capture enough detail now that the logbook makes sense years later.</p></div><button class="primary-action" data-action="new-activity" type="button">New activity <span aria-hidden="true">＋</span></button></section>
    ${state.activities.length ? `<div class="activity-list">${state.activities.map(activityCard).join("")}</div>` : emptyActivities()}
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
  return `<dialog id="activity-dialog" class="editor-dialog"><form id="activity-form" method="dialog">
    <div class="dialog-heading"><div><p class="eyebrow">CPD logbook</p><h2 data-dialog-title>Log an activity</h2></div><button class="icon-button" data-action="close-dialog" type="button" aria-label="Close">×</button></div>
    <input type="hidden" name="recordId" />
    <div class="form-grid two"><label>Date<input type="date" name="activityDate" required /></label><label>Hours<input type="number" name="hours" min="0.25" step="0.25" required /></label></div>
    <label>Activity name<input name="name" maxlength="180" required placeholder="e.g. CT dose optimisation workshop" /></label>
    <div class="form-grid two"><label>Source or provider<input name="provider" maxlength="180" placeholder="Provider, journal or facilitator" /></label><label>Location<input name="location" maxlength="140" placeholder="Online, workplace, venue…" /></label></div>
    <fieldset><legend>CPD type</legend><div class="segmented"><label><input type="radio" name="type" value="substantive" checked /><span>Substantive</span></label><label><input type="radio" name="type" value="general" /><span>General</span></label></div></fieldset>
    <label>Short summary <span class="optional">Optional</span><textarea name="summary" rows="3" placeholder="What was the activity about?"></textarea></label>
    <label>Evidence file <span class="optional">Optional — originals are preserved</span><input type="file" name="evidence" /></label>
    <div class="dialog-actions"><button class="secondary-action" data-action="close-dialog" type="button">Cancel</button><button class="primary-action plain" type="submit">Save activity</button></div>
  </form></dialog>`;
}

function reflectionsView() {
  const reflections = state.activities.flatMap((activity) => activity.reflections.map((item) => ({ ...item, activity })));
  return `
    <section class="page-heading"><div><p class="eyebrow">Practice, considered</p><h1>Reflections</h1><p>Write against the questions MRTB actually asks, then choose one statement for each audit slot.</p></div><button class="primary-action" data-action="new-reflection" type="button" ${state.activities.length ? "" : "disabled"}>New reflection <span aria-hidden="true">＋</span></button></section>
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
  return `<dialog id="reflection-dialog" class="editor-dialog"><form id="reflection-form" method="dialog">
    <div class="dialog-heading"><div><p class="eyebrow">Reflective statement</p><h2 data-dialog-title>New reflection</h2></div><button class="icon-button" data-action="close-dialog" type="button" aria-label="Close">×</button></div>
    <input type="hidden" name="recordId" />
    <label>Linked CPD activity<select name="activityId" required><option value="">Choose an activity</option>${state.activities.map((activity) => `<option value="${activity.id}">${escapeHtml(activity.name)} — ${formatDate(activity.activityDate)}</option>`).join("")}</select></label>
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
            const options = state.activities.flatMap((activity) => activity.reflections.map((reflection) => ({ ...reflection, activity }))).filter((item) => item.category === category);
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

function settingsView() {
  return `<section class="page-heading"><div><p class="eyebrow">Personal setup</p><h1>Settings</h1><p>These details appear on your generated logbook and reflective statements.</p></div></section>
    <section class="settings-card"><form id="settings-form">
      <label>Full name<input name="fullName" required value="${escapeHtml(state.settings.fullName)}" autocomplete="name" /></label>
      <label>MRTB registration number<input name="registrationNumber" required value="${escapeHtml(state.settings.registrationNumber)}" /></label>
      <label>Biennium starts<input type="number" name="bienniumStart" min="2023" max="2100" step="2" required value="${state.settings.bienniumStart}" /><small>The app treats this and the following calendar year as one audit cycle.</small></label>
      <button class="primary-action plain" type="submit">Save details</button>
    </form>
    <div class="settings-side"><div class="privacy-note"><span aria-hidden="true">⌂</span><div><strong>Local by design</strong><p>Records and original files live inside the mounted Docker data folder. Nothing is sent to MRTB or any other service.</p></div></div><div class="backup-note"><p class="eyebrow">Portable backup</p><h2>Take everything with you</h2><p>Download the structured record and every untouched original file in one private archive.</p><a class="small-button" href="/api/backup.zip">Download backup</a></div></div></section>`;
}

function render() {
  if (!state) return;
  const views = { home: homeView, activities: activitiesView, reflections: reflectionsView, audit: auditView, settings: settingsView };
  app.innerHTML = shell(views[currentRoute()]());
}

function findActivity(id) { return state.activities.find((activity) => activity.id === id); }
function findReflection(id) { return state.activities.flatMap((activity) => activity.reflections).find((reflection) => reflection.id === id); }

function openActivityDialog(id) {
  const dialog = document.querySelector("#activity-dialog");
  const form = dialog.querySelector("form");
  const activity = id ? findActivity(id) : null;
  form.reset();
  form.elements.recordId.value = activity?.id || "";
  form.elements.activityDate.value = activity?.activityDate || today();
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
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const { action, id } = control.dataset;
  try {
    if (action === "new-activity") openActivityDialog();
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

app.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const formId = form.getAttribute("id");
  try {
    if (formId === "login-form") {
      const password = new FormData(form).get("password");
      await api("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      await refresh("CPD Manager unlocked");
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

window.addEventListener("hashchange", render);
api("/api/auth/status").then((auth) => auth.authenticated ? refresh() : renderLogin()).catch((error) => { app.innerHTML = `<section class="fatal-error"><h1>Couldn’t open the CPD log</h1><p>${escapeHtml(error.message)}</p><button onclick="location.reload()">Try again</button></section>`; });
