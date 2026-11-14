import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TranscriptRuntime } from "./runtime-types.js";
import { initializeTranscriptState } from "./runtime-state.js";
import { initializeActivityProjection } from "./activity-projection.js";
import { initializeActivityUpdates } from "./activity-updates.js";
import { installSettingsControls } from "./settings-controls.js";
import { installMessageRuntime } from "./message-runtime.js";
import { initializeToolRenderers } from "./tool-renderers.js";
import { initializeToolActivity } from "./tool-activity.js";
import { initializeActivitySummaries, installSummaryEntries } from "./activity-summary.js";
import { initializeSessionRestore } from "./session-restore.js";
import { installSessionLifecycle, installRunLifecycle } from "./session-events.js";
import { installBuiltinTools } from "./builtin-tools.js";

/** Build one transcript runtime in the original initialization order. */
export default function prettyTui(pi: ExtensionAPI): void {
  const transcriptRuntime = {} as TranscriptRuntime;
  initializeTranscriptState(pi, transcriptRuntime);
  initializeActivityProjection(pi, transcriptRuntime);
  initializeActivityUpdates(pi, transcriptRuntime);
  installSettingsControls(pi, transcriptRuntime);
  if (!transcriptRuntime.activeForSession) return;
  installMessageRuntime(pi, transcriptRuntime);
  initializeToolRenderers(pi, transcriptRuntime);
  initializeToolActivity(pi, transcriptRuntime);
  initializeActivitySummaries(pi, transcriptRuntime);
  installSummaryEntries(pi, transcriptRuntime);
  initializeSessionRestore(pi, transcriptRuntime);
  installSessionLifecycle(pi, transcriptRuntime);
  installRunLifecycle(pi, transcriptRuntime);
  installBuiltinTools(pi, transcriptRuntime);
}
