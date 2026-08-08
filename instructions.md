# Product Specification & Technical Architecture: MD Lite
**Target Platform:** macOS 13.0+  
**Architecture:** Go + Wails v2 / v3 + WKWebView  
**Document Status:** Approved Architecture & UI/UX Spec  

---

## 1. Product Overview & Core Philosophy

`MD Lite` is a lightweight, high-performance Markdown editor and reader designed natively for macOS. It strips away bloated multi-file trees, complex project management features, and plugin ecosystems in favor of an instant, distraction-free writing environment.

### Key Objectives
* **Sub-second Startup:** Cold launch time under 300ms.
* **Minimal Footprint:** Memory usage below 40MB RAM at idle; binary size under 20MB.
* **Mac-Native Feel:** Fully compliant with Apple Human Interface Guidelines (HIG), dark/light mode auto-detection, and system font integration.
* **Zero Latency:** Instant rendering and seamless keyboard-driven navigation.

---

## 2. Technical Architecture & Component Responsibilities

The application uses a modular architecture: Go handles file operations, system APIs, and parsing, while a lightweight JS/HTML front end running inside macOS's native `WKWebView` handles input rendering and UI controls.

```
┌────────────────────────────────────────────────────────────────────────┐
│                              macOS Window                              │
├──────────────────────────────────┬─────────────────────────────────────┤
│        Go Engine (Backend)       │        WKWebView UI (Frontend)      │
│                                  │                                     │
│  • File I/O & Atomic Writes      │  • CodeMirror 6 Editor Engine       │
│  • goldmark CommonMark Parser    │  • Apple SF Typography & CSS Variable│
│  • Native File Dialog Bridge     │  • Instant Local State & Keyboard   │
│  • File Watching & OS Events     │  • Live Preview Render Engine       │
└──────────────────────────────────┴─────────────────────────────────────┘
```

### 2.1 Backend Layer (Go)
* **File System Operations:** Atomic disk writes using temporary file buffers (`.tmp`) prior to replacing target files to guarantee data integrity.
* **Markdown Parser:** `github.com/yuin/goldmark` configured with GitHub Flavored Markdown (GFM) extensions (tables, task lists, strikethrough, autolinks).
* **System Event Listening:** Uses `fsnotify` to monitor open files for external modifications and broadcast update events to the frontend.
* **Native OS Menus & Dialogs:** Leverages Wails bindings to invoke native `NSOpenPanel`, `NSSavePanel`, and standard macOS application menus.

### 2.2 Frontend Layer (Web App via WKWebView)
* **Editor Engine:** CodeMirror 6 with custom Apple-styled syntax highlighting and Markdown keymaps.
* **View Renderer:** High-speed DOM differential updates for the Markdown Live Preview pane.
* **Styling Framework:** Pure CSS utilizing system variables and native macOS blur filters (`backdrop-filter: blur(20px)`).

---

## 3. Detailed UI & Layout Specifications

The interface is built around a single-window layout with translucent title bars and minimal status indicators.

