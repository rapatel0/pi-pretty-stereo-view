import { setSideBorders } from "./full-frame.js";
import { setPrettyTuiBridge } from "../integrated/ui-runtime.js";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { updateSection } from "../integrated/settings-store.js";
import type { TranscriptRuntime, PrettyTuiMode, PrettyTuiConfig } from "./runtime-types.js";
export function installSettingsControls(pi: ExtensionAPI, transcriptRuntime: TranscriptRuntime): void {
    transcriptRuntime.saveConfig = (nextConfig: PrettyTuiConfig) => {
        transcriptRuntime.config = nextConfig;
        updateSection("prettyTui", () => ({ ...transcriptRuntime.config }));
    };
    transcriptRuntime.saveRenderMode = (mode: PrettyTuiMode) => transcriptRuntime.saveConfig({ ...transcriptRuntime.config, mode });
    transcriptRuntime.saveEnabled = (enabled: boolean) => transcriptRuntime.saveConfig({ ...transcriptRuntime.config, enabled });
    transcriptRuntime.applySideBorders = (on: boolean): void => {
        transcriptRuntime.sideBordersEnabled = on;
        setSideBorders(on);
        transcriptRuntime.saveConfig({ ...transcriptRuntime.config, sideBorders: on });
        transcriptRuntime.currentTui?.requestRender();
    };
    transcriptRuntime.applyMode = (mode: PrettyTuiMode): void => {
        transcriptRuntime.cleanCompactToolCallIds.clear();
        transcriptRuntime.revealedActivityGroups.clear();
        transcriptRuntime.collapsedActivityGroups.clear();
        transcriptRuntime.expandedThinkingMembers.clear();
        transcriptRuntime.renderMode = mode;
        if (transcriptRuntime.cleanRun?.active && !transcriptRuntime.cleanRun.settled)
            transcriptRuntime.startWorkingElapsedTimer();
        transcriptRuntime.refreshLatestActivityWidget();
        for (const component of transcriptRuntime.toolComponents.values())
            component.updateDisplay?.();
        for (const component of transcriptRuntime.thinkingComponents.values())
            component.invalidate?.();
        transcriptRuntime.currentTui?.requestRender();
    };
    setPrettyTuiBridge({
        statusLine: () => `${transcriptRuntime.config.enabled !== false ? "enabled" : "disabled"} · mode ${transcriptRuntime.renderMode} · side borders ${transcriptRuntime.sideBordersEnabled ? "shown" : "hidden"}`,
        enabled: () => transcriptRuntime.config.enabled !== false,
        mode: () => transcriptRuntime.renderMode,
        sideBorders: () => transcriptRuntime.sideBordersEnabled,
        setMode: (mode) => {
            transcriptRuntime.applyMode(mode);
            try {
                transcriptRuntime.saveRenderMode(mode);
            }
            catch {
                // Session-only change; the saved file keeps the previous mode.
            }
        },
        setSideBorders: transcriptRuntime.applySideBorders,
        setEnabled: async (on, panelCtx) => {
            try {
                transcriptRuntime.saveEnabled(on);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                panelCtx.ui.notify(`Could not save pi-pretty-tui setting: ${message}`, "error");
                return;
            }
            panelCtx.ui.notify(`pi-pretty-tui ${on ? "enabled" : "disabled"}; reloading…`, "info");
            try {
                await panelCtx.reload?.();
            }
            catch {
                panelCtx.ui.notify("Setting saved; run /reload to apply it", "warning");
            }
        },
    });
}
