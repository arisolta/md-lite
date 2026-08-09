package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer/html"
)

// FilePayload holds path, filename, and file content for frontend IPC
type FilePayload struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Content string `json:"content"`
}

// FileStats holds metrics for status bar
type FileStats struct {
	WordCount     int `json:"wordCount"`
	CharCount     int `json:"charCount"`
	LineCount     int `json:"lineCount"`
	ReadingTimeMs int `json:"readingTimeMs"`
}

// App struct
type App struct {
	ctx        context.Context
	mu         sync.Mutex
	activePath string
	watcher    *fsnotify.Watcher
	isSaving   bool
	mdParser   goldmark.Markdown
}

// NewApp creates a new App application struct
func NewApp() *App {
	md := goldmark.New(
		goldmark.WithExtensions(
			extension.GFM,
			extension.Table,
			extension.TaskList,
			extension.Strikethrough,
			extension.Linkify,
		),
		goldmark.WithParserOptions(
			parser.WithAutoHeadingID(),
		),
		goldmark.WithRendererOptions(
			html.WithUnsafe(),
		),
	)
	return &App{
		mdParser: md,
	}
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.mu.Lock()
	a.ctx = ctx
	activePath := a.activePath
	a.mu.Unlock()

	// Check if a file path was passed via CLI arguments if activePath isn't already set by OnFileOpen
	if activePath == "" && len(os.Args) > 1 {
		argPath := os.Args[1]
		if strings.HasSuffix(argPath, ".md") || strings.HasSuffix(argPath, ".markdown") || strings.HasSuffix(argPath, ".txt") {
			if abs, err := filepath.Abs(argPath); err == nil {
				if _, err := os.Stat(abs); err == nil {
					a.mu.Lock()
					a.activePath = abs
					a.mu.Unlock()
				}
			}
		}
	}
}

// handleOpenFile is called by Wails (Mac.OnFileOpen) when a file is opened via macOS Finder / open command
func (a *App) handleOpenFile(filePath string) {
	if filePath == "" {
		return
	}

	absPath, err := filepath.Abs(filePath)
	if err != nil {
		absPath = filePath
	}

	a.mu.Lock()
	a.activePath = absPath
	ctx := a.ctx
	a.mu.Unlock()

	if ctx != nil {
		runtime.WindowShow(ctx)
		runtime.WindowUnminimise(ctx)

		payload, err := a.ReadFileAtPath(absPath)
		if err == nil && payload != nil {
			runtime.EventsEmit(ctx, "open-file-payload", payload)
		}
	}
}

// handleSecondInstance handles command line args when launched while another instance is running
func (a *App) handleSecondInstance(secondInstanceData options.SecondInstanceData) {
	if len(secondInstanceData.Args) > 1 {
		filePath := secondInstanceData.Args[1]
		if !filepath.IsAbs(filePath) {
			filePath = filepath.Join(secondInstanceData.WorkingDirectory, filePath)
		}
		a.handleOpenFile(filePath)
	} else {
		a.mu.Lock()
		ctx := a.ctx
		a.mu.Unlock()
		if ctx != nil {
			runtime.WindowShow(ctx)
			runtime.WindowUnminimise(ctx)
		}
	}
}

// GetInitialFile loads CLI file if provided on startup
func (a *App) GetInitialFile() (*FilePayload, error) {
	a.mu.Lock()
	path := a.activePath
	a.mu.Unlock()

	if path != "" {
		return a.ReadFileAtPath(path)
	}
	return nil, nil
}

// OpenFile triggers native macOS file picker dialog
func (a *App) OpenFile() (*FilePayload, error) {
	selectedPath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open Markdown Document",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown Files (*.md, *.markdown, *.txt)", Pattern: "*.md;*.markdown;*.txt"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to open file dialog: %w", err)
	}
	if selectedPath == "" {
		return nil, nil // User cancelled
	}

	return a.ReadFileAtPath(selectedPath)
}

// ReadFileAtPath reads content from disk and starts watching for external changes
func (a *App) ReadFileAtPath(filePath string) (*FilePayload, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file '%s': %w", filePath, err)
	}

	a.activePath = filePath
	a.startWatchingLocked(filePath)

	return &FilePayload{
		Path:    filePath,
		Name:    filepath.Base(filePath),
		Content: string(data),
	}, nil
}

// SaveFile performs atomic write to target filePath. If empty, triggers Save As dialog.
func (a *App) SaveFile(filePath string, content string) (string, error) {
	if filePath == "" {
		return a.SaveFileAs(content)
	}

	a.mu.Lock()
	a.isSaving = true
	a.mu.Unlock()

	defer func() {
		go func() {
			time.Sleep(300 * time.Millisecond)
			a.mu.Lock()
			a.isSaving = false
			a.mu.Unlock()
		}()
	}()

	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create directory: %w", err)
	}

	// Create temp file for atomic write
	tmpFile, err := os.CreateTemp(dir, ".mdlite-*.tmp")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpName := tmpFile.Name()

	if _, err := tmpFile.WriteString(content); err != nil {
		tmpFile.Close()
		os.Remove(tmpName)
		return "", fmt.Errorf("failed to write temp file: %w", err)
	}

	if err := tmpFile.Sync(); err != nil {
		tmpFile.Close()
		os.Remove(tmpName)
		return "", fmt.Errorf("failed to sync temp file: %w", err)
	}
	tmpFile.Close()

	// Atomic replace
	if err := os.Rename(tmpName, filePath); err != nil {
		// Fallback for cross-device rename
		data := []byte(content)
		if writeErr := os.WriteFile(filePath, data, 0644); writeErr != nil {
			os.Remove(tmpName)
			return "", fmt.Errorf("failed atomic fallback save: %w", writeErr)
		}
		os.Remove(tmpName)
	}

	a.mu.Lock()
	a.activePath = filePath
	a.startWatchingLocked(filePath)
	a.mu.Unlock()

	return filePath, nil
}

