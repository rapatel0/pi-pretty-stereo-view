/**
 * `/ui-settings` — one settings surface for the whole bundle. Each section
 * drives its extension's live bridge (or the sidebar host's own controls),
 * so changes take effect immediately and persist through exactly the same
 * code paths as the individual `/sidebar`, `/pretty-tui`, `/stereo-view`,
 * and `/powerline` commands. There is no second source of truth here.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  getPowerlineBridge,
  getPrettyTuiBridge,
  getStereoBridge,
  type PowerlineBridge,
  type PrettyTuiBridge,
} from "./bridges.js";
import type { SidebarControls } from "./sidebar-host.js";
import { PRESETS } from "../powerline/presets.js";

type MenuExit = "back" | "exit";

export function registerSettingsPanel(pi: ExtensionAPI, sidebar: SidebarControls): void {
  pi.registerCommand("ui-settings", {
    description: "All bundle settings in one panel (sidebar, pretty-tui, stereo split, powerline)",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("The settings panel needs interactive mode", "warning");
        return;
      }
      await rootMenu(ctx, sidebar);
    },
  });
}

const section = (name: string, status: string): string => `${name} — ${status}`;

async function rootMenu(ctx: ExtensionContext, sidebar: SidebarControls): Promise<void> {
  for (;;) {
    const pretty = getPrettyTuiBridge();
    const stereo = getStereoBridge();
    const powerline = getPowerlineBridge();
    const choice = await ctx.ui.select("pi-pretty-stereo-view — settings", [
      section("Sidebar", sidebar.statusLine()),
      section("Pretty TUI", pretty ? pretty.statusLine() : "not available in this session"),
      section("Stereo split", stereo ? stereo.statusLine() : "not mounted yet (appears with the first reply)"),
      section("Powerline", powerline ? powerline.statusLine() : "not available in this session"),
      "Exit",
    ]);
    if (!choice || choice === "Exit") return;
    let result: MenuExit = "back";
    if (choice.startsWith("Sidebar — ")) {
      result = await sidebarMenu(ctx, sidebar);
    } else if (choice.startsWith("Pretty TUI — ") && pretty) {
      result = await prettyMenu(ctx, pretty);
    } else if (choice.startsWith("Stereo split — ")) {
      if (stereo) await stereo.openSettings(ctx.ui);
      else ctx.ui.notify("The stereo split appears after the first assistant reply", "info");
    } else if (choice.startsWith("Powerline — ") && powerline) {
      result = await powerMenu(ctx, powerline);
    }
    if (result === "exit") return;
  }
}

async function sidebarMenu(ctx: ExtensionContext, sidebar: SidebarControls): Promise<MenuExit> {
  for (;;) {
    const choice = await ctx.ui.select(`Sidebar — ${sidebar.statusLine()}`, [
      sidebar.isEnabled() ? "Turn off" : "Turn on",
      "Change width…",
      sidebar.autoHideBelow() === 0
        ? "Auto-hide on narrow screens: off"
        : `Auto-hide on narrow screens: below ${sidebar.autoHideBelow()} columns`,
      "Back",
    ]);
    if (!choice || choice === "Back") return "back";
    if (choice === "Turn on" || choice === "Turn off") {
      sidebar.setEnabled(choice === "Turn on");
    } else if (choice === "Change width…") {
      const value = await ctx.ui.input("Sidebar width", "columns (24–48); blank = auto (20%)");
      if (value === undefined) continue;
      const trimmed = value.trim();
      if (trimmed === "") sidebar.setWidth(undefined);
      else if (/^\d+$/.test(trimmed)) sidebar.setWidth(Math.max(24, Math.min(48, Number(trimmed))));
      else ctx.ui.notify("Width must be a number of columns", "warning");
    } else {
      const value = await ctx.ui.input("Auto-hide threshold", "hide the sidebar below this many columns; 0 = never");
      if (value === undefined) continue;
      if (/^\d+$/.test(value.trim())) sidebar.setAutoHideBelow(Number(value.trim()));
      else ctx.ui.notify("Enter a number of columns (0 disables auto-hide)", "warning");
    }
  }
}

async function prettyMenu(ctx: ExtensionContext, pretty: PrettyTuiBridge): Promise<MenuExit> {
  for (;;) {
    const choice = await ctx.ui.select(`Pretty TUI — ${pretty.statusLine()}`, [
      pretty.enabled() ? "Disable styling (reload)" : "Enable styling (reload)",
      `Full — full tool details${pretty.mode() === "full" ? " (current)" : ""}`,
      `Compact — concise summaries${pretty.mode() === "compact" ? " (current)" : ""}`,
      `Clean — Running/Done groups${pretty.mode() === "clean" ? " (current)" : ""}`,
      `Side borders — ${pretty.sideBorders() ? "shown" : "hidden"} (toggle)`,
      "Back",
    ]);
    if (!choice || choice === "Back") return "back";
    if (choice.startsWith("Full —")) pretty.setMode("full");
    else if (choice.startsWith("Compact —")) pretty.setMode("compact");
    else if (choice.startsWith("Clean —")) pretty.setMode("clean");
    else if (choice.startsWith("Side borders")) pretty.setSideBorders(!pretty.sideBorders());
    else if (choice.startsWith("Enable") || choice.startsWith("Disable")) {
      await pretty.setEnabled(choice.startsWith("Enable"), ctx);
      return "exit";
    }
  }
}

async function powerMenu(ctx: ExtensionContext, power: PowerlineBridge): Promise<MenuExit> {
  for (;;) {
    const choice = await ctx.ui.select(`Powerline — ${power.statusLine()}`, [
      power.enabled() ? "Disable status bar" : "Enable status bar",
      `Status placement: ${power.placement()} (toggle)`,
      `Preset: ${power.preset()} (change)`,
      "Back",
    ]);
    if (!choice || choice === "Back") return "back";
    if (choice.startsWith("Enable") || choice.startsWith("Disable")) await power.runCommand("", ctx);
    else if (choice.startsWith("Status placement")) await power.runCommand("placement toggle", ctx);
    else if (choice.startsWith("Preset:")) {
      const names = Object.keys(PRESETS);
      const preset = await ctx.ui.select(`Powerline preset — current: ${power.preset()}`, [...names, "Back"]);
      if (preset && preset !== "Back") await power.runCommand(`preset ${preset}`, ctx);
    }
  }
}
