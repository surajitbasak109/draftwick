# Draftwick

A small cross-platform desktop editor for quick drafts (meeting notes, pasted chat or web text), built to replace Sublime Text for that one job. Tauri 2 (Rust) + vanilla TypeScript + CodeMirror 6, bundled with Vite. It edits Markdown and text drafts only (`.md`, `.txt`), with one exception: its own `settings.json`.

`.claude/PLAN.md` is the spec and the history. **Read its "Status and next steps" section first.** `.claude/TODO.md` is the checklist of what is left (see "The task list" below). It was written before the build and updated as decisions were made, so where an older section disagrees with a newer note (M7 to M9, the "Decided" lines), the newer one wins.

## Rules from the user (follow these)

- **Consent: nothing happens unless the user asked for it.** No system dialog on launch; no folder or file created, changed or recreated without an explicit action (a clicked button, menu item or shortcut). If you find or add behaviour that acts on its own, say so and offer alternatives instead of shipping it quietly.
- **Use pnpm**, never npm or npx. There must be no `package-lock.json`; `pnpm-lock.yaml` is the lockfile.
- **Say "draft" and "draft directory"** in anything the user sees, not "note" or "notes folder". Internal names keep the old words on purpose (`notes_dir` in `config.json`, `notes.rs`, `NoteMeta`): renaming them would break existing config files for no benefit.
- **Commit only when asked, and never push** (the repo has no remote). One commit per request, with a message that explains the why; see `git log` for the style.
- Ask rather than guess on product decisions. The plan records the ones already made.

## The task list

`.claude/TODO.md` holds the pending work as checkboxes. When the user asks you to do an item, do it, and tick its box (`- [x]`) **only when it is finished and verified**: it builds, the checks pass, and you tested it. If it can only be confirmed in the real window, leave the box open and write "built, needs your check" next to it; the user ticks it. Add items the user asks for under the right heading, and do not build anything under "Decisions needed" unless they say so. `.claude/PLAN.md` keeps the design and the decisions; `.claude/TODO.md` keeps what remains.

## Commands

- `pnpm install`
- `pnpm tauri dev` runs the app. The dev server port is fixed at 1420. Changing a Rust file rebuilds and restarts the window. To test without touching the user's real settings, give it a throwaway config folder: `XDG_CONFIG_HOME=/tmp/draftwick-xdg pnpm tauri dev` (the app's files then live in `$XDG_CONFIG_HOME/dev.draftwick.app/`).
- `pnpm typecheck`, `pnpm build`, and `pnpm test` (Node's built-in runner over `tests/*.test.mjs`; it imports `src/*.ts` directly).
- `cd src-tauri && cargo test`. If `cargo` is not found, run `source ~/.cargo/env` first.
- Before finishing a change: typecheck, build, `pnpm test` and `cargo test` should all pass.

## How it is put together

**Rust (`src-tauri/src`)**
- `menu.rs` holds **the action table** (`ACTIONS`: id, label, accelerator, menu, needs_folder, check). It is the single source of truth for the native menu, the key bindings and Help > Keyboard shortcuts. Adding a user-facing action means a row there plus a handler in `main.ts` (`handlers`).
- `notes.rs`: draft files (list, read, write, create, rename). Writes are atomic. New drafts are named `YYYY-MM-DD HH-mm.md`, with ` (2)` added on a clash. `write_note` takes `create_if_missing`; a missing file gives `AppError::Missing` (`kind: "missing"`).
- `config.rs`: `config.json`, the app's own state (`notes_dir`, `sidebar_visible`). Change it with `update()`, which keeps the other fields.
- `settings.rs`: `settings.json`, edited by the user and never rewritten by the app. `analyze()` is the one checker behind both the live underlines (`check_settings`) and applying settings (`get_settings`). Adding a setting means a field in `Settings`, a match arm in `analyze`, and the frontend code that applies it.
- `error.rs`: `AppError` serialises as `{ kind, message }`. `lib.rs` registers the plugins, the menu and every command.

**Frontend (`src`)**
- `main.ts`: the open draft (`current`), actions (`handlers`, `runAction`), start-up, the autosave policy, the welcome screen, settings handling.
- `autosave.ts` (debounce, `flush(explicit)`), `editor.ts` (CodeMirror; keeps each file's line endings), `api.ts` (typed `invoke` wrappers; JS arguments are camelCase, Rust's are snake_case, e.g. `createIfMissing`), `jsonc.ts` (tokenizer for JSON with comments), and small overlays (`choice.ts`, `about.ts`, `shortcutsHelp.ts`, `switcher.ts`, `rename.ts`).

## Behaviour that must not break

- `autosaveOffReason()` in `main.ts` decides what may autosave: only drafts inside the draft directory, with uniform line endings, not emptied, whose file still exists. Everything else saves only on an explicit Save, and leaving it with unsaved edits asks Save / Don't Save / Cancel (`settleCurrent`).
- Saves say whether the user asked for them (`flush(explicit)`). Saves the app starts itself re-check at run time that autosave is still allowed.
- Each shortcut has one owner. Actions with a menu item use the native accelerator, with the frontend fallback `keyForMenuAction` so it fires exactly once either way. The rest are bound by the frontend.
- `settings.json` is the one non-draft file the app reads or writes, matched by its exact path in `notes.rs`. No other `.json` may be opened.
- Window and dialog API calls need a permission in `src-tauri/capabilities/default.json`.

## Working notes and pitfalls

- You cannot see or click the real Tauri window. Check frontend logic in the built-in browser against Vite (`http://localhost:1420`) using a **temporary stand-in backend**: a copy of `index.html` with an inline script that defines `window.__TAURI_INTERNALS__` (`invoke`, `transformCallback`, `metadata`) and implements the commands in memory. It is not kept in the repo, so delete any you create before committing. Whatever only the real window shows (native menu, accelerators, system dialogs, permissions) has to be checked by the user; say so plainly instead of claiming it works.
- A debug build prints `[menu] <id>` to the terminal for each native menu event, and the dev log forwards the page's console warnings.
- Vite can serve a **stale transform** when a file is edited twice within milliseconds. If the app seems to run old code, `touch` the file.
- Do not `pkill -f` a pattern that also appears in your own command line.
