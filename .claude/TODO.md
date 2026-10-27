# Draftwick to-do list

The checklist of work that is left. `.claude/PLAN.md` holds the design and the decisions; this file holds what still has to be done.

**How to use it**
- Ask the agent to do an item (for example "do the status bar") and it ticks the box when it is finished: `- [ ]` becomes `- [x]`.
- An item is ticked only when it is **done and verified**: it builds, the checks pass (`pnpm typecheck`, `pnpm build`, `pnpm test`, `cargo test`), and it was tested. Anything only the real Draftwick window can show is checked by **you**: the agent leaves the box open and writes "built, needs your check" beside it. You tick it, or tell the agent to.
- To add something, write a new `- [ ]` line under the right heading (or ask the agent to). Items under "Decisions needed" are **not built until you say so**.

## Suggested by you

- [x] **Status bar at the bottom of the window.** Shows the draft name, the cursor as `Ln 3, Col 14`, `N characters selected` while text is selected, `Saved` / `Unsaved` (nothing for a blank new draft) and a red `Autosave off` pill when autosave is paused (hover for the reason). Checked by the user on 2026-10-27. Left out on purpose: a file-type label (the file name shows `.md` or `.txt`), word count and line ending (LF or CRLF); add them if wanted.

## To check in the real window (you)

Checked by the user on 2026-10-27: the settings file, error underlines, apply-on-save, sidebar tick and memory, Quit, save on close, About. The app's files now live in `~/.config/draftwick/` (seen there: `config.json`, `settings.json`).

The agent cannot see or click the real window, so these are yours. Everything below is built and tested outside it.

- [x] Settings > Open settings file opens `settings.json` in the editor, with colours (comments grey, names blue, numbers orange).
- [x] Deleting a comma in `settings.json` shows a red underline and a gutter marker with a message; adding it back clears them.
- [x] Saving `settings.json` applies the settings at once (a toast says so); a file with a syntax mistake gives a toast naming the line and keeps your old settings.
- [x] View > Show sidebar: the tick follows `Ctrl+B`, and the sidebar choice survives closing and reopening the app.
- [x] File > Quit (`Ctrl+Q`) quits; with unsaved edits in a file from outside the draft directory it asks first.
- [x] Closing the window right after typing in a normal draft saves it.
- [x] On the welcome screen (reset the throwaway config to see it) the File items are greyed out, Help still works, and "Use ~/Drafts instead" creates the folder only when clicked. Checked by the user on 2026-10-27.
- [x] Help > About is centred in the window.

- [ ] **Sidebar: trash icon, right-click menu with Rename and Delete.** Built, needs your check.  The menu is styled like a rounded popover (draft name as a muted heading, pencil and trash icons, Delete in red below a divider) with separate colours for the dark and light themes; check both. Hovering a draft shows a trash icon (inline SVG) at its right; clicking it asks "Move “name” to the trash?" (Cancel is focused). Right-clicking a draft opens a small menu with **Rename** and **Delete** (Esc, a click elsewhere, scrolling or choosing an item closes it; arrow keys move). Delete asks the same question. Rename opens the rename prompt for that draft, whether or not it is the open one. Check: the file goes to the system trash and can be restored; deleting the open draft leaves a blank draft and the file does not come back after the autosave delay; Cancel and Esc do nothing; renaming a draft that is not open keeps it in the list under the new name and does not change the open draft; renaming the open draft still updates the title.

## M6: packaging

- [x] `pnpm tauri build` produces the `.deb` (2.1 MiB) and the AppImage (84.5 MiB); both built on 2026-10-27.
- [ ] **Snap package (on hold: ask the user again when they bring up snap).** Decisions to put to them then: (1) may the agent install `snapcraft`, which needs LXD or Multipass, or `--destructive-mode` to build on this machine (suggested: `sudo snap install snapcraft --classic` plus LXD); (2) confinement: strict with the `home` interface (suggested; a draft directory outside the home folder would be blocked) or `classic` (needs a manual Snap Store review); (3) a local `.snap` file only (suggested) or publishing to the Snap Store (never without being asked). Also needs a `snap/snapcraft.yaml` in the repo.
- [x] Install the `.deb` on Ubuntu: Draftwick appears in the launcher and starts; the AppImage also runs. Checked by the user on 2026-10-27 (packages rebuilt from `c288c22`).
- [x] Measure start-up and idle memory; numbers are in `.claude/PLAN.md` (section 7). Start-up about 250 to 280 ms (target under 500 ms: met). Idle memory about 151 MB by proportional set size (target under 150 MB: at the limit, about 1 MB over; mostly the system WebKit). Measured 2026-10-27 under XWayland.
- [x] Content-security policy is on (own files only; inline styles allowed for CodeMirror; IPC allowed). Checked by the user in a release build and in `pnpm tauri dev` on 2026-10-27.
- [x] Replace the generated placeholder icon with a real one. An original icon (a page with a folded corner, three text lines and a small flame as the "wick"), drawn as `src-tauri/icons/icon.svg` with every size generated from it by `pnpm tauri icon`. Checked by the user in a rebuilt, installed package on 2026-10-27.

