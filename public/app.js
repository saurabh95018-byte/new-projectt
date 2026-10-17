const storageKeys = {
  proposals: "bidplot.proposals.v1",
  profile: "bidplot.profile.v1",
};

const form = document.querySelector("#proposal-form");
const preview = document.querySelector("#proposal-preview");
const generateButton = document.querySelector("#generate-button");
const errorMessage = document.querySelector("#form-error");
const copyButton = document.querySelector("#copy-button");
const saveButton = document.querySelector("#save-button");
let currentProposal = "";
let currentJobTitle = "";
let toastTimer;

function initFuturisticEffects() {
  const root = document.documentElement;
  document.addEventListener("pointermove", (event) => {
    const x = (event.clientX / window.innerWidth) * 100;
    const y = (event.clientY / window.innerHeight) * 100;
    root.style.setProperty("--pointer-x", `${x}%`);
    root.style.setProperty("--pointer-y", `${y}%`);
  });
}

function readStored(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    showToast("Could not save to this browser. Check its available storage.", true);
    return false;
  }
}

function proposals() {
  const stored = readStored(storageKeys.proposals, []);
  return Array.isArray(stored) ? stored.filter((item) => item && typeof item.id === "string") : [];
}

function updateStats() {
  const items = proposals();
  document.querySelector("#saved-count").textContent = String(items.length);
  document.querySelector("#stat-saved").textContent = String(items.length);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = items.filter((item) => Number(item.createdAt) >= weekAgo).length;
  document.querySelector("#stat-week").textContent = String(thisWeek);
  const profile = readStored(storageKeys.profile, {});
  const name = typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : "Your profile";
  document.querySelector("#sidebar-name").textContent = name;
  document.querySelector(".avatar").textContent = name === "Your profile" ? "A" : name.charAt(0).toUpperCase();
}

function renderSaved() {
  const items = proposals().sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  for (const [elementId, list] of [["recent-list", items.slice(0, 3)], ["all-saved-list", items]]) {
    const container = document.getElementById(elementId);
    if (!list.length) {
      container.innerHTML = '<div class="empty-saved"><span class="empty-saved-icon">✳</span><div><h3>No proposals just yet</h3><p>When you save a draft, you’ll find it here.</p><button class="text-button" data-action="new-proposal" type="button">Write your first proposal <span aria-hidden="true">→</span></button></div></div>';
      continue;
    }
    container.replaceChildren(...list.map((item) => createProposalRow(item)));
  }
  updateStats();
}

function createProposalRow(item) {
  const row = document.createElement("article");
  row.className = "proposal-row";
  const symbol = document.createElement("span");
  symbol.className = "proposal-symbol";
  symbol.textContent = "✳";
  const info = document.createElement("div");
  info.className = "proposal-info";
  const title = document.createElement("strong");
  title.textContent = item.title || "Untitled proposal";
  const date = document.createElement("span");
  date.textContent = new Date(Number(item.createdAt) || Date.now()).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const excerpt = document.createElement("span");
  excerpt.className = "proposal-preview-copy";
  excerpt.textContent = item.text;
  info.append(title, date, excerpt);
  const actions = document.createElement("div");
  actions.className = "proposal-row-actions";
  const open = document.createElement("button");
  open.className = "small-action";
  open.type = "button";
  open.textContent = "Open";
  open.addEventListener("click", () => openProposal(item));
  const remove = document.createElement("button");
  remove.className = "small-action delete-action";
  remove.type = "button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => removeProposal(item.id));
  actions.append(open, remove);
  row.append(symbol, info, actions);
  return row;
}

function showToast(message, isError = false) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.toggle("error-toast", isError);
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function updateWordCount(text) {
  const count = text.trim() ? text.trim().split(/\s+/).length : 0;
  document.querySelector("#word-count").textContent = `${count} ${count === 1 ? "word" : "words"}`;
}

