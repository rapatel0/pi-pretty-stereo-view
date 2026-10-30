import { agentEnv } from "./harness.mjs";

const { jiti } = agentEnv(
  { "pretty-tui.json": { enabled: true, mode: "full", sideBorders: false } },
  "ppsv-probe-",
);
const ca = await import("@earendil-works/pi-coding-agent");
const nativeRender = ca.CustomEditor.prototype.render;
const prettyMod = await jiti.import("../extensions/pretty-tui/index.ts");
const piStub = new Proxy({}, {
  get: (_t, p) => (["on", "registerCommand", "registerShortcut", "registerTool"].includes(p)
    ? () => () => {}
    : () => undefined),
});
await prettyMod.default(piStub);

const theme = { borderColor: (s) => s, accentColor: (s) => s };
const tui = { requestRender() {}, terminal: { cols: 80, rows: 24 } };
const editor = new ca.CustomEditor(tui, theme, { get: () => undefined, matches: () => false, bind: () => {} });
editor.setText("/");

const strip = (s) => (typeof s === "string" ? s.replace(/\u001b\[[0-9;]*m/g, "") : String(s));
const native = nativeRender.call(editor, 60).map(strip);
const framed = editor.render(60).map(strip);
Reflect.set(editor, "powerlineEditorChromeActive", true);
const deferred = editor.render(60).map(strip);

console.log("NATIVE   top:", JSON.stringify(native[0]));
console.log("FRAMED   top:", JSON.stringify(framed[0]));
console.log("FRAMED   bot:", JSON.stringify(framed[framed.length - 1]));
console.log("DEFERRED top:", JSON.stringify(deferred[0]));

const passThrough = deferred.length === native.length && deferred.every((l, i) => l === native[i]);
const framedOk = framed[0].startsWith("╭") && framed[framed.length - 1].startsWith("╰");
console.log(framedOk && passThrough
  ? "PROBE PASS: pretty-tui frames natively; defers to powerline chrome when flagged"
  : `PROBE FAIL: framedOk=${framedOk} passThrough=${passThrough}`);
process.exit(framedOk && passThrough ? 0 : 1);
