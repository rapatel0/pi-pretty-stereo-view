import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import stereoView from "./stereo-view/index.js";
import powerlineFooter from "./powerline/index.js";
import prettyTui from "./pretty-tui/index.js";
import { installSidebarHost } from "./integrated/sidebar-host.js";
import { registerSettingsPanel } from "./integrated/settings-panel.js";

/**
 * One package, one entry: pi-stereo-view split history, pi-powerline-footer
 * status bar, pi-pretty-tui rendering (optionally without side borders), and a
 * toggleable pi-ui-extension-style sidebar. Registration order matches the
 * order the standalone packages were loaded before bundling.
 */
export default async function piPrettyStereoView(pi: ExtensionAPI): Promise<void> {
  await stereoView(pi);
  powerlineFooter(pi);
  prettyTui(pi);
  const sidebarControls = installSidebarHost(pi);
  registerSettingsPanel(pi, sidebarControls);
}
