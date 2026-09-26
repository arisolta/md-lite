# MD Lite

> **MD Lite** is a lightweight, high-performance **Markdown editor** and reader designed natively for macOS. It strips away complex multi-file project trees and heavy plugin ecosystems in favor of an instant, distraction-free writing environment.

---

## Key Highlights

- ⚡ **Sub-Second Startup:** Launches instantly with a lightweight footprint (<40 MB RAM at idle; binary under 20 MB).
- 🍏 **Mac-Native Aesthetic:** Designed around Apple Human Interface Guidelines (HIG) featuring dark/light mode auto-detection, SF typography, glassmorphism translucent title bar & status bar (`backdrop-filter: blur(20px)`).
- 📝 **CodeMirror 6 Editor Engine:** Clean Markdown editing experience with syntax highlighting, line numbers, and smart auto-closing bracket pairs.
- 👁️ **Two Distraction-Free Modes (`Cmd+1` / `Cmd+2` or `Cmd+E` / `Cmd+P`):**
  - **Edit Mode:** Focused, centered 780px column editor.
  - **Read Mode:** Clean, typography-first rendered HTML view.
- 🚀 **Progressive Preview Loading:** Handles massive Markdown files (>750 KB) without UI lag via instant 50 KB chunking and on-demand pagination controls.
- 🛡️ **Atomic Disk Writes:** Writes to temporary `.tmp` buffers prior to atomic replacement, guaranteeing data integrity.
- 🔄 **External File Watching:** Listens for disk changes via `fsnotify` and alerts the user with translucent macOS notification toasts.
- 📤 **HTML Export & Printing:** Export formatted documents directly to self-contained HTML files or native macOS PDF print.

---

## Why You Should Build From Source

macOS enforces strict **Gatekeeper & Security Policies** for applications downloaded over the internet:

1. **Apple Gatekeeper & Notarization:** Pre-built binary `.app` downloads from GitHub without a paid Apple Developer ID certificate ($99/yr) trigger macOS security warnings (*"App is damaged and cannot be opened"* or *"App cannot be opened because it is from an unidentified developer"*).
2. **Local Self-Signing Advantage:** When you compile **MD Lite** from source on your own Mac, macOS automatically trusts the compiled binary on your machine without requiring Apple Developer ID notarization or security overrides.

Building takes less than 2 minutes using standard open-source developer tools (`go` + `node`).

---

## Building & Installing (Step-by-Step)

### 1. Prerequisites

Make sure you have Homebrew, Go, Node.js, and Wails CLI installed:

```bash
# Install Go and Node.js via Homebrew (if not already installed)
brew install go node

# Install Wails v2 CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

Ensure `$(go env GOPATH)/bin` is in your system `PATH`:
```bash
export PATH="$PATH:$(go env GOPATH)/bin"
```

---

### 2. Clone Repository & Build

```bash
# Clone the repository
git clone https://github.com/arisolta/md-lite.git
cd md-lite

# Build the production macOS .app bundle
wails build
```

The compiled app bundle will be generated at `build/bin/md-lite.app`.

---

### 3. Install to `/Applications` & Generate High-Res Icon

Run the following command to move the app into your `/Applications` folder and generate full-resolution macOS Retina icon sets:

```bash
# Remove any old version and copy the new build
rm -rf /Applications/md-lite.app
cp -R build/bin/md-lite.app /Applications/

# Generate native macOS Retina iconset (16x16 up to 1024x1024@2x)
mkdir -p /tmp/AppIcon.iconset
sips -z 16 16     build/appicon.png --out /tmp/AppIcon.iconset/icon_16x16.png >/dev/null
sips -z 32 32     build/appicon.png --out /tmp/AppIcon.iconset/icon_16x16@2x.png >/dev/null
sips -z 32 32     build/appicon.png --out /tmp/AppIcon.iconset/icon_32x32.png >/dev/null
sips -z 64 64     build/appicon.png --out /tmp/AppIcon.iconset/icon_32x32@2x.png >/dev/null
sips -z 128 128   build/appicon.png --out /tmp/AppIcon.iconset/icon_128x128.png >/dev/null
sips -z 256 256   build/appicon.png --out /tmp/AppIcon.iconset/icon_128x128@2x.png >/dev/null
sips -z 256 256   build/appicon.png --out /tmp/AppIcon.iconset/icon_256x256.png >/dev/null
sips -z 512 512   build/appicon.png --out /tmp/AppIcon.iconset/icon_256x256@2x.png >/dev/null
sips -z 512 512   build/appicon.png --out /tmp/AppIcon.iconset/icon_512x512.png >/dev/null
sips -z 1024 1024 build/appicon.png --out /tmp/AppIcon.iconset/icon_512x512@2x.png >/dev/null

iconutil -c icns /tmp/AppIcon.iconset -o /Applications/md-lite.app/Contents/Resources/iconfile.icns
cp /Applications/md-lite.app/Contents/Resources/iconfile.icns /Applications/md-lite.app/Contents/Resources/appicon.icns
rm -rf /tmp/AppIcon.iconset

# Touch app bundle & register with LaunchServices
touch /Applications/md-lite.app
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/md-lite.app
```

Now open Spotlight (`Cmd + Space`) and search for **MD Lite** to launch!

---

## Development Mode

To start live development mode with Vite hot-reloading and Go backend hot-recompile:

```bash
wails dev
```

---

## Keyboard Shortcuts Matrix

| Shortcut | Action |
| :--- | :--- |
| `Cmd + N` | Create New Document |
| `Cmd + O` | Open File (Triggers Native macOS Open Dialog) |
| `Cmd + S` | Force Save Document |
| `Cmd + Shift + S` | Save As... |
| `Cmd + B` | Bold Selection / Wrap `**` |
| `Cmd + I` | Italic Selection / Wrap `*` |
| `Cmd + K` | Insert Link / Wrap `[text](url)` |
| `Cmd + Shift + X` | Strikethrough Selection / Wrap `~~` |
| `Cmd + 1` | Switch to Edit Mode |
| `Cmd + 2` | Switch to Read Mode |
| `Cmd + E` / `Cmd + P` | Toggle Between Edit and Read Mode |
| `Cmd + Shift + E` | Export to HTML |
| `Cmd + /` | Toggle Status Bar Visibility |

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
│  • Native File Dialog Bridge     │  • Independent Cursor Pane Scroll   │
│  • File Watching & OS Events     │  • Live GFM Preview Render Engine   │
└──────────────────────────────────┴─────────────────────────────────────┘
```

---

## License

MIT License. Designed with ❤️ for macOS.
