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
- [ ] Measure start-up (target under 500 ms on a warm start) and idle memory (under 150 MB); write the numbers into `.claude/PLAN.md`.
- [x] Content-security policy is on (own files only; inline styles allowed for CodeMirror; IPC allowed). Checked by the user in a release build and in `pnpm tauri dev` on 2026-10-27.
- [ ] Replace the generated placeholder icon with a real one. Built, needs your check: an original icon (a page with a folded corner, three text lines, and a small flame as the "wick") drawn as `src-tauri/icons/icon.svg`, with every size generated from it by `pnpm tauri icon`. See it by rebuilding the packages (`pnpm tauri build`) or running `pnpm tauri dev`. Not yet a guarantee of repository acceptance: see the note on licensing and the Ubuntu archive in the conversation; the Snap Store is the easier route.

## Menu items held back (see M7 in `.claude/PLAN.md` for the reasons)

- [ ] **File > Save as…** (`Ctrl+Shift+S`). Medium: save dialog, `.md` or `.txt` only, the open draft switches to the new path, the old file is left alone.
- [ ] **Edit > Undo, Redo.** Easy, but they must be click-only items (no menu accelerator), or `Ctrl+Z` would be taken inside the small text boxes. Needs a display-only shortcut hint in the action table.
- [ ] **Edit > Cut, Copy.** Clipboard access from a menu click may be refused by the web view; needs proving in the real window, or a clipboard plugin.
- [ ] **Edit > Copy as HTML.** Needs a Markdown to HTML renderer, sanitising, and writing both HTML and plain text to the clipboard.
- [ ] **View > Toggle wrap.** Easy; decide together with the word wrap column setting.
- [ ] **View > Enter full screen** (`F11`). Needs shortcuts without `Ctrl`, two window permissions, and a label that flips to "Exit full screen".

## Settings (M9): the plumbing exists, each one is a key plus the code that applies it

- [ ] Word wrap column (default 70; soft wrap, not a line break).
- [ ] Font family (default: the system's monospace font).
- [ ] Font size (default 14 px; the editor is 15 px today).
- [ ] Theme: `system`, `dark` or `light` (default `system`). Built, needs your check: add `"theme": "light"` (or `"dark"`) to `settings.json`, save with `Ctrl+S`, and the window should switch at once; remove the line (or use `"system"`) and it should follow the operating system again. A wrong value (say `"blue"`) should underline and fall back to `system`. Also use it to check the sidebar right-click menu in light mode.
- [ ] Show line numbers (default `false`).
- [ ] Tab size (default 4).
- [ ] Translate tabs to spaces (default `true`). This also decides what the Tab key does: today it moves focus out of the editor.
- [ ] Auto indent (default `true`).
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
- [ ] Bring `.claude/PLAN.md` sections 3 and 4 up to date with the code, and say "draft" instead of "note" in the older sections.
- [ ] The default autosave delay (5000 ms) is written in two places: `settings.rs` and `main.ts`. Make it one.
- [ ] The editor keys listed in Help > Keyboard shortcuts are a fixed list; keep them in step with `editor.ts`, or generate them.
