import { EditorView, keymap, highlightActiveLine, lineNumbers, drawSelection } from "@codemirror/view";
import { EditorState, EditorSelection } from "@codemirror/state";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { marked } from "marked";

// Wails bindings
import {
  OpenFile,
  SaveFile,
  SaveFileAs,
  ExportHTML,
  GetFileStats,
  ReadFileAtPath,
  GetInitialFile,
  GetPendingFile
} from "../wailsjs/go/main/App.js";

import { EventsOn, BrowserOpenURL } from "../wailsjs/runtime/runtime.js";

// Configure marked with GFM support and interactive task checkboxes
marked.setOptions({
  gfm: true,
  breaks: true,
});

marked.use({
  renderer: {
    checkbox({ checked }) {
      return `<input type="checkbox"${checked ? " checked" : ""} class="task-checkbox"> `;
    },
  },
});

// Markdown formatting command helpers (Cmd+B, Cmd+I, Cmd+K, Cmd+Shift+X)
function toggleWrapCommand(prefix, suffix) {
  return (view) => {
    const changes = [];
    const newSelections = [];
    for (const range of view.state.selection.ranges) {
      if (range.empty) {
        changes.push({ from: range.from, insert: prefix + suffix });
        newSelections.push(EditorSelection.cursor(range.from + prefix.length));
      } else {
        const text = view.state.sliceDoc(range.from, range.to);
        const pLen = prefix.length;
        const sLen = suffix.length;
        if (text.startsWith(prefix) && text.endsWith(suffix) && text.length >= pLen + sLen) {
          const unwrapped = text.slice(pLen, text.length - sLen);
          changes.push({ from: range.from, to: range.to, insert: unwrapped });
          newSelections.push(EditorSelection.range(range.from, range.from + unwrapped.length));
        } else {
          const before = view.state.sliceDoc(Math.max(0, range.from - pLen), range.from);
          const after = view.state.sliceDoc(range.to, Math.min(view.state.doc.length, range.to + sLen));
          if (before === prefix && after === suffix) {
            changes.push({ from: range.from - pLen, to: range.from, insert: "" });
            changes.push({ from: range.to, to: range.to + sLen, insert: "" });
            newSelections.push(EditorSelection.range(range.from - pLen, range.to - pLen));
          } else {
            changes.push({ from: range.from, to: range.to, insert: prefix + text + suffix });
            newSelections.push(EditorSelection.range(range.from + pLen, range.to + pLen));
          }
        }
      }
    }
    view.dispatch({
      changes,
      selection: EditorSelection.create(newSelections),
      scrollIntoView: true,
      userEvent: "input.format",
    });
    return true;
  };
}

function insertLinkCommand(view) {
  const changes = [];
  const newSelections = [];
  for (const range of view.state.selection.ranges) {
    if (range.empty) {
      changes.push({ from: range.from, insert: "[](url)" });
      newSelections.push(EditorSelection.cursor(range.from + 1));
    } else {
      const text = view.state.sliceDoc(range.from, range.to);
      changes.push({ from: range.from, to: range.to, insert: `[${text}](url)` });
      newSelections.push(EditorSelection.range(range.from + text.length + 3, range.from + text.length + 6));
    }
  }
  view.dispatch({
    changes,
    selection: EditorSelection.create(newSelections),
    scrollIntoView: true,
    userEvent: "input.format",
  });
  return true;
}

const markdownFormattingKeymap = [
  { key: "Mod-b", run: toggleWrapCommand("**", "**") },
  { key: "Mod-i", run: toggleWrapCommand("*", "*") },
  { key: "Mod-k", run: insertLinkCommand },
  { key: "Mod-Shift-x", run: toggleWrapCommand("~~", "~~") },
];

// App State
let currentFilePath = "";
let currentFileName = "Untitled.md";
let isDirty = false;
let autoSaveTimer = null;
let currentMode = "edit"; // edit | read
let editorView = null;
let pendingExternalPath = null;

// DOM Elements
const docNameEl = document.getElementById("doc-name");
const docBadgeEl = document.getElementById("doc-badge");
const workspaceEl = document.getElementById("workspace");
const previewPane = document.getElementById("preview-pane");
const previewContent = document.getElementById("preview-content");
const editorPane = document.getElementById("editor-pane");
const toastEl = document.getElementById("toast");
const statusbarEl = document.getElementById("statusbar");

