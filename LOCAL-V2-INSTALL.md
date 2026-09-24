# Local V2 install (pre-publish)

The `./tui-v2` entrypoint in this branch is not on npm yet (PR #99 pending merge).
To install it locally on OpenCode 2.x without rebuilding:

1. Install the prebuilt package into the OpenCode config dir:

   ```sh
   cd ~/.config/opencode
   npm i --ignore-scripts <tarball-or-checkout-of-this-branch>
   ```

   `--ignore-scripts` is needed because `prepack` calls `pnpm run build`.

2. OpenCode V2 only loads TUI plugins from `cli.json` `plugins` as a
   **directory with a `tui.js` entry** (or an npm specifier). Loose `.js`/`.tsx`
   file paths are silently skipped. Create the wrapper:

   ```sh
   mkdir -p ~/.config/opencode/tui-plugins/subagent-monitor
   # tui.js: re-export the built plugin
   ```

   ```js
   // ~/.config/opencode/tui-plugins/subagent-monitor/tui.js
   export { default } from "../../node_modules/opencode-subagent-statusline/dist/tui-v2.js";
   ```

3. Register it in `cli.json`:

   ```json
   { "plugins": ["./tui-plugins/subagent-monitor"] }
   ```

4. Restart OpenCode. The `dist/` directory in this branch contains the exact
   build (v0.7.0) validated on OpenCode 2.0.16.

Known gotchas (verified on 2.0.16):

- An npm specifier for an unpublished package (e.g. `opencode-subagent-statusline/tui-v2`)
  triggers `NpmInstallFailedError` at `stage=prepare` because the host installs
  it from the registry.
- Loose file paths in `cli.json` `plugins` load nothing and log nothing.
