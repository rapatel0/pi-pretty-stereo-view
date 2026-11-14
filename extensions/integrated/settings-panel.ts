import { readSettings, updateSection, updateSettings } from "./settings-store.js";
/**
 * `/ui` — one settings surface for the whole bundle. Each section
 * drives its extension's live bridge (or the sidebar host's own controls),
 * so changes take effect immediately and persist through exactly the same
 * component control paths. There is no second source of truth here.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  getPowerlineBridge,
  getNoticeBridge,
  getPrettyTuiBridge,
  getStereoBridge,
  type NoticeBridge,
  type PowerlineBridge,
  type PrettyTuiBridge,
} from "./ui-runtime.js";
import type { SidebarControls } from "./sidebar-host.js";

type MenuExit = "back" | "exit";

export function registerSettingsPanel(pi: ExtensionAPI, sidebar: SidebarControls): void {
  pi.registerCommand("ui", {
    description: "All bundle settings in one panel (sidebar, pretty-tui, stereo split, powerline)",
    handler: async (args, ctx) => {
      const [action = "", ...rest] = args.trim().split(/\s+/);
      const value = rest.join(" ");
      const power = getPowerlineBridge();
      const pretty = getPrettyTuiBridge();
      const stereo = getStereoBridge();
      const notices = getNoticeBridge();
      if (action === "status") {
        ctx.ui.notify([sidebar.statusLine(), stereo?.statusLine(), power?.statusLine(), pretty?.statusLine()].filter(Boolean).join("\n"), "info");
      } else if (action === "preset" && power) {
        await power.runCommand(`preset ${value}`, ctx);
      } else if (action === "powerline" && power) {
        await power.runCommand(value, ctx);
      } else if (action === "perf" && power) {
        if (value === "on" || value === "off") {
          updateSection("diagnostics", (saved) => ({ ...saved, enabled: value === "on" }));
          await ctx.reload();
        } else await power.performance(value, ctx);
      } else if (action === "sidebar") {
        await sidebar.runCommand(value, ctx);
      } else if (action === "notices" && notices) {
        await notices.runCommand(value, ctx);
      } else if (action === "split" && stereo) {
        if (["on", "off", "toggle"].includes(value)) stereo.setEnabled(value === "toggle" ? !stereo.enabled() : value === "on");
        else await stereo.runCommand(value, ctx);
      } else if (action === "mode" && pretty && ["full", "compact", "clean"].includes(value)) {
        pretty.setMode(value as "full" | "compact" | "clean");
      } else if (action === "theme" && value) {
        applyTheme(ctx, value);
      } else if (action) {
        ctx.ui.notify("Use /ui [status|preset <name>|mode <full|compact|clean>|split|sidebar|notices|powerline|perf|theme <name>]", "warning");
      } else if (ctx.mode !== "tui") {
        ctx.ui.notify("The settings panel requires interactive mode", "warning");
      } else {
        await rootMenu(ctx, sidebar);
      }

    },
  });
  pi.on("session_start", (_event, ctx) => {
    const theme = readSettings().theme;
    if (typeof theme === "string" && ctx.hasUI) applyTheme(ctx, theme, false);
  });

}

const section = (name: string, status: string): string => `${name} — ${status}`;

async function rootMenu(ctx: ExtensionContext, sidebar: SidebarControls): Promise<void> {
  for (;;) {
    const pretty = getPrettyTuiBridge();
    const stereo = getStereoBridge();
    const powerline = getPowerlineBridge();
    const notices = getNoticeBridge();
    const choice = await ctx.ui.select("pi-pretty-stereo-view — settings", [
      section("Sidebar", sidebar.statusLine()),
      section("Tool presentation", pretty ? pretty.statusLine() : "not available in this session"),
      section("Split view", stereo ? stereo.statusLine() : "unavailable"),
      section("Status bar", powerline ? powerline.statusLine() : "unavailable"),
      section("Subagents", sidebar.isPanelEnabled("subagent") ? "on" : "off"),
      section("Processes", sidebar.isPanelEnabled("process") ? "on" : "off"),
      section("Notices", notices ? notices.statusLine() : "unavailable"),
      section("Theme", String(readSettings().theme ?? "host default")),
      "Exit",
    ]);
    if (!choice || choice === "Exit") return;
    let result: MenuExit = "back";
    if (choice.startsWith("Sidebar — ")) {
      result = await sidebarMenu(ctx, sidebar);
    } else if (choice.startsWith("Tool presentation — ") && pretty) {
      result = await prettyMenu(ctx, pretty);
    } else if (choice.startsWith("Split view — ")) {
      if (stereo) stereo.setEnabled(!stereo.enabled());
      else ctx.ui.notify("The stereo split appears after the first assistant reply", "info");
    } else if (choice.startsWith("Status bar — ") && powerline) {
      result = await powerMenu(ctx, powerline);
    } else if (choice.startsWith("Notices — ") && notices) {
      result = await noticesMenu(ctx, notices);
    }
    if (choice.startsWith("Subagents — ")) sidebar.setPanelEnabled("subagent", !sidebar.isPanelEnabled("subagent"));
    if (choice.startsWith("Processes — ")) sidebar.setPanelEnabled("process", !sidebar.isPanelEnabled("process"));
    if (choice.startsWith("Theme — ")) {
      const name = await ctx.ui.select("Theme", [...ctx.ui.getAllThemes().map((theme) => theme.name), "Back"]);
      if (name && name !== "Back") applyTheme(ctx, name);
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
      const names = power.presets();
      const preset = await ctx.ui.select(`Powerline preset — current: ${power.preset()}`, [...names, "Back"]);
      if (preset && preset !== "Back") await power.runCommand(`preset ${preset}`, ctx);
    }
  }
}

async function noticesMenu(ctx: ExtensionContext, notices: NoticeBridge): Promise<MenuExit> {
  for (;;) {
    const inline = notices.inlineLevels();
    const choice = await ctx.ui.select(`Notices — ${notices.statusLine()}`, [
      "Open the inbox (ctrl+alt+n)",
      notices.external() ? "Other extensions: routed to the inbox (turn off)" : "Other extensions: printed in the transcript (route them)",
      `Print inline anyway: ${inline.length > 0 ? inline.join(", ") : "nothing"}`,
      "Clear the inbox",
      "Back",
    ]);
    if (!choice || choice === "Back") return "back";
    if (choice.startsWith("Open the inbox")) {
      await notices.runCommand("open", ctx);
      return "back";
    }
    if (choice.startsWith("Other extensions")) await notices.runCommand("external", ctx);
    if (choice.startsWith("Clear the inbox")) await notices.runCommand("clear", ctx);
    if (choice.startsWith("Print inline anyway")) {
      const level = await ctx.ui.select("Print this level in the transcript as well", ["info", "warning", "error", "Back"]);
      if (level && level !== "Back") notices.toggleInlineLevel(level as "info" | "warning" | "error");
    }
  }
}

function applyTheme(ctx: ExtensionContext, name: string, persist = true): void {
  const theme = ctx.ui.getTheme(name);
  if (!theme) {
    ctx.ui.notify(`Theme is unavailable: ${name}`, "warning");
    return;
  }
  const result = ctx.ui.setTheme(theme);
  if (!result.success) {
    ctx.ui.notify(result.error ?? "Cannot apply theme", "error");
    return;
  }
  if (persist) updateSettings((plane) => ({ ...plane, theme: name }));
}