## Menu items held back (see M7 in `.claude/PLAN.md` for the reasons)

- [ ] **File > Save as…** (`Ctrl+Shift+S`). Medium: save dialog, `.md` or `.txt` only, the open draft switches to the new path, the old file is left alone.
- [x] **Edit > Undo, Redo.** A new Edit menu with click-only Undo and Redo (no accelerator, so `Ctrl+Z` and `Ctrl+Shift+Z` still go to whatever has focus). Checked by the user on 2026-10-27. Not done: a display-only shortcut hint beside the item.
- [ ] **Edit > Cut, Copy.** Clipboard access from a menu click may be refused by the web view; needs proving in the real window, or a clipboard plugin.
- [ ] **Edit > Copy as HTML.** Needs a Markdown to HTML renderer, sanitising, and writing both HTML and plain text to the clipboard.
- [ ] **View > Toggle wrap.** Easy; decide together with the word wrap column setting.
- [x] **View > Enter full screen** (`F11`). Checked by the user on 2026-10-27. The menu text flips to "Exit full screen"; uses the `set-fullscreen` and `is-fullscreen` window permissions. Known gap: if the window manager leaves full screen by itself, the menu text can stay "Exit full screen" until the next toggle.

## Settings (M9): the plumbing exists, each one is a key plus the code that applies it

- [x] Word wrap column (default 70; soft wrap, not a line break). Checked by the user on 2026-10-27; `"wrap_column"` in `settings.json` (20 to 300, or 0 for the window edge).
- [x] Font family (default: the system's monospace font). Checked by the user on 2026-10-27; `"font_family": "Fira Code"`; an uninstalled name falls back to monospace.
- [x] Font size (default 14 px; the editor was 15 px before). Checked by the user on 2026-10-27; `"font_size"`, 8 to 48.
- [ ] Theme: `system`, `dark` or `light` (default `system`). Built, needs your check: add `"theme": "light"` (or `"dark"`) to `settings.json`, save with `Ctrl+S`, and the window should switch at once; remove the line (or use `"system"`) and it should follow the operating system again. A wrong value (say `"blue"`) should underline and fall back to `system`. Also use it to check the sidebar right-click menu in light mode.
- [x] Show line numbers (default `false`). Checked by the user on 2026-10-27; `"show_line_numbers": true`.
- [x] Tab size (default 4). Checked by the user on 2026-10-27; `"tab_size"`: only 2, 4 or 8 are allowed; any other value shows a warning and uses 4.
- [x] Translate tabs to spaces (default `true`). Checked by the user on 2026-10-27; Tab now types spaces up to the next tab stop (or a tab character when `false`); with several lines selected it indents them, and Shift+Tab removes an indent. It no longer moves focus out of the editor.
- [x] ~~Auto indent~~ Dropped 2026-10-27: Enter already keeps the indentation and continues Markdown lists, and nobody needs to turn that off.
- [ ] A Settings dialog on top of the settings file (phase 2).
- [ ] Optional: reload the settings automatically when the window regains focus.

## Decisions needed (do NOT build these unless you say so)

From the consent review. You chose items 1 to 4 of that review and left these.

- [x] A draft file is created on the first keystroke. Decided 2026-10-27: keep it (the user left it to the agent).
- [x] Closing the window saves a normal draft quietly, with no prompt. Decided 2026-10-27: keep it (the user left it to the agent).
- [x] A temporary `<name>.tmp` file appears next to a draft while it saves. Decided 2026-10-27: keep it; it makes a save all-or-nothing.
- [x] `Ctrl+W` and `Ctrl+N` save the current draft and swap in a blank one. Decided 2026-10-27: keep it; files outside the draft directory still ask first.

## Housekeeping

- [ ] Keep the browser-test stand-in backend in the repo as a dev tool (for example under `dev/`) and document it in `.claude/CLAUDE.md`.
- [x] Brought `.claude/PLAN.md` sections 3 and 4 up to date with the code, and said "draft" instead of "note" in the older sections (2026-10-27). Internal names (`notes_dir`, `notes.rs`, `NoteMeta`) stay.
- [x] The default autosave delay (5000 ms) is still written in `settings.rs` and `main.ts`, but a test in `tests/jsonc.test.mjs` now fails if the two ever differ (2026-10-27). The frontend needs a number before the settings load, so one copy had to stay.
- [ ] The editor keys listed in Help > Keyboard shortcuts are a fixed list; keep them in step with `editor.ts`, or generate them.