```
┌────────────────────────────────────────────────────────────────────────┐
│  🔴 🟡 🟢  document.md - Edited                   [ Edit | Split | Read ]│  <- Title Bar (40px)
├───────────────────────────────────┬────────────────────────────────────┤
│ 1 │ # Introduction                │ # Introduction                     │
│ 2 │                               │                                    │
│ 3 │ This is a clean Markdown      │ This is a clean Markdown           │
│ 4 │ editor for macOS.             │ editor for macOS.                  │
│ 5 │                               │                                    │
│   │                               │                                    │
│   │                               │                                    │
├───────────────────────────────────┴────────────────────────────────────┤
│ 142 words   890 characters                           UTF-8  │  Markdown  │  <- Status Bar (24px)
└────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Dimensions & Metrics
* **Title Bar:** `height: 40px`, non-bordered, draggable canvas (`-webkit-app-region: drag`). Buttons use `-webkit-app-region: no-drag`.
* **Editor Container Width:** Centered column, `max-width: 720px` in focus/edit mode, scale-to-fit in split mode.
* **Editor Padding:** `top: 32px`, `bottom: 48px`, `left/right: 48px`.
* **Split Separator:** `1px` subtle vertical border (`rgba(0,0,0,0.08)` in Light, `rgba(255,255,255,0.08)` in Dark).
* **Status Bar:** `height: 24px`, fixed at bottom, translucent, `font-size: 11px`.

---

## 4. Visual Design System

### 4.1 Color Tokens

| Token Name | Light Mode | Dark Mode | Application |
| :--- | :--- | :--- | :--- |
| `--bg-primary` | `#FFFFFF` | `#1E1E1E` | Canvas & Window background |
| `--bg-secondary` | `#F5F5F7` | `#2C2C2E` | Titlebar / Statusbar / Code blocks |
| `--text-primary` | `#1D1D1F` | `#F5F5F7` | Main paragraph text |
| `--text-secondary` | `#86868B` | `#8E8E93` | Line numbers, status icons, meta text |
| `--accent` | `#0066CC` | `#0A84FF` | Active toggles, focus rings, links |
| `--divider` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.08)` | Borders & pane splits |

### 4.2 Typography
* **UI & Body Text:** San Francisco (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display"`)
* **Monospace & Code:** SF Mono (`"SF Mono", Menlo, Monaco, Consolas, monospace`)
* **Base Sizes:**
  * Editor text: `15px / line-height 1.6`
  * Status text: `11px / line-height 1.0`
  * H1: `28px / bold`
  * H2: `22px / bold`
  * H3: `18px / semibold`

---

## 5. Functional Feature Requirements

### 5.1 File & State Handling
1. **Auto-Save:** Debounced save at 500ms inactivity when working on an existing file path.
2. **Draft Persistence:** Unsaved files persist across app quit/relaunch in local storage buffers.
3. **External Reloading:** If the active file is modified on disk by another application, prompt the user or seamlessly auto-reload if no unwritten local edits exist.

### 5.2 Editing Capabilities
* Smart list indentation (Auto-bullet/-number on Enter).
* Auto-closing pairs for parentheses, brackets, backticks, and asterisks.
* Multi-cursor support (Cmd + Click).
* Blockquote and code block shortcuts.

### 5.3 View Modes
* **Edit Mode (`Cmd+1`):** Plain-text CodeMirror 6 editor taking 100% width.
* **Split Mode (`Cmd+2`):** 50/50 dual pane showing CodeMirror editor on left, rendered Markdown HTML on right with synchronized scrolling.
* **Read Mode (`Cmd+3`):** Clean, distraction-free rendered Markdown view without editing chrome.

---

## 6. Keyboard Shortcuts & Native Controls

| Shortcut | Action |
| :--- | :--- |
| `Cmd + N` | Create New Window / Document |
| `Cmd + O` | Open File (Triggers Native macOS Open Dialog) |
| `Cmd + S` | Force Save Document |
| `Cmd + Shift + S` | Save As... |
| `Cmd + 1` | Switch to Edit Mode |
| `Cmd + 2` | Switch to Split View |
| `Cmd + 3` | Switch to Read Mode |
| `Cmd + Shift + E` | Export to HTML or Print to PDF |
| `Cmd + /` | Toggle Status Bar |

---

## 7. Data Flow & IPC Specifications

1. **Opening a File:**
   `Frontend` (User clicks Open or `Cmd+O`) $ightarrow$ `Go Backend` (Calls `wails.Dialog.SelectFile`) $ightarrow$ `Go File Reader` $ightarrow$ Returns Payload `{path: string, content: string}` to `Frontend` $ightarrow$ `CodeMirror` initializes buffer.

2. **Auto-Saving:**
   `CodeMirror` change event $ightarrow$ Frontend sets 500ms timer $ightarrow$ Timer fires $ightarrow$ Calls `window.go.main.App.SaveFile(path, content)` $ightarrow$ `Go Backend` writes atomically to disk via temp buffer.

3. **Live Rendering:**
   User types in `CodeMirror` $ightarrow$ Local JavaScript markdown engine processes immediate view AST OR calls `Go` `RenderMarkdown(raw)` endpoint $ightarrow$ HTML DOM tree updated.
