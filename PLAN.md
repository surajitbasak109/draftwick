# Draftwick — Implementation Plan

A fast, minimal desktop editor for quick drafts (meeting notes, pasted chat/web text).
It replaces Sublime Text for that one job. Only `.md` and `.txt` files.

> **For the implementing agent (Sonnet 5.5):** every decision below is already made.
> Don't revisit the stack or the behavior. If something is truly blocked, stop and ask the user.
> "Draftwick" is a working name, so keep it in one place (`tauri.conf.json` `productName`) to make renaming easy.

---

## 1. Decisions (final)

| Topic | Decision | Why |
|---|---|---|
| Platforms | Cross-platform (Linux first, Ubuntu is the daily driver; Windows/macOS should build but are tested later) | The web stack makes cross-platform nearly free |
| Shell | **Tauri 2** (Rust) | About 10 MB binary, fast startup, native dialogs |
| Frontend | **TypeScript + Vite, vanilla (no React/Vue)** | Less overhead, faster startup, one less dependency |
| Editor | **CodeMirror 6** + `@codemirror/lang-markdown` | The best web editor core; handles typical note sizes instantly |
| File I/O | **Custom Rust commands** (not `tauri-plugin-fs` from JS) | The notes folder is picked at runtime; Rust commands avoid fs-scope config pain and keep naming logic testable |
| Folder picker | `tauri-plugin-dialog` | Native folder dialog |
| Config storage | JSON file in `app_config_dir()/config.json`, read/written by Rust | No extra plugin |
| Consent rule | **Nothing happens without an explicit user action**: no system dialog on launch, no folder created unless the user asks | The user must never be surprised by a prompt or a silent change |
| Folder choice | Welcome screen with **"Choose notes folder…"** (primary) and **"Use ~/Notes instead"** (secondary link); `~/Notes` is created only when that link is clicked | Replaces the earlier auto-dialog + silent `~/Notes` fallback |
| New-note filename | **`YYYY-MM-DD HH-mm.md`** (local time), e.g. `2026-10-27 14-05.md` | `:` is illegal on Windows and shows oddly on macOS |
| Filename collision | Append ` (2)`, ` (3)`, … before `.md` | Two notes in the same minute must not overwrite each other |
| Saving | **Autosave** 500 ms after the last keystroke, plus on blur/close, **only for notes inside the notes folder**; `Ctrl+S` forces a save | Drafts must never be lost (matches the Sublime "just close it" habit) |
| Files outside the notes folder | **Never autosaved.** Saved only with `Ctrl+S`; leaving or closing with unsaved edits asks **Save / Don't Save / Cancel**. The title shows "(autosave off)" | Consent rule: don't write to a file the user opened from elsewhere unless they ask |
| Line endings | **Preserved exactly.** CRLF, LF or CR is detected when a file is opened and written back unchanged (CodeMirror itself normalizes to LF). A file that **mixes** endings is not autosaved; an explicit save converts every line to its most common ending | Opening and saving must never silently rewrite lines the user didn't touch |
| Theme | Dark by default, follows the OS `prefers-color-scheme` | |

---

## 2. Behavior spec

### First launch
1. If `config.json` has no `notesDir`, show a **welcome screen** instead of the editor. **No system dialog opens by itself.** Keyboard shortcuts do nothing while it is showing.
2. **"Choose notes folder…"** opens the native folder picker (titled "Choose a folder for your notes"). If a folder is chosen, save it as `notesDir` and open the editor. If the picker is cancelled, the user simply stays on the welcome screen; nothing is saved or created.
3. **"Use ~/Notes instead"** creates `<home>/Notes` if missing, saves it as `notesDir`, and opens the editor. This is the only path that creates a folder, and only on click.

### Every launch
- Load `notesDir`. If it no longer exists, show the welcome screen again.
- Open a **new empty note** in the editor. **Don't create the file on disk until the first character is typed**, so there are no empty junk files.
- The filename is fixed at the moment the file is first written (timestamp of first keystroke).

### Sidebar (left, collapsible with `Ctrl+B`)
- Lists `.md` and `.txt` files in `notesDir` (not recursive), **newest modified first**.
- Click to open. The active file is highlighted.
- Refresh after every create/save. Don't poll and don't use a file watcher in v1.