// Stats Elements
const statWords = document.getElementById("stat-words");
const statChars = document.getElementById("stat-chars");
const statReading = document.getElementById("stat-reading");

// Buttons & Controls
const btnNew = document.getElementById("btn-new");
const btnOpen = document.getElementById("btn-open");
const btnSave = document.getElementById("btn-save");
const btnExport = document.getElementById("btn-export");
const btnReloadFile = document.getElementById("btn-reload-file");
const btnIgnoreReload = document.getElementById("btn-ignore-reload");
const btnToggleStatusbar = document.getElementById("btn-toggle-statusbar");
const viewSwitcher = document.getElementById("view-switcher");

// Initialize Application
async function initApp() {
  initCodeMirror();
  setupEventListeners();
  setupKeyboardShortcuts();
  setupDragAndDrop();
  setupWailsEvents();

  // Wait for Wails runtime to be ready, then check for initial file
  await waitForWailsReady();

  // Try GetPendingFile first (set by handleOpenFile before webview was ready)
  let loaded = await checkPendingFile();

  // Fall back to GetInitialFile (set by startup from CLI args)
  if (!loaded) {
    try {
      const initialFile = await GetInitialFile();
      if (initialFile && initialFile.path) {
        loadFilePayload(initialFile);
        loaded = true;
      }
    } catch (e) {
      console.error("GetInitialFile error:", e);
    }
  }

  if (!loaded) {
    loadDraftFromStorage();
  }
}

// Wait until Wails Go bindings are available
async function waitForWailsReady() {
  for (let i = 0; i < 50; i++) {
    try {
      if (window.go && window.go.main && window.go.main.App) {
        return;
      }
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 50));
  }
}

// Check for a pending file from the Go side (pull model)
async function checkPendingFile() {
  try {
    const pending = await GetPendingFile();
    if (pending && (pending.path || pending.content)) {
      loadFilePayload(pending);
      return true;
    }
  } catch (e) {
    console.error("GetPendingFile error:", e);
  }
  return false;
}

// CodeMirror 6 Initialization
function initCodeMirror() {
  const initialContent = localStorage.getItem("mdlite_draft_content") || "# Welcome to MD Lite\n\nA lightweight, high-performance Markdown editor for macOS.\n\n### Features\n- **Sub-second Startup & Native macOS HIG UI**\n- **Live Dual-Pane Preview (`Cmd+2`)**\n- **Atomic Disk Saves & External File Watching**\n- **GFM Formatting Support**\n\n```js\nconsole.log('Hello, MD Lite!');\n```\n";

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onDocumentChanged();
    }
  });

  const state = EditorState.create({
    doc: initialContent,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      markdown(),
      closeBrackets(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([
        ...markdownFormattingKeymap,
        ...markdownKeymap,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      updateListener,
      EditorView.lineWrapping,
    ],
  });

  editorView = new EditorView({
    state,
    parent: document.getElementById("codemirror-editor"),
  });

  updatePreviewAndStats();
}

let isLoadingPayload = false;

// Handle Document Editing Changes
function onDocumentChanged() {
  if (isLoadingPayload) return;
  isDirty = true;
  updateTitleBadge();
  schedulePreviewUpdate();

  const content = getEditorText();
  localStorage.setItem("mdlite_draft_content", content);
  localStorage.setItem("mdlite_draft_path", currentFilePath);

  // Debounced auto-save (500ms inactivity) if existing path
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (currentFilePath) {
    autoSaveTimer = setTimeout(() => {
      performAutoSave();
    }, 500);
  }
}

// Perform Auto-Save
async function performAutoSave() {
  if (!currentFilePath || !isDirty) return;
  try {
    const savedPath = await SaveFile(currentFilePath, getEditorText());
    if (savedPath) {
      isDirty = false;
      updateTitleBadge();
    }
  } catch (err) {
    console.error("Auto-save failed:", err);
  }
}

// Get raw editor text
function getEditorText() {
  return editorView ? editorView.state.doc.toString() : "";
}

// Set editor text
function setEditorText(text) {
  if (!editorView) return;
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: text },
  });
  isDirty = false;
  updateTitleBadge();
  // Defer heavy preview/stats work so the editor renders first
  requestAnimationFrame(() => updatePreviewAndStats());
}

