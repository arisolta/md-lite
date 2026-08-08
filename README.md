# MD Lite

> **MD Lite** is a lightweight, high-performance Markdown editor and reader designed natively for macOS. It strips away complex multi-file project trees and heavy plugin ecosystems in favor of an instant, distraction-free writing environment.

---

## Key Highlights

- ⚡ **Sub-Second Startup:** Launches instantly with a lightweight footprint (<40 MB RAM at idle; binary under 20 MB).
- 🍏 **Mac-Native Aesthetic:** Designed around Apple Human Interface Guidelines (HIG) featuring dark/light mode auto-detection, SF typography, glassmorphism translucent title bar & status bar (`backdrop-filter: blur(20px)`).
- 📝 **CodeMirror 6 Editor Engine:** Clean Markdown editing experience with syntax highlighting, line numbers, and smart auto-closing bracket pairs.
- 👁️ **Three View Modes (`Cmd+1` / `Cmd+2` / `Cmd+3`):**
  - **Edit Mode:** Centered 780px column editor.
  - **Split Mode:** Dual-pane 50/50 dual view with proportional synchronized scrolling between editor & rendered HTML preview.
  - **Read Mode:** Clean, distraction-free HTML view.
- 🛡️ **Atomic Disk Writes:** Writes to temporary `.tmp` buffers prior to atomic replacement, guaranteeing data integrity.
- 🔄 **External File Watching:** Listens for disk changes via `fsnotify` and alerts the user with translucent macOS notification toasts.
- 📤 **HTML Export & Printing:** Export formatted documents directly to self-contained HTML files or native macOS PDF print.

---

## Technical Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                              macOS Window                              │
├──────────────────────────────────┬─────────────────────────────────────┤
│        Go Engine (Backend)       │        WKWebView UI (Frontend)      │
│                                  │                                     │
│  • File I/O & Atomic Writes      │  • CodeMirror 6 Editor Engine       │
│  • goldmark CommonMark Parser    │  • Apple SF Typography & CSS Tokens │
│  • Native File Dialog Bridge     │  • Dual-Pane Synchronized Scroll   │
│  • File Watching & OS Events     │  • Live GFM Preview Render Engine   │
└──────────────────────────────────┴─────────────────────────────────────┘
```

---

## Keyboard Shortcuts Matrix

| Shortcut | Action |
| :--- | :--- |
| `Cmd + N` | Create New Document |
| `Cmd + O` | Open File (Triggers Native macOS Open Dialog) |
| `Cmd + S` | Force Save Document |
| `Cmd + Shift + S` | Save As... |
| `Cmd + 1` | Switch to Edit Mode |
| `Cmd + 2` | Switch to Split View |
| `Cmd + 3` | Switch to Read Mode |
| `Cmd + Shift + E` | Export to HTML |
| `Cmd + /` | Toggle Status Bar Visibility |

---

## Getting Started

### Prerequisites

- **macOS 13.0+**
- **Go 1.20+**
- **Node.js 18+**
- **Wails v2 CLI:** Install via `go install github.com/wailsapp/wails/v2/cmd/wails@latest`

### Development

To start live development mode with Vite hot-reloading and Go bridge hot-recompile:

```bash
wails dev
```

### Production Build

To build the production `.app` bundle for macOS:

```bash
wails build
```

The compiled binary bundle will be output to `build/bin/md-lite.app`.

---

## License

MIT License. Designed with ❤️ for macOS.