### Editor
- CodeMirror 6 with: markdown highlighting (for `.md`; plain text for `.txt`), line wrapping ON, history (undo/redo), search (`Ctrl+F`, replace `Ctrl+H`), multiple cursors (`Ctrl+click`, `Ctrl+D` select next occurrence), bracket/markdown-list continuation on Enter, no line numbers by default.
- Monospace font stack: `"JetBrains Mono", "Ubuntu Mono", "DejaVu Sans Mono", monospace`, 15px.
- Window title: `<filename> — Draftwick`, with a `•` prefix while there are unsaved changes.

### Keyboard shortcuts
| Keys | Action |
|---|---|
| `Ctrl+N` | New note (autosaves the current one first; for an outside file with unsaved edits, asks Save / Don't Save / Cancel) |
| `Ctrl+O` | Open any `.md`/`.txt` file via native file dialog (may be outside `notesDir`; outside files are not autosaved, see Saving) |
| `Ctrl+S` | Save now |
| `Ctrl+P` | Quick switcher: fuzzy filter over sidebar files, Enter to open |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+,` | Settings: change notes folder (folder picker again) |
| `Ctrl+Shift+R` | Rename current file (inline input; keep the extension; reject `/ \ : * ? " < > \|`) |
| `Ctrl+W` | Close current note (save first) → new empty note |

### Closing the app
- Notes inside the notes folder: flush the pending autosave before the window closes (handle the Tauri `close-requested` event), with no dialog.
- A file from outside the notes folder with unsaved edits: keep the window open and ask **Save / Don't Save / Cancel**. Cancel keeps the window open; Save that fails also keeps it open.
- Whether a file is "inside" is decided in Rust (`is_in_notes_dir`): both paths are canonicalized, so symlinks pointing out of the folder count as outside.

---

## 3. Project structure

```
draftwick/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/                     # frontend (TypeScript)
│   ├── main.ts              # bootstrap: load config → first-launch flow → mount editor
│   ├── editor.ts            # CodeMirror setup, language switching by extension
│   ├── sidebar.ts           # file list rendering + click handling
│   ├── switcher.ts          # Ctrl+P fuzzy switcher
│   ├── autosave.ts          # debounce + flush
│   ├── shortcuts.ts         # global keymap
│   ├── api.ts               # typed wrappers around invoke() for every Rust command
│   └── styles.css           # CSS variables, dark/light
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/default.json   # allow dialog plugin + core window events
    └── src/
        ├── main.rs
        ├── lib.rs           # builder, plugin registration, command registration
        ├── config.rs        # load/save config.json
        ├── notes.rs         # list/read/write/create/rename + filename logic
        └── error.rs         # serializable error type
```

---

## 4. Rust command API (`src-tauri/src/notes.rs`, `config.rs`)

All commands return `Result<T, AppError>`, where `AppError` serializes to `{ message: string }`.

```rust
get_config() -> Config                       // { notes_dir: Option<String> }
set_notes_dir(path: String) -> Config         // validates it's a dir (creates if missing)
default_notes_dir() -> String                 // <home>/Notes, created if missing
list_notes() -> Vec<NoteMeta>                 // { path, name, modified_ms, ext } for .md/.txt, newest first
read_note(path: String) -> String
write_note(path: String, content: String) -> NoteMeta   // atomic: write to .tmp then rename
create_note(content: String) -> NoteMeta      // generates "YYYY-MM-DD HH-mm.md" in notes_dir, collision-safe
rename_note(path: String, new_stem: String) -> NoteMeta // keeps extension, rejects invalid chars and existing targets
```

Crates: `serde`, `serde_json`, `chrono` (local time), `dirs` (home dir), `thiserror`.

**Filename logic must be a pure function** for unit testing:
```rust
fn note_filename(now: chrono::NaiveDateTime, exists: impl Fn(&str) -> bool) -> String
```

---

## 5. Milestones

Do them in order. Each one ends in a working, runnable app.

### M0: Environment (Ubuntu)
```bash
sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```
- Rust via `rustup` (stable), Node 20+.
- Scaffold: `pnpm create tauri-app draftwick -- --template vanilla-ts`, then `pnpm add @codemirror/state @codemirror/view @codemirror/commands @codemirror/search @codemirror/language @codemirror/lang-markdown @tauri-apps/api @tauri-apps/plugin-dialog` and `cargo add tauri-plugin-dialog chrono dirs thiserror serde --features serde/derive` in `src-tauri`.
- Note: the first Rust build takes several minutes, so run it in the background.
- **Done when:** `pnpm tauri dev` opens the template window.

### M1: Editor in a window
- Replace the template with CodeMirror filling the window, dark theme, markdown mode, line wrapping.
- **Done when:** typing, undo, `Ctrl+F` search, and `Ctrl+D` multi-select work.

### M2: Config + first-launch flow
- `config.rs`, `get_config`, `set_notes_dir`, `default_notes_dir`, plus the welcome screen with its two buttons.
- **Done when:** deleting `config.json` and relaunching shows the welcome screen and opens **no** dialog; "Choose notes folder…" opens the picker and cancelling it leaves the welcome screen up; "Use ~/Notes instead" creates `~/Notes` and opens the editor; relaunching doesn't show the welcome screen again.

### M3: Create + autosave
- `create_note`, `write_note`, `autosave.ts` (500 ms debounce, flush on blur, `Ctrl+S`, `close-requested`).
- The first keystroke in an unsaved note calls `create_note`, and later saves call `write_note`.
- **Done when:** typing creates `2026-10-27 14-05.md` in the notes folder; a second note in the same minute becomes `2026-10-27 14-05 (2).md`; closing the window mid-typing loses nothing; opening the app without typing creates no file.

### M4: Sidebar + open
- `list_notes`, `read_note`, sidebar UI, `Ctrl+B`, `Ctrl+N`, `Ctrl+O` (dialog filter: `md`, `txt`), `Ctrl+W`, title-bar dirty marker.
- Opening a `.txt` switches the editor to plain-text mode.
- **Done when:** notes list newest-first, clicking switches files with no data loss, and external `.md`/`.txt` files open and save in place.

### M5: Quick switcher, rename, settings
- `Ctrl+P` overlay (simple subsequence fuzzy match, arrow keys + Enter, Esc closes), `Ctrl+Shift+R` rename, `Ctrl+,` change folder.
- **Done when:** all three work, and rename rejects `a:b` and existing names with a visible error.

### M6: Packaging
- `pnpm tauri build` → `.deb` and `.AppImage` in `src-tauri/target/release/bundle/`.
- Set `productName`, `identifier` (`dev.draftwick.app`), version `0.1.0`, and an app icon (`pnpm tauri icon <png>`; a simple generated placeholder is fine).
- **Done when:** the `.deb` installs on Ubuntu, Draftwick appears in the app launcher, and launches.

---

## 6. Testing

- **Rust unit tests** (`cargo test` in `src-tauri`):
  - `note_filename` formats a given datetime as `YYYY-MM-DD HH-mm.md` (zero-padded month/day/hour/minute).
  - Collisions produce ` (2)`, ` (3)`.
  - `rename_note` validation rejects each forbidden char, empty names, and existing targets.
  - `list_notes` ignores other extensions and dotfiles and sorts by mtime descending (use a `tempfile` dev-dependency).
- **Manual checklist**: run through every milestone's "Done when" in `pnpm tauri dev` before calling the work finished. Report any that couldn't be checked.
- No frontend test framework in v1.

---

## 7. Performance guardrails

- No UI framework, no CSS framework, no web fonts bundled (system fonts only).
- Load only the CodeMirror extensions listed above. **Don't** use the `codemirror` meta-package `basicSetup` (it pulls in line numbers, fold gutter, and autocomplete); compose the extensions by hand.
- Target: window visible with a usable editor in **< 500 ms** on a warm start, and idle memory **< 150 MB**. Measure once at M6 and report the numbers.

---

## 8. Out of scope for v1

Tabs, markdown preview, file watching, subfolders, git, sync, spellcheck, plugins, themes beyond dark/light, Windows/macOS packaging and testing. Don't build these. List them as follow-ups at the end if relevant.