// Update Title & Badge
function updateTitleBadge() {
  docNameEl.textContent = currentFileName;
  docBadgeEl.style.display = isDirty ? "inline-block" : "none";
  document.title = `${currentFileName}${isDirty ? " - Edited" : ""} | MD Lite`;
}

// Debounce timer for preview updates during typing
let previewDebounceTimer = null;

// Schedule a debounced preview + stats update (used during typing)
function schedulePreviewUpdate() {
  if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(() => updatePreviewAndStats(), 300);
}

// Compute file stats client-side (avoids sending large content over IPC)
function computeStatsLocal(text) {
  const charCount = text.length;
  let words = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const isSpace = c === 32 || c === 10 || c === 13 || c === 9;
    if (isSpace) {
      if (inWord) { words++; inWord = false; }
    } else {
      inWord = true;
    }
  }
  if (inWord) words++;
  const readingMins = words === 0 ? 0 : Math.max(1, Math.ceil(words / 200));
  return { words, charCount, readingMins };
}

// Preview size limit - chunk size is ~50KB
const PREVIEW_LIMIT = 50000;
let previewChunkMultiplier = 1;

// Update Preview HTML and Status Bar Metrics
function updatePreviewAndStats() {
  const rawText = getEditorText();

  // Only render markdown preview when in read mode
  if (currentMode === "read") {
    let textToRender = rawText;
    let truncated = false;
    const currentLimit = PREVIEW_LIMIT * previewChunkMultiplier;

    if (rawText.length > currentLimit) {
      // Truncate at a clean line break to avoid cutting mid-syntax
      let cutPoint = rawText.lastIndexOf("\n", currentLimit);
      if (cutPoint < currentLimit * 0.5) cutPoint = currentLimit;
      textToRender = rawText.slice(0, cutPoint);
      truncated = true;
    }

    try {
      let html = marked.parse(textToRender);
      if (truncated) {
        const remainingBytes = rawText.length - textToRender.length;
        const remainingKB = Math.ceil(remainingBytes / 1024);
        const shownKB = Math.round(textToRender.length / 1024);
        const totalKB = Math.round(rawText.length / 1024);

        html += `
          <div class="preview-truncation-banner">
            <div class="truncation-info">
              Previewing <strong>${shownKB} KB</strong> of <strong>${totalKB} KB</strong> (${remainingKB} KB remaining)
            </div>
            <div class="truncation-actions">
              <button class="truncation-btn primary" id="btn-load-next-chunk">Load Next 50 KB</button>
              <button class="truncation-btn" id="btn-load-all-chunks">Load All</button>
            </div>
          </div>`;
      }
      previewContent.innerHTML = html;
    } catch (e) {
      previewContent.innerHTML = "<p>Error rendering Markdown</p>";
    }
  }

  // Compute stats locally (no IPC overhead) — always on full content
  const stats = computeStatsLocal(rawText);
  statWords.textContent = `${stats.words.toLocaleString()} words`;
  statChars.textContent = `${stats.charCount.toLocaleString()} characters`;
  statReading.textContent = `${stats.readingMins} min read`;
}

// Load File Payload into Editor
function loadFilePayload(payload) {
  if (!payload) return;
  isLoadingPayload = true;
  previewChunkMultiplier = 1;
  currentFilePath = payload.path || "";
  currentFileName = payload.name || (payload.path ? payload.path.split("/").pop() : "Untitled.md");
  setEditorText(payload.content || "");
  isDirty = false;
  isLoadingPayload = false;
  updateTitleBadge();
  toastEl.style.display = "none";

  if (payload.path) {
    localStorage.setItem("mdlite_draft_content", payload.content || "");
    localStorage.setItem("mdlite_draft_path", payload.path);
  }
}

