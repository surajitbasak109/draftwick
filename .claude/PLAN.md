# Draftwick — Implementation Plan

A fast, minimal desktop editor for quick drafts (meeting notes, pasted chat/web text).
It replaces Sublime Text for that one job. Only `.md` and `.txt` files (one exception: its own settings file, see M9).

> **Read `.claude/CLAUDE.md` first** (how to work in this repo, and the user's rules). This file is the spec and the history. It was written before the build and updated as decisions were made: **where an older section disagrees with a newer one (M7 to M9, the "Decided" notes), the newer one wins.** Where the plan and the code disagree, ask the user which is right instead of assuming.

## Status and next steps

*As of commit `7dbebff` on `main`. The repo has no remote.*

**Built and committed**
- **Editor and drafts (M0 to M5):** CodeMirror editor, welcome screen that asks for a draft directory (no dialog opens by itself), draft files named by date and time, sidebar, quick switcher, rename.
- **Safety rules (the "consent" work):** autosave only inside the draft directory; files opened from elsewhere save only on `Ctrl+S`; a file's line endings are preserved; an emptied draft is never autosaved over a file with text; a deleted file is never silently recreated; saves are explicit or implicit (see `.claude/CLAUDE.md`).
- **Menubar (M7):** native menu. File: New file, Open, Open/Set draft directory, Save, Close (closes the draft), Quit. View: Show sidebar (tick). Settings: Open settings file, Reload settings. Help: About, Keyboard shortcuts. All built from one action table in `menu.rs`.
- **Sidebar (M8):** `Ctrl+B` and View > Show sidebar; the choice is remembered.
- **Settings (M9, first part):** `settings.json` with the autosave delay (default 5 s, range 0.5 to 30 s); opened inside the editor, highlighted, and checked for mistakes while typing and on save.
- **Wording:** the app says "draft" and "draft directory" throughout.
- **Checks:** typecheck, build, `pnpm test` and `cargo test` all pass.

**Needs a check in the real window** (an agent cannot see or click it, so the user has to): Settings > Open settings file and the error underlines; the View tick; Quit; that the sidebar choice survives a restart; File items greyed out on the welcome screen; that closing the window saves an open draft.

**Next, in the order I would take them** (the live checklist is `.claude/TODO.md`)
1. **M6, packaging:** `pnpm tauri build`; install the `.deb` and check it appears in the launcher; measure startup (target under 500 ms) and memory (under 150 MB); the content-security policy is on (checked 2026-10-27); the icon is a generated placeholder.
2. **Held on purpose, each with its reason in M7 and M9:** Save as (`Ctrl+Shift+S`); the Edit menu (Undo, Redo, Cut, Copy, Copy as HTML; these must be click-only, without accelerators); View > Toggle wrap; Enter full screen (`F11`); the remaining settings (wrap column, font family and size, theme, line numbers, tab size, tabs to spaces, auto indent); a Settings dialog on top of the settings file.
3. **Raised in the consent review but not chosen by the user, so leave them unless asked:** a draft file is created on the first keystroke; closing the window saves quietly with no prompt for normal drafts; a temporary `.tmp` file appears next to a draft while it saves; `Ctrl+W` and `Ctrl+N` save and swap drafts.

**Out of date on purpose:** sections 3 and 4 (project structure and the Rust command list) describe the original plan only. The current truth is the files in `src` and `src-tauri/src`, and the list in the `generate_handler!` macro in `src-tauri/src/lib.rs`. The older sections also still say "note" where the app now says "draft".

**Not saved in the repo:** the browser-test harness used during development (a stand-in backend page). `.claude/CLAUDE.md` explains how to recreate one.

---

## 1. Decisions (final)

| Topic | Decision | Why |
|---|---|---|
| Platforms | Cross-platform (Linux first, Ubuntu is the daily driver; Windows/macOS should build but are tested later) | The web stack makes cross-platform nearly free |
| Shell | **Tauri 2** (Rust) | About 10 MB binary, fast startup, native dialogs |
| Frontend | **TypeScript + Vite, vanilla (no React/Vue)** | Less overhead, faster startup, one less dependency |
| Editor | **CodeMirror 6** + `@codemirror/lang-markdown` | The best web editor core; handles typical draft sizes instantly |
| File I/O | **Custom Rust commands** (not `tauri-plugin-fs` from JS) | The draft directory is picked at runtime; Rust commands avoid fs-scope config pain and keep naming logic testable |
| Folder picker | `tauri-plugin-dialog` | Native folder dialog |
| Config storage | JSON file in `~/.config/draftwick/config.json` (the platform config folder plus `draftwick`; one function, `config::config_dir`, decides it), read/written by Rust | No extra plugin |
| Consent rule | **Nothing happens without an explicit user action**: no system dialog on launch, no folder created unless the user asks | The user must never be surprised by a prompt or a silent change |
| Folder choice | Welcome screen with **"Choose draft directory…"** (primary) and **"Use ~/Drafts instead"** (secondary link); `~/Drafts` is created only when that link is clicked | Replaces the earlier auto-dialog + silent `~/Drafts` fallback |
| New-draft filename | **`YYYY-MM-DD HH-mm.md`** (local time), e.g. `2026-10-27 14-05.md` | `:` is illegal on Windows and shows oddly on macOS |
| Filename collision | Append ` (2)`, ` (3)`, … before `.md` | Two drafts in the same minute must not overwrite each other |
| Saving | **Autosave** after the user stops typing (default **5 seconds**, configurable from 500 ms to 30 s, see M9; every keystroke restarts the wait), and always on blur, switching drafts and close, **only for drafts inside the draft directory**; `Ctrl+S` forces a save | Drafts must never be lost (matches the Sublime "just close it" habit) |
| Files outside the draft directory | **Never autosaved.** Saved only with `Ctrl+S`; leaving or closing with unsaved edits asks **Save / Don't Save / Cancel**. The title shows "(autosave off)" | Consent rule: don't write to a file the user opened from elsewhere unless they ask |
| Deleted or moved files | **A file that disappears while it is open is never silently recreated.** Saving asks **Save again / Close without saving / Keep editing**; "Keep editing" is the focused button because the prompt can appear mid-typing, so a stray Enter is harmless. After Keep editing, autosave stays off until the user presses `Ctrl+S`, which recreates the file. Rust's `write_note` takes `create_if_missing` and reports `kind: "missing"` | A draft the user deleted should stay deleted unless they say otherwise |
| Implicit vs explicit saves | Saves started by the app (typing timer, blur, leaving a draft) re-check at run time that autosave is still allowed; only `Ctrl+S` or answering a prompt is an explicit save | A save waiting in the queue must not act on an outdated situation |
| Emptied drafts | **Autosave never replaces a file that has text with an empty document.** Clearing a draft pauses autosave (title shows "(autosave off)", plus a toast); only `Ctrl+S` writes the empty draft. Leaving or closing it asks Save / Don't Save / Cancel. Typing again resumes autosave | An accidental select-all + delete must not wipe the file |
| Line endings | **Preserved exactly.** CRLF, LF or CR is detected when a file is opened and written back unchanged (CodeMirror itself normalizes to LF). A file that **mixes** endings is not autosaved; an explicit save converts every line to its most common ending | Opening and saving must never silently rewrite lines the user didn't touch |
| Theme | Dark by default, follows the OS `prefers-color-scheme` | |

---

## 2. Behavior spec

### First launch
1. If `config.json` has no `notes_dir`, show a **welcome screen** instead of the editor. **No system dialog opens by itself.** Keyboard shortcuts do nothing while it is showing.
2. **"Choose draft directory…"** opens the native folder picker (titled "Choose a directory for your drafts"). If a folder is chosen, save it as `notes_dir` and open the editor. If the picker is cancelled, the user simply stays on the welcome screen; nothing is saved or created.
3. **"Use ~/Drafts instead"** creates `<home>/Drafts` if missing, saves it as `notes_dir`, and opens the editor. This is the only path that creates a folder, and only on click.

### Every launch
- Load `notes_dir`. If it no longer exists, show the welcome screen again.
- Open a **new empty draft** in the editor. **Don't create the file on disk until the first character is typed**, so there are no empty junk files.
- The filename is fixed at the moment the file is first written (timestamp of first keystroke).

### Sidebar (left, collapsible with `Ctrl+B`)
- A visible show/hide control, and remembering the choice, are planned in M8.
- Lists `.md` and `.txt` files in `notes_dir` (not recursive), **newest modified first**.
- Click to open. The active file is highlighted.
- Refresh after every create/save. Don't poll and don't use a file watcher in v1.

### Editor
- CodeMirror 6 with: markdown highlighting (for `.md`; plain text for `.txt`), line wrapping ON, history (undo/redo), search (`Ctrl+F`, replace `Ctrl+H`), multiple cursors (`Ctrl+click`, `Ctrl+D` select next occurrence), bracket/markdown-list continuation on Enter, no line numbers by default.
- Monospace font stack: `"JetBrains Mono", "Ubuntu Mono", "DejaVu Sans Mono", monospace`, 15px.
- Window title: `<filename> — Draftwick`, with a `•` prefix while there are unsaved changes.

### Keyboard shortcuts
| Keys | Action |
|---|---|
| `Ctrl+N` | New draft (autosaves the current one first; for an outside file with unsaved edits, asks Save / Don't Save / Cancel) |
| `Ctrl+O` | Open any `.md`/`.txt` file via native file dialog (may be outside `notes_dir`; outside files are not autosaved, see Saving) |
| `Ctrl+S` | Save now |
| `Ctrl+P` | Quick switcher: fuzzy filter over sidebar files, Enter to open |
| `Ctrl+B` | Toggle sidebar (View → Show sidebar, with a tick) |
| `Ctrl+,` | Settings: change draft directory (folder picker again) |
| `Ctrl+Shift+R` | Rename current file (inline input; keep the extension; reject `/ \ : * ? " < > \|`) |
| `Ctrl+W` | Close current draft (save first) → new empty draft |
| `Ctrl+Q` | Quit: closes the window through the normal close path, so unsaved work is still asked about |

### Closing the app
- Drafts inside the draft directory: flush the pending autosave before the window closes (handle the Tauri `close-requested` event), with no dialog.
- A file from outside the draft directory with unsaved edits: keep the window open and ask **Save / Don't Save / Cancel**. Cancel keeps the window open; Save that fails also keeps it open.
- Whether a file is "inside" is decided in Rust (`is_in_notes_dir`): both paths are canonicalized, so symlinks pointing out of the folder count as outside.

---

## 3. Project structure

*Brought up to date on 2026-10-27. The files in `src` and `src-tauri/src` are the truth; this is a map.*

```
draftwick/
├── package.json, pnpm-lock.yaml, vite.config.ts, tsconfig.json
├── index.html                     # the page: welcome screen, editor, sidebar, status bar, dialogs
├── settings.example.jsonc         # the commented template Settings > Open settings file writes (built into the app)
├── tests/                         # plain Node tests (pnpm test)
├── src/                           # frontend (TypeScript)
│   ├── main.ts                    # start-up, the open draft, actions, autosave policy, settings handling, status bar
│   ├── editor.ts                  # CodeMirror: language by extension, options (line numbers, tabs), cursor reporting
│   ├── sidebar.ts                 # draft list, hover trash button, right-click menu
│   ├── contextMenu.ts             # the small popup menu
│   ├── switcher.ts                # Ctrl+P quick switcher
│   ├── rename.ts                  # rename prompt
│   ├── choice.ts                  # two- or three-button prompt (Save / Don't Save / Cancel ...)
│   ├── about.ts, shortcutsHelp.ts # the About and Keyboard shortcuts dialogs
│   ├── lineEndings.ts             # detect CRLF / LF / CR so saving can restore them
│   ├── autosave.ts                # debounce + flush(explicit)
│   ├── shortcuts.ts, accelerators.ts   # frontend key bindings and the key-name helpers
│   ├── jsonc.ts                   # tokenizer for JSON with comments (settings file colours)
│   ├── api.ts                     # typed wrappers around invoke() for every Rust command
│   └── styles.css                 # CSS variables: dark, light, and the theme override
└── src-tauri/
    ├── Cargo.toml, tauri.conf.json   # content-security policy and bundle targets live here
    ├── capabilities/default.json     # window and dialog permissions
    ├── icons/                        # icon.svg is the master; the rest is generated from it
    └── src/
        ├── main.rs, lib.rs        # builder, plugins, menu, command registration
        ├── menu.rs                # the action table (menu, key bindings, shortcut help) and menu commands
        ├── notes.rs               # draft files: list, read, write, create, rename, trash; filename logic
        ├── config.rs              # config.json (the app's own state) and the one config folder
        ├── settings.rs            # settings.json: the checker, defaults, the template
        └── error.rs               # serializable error type
```

The app's files live in `~/.config/draftwick/` (`config.json`, `settings.json`), decided in one place: `config::config_dir`.

---

## 4. Rust command API

*Brought up to date on 2026-10-27. The list of record is the `generate_handler!` macro in `src-tauri/src/lib.rs`.*

All commands return `Result<T, AppError>`; `AppError` serialises to `{ kind, message }` (`kind: "missing"` is a file that no longer exists).

```rust
// config.rs: the app's own state
get_config() -> Config                          // { notes_dir, sidebar_visible }; a missing draft directory reads as unset
set_notes_dir(path) -> Config                   // creates it if missing
default_notes_dir() -> String                   // ~/Drafts, created only when the user clicks "Use ~/Drafts instead"
set_sidebar_visible(visible)

// notes.rs: drafts (.md / .txt only; the settings file is the one exception)
is_in_notes_dir(path) -> bool                   // canonicalized, so symlinks out of the folder count as outside
list_notes() -> Vec<NoteMeta>                   // { path, name, modified_ms, ext }, newest first
read_note(path) -> String
write_note(path, content, create_if_missing) -> NoteMeta   // atomic (.tmp then rename); a missing file is `missing`
create_note(content) -> NoteMeta                // "YYYY-MM-DD HH-mm.md", " (2)" on a clash
rename_note(path, new_stem) -> NoteMeta         // keeps the extension, rejects bad characters and existing targets
trash_note(path)                                // system trash; only a .md/.txt directly inside the draft directory

// settings.rs
get_settings() -> LoadedSettings                // { settings, problems, valid }
check_settings(text) -> Vec<Diagnostic>         // the live underlines
prepare_settings_file() -> String               // creates settings.json from the template if missing; returns its path

// menu.rs
get_actions() -> Vec<ActionInfo>                // the action table
get_about() -> ...                              // the About dialog's text
set_menu_enabled(enabled)                       // File items follow whether a draft directory is set
set_menu_checked(id, checked)                   // the View > Show sidebar tick
```

Crates: `tauri`, `tauri-plugin-dialog`, `serde`, `serde_json`, `chrono` (local time), `dirs`, `thiserror`, `trash`.

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
- **Done when:** deleting `config.json` and relaunching shows the welcome screen and opens **no** dialog; "Choose draft directory…" opens the picker and cancelling it leaves the welcome screen up; "Use ~/Drafts instead" creates `~/Drafts` and opens the editor; relaunching doesn't show the welcome screen again.

### M3: Create + autosave
- `create_note`, `write_note`, `autosave.ts` (debounced autosave, 5 s by default and configurable, see M9; flush on blur, `Ctrl+S`, `close-requested`).
- The first keystroke in an unsaved draft calls `create_note`, and later saves call `write_note`.
- **Done when:** typing creates `2026-10-27 14-05.md` in the draft directory; a second draft in the same minute becomes `2026-10-27 14-05 (2).md`; closing the window mid-typing loses nothing; opening the app without typing creates no file.

### M4: Sidebar + open
- `list_notes`, `read_note`, sidebar UI, `Ctrl+B`, `Ctrl+N`, `Ctrl+O` (dialog filter: `md`, `txt`), `Ctrl+W`, title-bar dirty marker.
- Opening a `.txt` switches the editor to plain-text mode.
- **Done when:** drafts list newest-first, clicking switches files with no data loss, and external `.md`/`.txt` files open and save in place.

### M5: Quick switcher, rename, settings
- `Ctrl+P` overlay (simple subsequence fuzzy match, arrow keys + Enter, Esc closes), `Ctrl+Shift+R` rename, `Ctrl+,` change folder.
- **Done when:** all three work, and rename rejects `a:b` and existing names with a visible error.

### M6: Packaging
- `pnpm tauri build` → `.deb` and `.AppImage` in `src-tauri/target/release/bundle/`.
- Set `productName`, `identifier` (`dev.draftwick.app`), version `0.1.0`, and an app icon (`pnpm tauri icon <png>`; a simple generated placeholder is fine).
- **Done when:** the `.deb` installs on Ubuntu, Draftwick appears in the app launcher, and launches.

### M7: Menubar (built; needs a check in the real window, see below)
Add a menubar. **The menu below is the user's plan** (their wording; File/Help items first given earlier, the rest added later):

- **File:** New file · Open / Set draft directory · Save · Save as… (`Ctrl+Shift+S`) · Close · Quit (`Ctrl+Q`)
- **Edit:** Undo · Redo · Cut · Copy · Copy as HTML
- **View:** Show sidebar (conditional) · Toggle wrap · Enter full screen (`F11`)
- **Settings:** see M9
- **Help:** About · Keyboard shortcuts

Settled with the user: "Open/Set draft directory" is **one item**, and that is its name (it is the existing "change the draft directory" action). **Open** (a file) is a separate item, from the earlier File list. "Show sidebar (conditional)" is **one item with a tick** that is ticked while the sidebar is visible.

**Status of every item.** Built in the first batch, because they were already working as shortcuts or are tiny; held for later, with the reason, because each needs a design decision or a check in the real window that I can't do from here.

| Menu | Item | Shortcut | Status | Notes |
|---|---|---|---|---|
| File | New file | `Ctrl+N` | **Built** | Same action as before, now in the menu |
| File | Open | `Ctrl+O` | **Built** | |
| File | Open/Set draft directory | `Ctrl+,` | **Built** | The old "change draft directory" action, now with the user's name for it |
| File | Save | `Ctrl+S` | **Built** | Confirmed working in the real window |
| File | Save as… | `Ctrl+Shift+S` | Held, medium | See "Save as" below |
| File | Close | `Ctrl+W` | **Built** | Closes the note, not the window |
| File | Quit | `Ctrl+Q` | **Built** | Closes the window through the normal close path, so unsaved work is still asked about; also works on the welcome screen |
| Edit | Undo, Redo, Cut, Copy | | Held, needs design | See "Edit menu" below |
| Edit | Copy as HTML | | Held, bigger | Needs a Markdown renderer |
| View | Show sidebar | `Ctrl+B` | **Built** | A tick item; the tick follows the real state, including after `Ctrl+B` |
| View | Toggle wrap | | Held, easy | Decide together with the "word wrap column" setting (M9) |
| View | Enter full screen | `F11` | Held, easy | Needs keys without `Ctrl` in the shortcut code, a label that flips to "Exit full screen", and a check on GNOME |
| Settings | Open settings file, Reload settings | | **Built** | The first part of M9; the other settings are held |
| Help | About | | **Built** | In-app dialog, centred |
| Help | Keyboard shortcuts | | **Built** | Generated from the action table |

**Save as** (held): needs the `dialog:allow-save` permission and a save dialog; the name must end in `.md` or `.txt` (append `.md` if missing); after saving, the open note switches to the new path and the old file is left alone; whether the new location is inside the draft directory decides if it autosaves; the sidebar refreshes. Overwrite confirmation comes from the system dialog. Consent rule: it only happens when the user chooses it.

**Edit menu** (held), three separate problems:
1. **Accelerators would hijack keys.** A native accelerator for Undo/Redo/Cut/Copy (`Ctrl+Z/Y/X/C`) takes the key even when focus is in the small text boxes (rename, quick switcher, search panel) and would apply it to the editor instead. So these must be **click-only items without accelerators**, leaving the keys to whatever has focus. The action table then needs a display-only shortcut hint so the menu and Help can still show `Ctrl+Z`.
2. **Clipboard from a menu click.** A native menu click is not a user gesture inside the page, so the web clipboard calls may be refused by WebKitGTK. The options are a Tauri clipboard plugin (new dependency and permissions) or proving the web call works in the real window.
3. **Copy as HTML** needs a Markdown to HTML renderer (a new dependency, e.g. `marked`, or CodeMirror's syntax tree), sanitizing, and writing both `text/html` and `text/plain` to the clipboard.
Undo and Redo on their own are easy (CodeMirror commands), but only worth doing together with the click-only design in point 1.

**Decided: the app says "draft" and "draft directory", not "note" and "notes folder".** The user's menu says "draft directory", and the rest of the app now matches: the folder is the **draft directory**, a file in it is a **draft** (Go to draft, Rename draft, "Couldn't open draft"), and the default directory a button creates is `~/Drafts` (it was `~/Notes`). "File" is still used where the thing may be anywhere (New file, Open, Save as). Internal names are unchanged (`notes_dir` in `config.json`, `notes.rs`, `NoteMeta`...), because nobody sees them and renaming them would break existing config files for no benefit. Older sections of this plan still say "note" in places; read those as "draft". (The phrase "notes folder" has been replaced by "draft directory" throughout.)

Rules for the menubar:
- **Consent rule applies.** A menu item only runs when the user clicks it or presses its shortcut. Opening a menu never triggers a dialog, a save, or a file change.
- Show each item's shortcut next to it, and keep menu actions and shortcuts on **one code path** so they can't drift apart.
- File actions do nothing on the welcome screen (same as shortcuts), because there is no draft directory yet. Help stays available there, since it needs no folder.
- "Keyboard shortcuts" is generated from the same table as the real shortcut map, so the list can't go stale.

**Decided: native Tauri menu** (`tauri::menu`), not an in-app HTML menubar. It follows each platform's conventions and works with the macOS global menu bar.

**Decided: File → Close closes the note** (like `Ctrl+W`): it shows a new blank note and the window stays open. **Quit** (`Ctrl+Q`) is a separate item that closes the window, going through the same close path as the window's own close button, so unsaved work is still asked about.

**What "native" means for the implementation** (so the "one code path" rule still holds):
- **The menu is built in Rust** (`.menu(...)` on the Tauri builder, handled in `on_menu_event`). It needs no JS permissions beyond the existing event access.
- **A menu click reaches the same frontend action as the shortcut.** Rust emits an event carrying the item id; the frontend maps that id to the same function the keyboard shortcut calls (`newNote`, `openWithDialog`, `autosave.flush`, ...). Menu and shortcut must never have two implementations.
- **One table is the source of truth, and it lives in Rust:** each entry has an `id`, a label and an accelerator. Rust builds the menu from it and exposes it through a command, so Help → Keyboard shortcuts lists what is really bound and the frontend's shortcut map is built from the same data.
- **Accelerators can swallow keys.** A GTK menu accelerator may consume the key press before the webview sees it. This must be checked on Ubuntu when building: each shortcut must fire exactly once (not zero times, not twice), including while the editor has focus. Don't give a menu item an accelerator that clashes with a CodeMirror key until that is confirmed.
- **Edit menu items must drive CodeMirror**, not the webview's built-in undo/copy/paste. CodeMirror keeps its own undo history, so they emit events that run the editor commands, and they must be click-only (see "Edit menu" above).
- **Inert on the welcome screen:** items that need a draft directory start greyed out; the frontend calls `set_menu_enabled(true)` once a folder exists. The frontend also ignores the action itself, as a second guard.
- **About is an in-app dialog, not the native one.** The native GTK About dialog is created without a parent window, so the window manager places it wherever it likes (and Wayland does not let an app position a window), which left it off-centre. The in-app dialog is centred in the window at any size. Name, version and description come from the `get_about` command (package info and `Cargo.toml`), so they can't drift from the build.
- **Testing:** the frontend half (id → action, welcome-screen guard) can still be tested in the browser with the stand-in backend; the native menu itself can only be checked in the real window.

**What was built:** `src-tauri/src/menu.rs` (the action table, the menu, check items, the event bridge, `get_actions`, `set_menu_enabled`, `set_menu_checked`); `accelerators.ts`, `shortcutsHelp.ts`, and a single `runAction(id)` in `main.ts` that both menu clicks and key presses go through.

**Who owns each key (so it fires exactly once):** an action with a menu item (every item in the File and View menus) is taken by the native accelerator first. Because it was not possible to confirm from outside the real window whether GTK passes those keys through while the editor has focus, the frontend also listens for them as a safety net (`keyForMenuAction`): if the key reaches the page and the menu does not report the same action within 150 ms, the frontend runs it. If the menu's event arrives (in either order), the frontend does nothing, so the action never runs twice. Actions without a menu item (Go to note, Rename note) are bound by the frontend only. Moving an action into a menu is a one-line change to its `menu` field in the table.

**Still to verify in the real window on Ubuntu** (cannot be checked in a browser): File items are greyed out on the welcome screen. (Confirmed by the user in the real window: File → Save and `Ctrl+S` work.) A debug build prints `[menu] <id>` to the terminal for each native menu event.

**Dialog placement:** dialogs (About, Keyboard shortcuts, Save / Don't Save prompts) are centred in the window; the quick switcher and rename prompt stay near the top like a command palette.

- **Done when (for the built items):** the native menus above exist, every item does exactly what its shortcut does (and each shortcut still fires exactly once), menus are greyed out on the welcome screen, and Help → Keyboard shortcuts lists the real shortcuts.

### M8: Show / hide the sidebar (built)
**Requested by the user:** a way to hide and show the sidebar, and `Ctrl+B` toggles the sidebar state.

Where things stand today:
- **Built:** **View → Show sidebar** (`Ctrl+B`) is a tick item that is ticked while the sidebar is visible. `Ctrl+B`, a menu click, or both together toggle it exactly once, the tick always matches what is on screen, and focus returns to the editor.
- **Built:** the choice is remembered. It is saved as `sidebar_visible` in `config.json` whenever the user toggles it, and restored at startup (the menu tick is set to match). Restoring writes nothing back. A config with no saved choice, or an older config without the key, starts with the sidebar shown.

The work: give the existing toggle a proper, discoverable form, keep `Ctrl+B` as the toggle, and make sure there is still only **one code path** (`runAction("toggle_sidebar")`) for every way of triggering it.

**Decisions** (all settled):
1. ~~Where is the visible control?~~ **Decided by the user's menu plan: View → Show sidebar.** No extra on-screen button.
2. ~~Is the choice remembered between launches?~~ **Decided: yes**, defaulting to shown, stored as `sidebar_visible` in `config.json`.
3. ~~Should the menu item show its state?~~ **Decided: yes**, as a tick ("conditional" in the user's plan).

Rules:
- **The consent rule applies:** the sidebar only changes when the user toggles it (key, menu or button). Nothing hides or shows it on its own.
- **Keep `Ctrl+B` working exactly once.** If the action moves into a native menu, the menu's accelerator owns `Ctrl+B` and the M7 fallback (`keyForMenuAction`) covers the case where the key reaches the page instead; do not bind it a second way.
- After toggling, focus goes back to the editor, and toggling never touches the open note or its unsaved changes.
- It behaves the same on the welcome screen as other File actions: there is no sidebar to toggle until a draft directory exists.

- **Done when:** `Ctrl+B` and the menu item both toggle the sidebar, each press toggles it exactly once, the state is remembered across launches, and hiding or showing it never changes the open draft.

### M9: Settings (started: the settings file, the Settings menu and the autosave delay are built; the other settings are held)
**Requested by the user:** a Settings menu and these settings, with more to be added later.

**The user's question: a settings UI, or a settings file (like VS Code / Sublime)?** Recommendation: **a settings file first, a UI later.**
- **Why a file first:** the user already works in Sublime Text and VS Code and is used to editing a settings file; it is a fraction of the work of a UI (eight controls, validation and live preview); and a UI can be added later on top of the same file, so nothing is wasted.
- **Format: JSON, with comments allowed** (like Sublime and VS Code). Rust reads it itself (comments and trailing commas are blanked out, then it is parsed as strict JSON), so the rules are exactly what is documented. The first version used the `json5` crate, which was rejected because it silently accepts things that are not valid JSON (names without quotes, single quotes), so a mistake would not have been flagged. YAML is more error-prone to hand-edit (indentation) and `serde_yaml` is no longer maintained; TOML would also work (comments, Rust-native) if the user prefers it.
- **Where:** `settings.json` in the app's config folder, next to `config.json`.
- **The app never rewrites the user's file**, so their comments and layout survive. Defaults live in the code; the file only holds overrides.
- **Consent rule:** the file is **not** created at launch. It is created, filled with the defaults as comments, only when the user chooses **Settings → Open settings file** for the first time. That item opens it in **Draftwick's own editor** (see below).
- **Reloading:** there is no file watcher (out of scope for v1), so **Settings → Reload settings** applies changes. (Reloading when the window regains focus is a possible later addition.)
- **A bad value** is ignored (the default is used) and a toast names the key; it must never crash the app or overwrite the file.
- **One table, like the actions:** a single table in Rust lists each setting (key, type, default, valid range) and is exposed to the frontend, so adding a setting later is one entry plus the code that applies it.
- **Phase 2: a Settings dialog** that edits the same file. Writing it back would lose comments, so this needs a format-preserving approach or a decision to accept that.

**What is built so far** (`src-tauri/src/settings.rs`, plus `get_settings` and `prepare_settings_file`): the settings file is `settings.json` in the app's config folder (`~/.config/draftwick/`; before 2026-10-27 it was `~/.config/dev.draftwick.app/`, and files there are not moved automatically), read as strict JSON after comments and trailing commas are blanked out. **Settings → Open settings file** creates it on first use (every setting shown as a commented-out default; an existing file is never touched) and opens it in Draftwick's own editor. **Saving it applies the settings immediately**, and **Settings → Reload settings** re-reads the file at any time and says what changed. Problems are shown, not silent (see "Checking mistakes" below): an out-of-range value is clamped, a value of the wrong type falls back to the default, broken syntax uses all defaults, and an **unknown or repeated setting name is reported** so typos are noticed. The app only writes the file when the user saves their own edits. Adding a setting later means one more key in `settings.rs` plus the code that applies it.

**Why the settings file opens inside Draftwick, not in "the user's editor":** the first version handed the file to the system, which opens whatever the OS associates with `.json`. On the user's machine that is Firefox, so choosing the menu item opened a browser tab instead of an editor (the odd `file:///run/user/1000/doc/…` address is the system's file-sharing portal for a sandboxed browser). That depends on each machine's setup and cannot be fixed from inside the app, so the file now opens in Draftwick's own editor. A side benefit is that it works the same on every operating system.

**Checking mistakes in the settings file** (built). Both options the user asked about, checking while typing and checking on save, are done, and they use **one checker** (`check_settings` in `settings.rs`), so the editor and the app can never disagree about what is wrong.
- **While typing:** about 0.3 s after the last keystroke the text is checked. A mistake gets a red wavy underline, a red marker in the gutter, and a plain-English message on hover. Warnings (a value that was adjusted or ignored) get an amber underline and a yellow triangle. Fixing the mistake clears the marks. Only the settings file is checked; Markdown drafts never are.
- **What it catches, with the wording the user sees:** a missing comma between settings ("Expected a comma here. Did you forget one after the previous setting?", underlining the next setting), a setting name without quotes or with single quotes ("Setting names must be in double quotes"), a missing closing quote (underlines the unfinished text), a missing colon, a value like `3000ms`, an empty value, two commas in a row, a missing closing brace, text after the closing brace, a comment that is never closed, and a file that is not an object. A trailing comma is allowed (the file's own comments say so).
- **Warnings** for things the app can still use: a value outside 500 to 30000 (clamped), a value that is not a number, an unknown setting name (so typos are noticed), and a setting that appears twice (the last one wins).
- **On save:** the file is always saved (the user's work is never blocked), then applied. If it has a syntax mistake the toast says where ("Settings not applied. Line 3: ... Your previous settings are still in use.") and **the settings that were working are kept**; a typo does not reset everything to the defaults. At startup a broken file falls back to the defaults and says so.
- **Positions are exact:** offsets are in UTF-16 units (what CodeMirror uses), and comments are blanked to spaces of the same byte length, so accents, emoji, comments with non-ASCII text and Windows line endings do not shift an underline. 71 Rust tests pin the exact text each underline covers.
- **Only one mistake is shown at a time** for syntax errors, because the parser stops at the first one; fixing it reveals the next.

**Syntax highlighting for the settings file** (built): it is shown with colours for property names, strings, numbers, `true`/`false`/`null`, comments (including multi-line `/* ... */` ones) and punctuation, in both the dark and light themes. CodeMirror's own JSON grammar was tried first and rejected: it does not understand comments and flags every comment character as an error (123 errors on the default file), so a small purpose-built tokenizer (`src/jsonc.ts`) is used instead. It only colours text; it does not validate (the Rust side reports problems). A commented-out setting is one grey comment, and removing the `//` turns it into a coloured setting immediately. The Markdown colours are unchanged.

**An exception to "Draftwick edits only `.md` and `.txt`":** the settings file is the **one** other file the app will read or write. It is matched by its **exact path** inside the app's config folder, never by its extension, so no other `.json` (or any other file) can be opened or saved. It behaves like a file outside the draft directory: autosave is off, it is saved only with `Ctrl+S` or the Save button of the prompt, leaving it with unsaved edits asks first, it cannot be renamed, and it is not listed among the drafts. "Open settings file" waits for a draft directory (the editor is hidden on the welcome screen); "Reload settings" works from the start.

**The settings** (defaults as given by the user, or proposed by me and **confirmed by the user**):

| Setting | Key | Default | Notes |
|---|---|---|---|
| **Autosave delay** | `autosave_delay_ms` | **5000** (5 s) | **Built.** Allowed range **500 to 30000**; a value outside it is clamped and reported. How long to wait after the last keystroke; every keystroke restarts the wait. Drafts are still saved immediately when you switch drafts, lose focus or quit, so a long delay only affects how much typing is at risk if the app or computer stops suddenly. |
| Word wrap column | `wrap_column` | 0 (the window edge) | Soft wrap at this width, not a hard line break (confirm). Interacts with View → Toggle wrap; decide together. |
| Font family | `font_family` | system default text editor font | Use the generic `monospace`, which WebKitGTK maps to the system's monospace font. Today's list is JetBrains Mono, Ubuntu Mono, DejaVu Sans Mono. |
| Font size | `font_size` | 14 px | The editor is currently 15 px, so the default changes. |
| Dark or light mode | `theme` | `"system"` (confirmed) | Today the app follows the operating system. Proposal: `"system"`, `"dark"` or `"light"`, so today's behaviour stays the default. |
| Show line numbers | `line_numbers` | `false` (confirmed) | Matches today. |
| Tab size | `tab_size` | 4 | |
| Translate tabs to spaces | `tabs_to_spaces` | `true` (confirmed) | Today the Tab key is not bound in the editor, so it moves focus out of it. This setting means deciding what Tab does: insert indentation. |
| Auto indent | `auto_indent` | `true` (confirmed) | Matches today's Enter behaviour. |

**Effort, and why this is held for now:** each setting is small once the plumbing exists (read the file, validate, apply, reload), and that plumbing is the real work. Easy once it exists: font size, font family, theme, line numbers, tab size (CodeMirror compartments and CSS variables). A little more: tabs to spaces (Tab key behaviour), auto indent, and the wrap column (layout). The first stage of Draftwick does not need any of them, so the suggested order is: the plumbing plus the five easy settings first, the rest after.

**Settled:** the defaults above. **Going with my recommendations unless the user says otherwise:** the wrap column is a soft-wrap width (not a hard line break), and the settings file is JSON with comments.

---

## 6. Testing

- **Rust unit tests** (`cargo test` in `src-tauri`):
  - `note_filename` formats a given datetime as `YYYY-MM-DD HH-mm.md` (zero-padded month/day/hour/minute).
  - Collisions produce ` (2)`, ` (3)`.
  - `rename_note` validation rejects each forbidden char, empty names, and existing targets.
  - `list_notes` ignores other extensions and dotfiles and sorts by mtime descending (use a `tempfile` dev-dependency).
- **Manual checklist**: run through every milestone's "Done when" in `pnpm tauri dev` before calling the work finished. Report any that couldn't be checked.
- Frontend: no test framework in v1, but pure logic can have plain Node tests. `pnpm test` runs `tests/*.test.mjs` with Node's built-in runner (currently the settings-file tokenizer in `src/jsonc.ts`, including a check against the real default settings file).

---

## 7. Performance guardrails

- No UI framework, no CSS framework, no web fonts bundled (system fonts only).
- Load only the CodeMirror extensions listed above. **Don't** use the `codemirror` meta-package `basicSetup` (it pulls in line numbers, fold gutter, and autocomplete); compose the extensions by hand.
- Target: window visible with a usable editor in **< 500 ms** on a warm start, and idle memory **< 150 MB**. Measure once at M6 and report the numbers.

**Measured on 2026-10-27** (release build of commit `a342b74`, this Ubuntu machine, a throwaway config with five small drafts, run under XWayland with `GDK_BACKEND=x11`; averaged over four to five warm runs):
- **Start-up:** the window exists after about 70 ms, and the editor, sidebar and status bar are painted after **about 250 to 280 ms** (target under 500 ms: met). The paint time was found by polling the window's pixels, so it is accurate to a few milliseconds but not to a real Wayland session, which may differ slightly.
- **Idle memory** (10 seconds after start, nothing typed), as proportional set size (each shared page counted once): **about 151 MB** for the three processes together (the app 49 MB, WebKitWebProcess 95 MB, WebKitNetworkProcess 12 MB). The target is under 150 MB, so this is **at the limit, about 1 MB over**. Most of it is the system WebKit that Tauri uses, not our code. Adding up each process's plain resident size gives 406 MB, but that counts shared libraries three times and is not what the machine really uses.

---

## 8. Out of scope for v1

Tabs, markdown preview, file watching, subfolders, git, sync, spellcheck, plugins, themes beyond dark/light, Windows/macOS packaging and testing. Don't build these. List them as follow-ups at the end if relevant.
