import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
// @ts-expect-error plain JavaScript, shared with the tests
import { parseActions } from "./dev/actions.mjs";

/**
 * A dev server for trying the frontend in an ordinary browser, with no Tauri window: it adds
 * dev/standin.js (a fake backend kept in memory) to the page and serves the real action table.
 * Nothing here is part of the app or its build. See "Trying the frontend in a browser" in
 * .claude/CLAUDE.md.
 */
function standin(): Plugin {
  return {
    name: "draftwick-standin",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html.replace(
          '<script type="module" src="/src/main.ts"></script>',
          '<script src="/dev/standin.js"></script>\n    <script type="module" src="/src/main.ts"></script>',
        ),
    },
    configureServer(server) {
      server.middlewares.use("/__standin/actions.json", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(parseActions(readFileSync("src-tauri/src/menu.rs", "utf8"))));
      });
    },
  };
}

// A different port from `pnpm tauri dev` (1420), so both can run at once.
export default defineConfig({
  clearScreen: false,
  plugins: [standin()],
  server: { port: 1421, strictPort: true },
});