// Restore Draft from Local Storage
function loadDraftFromStorage() {
  const savedPath = localStorage.getItem("mdlite_draft_path");
  if (savedPath) {
    currentFilePath = savedPath;
    currentFileName = savedPath.split("/").pop() || "Untitled.md";
  }
  updateTitleBadge();
}

// View Mode Switching [ Edit | Read ]
function setViewMode(mode) {
  currentMode = mode;
  workspaceEl.className = `workspace mode-${mode}`;

  const buttons = viewSwitcher.querySelectorAll(".segment");
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  if (mode === "read") {
    updatePreviewAndStats();
  } else if (mode === "edit" && editorView) {
    editorView.focus();
  }
}

// UI Event Listeners
function setupEventListeners() {
  // View Switcher Buttons
  viewSwitcher.addEventListener("click", (e) => {
    const target = e.target.closest(".segment");
    if (target && target.dataset.mode) {
      setViewMode(target.dataset.mode);
    }
  });

  // Action Buttons
  btnNew.addEventListener("click", handleNewFile);
  btnOpen.addEventListener("click", handleOpenFile);
  btnSave.addEventListener("click", handleSaveFile);
  btnExport.addEventListener("click", handleExportHTML);

  // Status bar toggle button
  btnToggleStatusbar.addEventListener("click", toggleStatusbar);

  // External Toast Action Buttons
  btnReloadFile.addEventListener("click", async () => {
    if (pendingExternalPath) {
      const payload = await ReadFileAtPath(pendingExternalPath).catch(() => null);
      if (payload) loadFilePayload(payload);
    }
    toastEl.style.display = "none";
  });

  btnIgnoreReload.addEventListener("click", () => {
    toastEl.style.display = "none";
  });

  // Preview Truncation Load Actions
  previewContent.addEventListener("click", (e) => {
    const nextBtn = e.target.closest("#btn-load-next-chunk");
    const allBtn = e.target.closest("#btn-load-all-chunks");
    if (nextBtn) {
      previewChunkMultiplier++;
      updatePreviewAndStats();
    } else if (allBtn) {
      previewChunkMultiplier = Infinity;
      updatePreviewAndStats();
    }
  });

  // Interactive Task List Checkbox Toggling
  previewContent.addEventListener("change", (e) => {
    const checkbox = e.target.closest(".task-checkbox");
    if (!checkbox) return;

    const allCheckboxes = Array.from(previewContent.querySelectorAll(".task-checkbox"));
    const index = allCheckboxes.indexOf(checkbox);
    if (index === -1) return;

    toggleTaskCheckboxInDoc(index, checkbox.checked);
  });

  // Safe External Link Navigation (opens in default macOS browser)
  previewContent.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href) return;

    if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) {
      e.preventDefault();
      BrowserOpenURL(href);
    } else if (href.startsWith("#")) {
      e.preventDefault();
      const id = href.slice(1);
      const targetEl = previewContent.querySelector(`[id="${CSS.escape(id)}"]`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth" });
      }
    }
  });
}

// Toggle task checkbox in the Markdown document source and auto-save
function toggleTaskCheckboxInDoc(targetIndex, isChecked) {
  if (!editorView) return;
  const text = editorView.state.doc.toString();
  const regex = /^([ \t]*[-*+]\s+\[)([ xX])(\])/gm;
  let match;
  let currentIndex = 0;
  while ((match = regex.exec(text)) !== null) {
    if (currentIndex === targetIndex) {
      const charPos = match.index + match[1].length;
      const newChar = isChecked ? "x" : " ";
      editorView.dispatch({
        changes: { from: charPos, to: charPos + 1, insert: newChar },
        userEvent: "input.checkbox",
      });
      break;
    }
    currentIndex++;
  }
}

// Setup Drag & Drop file opening with visual overlay
function setupDragAndDrop() {
  let dragCounter = 0;

  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    document.body.classList.add("dragging-file");
  });

  window.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      document.body.classList.remove("dragging-file");
    }
  });

  window.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    dragCounter = 0;
    document.body.classList.remove("dragging-file");

    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.path) {
        const payload = await ReadFileAtPath(file.path).catch(() => null);
        if (payload) {
          loadFilePayload(payload);
          return;
        }
      }

      if (file.name.endsWith(".md") || file.name.endsWith(".markdown") || file.name.endsWith(".txt")) {
        const reader = new FileReader();
        reader.onload = () => {
          loadFilePayload({
            path: "",
            name: file.name,
            content: reader.result,
          });
        };
        reader.readAsText(file);
      }
    }
  });
}

