/*
 * A stand-in for the Tauri backend, so the frontend can be tried in an ordinary browser.
 * Everything lives in memory and disappears on reload. Served only by `pnpm dev:standin`
 * (vite.standin.config.ts); it is not part of the app.
 *
 * What it is not: it does not check settings.json (get_settings returns the defaults and
 * check_settings finds nothing), and the menu, accelerators, system dialogs and window are
 * not real. Those only the real window shows.
 *
 * Handy in the browser console:
 *   __standin.emit("menu-action", "save_as")  pretend a menu item was clicked
 *   __standin.dialog = "/standin/Drafts/x.md" the path the next open/save dialog returns
 *   __standin.files                           the files, as { path: { text, modified } }
 * Open the page with ?welcome to start with no draft directory (the welcome screen).
 */
(() => {
  const DIR = "/standin/Drafts";
  const CONFIG_DIR = "/standin/config";
  const now = Date.now();
  const files = {
    [`${DIR}/2026-10-27 09-30.md`]: { text: "# Standup\n\n- ship the status bar\n- check the icon\n", modified: now - 3_600_000 },
    [`${DIR}/2026-10-26 16-05.md`]: { text: "Ideas for **Draftwick**:\n\n1. font settings\n2. save as\n", modified: now - 86_400_000 },
    [`${DIR}/shopping.txt`]: { text: "milk\neggs\nbread\n", modified: now - 172_800_000 },
  };
  const state = {
    config: {
      notes_dir: new URLSearchParams(location.search).has("welcome") ? null : DIR,
      sidebar_visible: null,
      word_wrap: null,
    },
    settings: {
      autosave_delay_ms: 5000, theme: "system", font_size: 14, font_family: "", wrap_column: 0,
      show_line_numbers: false, tab_size: 4, translate_tabs_to_spaces: true,
    },
    menu: {},
    fullscreen: false,
    dialog: null,
  };

  const fail = (kind, message) => Promise.reject({ kind, message });
  const ext = (p) => (p.includes(".") ? p.slice(p.lastIndexOf(".") + 1).toLowerCase() : "");
  const base = (p) => p.slice(p.lastIndexOf("/") + 1);
  const needNote = (p) => (["md", "txt"].includes(ext(p)) || p === `${CONFIG_DIR}/settings.json` ? null : fail("error", "Only .md and .txt files can be opened"));
  const meta = (p) => ({ path: p, name: base(p), modified_ms: files[p].modified, ext: ext(p) });
  const inDir = (p) => state.config.notes_dir !== null && p.startsWith(state.config.notes_dir + "/");

  // ---- events: the app listens for "menu-action" and the window's close request ----
  let nextCallback = 1;
  const callbacks = new Map();
  const listeners = [];
  const emit = (event, payload) => {
    for (const l of listeners.filter((x) => x.event === event)) {
      callbacks.get(l.handler)?.({ event, id: l.id, payload });
    }
  };

  const commands = {
    get_actions: () => fetch("/__standin/actions.json").then((r) => r.json()),
    get_about: () => ({ name: "Draftwick", version: "0.0.0-standin", description: "Fast Markdown and text drafts (browser stand-in)." }),
    set_menu_enabled: ({ enabled }) => { state.menu.enabled = enabled; },
    set_menu_checked: ({ id, checked }) => { state.menu[id] = checked; },
    set_menu_text: ({ id, text }) => { state.menu[id] = text; },
    get_settings: () => ({ settings: state.settings, problems: [], valid: true }),
    check_settings: () => [],
    prepare_settings_file: () => {
      const path = `${CONFIG_DIR}/settings.json`;
      files[path] ??= { text: '{\n  // stand-in settings file (not checked here)\n  // "theme": "light"\n}\n', modified: Date.now() };
      return path;
    },
    get_config: () => ({ ...state.config }),
    set_notes_dir: ({ path }) => { state.config.notes_dir = path; return { ...state.config }; },
    default_notes_dir: () => DIR,
    set_sidebar_visible: ({ visible }) => { state.config.sidebar_visible = visible; },
    set_word_wrap: ({ enabled }) => { state.config.word_wrap = enabled; },
    is_in_notes_dir: ({ path }) => inDir(path),
    list_notes: () =>
      Object.keys(files)
        .filter((p) => inDir(p) && !p.slice(state.config.notes_dir.length + 1).includes("/") && ["md", "txt"].includes(ext(p)))
        .map(meta)
        .sort((a, b) => b.modified_ms - a.modified_ms || b.name.localeCompare(a.name)),
    read_note: ({ path }) => needNote(path) ?? (path in files ? files[path].text : fail("missing", `"${base(path)}" no longer exists`)),
    write_note: ({ path, content, createIfMissing }) =>
      needNote(path) ??
      (!(path in files) && !createIfMissing
        ? fail("missing", `"${base(path)}" no longer exists`)
        : ((files[path] = { text: content, modified: Date.now() }), meta(path))),
    create_note: ({ content }) => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const stem = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
      let path = `${state.config.notes_dir}/${stem}.md`;
      for (let n = 2; path in files; n++) path = `${state.config.notes_dir}/${stem} (${n}).md`;
      files[path] = { text: content, modified: Date.now() };
      return meta(path);
    },
    rename_note: ({ path, newStem }) => {
      if (/[/\\:*?"<>|]/.test(newStem) || !newStem.trim()) return fail("error", "That name isn't allowed");
      const target = `${path.slice(0, path.lastIndexOf("/") + 1)}${newStem.trim()}.${ext(path)}`;
      if (target !== path && target in files) return fail("error", `A draft named "${base(target)}" already exists`);
      files[target] = files[path];
      if (target !== path) delete files[path];
      return meta(target);
    },
    trash_note: ({ path }) => { delete files[path]; },

    // ---- plugins ----
    "plugin:dialog|open": () => { const d = state.dialog; state.dialog = null; return d; },
    "plugin:dialog|save": () => { const d = state.dialog; state.dialog = null; return d; },
    "plugin:event|listen": ({ event, handler }) => {
      const id = nextCallback++;
      listeners.push({ event, handler, id });
      return id;
    },
    "plugin:event|unlisten": () => {},
    "plugin:window|set_title": () => {},
    "plugin:window|is_fullscreen": () => state.fullscreen,
    "plugin:window|set_fullscreen": ({ value }) => { state.fullscreen = value; },
    "plugin:window|close": () => emit("tauri://close-requested"),
    "plugin:window|destroy": () => {},
  };

  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback: (callback) => { const id = nextCallback++; callbacks.set(id, callback); return id; },
    unregisterCallback: (id) => callbacks.delete(id),
    convertFileSrc: (p) => p,
    invoke: async (cmd, args = {}) => {
      const run = commands[cmd];
      if (!run) return fail("error", `The stand-in has no command "${cmd}"`);
      console.debug("[standin]", cmd, args);
      return run(args);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__standin = Object.assign(state, { files, emit });
})();
