"use strict";

const app = document.getElementById("app");
const navigation = document.getElementById("navigation");
let me;
let noticeTimer;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function notify(message) {
  const node = document.getElementById("notice");
  node.textContent = message; node.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { node.hidden = true; }, 6000);
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options, headers: { "Content-Type": "application/json", ...(me ? { "X-CSRF-Token": me.csrfToken } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || "The request failed."); error.status = response.status; throw error; }
  return data;
}
function bindForm(id, run) {
  const form = document.getElementById(id);
  let submitting = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    const buttons = [...form.querySelectorAll("button")];
    buttons.forEach((button) => { button.disabled = true; });
    const error = form.querySelector(".error");
    error.textContent = "";
    try { await run(Object.fromEntries(new FormData(form))); }
    catch (failure) { error.textContent = failure.message; }
    finally { submitting = false; buttons.forEach((button) => { button.disabled = false; }); }
  });
}
function field(name, label, type, attributes) {
  return `<label>${label}<input name="${name}" type="${type}" ${attributes}></label>`;
}
function login() {
  app.innerHTML = `<section class="card login"><p class="eyebrow">Scanora Celebrates</p><h1>Administrator</h1>
    <form id="login"><div class="fields">
    ${field("identifier", "Username", "text", 'required autocomplete="username" maxlength="100"')}
    ${field("password", "Password", "password", 'required autocomplete="current-password" maxlength="256"')}
    </div><p class="error" role="alert"></p><div class="actions"><button>Log in</button></div></form></section>`;
  bindForm("login", async (values) => {
    await api("/api/login", { method: "POST", body: values });
    location.href = "/admin/dashboard";
  });
}
async function qrBatches(page = 1, batchId = "") {
  const data = await api(`/api/admin/qr-batches?page=${page}${batchId ? `&batchId=${encodeURIComponent(batchId)}` : ""}`);
  app.innerHTML = `<div class="heading"><div><p class="eyebrow">Administrator</p><h1>Wedding invitation QRs</h1></div></div>
    <form id="batch-form" class="card"><div class="fields">${field("batchId", "Shop number", "text", 'required inputmode="numeric" pattern="[0-9]{1,20}" maxlength="20"')}${field("count", "How many QR cards?", "number", 'required min="1" max="1000" step="1"')}</div>
    <p class="error" role="alert"></p><div class="actions"><button>Generate QRs</button></div></form>
    <p id="batch-ready" role="status"></p>
    <form id="filter-form" class="card"><div class="fields">${field("batchId", "Filter by shop number / legacy batch ID", "text", `maxlength="36" value="${escapeHtml(batchId)}"`)}</div><p class="error" role="alert"></p><div class="actions"><button>Filter</button><button type="button" id="clear-filter" class="secondary">Show all</button></div></form>
    <div class="table-wrap"><table class="shops-table"><thead><tr><th>Shop / batch ID</th><th>First created</th><th>Cards</th><th>Customized</th><th>Download</th></tr></thead><tbody>
    ${data.batches.map((batch) => `<tr><td>${escapeHtml(batch.batch_id)}</td><td>${escapeHtml(new Date(batch.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}</td><td>${batch.count}</td><td>${batch.activated}</td>
    <td><a class="button secondary" href="/api/admin/qr-batches/${encodeURIComponent(batch.batch_id)}/download">Download ZIP</a></td></tr>`).join("") || '<tr><td colspan="5">No batches yet.</td></tr>'}</tbody></table></div>
    <div class="pager"><button id="previous" class="secondary" ${page === 1 ? "disabled" : ""}>Previous</button><span>Page ${page}</span><button id="next" class="secondary" ${data.hasMore ? "" : "disabled"}>Next</button></div>`;
  for (const [id, nextPage] of [["previous", page - 1], ["next", page + 1]]) {
    document.getElementById(id).addEventListener("click", () => qrBatches(nextPage, batchId).catch((error) => notify(error.message)));
  }
  bindForm("filter-form", (values) => qrBatches(1, values.batchId.trim()));
  document.getElementById("clear-filter").addEventListener("click", () => qrBatches().catch((error) => notify(error.message)));
  bindForm("batch-form", async (values) => {
    let batch;
    try { batch = await api("/api/admin/qr-batches", { method: "POST", body: { count: Number(values.count), batchId: values.batchId } }); }
    catch (error) {
      if (!error.status || error.status >= 500) throw new Error("Generation could not be confirmed. Refresh and check the batch list before generating again.");
      throw error;
    }
    await qrBatches();
    document.getElementById("batch-ready").innerHTML = `${batch.count} QR ${batch.count === 1 ? "card" : "cards"} created. <a href="${batch.downloadUrl}">Download ZIP</a>`;
  });
}
function invitationForm(publicId) {
  app.innerHTML = `<section class="card simple-gift"><p class="eyebrow">Wedding invitation</p>
    <form id="invitation-form"><div class="fields">
    ${field("nameOne", "Mr", "text", 'required maxlength="30"')}
    ${field("nameTwo", "Mrs", "text", 'required maxlength="30"')}
    <fieldset class="date-fields wide"><legend>Wedding date</legend><div class="date-selects">
    <select name="day" aria-label="Day" required><option value="">Day</option></select>
    <select name="month" aria-label="Month" required><option value="">Month</option>${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((label, index) => `<option value="${String(index + 1).padStart(2, "0")}">${label}</option>`).join("")}</select>
    <select name="year" aria-label="Year" required><option value="">Year</option>${Array.from({ length: 200 }, (_, index) => 1900 + index).map((year) => `<option value="${year}">${year}</option>`).join("")}</select>
    </div></fieldset>
    ${field("venueMapsUrl", "Venue Maps link (optional)", "url", 'maxlength="2048" placeholder="https://maps.app.goo.gl/..."')}
    </div>
    <p class="error" role="alert"></p><div class="actions"><button>Save and open invitation</button></div></form></section>`;
  const form = document.getElementById("invitation-form");
  function updateDays() {
    const selected = form.elements.day.value;
    const month = Number(form.elements.month.value);
    const year = Number(form.elements.year.value);
    const count = month ? new Date(Date.UTC(year || 2000, month, 0)).getUTCDate() : 31;
    form.elements.day.innerHTML = '<option value="">Day</option>' + Array.from({ length: count }, (_, index) => {
      const value = String(index + 1).padStart(2, "0");
      return `<option value="${value}" ${value === selected ? "selected" : ""}>${index + 1}</option>`;
    }).join("");
  }
  updateDays();
  form.elements.month.addEventListener("change", updateDays);
  form.elements.year.addEventListener("change", updateDays);
  bindForm("invitation-form", async (values) => {
    let saved;
    try {
      saved = await api(`/api/public/gifts/${publicId}/activate`, { method: "POST", body: {
        names: [values.nameOne, values.nameTwo],
        occasionDate: `${values.year}-${values.month}-${values.day}`, venueMapsUrl: values.venueMapsUrl
      } });
    } catch (error) {
      if (error.status === 404) { location.replace("/thank-you"); return; }
      if (error.status === 409) { location.replace(`/g/${publicId}`); return; }
      if (!error.status || error.status >= 500) throw new Error("Activation could not be confirmed. Scan this QR again to check your invitation before retrying.");
      throw error;
    }
    location.replace(saved.publicUrl);
  });
}
async function start() {
  const activation = location.pathname.match(/^\/customize\/([A-Za-z0-9_-]{8}|[A-Za-z0-9_-]{32})$/);
  if (activation) {
    const state = await api(`/api/public/gifts/${activation[1]}`);
    if (!state.unused) { location.replace(state.publicUrl); return; }
    return invitationForm(activation[1]);
  }
  if (location.pathname === "/admin/login") return login();
  try { me = await api("/api/me"); }
  catch (error) { if (error.status === 401) { location.replace("/admin/login"); return; } throw error; }
  navigation.innerHTML = '<button id="logout" class="secondary">Log out</button>';
  document.getElementById("logout").addEventListener("click", async () => {
    try { await api("/api/logout", { method: "POST" }); location.href = "/admin/login"; }
    catch (error) { notify(error.message); }
  });
  return qrBatches();
}
start().catch((error) => {
  const publicInvitation = location.pathname.startsWith("/customize/");
  if (publicInvitation && error.status === 404) { location.replace("/thank-you"); return; }
  app.innerHTML = `<section class="card"><h1>${publicInvitation ? "Unable to open this invitation" : "Unable to open your workspace"}</h1><p class="error" role="alert">${escapeHtml(error.message)}</p>${publicInvitation ? "<p>Scan your QR again to check its link.</p>" : '<a href="/admin/login">Back to login</a>'}</section>`;
});