function showProposal(text) {
  currentProposal = text;
  const content = document.createElement("div");
  content.className = "proposal-content";
  content.textContent = text;
  content.contentEditable = "true";
  content.setAttribute("role", "textbox");
  content.setAttribute("aria-label", "Editable proposal draft");
  content.setAttribute("aria-multiline", "true");
  content.spellcheck = true;
  content.addEventListener("input", () => {
    currentProposal = content.innerText.trim();
    updateWordCount(currentProposal);
    saveButton.disabled = !currentProposal;
    copyButton.disabled = !currentProposal;
  });
  preview.replaceChildren(content);
  copyButton.disabled = !text;
  saveButton.disabled = !text;
  updateWordCount(text);
}

function openProposal(item) {
  currentJobTitle = item.title;
  document.querySelector("#job-title").value = item.title;
  showProposal(item.text);
  navigate("write");
}

function removeProposal(id) {
  const next = proposals().filter((item) => item.id !== id);
  if (saveStored(storageKeys.proposals, next)) {
    renderSaved();
    showToast("Proposal removed.");
  }
}

function navigate(section) {
  const pages = {
    dashboard: document.querySelector("#dashboard-section"),
    write: document.querySelector("#editor-section"),
    saved: document.querySelector("#saved-section"),
  };
  if (!pages[section]) return;
  for (const [name, page] of Object.entries(pages)) page.classList.toggle("hidden", name !== section);
  document.querySelector("#breadcrumb-current").textContent = section === "write" ? "New proposal" : section === "saved" ? "My proposals" : "Overview";
  for (const link of document.querySelectorAll(".main-nav .nav-link")) {
    link.classList.toggle("active", link.dataset.nav === section || (section === "write" && link.dataset.nav === "write"));
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function newProposal() {
  form.reset();
  currentJobTitle = "";
  currentProposal = "";
  preview.innerHTML = '<div class="empty-preview"><span class="empty-sparkle">✳</span><h3>Your next great proposal<br>starts right here.</h3><p>Share a little about the opportunity and we’ll help you find the words.</p><div class="preview-decoration"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div></div>';
  updateWordCount("");
  copyButton.disabled = true;
  saveButton.disabled = true;
  errorMessage.classList.add("hidden");
  navigate("write");
  document.querySelector("#job-title").focus({ preventScroll: true });
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-nav]");
  if (nav) {
    event.preventDefault();
    navigate(nav.dataset.nav);
  }
  if (event.target.closest('[data-action="new-proposal"]')) newProposal();
});

initFuturisticEffects();

document.querySelector("#profile-button").addEventListener("click", () => {
  const current = readStored(storageKeys.profile, {});
  const name = window.prompt("What name should Bidplot use for you?", current.name || "");
  if (name === null) return;
  if (name.length > 80) return showToast("Please use a name under 80 characters.", true);
  if (saveStored(storageKeys.profile, { name: name.trim() })) {
    updateStats();
    showToast("Profile name saved.");
  }
});

document.querySelector("#help-button").addEventListener("click", () => {
  showToast("Bidplot drafts proposals for you to review. It never submits them on your behalf.");
});

document.querySelector("#job-description").addEventListener("input", (event) => {
  document.querySelector("#description-count").textContent = `${event.target.value.length.toLocaleString()} / 12,000`;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.classList.add("hidden");
  const values = Object.fromEntries(new FormData(form).entries());
  currentJobTitle = values.jobTitle.trim();
  generateButton.disabled = true;
  generateButton.classList.add("loading");
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not generate a proposal.");
    showProposal(result.proposal);
    showToast("Your first draft is ready. Make it yours.");
  } catch (error) {
    errorMessage.textContent = error.message || "Something went wrong. Please try again.";
    errorMessage.classList.remove("hidden");
  } finally {
    generateButton.disabled = false;
    generateButton.classList.remove("loading");
  }
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentProposal);
    showToast("Proposal copied to your clipboard.");
  } catch {
    showToast("Clipboard access is unavailable. Select and copy the proposal text.", true);
  }
});

saveButton.addEventListener("click", () => {
  if (!currentProposal.trim()) return;
  const items = proposals();
  items.unshift({ id: crypto.randomUUID(), title: currentJobTitle || "Untitled proposal", text: currentProposal, createdAt: Date.now() });
  if (saveStored(storageKeys.proposals, items.slice(0, 100))) {
    renderSaved();
    showToast("Draft saved in this browser.");
  }
});

renderSaved();