// SaveFileAs prompts native Save As dialog and performs atomic save
func (a *App) SaveFileAs(content string) (string, error) {
	defaultName := "Untitled.md"
	if a.activePath != "" {
		defaultName = filepath.Base(a.activePath)
	}

	selectedPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save Markdown Document",
		DefaultFilename: defaultName,
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown File (*.md)", Pattern: "*.md"},
			{DisplayName: "Text File (*.txt)", Pattern: "*.txt"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return "", fmt.Errorf("save dialog error: %w", err)
	}
	if selectedPath == "" {
		return "", nil // Cancelled
	}

	return a.SaveFile(selectedPath, content)
}

// RenderMarkdown renders GFM markdown text to HTML using goldmark
func (a *App) RenderMarkdown(raw string) string {
	var buf bytes.Buffer
	if err := a.mdParser.Convert([]byte(raw), &buf); err != nil {
		return "<p>Error rendering Markdown</p>"
	}
	return buf.String()
}

// GetFileStats calculates metrics for status bar display
func (a *App) GetFileStats(content string) FileStats {
	lines := strings.Split(content, "\n")
	lineCount := len(lines)
	charCount := utf8.RuneCountInString(content)

	words := 0
	inWord := false
	for _, r := range content {
		if unicode.IsSpace(r) {
			if inWord {
				words++
				inWord = false
			}
		} else {
			inWord = true
		}
	}
	if inWord {
		words++
	}

	// Reading time estimate based on ~200 WPM
	readingTimeMs := int(float64(words) / 200.0 * 60.0 * 1000.0)

	return FileStats{
		WordCount:     words,
		CharCount:     charCount,
		LineCount:     lineCount,
		ReadingTimeMs: readingTimeMs,
	}
}

// ExportHTML converts document to HTML file via native Save dialog
func (a *App) ExportHTML(content string, title string) (string, error) {
	bodyHTML := a.RenderMarkdown(content)
	if title == "" {
		title = "Markdown Document"
	}

	fullHTML := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>%s</title>
<style>
  :root {
    --bg: #ffffff;
    --text: #1d1d1f;
    --accent: #0066cc;
    --code-bg: #f5f5f7;
    --border: rgba(0,0,0,0.1);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1e1e1e;
      --text: #f5f5f7;
      --accent: #0a84ff;
      --code-bg: #2c2c2e;
      --border: rgba(255,255,255,0.1);
    }
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", sans-serif;
    line-height: 1.65;
    color: var(--text);
    background-color: var(--bg);
    max-width: 760px;
    margin: 0 auto;
    padding: 48px 24px;
  }
  h1, h2, h3, h4, h5, h6 { font-weight: 700; line-height: 1.25; margin-top: 1.5em; margin-bottom: 0.5em; }
  h1 { font-size: 2em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
  code { font-family: "SF Mono", Menlo, Monaco, monospace; font-size: 0.9em; background: var(--code-bg); padding: 2px 6px; border-radius: 4px; }
  pre code { display: block; padding: 12px; overflow-x: auto; border-radius: 6px; }
  blockquote { margin: 0; padding-left: 1em; color: #86868b; border-left: 4px solid var(--accent); }
  table { border-collapse: collapse; width: 100%%; margin: 1em 0; }
  th, td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
  th { background: var(--code-bg); }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  img { max-width: 100%%; height: auto; border-radius: 6px; }
</style>
</head>
<body>
%s
</body>
</html>`, title, bodyHTML)

	selectedPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export to HTML",
		DefaultFilename: fmt.Sprintf("%s.html", strings.TrimSuffix(title, filepath.Ext(title))),
		Filters: []runtime.FileFilter{
			{DisplayName: "HTML File (*.html)", Pattern: "*.html"},
		},
	})
	if err != nil {
		return "", err
	}
	if selectedPath == "" {
		return "", nil
	}

	if err := os.WriteFile(selectedPath, []byte(fullHTML), 0644); err != nil {
		return "", err
	}
	return selectedPath, nil
}

// startWatchingLocked initializes fsnotify file watcher on target filePath
func (a *App) startWatchingLocked(filePath string) {
	if a.watcher != nil {
		_ = a.watcher.Close()
		a.watcher = nil
	}

	w, err := fsnotify.NewWatcher()
	if err != nil {
		return
	}

	err = w.Add(filePath)
	if err != nil {
		_ = w.Close()
		return
	}
	a.watcher = w

	go func(target string, watcher *fsnotify.Watcher) {
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if event.Has(fsnotify.Write) || event.Has(fsnotify.Create) {
					a.mu.Lock()
					saving := a.isSaving
					currentPath := a.activePath
					a.mu.Unlock()

					if !saving && currentPath == target {
						runtime.EventsEmit(a.ctx, "file-externally-modified", target)
					}
				}
			case _, ok := <-watcher.Errors:
				if !ok {
					return
				}
			}
		}
	}(filePath, w)
}

