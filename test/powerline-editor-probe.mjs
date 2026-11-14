import assert from "node:assert/strict";
import { agentEnv } from "./harness.mjs";

const { dir, module: loadModule } = agentEnv({}, "ppsv-editor-");
const { KeybindingsManager } = await import("../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js");
const { visibleWidth } = await import("@earendil-works/pi-tui");
const { PowerlineEditor, isPrintableInput } = await loadModule("extensions/powerline/editor.ts");
const { OneOffShellAutocompleteProvider } = await loadModule("extensions/powerline/one-off-shell/completion.ts");
const theme = { borderColor: (s) => s, accentColor: (s) => s };
const tui = { requestRender() {}, terminal: { cols: 80, rows: 24 } };
const keybindings = new KeybindingsManager();
const makeEditor = (options = {}) => new PowerlineEditor(tui, theme, keybindings, {
  keybindings,
  areCompletionsEnabled: () => false,
  resolveGhostSuggestion: async () => null,
  ...options,
});

const editor = makeEditor();
for (const input of ["a", " ", "😀"]) editor.handleInput(input);
assert.equal(editor.getText(), "a 😀");
assert.equal(isPrintableInput("😀"), true);
assert.equal(isPrintableInput("\x1b[A"), false);
editor.setText("");
editor.handleInput("\x1b[200~file:///tmp/a%20b\x1b[201~");
assert.equal(editor.getText(), "/tmp/a b");

const submitted = [];
editor.onSubmit = (text) => submitted.push(text);
editor.setText("!printf ok");
editor.handleInput("\r");
assert.deepEqual(submitted, ["!printf ok"]);
editor.setText("normal prompt");
editor.handleInput("\r");
assert.deepEqual(submitted, ["!printf ok", "normal prompt"]);

editor.addToHistory("previous prompt");
editor.setText("draft");
editor.handleInput("\x1b[A");
assert.equal(editor.getText(), "previous prompt");
editor.handleInput("\x1b[B");
assert.equal(editor.getText(), "draft");

const boundaryEditor = makeEditor({ editorBoundaryShortcuts: { start: "ctrl+a", end: "ctrl+e" } });
boundaryEditor.setText("first\nlast");
boundaryEditor.handleInput("\x01");
assert.deepEqual(boundaryEditor.getCursor(), { line: 0, col: 0 });
boundaryEditor.handleInput("\x05");
assert.deepEqual(boundaryEditor.getCursor(), { line: 1, col: 4 });
for (const width of [8, 20, 80, 160]) {
  assert.ok(boundaryEditor.render(width).every((line) => visibleWidth(line) <= width));
}

const longEditor = makeEditor();
longEditor.setText("x".repeat(1500));
longEditor.handleInput("\x7f");
assert.equal(longEditor.getText().length, 1499);
longEditor.handleInput("\x1b[D");
assert.equal(longEditor.getCursor().col, 1498);
longEditor.handleInput("\x1b[3~");
assert.equal(longEditor.getText().length, 1498);

const ghostEditor = makeEditor({ areCompletionsEnabled: () => true });
ghostEditor.setText("!git st");
Reflect.set(ghostEditor, "ghost", { value: "!git status", source: "git" });
ghostEditor.handleInput("\t");
assert.equal(ghostEditor.getText(), "!git status");
ghostEditor.clearGhostSuggestion();

const calls = [];
const provider = (name) => ({
  triggerCharacters: [name],
  getSuggestions: async () => { calls.push(name); return null; },
  applyCompletion: (lines, cursorLine, cursorCol) => { calls.push(name); return { lines, cursorLine, cursorCol }; },
  shouldTriggerFileCompletion: (lines) => lines[0].startsWith("!"),
});
const wrapped = new OneOffShellAutocompleteProvider(provider("default"), provider("shell"));
const options = { signal: new AbortController().signal };
await wrapped.getSuggestions(["normal"], 0, 6, options);
await wrapped.getSuggestions(["!echo"], 0, 5, options);
wrapped.applyCompletion(["normal"], 0, 6, {}, "");
wrapped.applyCompletion(["!echo"], 0, 5, {}, "");
assert.deepEqual(calls, ["default", "shell", "default", "shell"]);
const handlers = new Map();
const commands = new Map();
const { default: registerPowerline } = await loadModule("extensions/powerline/index.ts");
registerPowerline({
  on: (name, handler) => handlers.set(name, handler),
  registerCommand: (name, command) => commands.set(name, command),
});
assert.equal(commands.has("bash-mode"), false);
assert.equal(commands.has("bash-reset"), false);
let factory;
let compactCalls = 0;
const ctx = {
  cwd: dir, hasUI: true, mode: "tui", thinkingLevel: "off",
  compact: () => { compactCalls++; },
  ui: {
    setEditorComponent: (value) => { factory = value; },
    setWidget() {}, setFooter() {}, notify() {},
  },
};
await handlers.get("session_start")({ reason: "startup" }, ctx);
const integratedEditor = factory(tui, theme, keybindings);
const integratedSubmissions = [];
integratedEditor.onSubmit = (text) => integratedSubmissions.push(text);
integratedEditor.setText("/compact");
integratedEditor.handleInput("\r");
assert.equal(compactCalls, 1);
assert.deepEqual(integratedSubmissions, []);
assert.equal(integratedEditor.getText(), "");
integratedEditor.setText("!echo still works");
integratedEditor.handleInput("\r");
assert.deepEqual(integratedSubmissions, ["!echo still works"]);
await handlers.get("session_shutdown")({}, ctx);
console.log("POWERLINE EDITOR PASS: input, paste, submission, history, shortcuts, widths, long drafts, and one-off completion");
