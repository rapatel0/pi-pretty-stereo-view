import assert from "node:assert/strict";
import { agentEnv } from "./harness.mjs";
const { module: loadModule } = agentEnv({}, "ppsv-messages-");
const ca = await import("@earendil-works/pi-coding-agent");
const { visibleWidth, stripTerminalSequences, Text, Container, setCapabilities } = await import("@earendil-works/pi-tui");
const { NativeContentIndex } = await loadModule("extensions/stereo-view/content.ts");
ca.initTheme("dark", false);
const handlers = [];
const resets = [];
const tools = new Map();
const noop = () => {};
const pi = new Proxy({
  on: (name, handler) => {
    if (name === "session_shutdown") handlers.push(handler);
    if (name === "session_tree") resets.push(handler);
  },
  registerTool: (tool) => tools.set(tool.name, tool),
}, { get: (target, key) => target[key] ?? noop });
const nativeUserRebuild = ca.UserMessageComponent.prototype.rebuild;
const nativeCustomRender = ca.CustomMessageComponent.prototype.render;
(await loadModule("extensions/pretty-tui/index.ts")).default(pi);
const { getPrettyTuiBridge } = await loadModule("extensions/integrated/ui-runtime.ts");
let timestamp = 100;
for (const mode of ["full", "compact", "clean"]) {
  getPrettyTuiBridge().setMode(mode);
  for (const width of [12, 24, 80, 160]) {
    for (const reset of resets) await reset({}, {
      ui: { getToolsExpanded: () => false, setWidget: noop },
      sessionManager: { buildContextEntries: () => [] },
    });
    const user = new ca.UserMessageComponent("Hello 世界", ca.getMarkdownTheme());
    const custom = new ca.CustomMessageComponent({ role: "custom", customType: "notice", content: "Progress retained", display: true, timestamp: 1 }, undefined, ca.getMarkdownTheme());
    const semantic = new ca.CustomMessageComponent({ role: "custom", customType: "owned", content: "Native renderer", display: true, timestamp: 2 }, () => new Text("Native renderer", 0, 0), ca.getMarkdownTheme());
    for (const component of [user, custom, semantic]) {
      const lines = component.render(width);
      assert.ok(lines.every((line) => visibleWidth(line) <= width), `${mode} at ${width}: ${lines.map(visibleWidth)}`);
      const text = lines.map(stripTerminalSequences).join("\n");
      assert.ok(text.trim().length > 0, `${component.constructor.name} ${mode} ${width}: ${JSON.stringify(lines)}`);
      if (component === user) assert.ok(text.includes("世") && text.includes("界"));
      if (component === semantic) assert.match(text, /Native/);
    }
    const assistant = new ca.AssistantMessageComponent({
      role: "assistant", content: [{ type: "thinking", thinking: "A private thought" }, { type: "text", text: "ANSWER_KEPT 世界" }],
      api: "fixture", provider: "fixture", model: "fixture", stopReason: "stop", timestamp: timestamp++,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    }, false, ca.getMarkdownTheme());
    const assistantLines = assistant.render(width);
    assert.ok(assistantLines.every((line) => visibleWidth(line) <= width));
    const answer = assistantLines.map(stripTerminalSequences).join("").replace(/[│╭╮╰╯─\s]/g, "");
    assert.ok(answer.includes("ANSWER_KEPT"), `${mode} ${width}: ${answer}`);
    const assistantHistory = new Container();
    assistantHistory.addChild(assistant);
    const assistantDocument = new Container();
    assistantDocument.addChild(new Text("", 0, 0));
    assistantDocument.addChild(new Text("", 0, 0));
    assistantDocument.addChild(assistantHistory);
    const assistantIndex = new NativeContentIndex(assistantDocument);
    assert.equal(assistantIndex.entries("activity").filter((entry) => entry.source === assistant).length, 1,
      `${mode}: split view must retain reasoning`);
    assert.equal(assistantIndex.entries("chat").filter((entry) => entry.source === assistant).length, 1,
      `${mode}: split view must retain the answer`);
    if (mode === "clean") {
      const activity = assistantIndex.entries("activity").find((entry) => entry.source === assistant);
      activity.search(width).reveal();
      const reasoning = activity.component.render(width).map(stripTerminalSequences).join("").replace(/[\u2500-\u257f\s]/g, "");
      assert.ok(reasoning.includes("Aprivatethought"), `clean ${width}: reasoning text must remain visible after reveal`);
      assert.ok(!reasoning.includes("ANSWER_KEPT"));
      const dialogue = assistantIndex.entries("chat").find((entry) => entry.source === assistant);
      const reply = dialogue.component.render(width).map(stripTerminalSequences).join("").replace(/[\u2500-\u257f\s]/g, "");
      assert.ok(reply.includes("ANSWER_KEPT"));
      assert.ok(!reply.includes("Aprivatethought"));
    }
    const failed = new ca.AssistantMessageComponent({
      role: "assistant", content: [], api: "fixture", provider: "fixture", model: "fixture",
      stopReason: "error", errorMessage: "OAuth refresh failed: invalid_grant", timestamp: timestamp++,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    }, false, ca.getMarkdownTheme());
    const history = new Container();
    history.addChild(failed);
    const document = new Container();
    document.addChild(new Text("", 0, 0));
    document.addChild(new Text("", 0, 0));
    document.addChild(history);
    const errors = new NativeContentIndex(document).entries("chat").filter((entry) => entry.source === failed);
    assert.equal(errors.length, 1, `${mode}: split view must retain a failed assistant with no response text`);
    const errorLines = errors[0].component.render(width);
    assert.ok(errorLines.every((line) => visibleWidth(line) <= width));
    assert.ok(errorLines.map(stripTerminalSequences).join("").replace(/[│╭╮╰╯─\s]/g, "").includes("invalid_grant"));
    for (const name of ["read", "bash"]) {
      const tool = new ca.ToolExecutionComponent(name, `${mode}-${width}-${name}`, name === "read" ? { path: "fixture.txt" } : { command: "printf fixture" },
        { showImages: false }, tools.get(name), { terminal: { columns: width, rows: 40 }, requestRender: noop }, process.cwd());
      tool.setArgsComplete();
      tool.markExecutionStarted();
      tool.updateResult({ content: [{ type: "text", text: "TOOL_OUTPUT" }], isError: false });
      tool.setExpanded(true);
      const lines = tool.render(width);
      assert.ok(lines.every((line) => visibleWidth(line) <= width), `${name} ${mode} at ${width}`);
      assert.ok(lines.join("").length > 0);
    }
  }
}
const frame = await loadModule("extensions/pretty-tui/full-frame.ts");
const owner = {};
const palette = { fg: (_role, text) => text, bg: (_role, text) => text, bold: (text) => text };
const rows = ["Cache content"];
const kittyImage = "\x1b_Ga=T,f=100,c=8,r=3,i=7;AAAA\x1b\\";
const imageFrame = frame.frameNativeRows("Image", ["before", kittyImage, "", "", "after"], 40, palette);
const imageAt = imageFrame.lines.findIndex((line) => line.includes(kittyImage));
assert.ok(imageAt >= 0);
assert.equal(imageFrame.lines[imageAt].indexOf("\x1b_G"), 3);
assert.deepEqual(imageFrame.lines.slice(imageAt + 1, imageAt + 3), ["", ""]);
assert.match(stripTerminalSequences(imageFrame.lines[imageAt + 3]), /after/);
const itermImage = "\x1b[2A\x1b]1337;File=inline=1:AAAA\x07";
const itermFrame = frame.frameNativeRows("Image", ["before", "", "", itermImage, "after"], 40, palette);
const itermAt = itermFrame.lines.findIndex((line) => line.includes(itermImage));
assert.deepEqual(itermFrame.lines.slice(itermAt - 2, itermAt), ["", ""]);
setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
getPrettyTuiBridge().setMode("full");
const imageTool = new ca.ToolExecutionComponent("read", "image-read", { path: "image.png" },
  { showImages: true }, tools.get("read"), { terminal: { columns: 80, rows: 40 }, requestRender: noop }, process.cwd());
