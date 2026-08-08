import { EditorView, keymap, highlightActiveLine, lineNumbers, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { marked } from "marked";

// Wails bindings
import {
  OpenFile,
  SaveFile,
  SaveFileAs,
  ExportHTML,
  GetFileStats,
  ReadFileAtPath,
  GetInitialFile
} from "../wailsjs/go/main/App.js";

import { EventsOn } from "../wailsjs/runtime/runtime.js";

// Configure marked with GFM support
marked.setOptions({
  gfm: true,
  breaks: true,
});

// App State
let currentFilePath = "";
let currentFileName = "Untitled.md";
let isDirty = false;
let autoSaveTimer = null;
let currentMode = "edit"; // edit | split | read
let editorView = null;
let pendingExternalPath = null;
let isScrollingFromEditor = false;
let isScrollingFromPreview = false;

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
  setupSynchronizedScrolling();
  setupWailsEvents();

  // Load draft or initial file
  const initialFile = await GetInitialFile().catch(() => null);
  if (initialFile && initialFile.path) {
    loadFilePayload(initialFile);
  } else {
    loadDraftFromStorage();
  }
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
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
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

// Handle Document Editing Changes
function onDocumentChanged() {
  isDirty = true;
  updateTitleBadge();
  updatePreviewAndStats();

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
  updatePreviewAndStats();
}

// Update Title & Badge
function updateTitleBadge() {
  docNameEl.textContent = currentFileName;
  docBadgeEl.style.display = isDirty ? "inline-block" : "none";
  document.title = `${currentFileName}${isDirty ? " - Edited" : ""} | MD Lite`;
}

// Update Preview HTML and Status Bar Metrics
async function updatePreviewAndStats() {
  const rawText = getEditorText();

  // Instant Client-side Markdown Rendering
  try {
    previewContent.innerHTML = marked.parse(rawText);
  } catch (e) {
    previewContent.innerHTML = "<p>Error rendering Markdown</p>";
  }

  // Update Stats
  try {
    const stats = await GetFileStats(rawText);
    statWords.textContent = `${stats.wordCount.toLocaleString()} words`;
    statChars.textContent = `${stats.charCount.toLocaleString()} characters`;

    const mins = Math.max(1, Math.ceil(stats.readingTimeMs / 60000));
    statReading.textContent = `${stats.wordCount === 0 ? 0 : mins} min read`;
  } catch (e) {
    // Fallback word count if stats fails
    const words = rawText.trim() ? rawText.trim().split(/\s+/).length : 0;
    statWords.textContent = `${words} words`;
    statChars.textContent = `${rawText.length} characters`;
  }
}

// Load File Payload into Editor
function loadFilePayload(payload) {
  if (!payload) return;
  currentFilePath = payload.path;
  currentFileName = payload.name || "Untitled.md";
  setEditorText(payload.content);
  isDirty = false;
  updateTitleBadge();
  toastEl.style.display = "none";
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

// View Mode Switching [ Edit | Split | Read ]
function setViewMode(mode) {
  currentMode = mode;
  workspaceEl.className = `workspace mode-${mode}`;

  const buttons = viewSwitcher.querySelectorAll(".segment");
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  if (mode === "read" || mode === "split") {
    updatePreviewAndStats();
  }

  // Focus editor when switching back to edit or split mode
  if ((mode === "edit" || mode === "split") && editorView) {
    editorView.focus();
  }
}

// Synchronized Scrolling between Editor and Preview Pane
function setupSynchronizedScrolling() {
  const scroller = editorPane.querySelector(".cm-scroller");

  if (scroller) {
    scroller.addEventListener("scroll", () => {
      if (currentMode !== "split" || isScrollingFromPreview) return;
      isScrollingFromEditor = true;

      const maxScroller = scroller.scrollHeight - scroller.clientHeight;
      if (maxScroller > 0) {
        const ratio = scroller.scrollTop / maxScroller;
        const maxPreview = previewPane.scrollHeight - previewPane.clientHeight;
        previewPane.scrollTop = ratio * maxPreview;
      }

      setTimeout(() => { isScrollingFromEditor = false; }, 50);
    });
  }

  previewPane.addEventListener("scroll", () => {
    if (currentMode !== "split" || isScrollingFromEditor) return;
    isScrollingFromPreview = true;

    const maxPreview = previewPane.scrollHeight - previewPane.clientHeight;
    if (maxPreview > 0) {
      const ratio = previewPane.scrollTop / maxPreview;
      const scroller = editorPane.querySelector(".cm-scroller");
      if (scroller) {
        const maxScroller = scroller.scrollHeight - scroller.clientHeight;
        scroller.scrollTop = ratio * maxScroller;
      }
    }

    setTimeout(() => { isScrollingFromPreview = false; }, 50);
  });
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
}

// Action Handlers
function handleNewFile() {
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
      setViewMode("split");
    } else if (e.key === "3") {
      e.preventDefault();
      setViewMode("read");
    } else if (e.key === "e" || e.key === "E") {
      if (e.shiftKey) {
        e.preventDefault();
        handleExportHTML();
      }
    } else if (e.key === "/") {
      e.preventDefault();
      toggleStatusbar();
    }
  });
}

// Wails Event Subscriptions (fsnotify external changes)
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
}

// Initialize on DOM Ready
window.addEventListener("DOMContentLoaded", initApp);
