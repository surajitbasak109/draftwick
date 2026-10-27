# Draftwick to-do list

The checklist of work that is left. `.claude/PLAN.md` holds the design and the decisions; this file holds what still has to be done.

**How to use it**
- Ask the agent to do an item (for example "do the status bar") and it ticks the box when it is finished: `- [ ]` becomes `- [x]`.
- An item is ticked only when it is **done and verified**: it builds, the checks pass (`pnpm typecheck`, `pnpm build`, `pnpm test`, `cargo test`), and it was tested. Anything only the real Draftwick window can show is checked by **you**: the agent leaves the box open and writes "built, needs your check" beside it. You tick it, or tell the agent to.
- To add something, write a new `- [ ]` line under the right heading (or ask the agent to). Items under "Decisions needed" are **not built until you say so**.

## Needs information from you

- [ ] **The second feature** from your "two more functionality" message. Only the JSON highlighting was listed. What was it?

## Suggested by you

- [ ] **Status bar at the bottom of the window.** Needs a decision first: what should it show? Candidates: the draft's name, line and column, "Saved" / "Unsaved" / "Autosave off", word count, line ending (LF or CRLF).

## To check in the real window (you)

The agent cannot see or click the real window, so these are yours. Everything below is built and tested outside it.

- [ ] Settings > Open settings file opens `settings.json` in the editor, with colours (comments grey, names blue, numbers orange).
- [ ] Deleting a comma in `settings.json` shows a red underline and a gutter marker with a message; adding it back clears them.
- [ ] Saving `settings.json` applies the settings at once (a toast says so); a file with a syntax mistake gives a toast naming the line and keeps your old settings.
- [ ] View > Show sidebar: the tick follows `Ctrl+B`, and the sidebar choice survives closing and reopening the app.
- [ ] File > Quit (`Ctrl+Q`) quits; with unsaved edits in a file from outside the draft directory it asks first.
- [ ] Closing the window right after typing in a normal draft saves it.
- [ ] On the welcome screen (reset the throwaway config to see it) the File items are greyed out, Help still works, and "Use ~/Drafts instead" creates the folder only when clicked.
- [ ] Help > About is centred in the window.

## M6: packaging

- [ ] `pnpm tauri build` produces the `.deb` and the AppImage.
- [ ] Install the `.deb` on Ubuntu: Draftwick appears in the launcher and starts.
- [ ] Measure start-up (target under 500 ms on a warm start) and idle memory (under 150 MB); write the numbers into `.claude/PLAN.md`.
- [ ] Turn the content-security policy on (it is `null` now) and check that the app and `pnpm tauri dev` still work.
- [ ] Replace the generated placeholder icon with a real one.

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
- [ ] Theme: `system`, `dark` or `light` (default `system`).
- [ ] Show line numbers (default `false`).
- [ ] Tab size (default 4).
- [ ] Translate tabs to spaces (default `true`). This also decides what the Tab key does: today it moves focus out of the editor.
- [ ] Auto indent (default `true`).
- [ ] A Settings dialog on top of the settings file (phase 2).
- [ ] Optional: reload the settings automatically when the window regains focus.

## Decisions needed (do NOT build these unless you say so)

From the consent review. You chose items 1 to 4 of that review and left these.

- [ ] A draft file is created on the first keystroke. Alternatives: create it on the first `Ctrl+S`, or ask for a name.
- [ ] Closing the window saves a normal draft quietly, with no prompt. Alternative: prompt when there are unsaved changes.
- [ ] A temporary `<name>.tmp` file appears next to a draft while it saves. Alternatives: write in place, or put the temp file elsewhere.
- [ ] `Ctrl+W` and `Ctrl+N` save the current draft and swap in a blank one.

## Housekeeping

- [ ] Keep the browser-test stand-in backend in the repo as a dev tool (for example under `dev/`) and document it in `.claude/CLAUDE.md`.
- [ ] Bring `.claude/PLAN.md` sections 3 and 4 up to date with the code, and say "draft" instead of "note" in the older sections.
- [ ] The default autosave delay (5000 ms) is written in two places: `settings.rs` and `main.ts`. Make it one.
- [ ] The editor keys listed in Help > Keyboard shortcuts are a fixed list; keep them in step with `editor.ts`, or generate them.