imageTool.setArgsComplete();
imageTool.markExecutionStarted();
imageTool.updateResult({ content: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAID" }], isError: false });
imageTool.setExpanded(true);
const imageToolLines = imageTool.render(80);
const toolImageAt = imageToolLines.findIndex((line) => line.includes("\x1b_G"));
assert.ok(toolImageAt >= 0, "read must retain the native image sequence");
const imageHeight = Number(/(?:^|,)r=(\d+)(?:,|;)/.exec(imageToolLines[toolImageAt])?.[1]);
assert.ok(imageHeight > 1, "fixture must reserve multiple rows");
assert.deepEqual(imageToolLines.slice(toolImageAt + 1, toolImageAt + imageHeight), Array(imageHeight - 1).fill(""));
const writeLines = Array.from({ length: 15 }, (_, i) => `LINE_${String(i + 1).padStart(2, "0")}`);
const writeTool = new ca.ToolExecutionComponent("write", "stream-write", { path: "stream.txt", content: writeLines.join("\n") },
  { showImages: false }, tools.get("write"), { terminal: { columns: 80, rows: 40 }, requestRender: noop }, process.cwd());
const writeText = () => writeTool.render(80).map(stripTerminalSequences).join("\n");
assert.match(writeText(), /5 earlier lines/);
assert.doesNotMatch(writeText(), /LINE_01/);
assert.match(writeText(), /LINE_15/);
writeTool.updateArgs({ path: "stream.txt", content: [...writeLines, "LINE_16"].join("\n") });
assert.match(writeText(), /6 earlier lines/);
assert.match(writeText(), /LINE_16/);
assert.doesNotMatch(writeText(), /LINE_06/);
writeTool.setExpanded(true);
assert.match(writeText(), /LINE_01/);
assert.match(writeText(), /LINE_16/);
writeTool.setExpanded(false);
writeTool.setArgsComplete();
assert.doesNotMatch(writeText(), /LINE_01/);
assert.match(writeText(), /LINE_16/);
getPrettyTuiBridge().setSideBorders(true);
const bordered = frame.frameNativeRows("Cache", rows, 40, palette, undefined, owner);
assert.equal(frame.frameNativeRows("Cache", rows, 40, palette, undefined, owner), bordered);
getPrettyTuiBridge().setSideBorders(false);
const unbordered = frame.frameNativeRows("Cache", rows, 40, palette, undefined, owner);
assert.notEqual(unbordered, bordered);
assert.ok(bordered.lines.some((line) => stripTerminalSequences(line).includes("│")));
assert.ok(unbordered.lines.every((line) => !stripTerminalSequences(line).includes("│")));
rows[0] = "Changed content";
const changed = frame.frameNativeRows("Cache", rows, 40, palette, undefined, owner);
assert.notEqual(changed, unbordered);
assert.match(changed.lines.map(stripTerminalSequences).join("\n"), /Changed content/);
getPrettyTuiBridge().setSideBorders(true);
for (const handler of handlers) await handler({}, {});
assert.equal(ca.UserMessageComponent.prototype.rebuild, nativeUserRebuild);
assert.equal(ca.CustomMessageComponent.prototype.render, nativeCustomRender);
console.log("MESSAGE RENDER PASS: assistant/user/custom messages, read/bash tools, three modes, four widths, cache invalidation, and patch restoration");
