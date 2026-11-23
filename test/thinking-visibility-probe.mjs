// Regression probe: the vendored assistant-panel render loop must survive
// Pi 1.6.0's host shape, where AssistantMessageComponent.thinkingVisibilityOverrides
// is undefined until a per-run click creates it (Pi <= 1.5 always kept a Map).
// Dereferencing the field directly threw inside measureHeight -> uncaught
// exception -> pi-bolt exits on any reply containing a thinking block.
// Cases: (a) map undefined (Pi 1.6.0 host), (b) Map with true/false per-run
// overrides (Pi <= 1.5 host), (c) message with no thinking children,
// (d) thought click -> global setHideThinkingBlock -> click again round-trip
// (Pi 1.6.0 resets the map to undefined on the global toggle).
import { agentEnv } from "./harness.mjs";

const { jiti, module } = agentEnv({
  "pretty-tui.json": { enabled: true, mode: "compact", sideBorders: false },
  "transcript.json": "{}",
}, "ppsv-think-");

const noop = () => () => {};
const known = {
  on: () => noop,
  registerCommand: () => noop,
  registerShortcut: () => noop,
  registerTool: () => noop,
  registerFlag: () => noop,
  registerMessageRenderer: () => noop,
  registerEntryRenderer: () => noop,
  events: { on: () => noop },
  getAllTools: () => [],
  getActiveTools: () => [],
  getCommands: () => [],
  getThinkingLevel: () => "medium",
  getSessionName: () => "think-probe",
  setActiveTools: () => {},
  setSessionName: () => {},
  sendUserMessage: async () => {},
  exec: async () => ({ stdout: "", stderr: "", code: 0 }),
};
const pi = new Proxy(known, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (typeof prop !== "string") return undefined;
    return (...args) => { return typeof args[0] === "function" ? undefined : noop; };
  },
});

// Activating the bundle patches AssistantMessageComponent.prototype.render;
// load the host class through the same jiti instance so the patch applies.
const mod = await module("extensions/index.ts");
await mod.default(pi);
const host = await jiti.import("@earendil-works/pi-coding-agent");
host.initTheme();
const { AssistantMessageComponent } = host;

// The hidden thought's compact preview is the thinking's FIRST line, so the
// body marker sits on a later line: visible == marker rendered, hidden == not.
const THINKING = "Folding 1mm paper 30 times.\nBody marker XYZZY gives 2^30 mm.";
const message = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: THINKING },
    { type: "text", text: "About 107 kilometres high." },
  ],
  stopReason: "stop",
};

let failures = 0;

// (a) Pi 1.6.0 host shape: no override map until first click. Must render.
{
  const component = new AssistantMessageComponent(message, false);
  component.thinkingVisibilityOverrides = undefined;
  try {
    const lines = component.render(100);
    console.log(`UNDEF-MAP  render ok lines=${lines.length}`);
  } catch (error) {
    failures++;
    console.log(`UNDEF-MAP  ${error.constructor.name}: ${error.message}`);
  }
}

// (b) Pi <= 1.5 host shape: per-run overrides win over hideThinkingBlock.
// Mirrors the host's own click callback: set the override, then updateContent.
{
  const shown = new AssistantMessageComponent(message, true);
  shown.thinkingVisibilityOverrides = new Map([[0, false]]);
  shown.updateContent(message);
  const shownText = shown.render(100).join("\n");
  const hidden = new AssistantMessageComponent(message, false);
  hidden.thinkingVisibilityOverrides = new Map([[0, true]]);
  hidden.updateContent(message);
  const hiddenText = hidden.render(100).join("\n");
  const shownHasBody = shownText.includes("XYZZY");
  const hiddenLacksBody = !hiddenText.includes("XYZZY");
  if (shownHasBody && hiddenLacksBody) console.log("OVERRIDE-MAP render ok (false shows, true hides)");
  else {
    failures++;
    console.log(`OVERRIDE-MAP FAIL shownHasBody=${shownHasBody} hiddenLacksBody=${hiddenLacksBody}`);
  }
}

// (c) No thinking children: the loop must never touch the override map.
{
  const component = new AssistantMessageComponent(
    { role: "assistant", content: [{ type: "text", text: "Plain answer." }], stopReason: "stop" },
    false,
  );
  component.thinkingVisibilityOverrides = undefined;
  try {
    const lines = component.render(100);
    console.log(`NO-THINK   render ok lines=${lines.length}`);
  } catch (error) {
    failures++;
    console.log(`NO-THINK   ${error.constructor.name}: ${error.message}`);
  }
}

// (d) Item-3 sequence: per-run click must survive the global toggle's
// map reset and a fresh click must recreate the map (host `??= new Map`).
{
  const component = new AssistantMessageComponent(message, false);
  const clickThought = () => {
    const thought = component.contentContainer.children.find(
      (child) => typeof child?.onMouse === "function" && child.child,
    );
    if (!thought) throw new Error("no clickable thought child");
    thought.onMouse({ type: "click", button: "left" });
  };
  const bodyVisible = () => component.render(100).join("\n").includes("XYZZY");
  try {
    clickThought();
    const shownAfterClick = bodyVisible();
    component.setHideThinkingBlock(true); // global hide resets the override map
    const hiddenAfterToggle = !bodyVisible();
    clickThought(); // recreate the map from undefined and show again
    const shownAfterSecondClick = bodyVisible();
    if (shownAfterClick && hiddenAfterToggle && shownAfterSecondClick) {
      console.log("CLICK-TOGGLE round-trip ok (click shows, toggle hides, click shows)");
    } else {
      failures++;
      console.log(`CLICK-TOGGLE FAIL shownAfterClick=${shownAfterClick} hiddenAfterToggle=${hiddenAfterToggle} shownAfterSecondClick=${shownAfterSecondClick}`);
    }
  } catch (error) {
    failures++;
    console.log(`CLICK-TOGGLE ${error.constructor.name}: ${error.message}`);
  }
}

console.log(failures === 0 ? "THINKING PROBE PASS" : `THINKING PROBE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