// Action Handlers
function handleNewFile() {
  previewChunkMultiplier = 1;
  currentFilePath = "";
  currentFileName = "Untitled.md";
  setEditorText("");
  localStorage.removeItem("mdlite_draft_content");
  localStorage.removeItem("mdlite_draft_path");
  isDirty = false;
  updateTitleBadge();
  if (editorView) editorView.focus();
}

async function handleOpenFile() {
  try {
    const payload = await OpenFile();
    if (payload && payload.path) {
      loadFilePayload(payload);
    }
  } catch (err) {
    console.error("Open file error:", err);
  }
}

async function handleSaveFile() {
  try {
    let savedPath = "";
    if (currentFilePath) {
      savedPath = await SaveFile(currentFilePath, getEditorText());
    } else {
      savedPath = await SaveFileAs(getEditorText());
    }
    if (savedPath) {
      currentFilePath = savedPath;
      currentFileName = savedPath.split("/").pop() || "Untitled.md";
      isDirty = false;
      updateTitleBadge();
    }
  } catch (err) {
    console.error("Save error:", err);
  }
}

async function handleSaveFileAs() {
  try {
    const savedPath = await SaveFileAs(getEditorText());
    if (savedPath) {
      currentFilePath = savedPath;
      currentFileName = savedPath.split("/").pop() || "Untitled.md";
      isDirty = false;
      updateTitleBadge();
    }
  } catch (err) {
    console.error("Save As error:", err);
  }
}

async function handleExportHTML() {
  try {
    const result = await ExportHTML(getEditorText(), currentFileName);
    if (!result) {
      window.print();
    }
  } catch (err) {
    window.print();
  }
}

function toggleStatusbar() {
  statusbarEl.classList.toggle("hidden");
}

// Keyboard Shortcuts Matrix
function setupKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    const isCmd = e.metaKey || e.ctrlKey;
    if (!isCmd) return;

    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      handleNewFile();
    } else if (e.key === "o" || e.key === "O") {
      e.preventDefault();
      handleOpenFile();
    } else if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      if (e.shiftKey) {
        handleSaveFileAs();
      } else {
        handleSaveFile();
      }
    } else if (e.key === "1") {
      e.preventDefault();
      setViewMode("edit");
    } else if (e.key === "2") {
      e.preventDefault();
      setViewMode("read");
    } else if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      setViewMode(currentMode === "edit" ? "read" : "edit");
    } else if (e.key === "e" || e.key === "E") {
      if (e.shiftKey) {
        e.preventDefault();
        handleExportHTML();
      } else {
        e.preventDefault();
        setViewMode(currentMode === "edit" ? "read" : "edit");
      }
    } else if (e.key === "/") {
      e.preventDefault();
      toggleStatusbar();
    }
  });
}

// Wails Event Subscriptions (fsnotify external changes + file open)
function setupWailsEvents() {
  EventsOn("file-externally-modified", async (filePath) => {
    if (filePath !== currentFilePath) return;
    pendingExternalPath = filePath;

    if (isDirty) {
      // Prompt user with translucent macOS notification toast
      toastEl.style.display = "flex";
    } else {
      // Seamless auto-reload if no unwritten local edits
      const payload = await ReadFileAtPath(filePath).catch(() => null);
      if (payload) {
        loadFilePayload(payload);
      }
    }
  });

  // Push path: EventsOn as fast-path when event bridge works
  EventsOn("open-file-payload", (data) => {
    const payload = Array.isArray(data) ? data[0] : data;
    if (payload && (payload.path || payload.content !== undefined)) {
      loadFilePayload(payload);
    }
  });

  // Pull path: poll GetPendingFile when window gains focus or becomes visible
  // This is the reliable fallback when Wails events don't reach the JS side
  window.addEventListener("focus", () => {
    checkPendingFile();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkPendingFile();
    }
  });
}

// Initialize on DOM Ready
window.addEventListener("DOMContentLoaded", initApp);
