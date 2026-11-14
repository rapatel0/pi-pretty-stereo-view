import { fillToWidth } from "../shared/text.js";
import { UserMessageComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import { cardMargin, nativeFrameWidth, cardBackground, frameNativeRows } from "./full-frame.js";
interface PatchState {
    readonly withTranscriptMarkdown: <T>(callback: () => T) => T;
    readonly renderMode: "full" | "compact" | "clean";
    readonly currentExtensionUi: any;
    readonly defaultActivityTheme: () => any;
    readonly sideBordersEnabled: boolean;
    readonly fullscreenTui: boolean;
    readonly copyTranscriptText: (text: string) => void;
    readonly mouseClickHitTests: WeakMap<object, (event: any) => boolean>;
}
export function installUserMessages(pi: ExtensionAPI, state: PatchState): void {
    // Clean uses content-sized bubbles; compact/full share full-width panels.
    // Keep Pi's Markdown, mouse handling and OSC 133 zones in every mode.
    const userMessagePrototype = UserMessageComponent.prototype as any;
    const userMessagePatchKey = Symbol.for("pretty-tui.user-message-frame");
    if (!userMessagePrototype[userMessagePatchKey]) {
        const originalUserMessageRebuild = userMessagePrototype.rebuild;
        const patchedUserMessageRebuild = function (this: any) {
            originalUserMessageRebuild.call(this);
            const content = this.children?.[0] as any;
            if (!content)
                return;
            // Remove Pi's full-width user-message background. The Markdown keeps its
            // native foreground styling, while the surrounding bubble stays transparent.
            content.paddingX = 0;
            content.paddingY = 0;
            content.setBgFn?.(undefined);
            content.invalidate?.();
            // Older Pi wraps Markdown in a Box; Pi 1.0 renders Markdown directly
            // with its own background and padding. Normalize both layouts before
            // measuring, preserving the native foreground and Markdown options.
            const markdown = content.children?.[0] ?? content;
            markdown.paddingX = 0;
            markdown.paddingY = 0;
            if (markdown.defaultTextStyle) {
                markdown.defaultTextStyle = { ...markdown.defaultTextStyle, bgColor: undefined };
            }
            markdown.invalidate?.();
            const outputPad = Math.max(0, Number(this.outputPad) || 0);
            const markdownTheme = this.markdownTheme;
            // Markdown deliberately pads every rendered line to the requested width.
            // Remove only that trailing layout padding before measuring or framing;
            // ANSI styling and the visible content remain untouched.
            const renderMarkdown = (width: number): string[] => state.withTranscriptMarkdown(() => markdown.render(width))
                .map((line: string) => line.replace(/ +$/u, ""));
            const layout = (width: number) => {
                const terminalWidth = Math.max(1, width);
                const rightPad = state.renderMode !== "clean" ? 0 : Math.min(outputPad, Math.max(0, terminalWidth - 1));
                const availableWidth = Math.max(1, terminalWidth - rightPad);
                if (availableWidth < (state.renderMode !== "clean" ? 8 : 4)) {
                    return {
                        framed: false,
                        rightPad,
                        leftPad: 0,
                        frameWidth: availableWidth,
                        contentWidth: availableWidth,
                        body: renderMarkdown(availableWidth),
                    };
                }
                if (state.renderMode !== "clean") {
                    const margin = cardMargin(terminalWidth);
                    const contentWidth = nativeFrameWidth(terminalWidth);
                    return {
                        framed: true, rightPad: margin, leftPad: margin,
                        frameWidth: terminalWidth - margin * 2, contentWidth,
                        body: renderMarkdown(contentWidth),
                    };
                }
                const preferredMaximum = Math.max(4, Math.floor(terminalWidth * 0.75));
                // Keep at least one blank column on the left whenever a framed bubble
                // fits, even after a narrow terminal relaxes the usual 75% maximum.
                const bubbleAvailable = availableWidth >= 5 ? availableWidth - 1 : availableWidth;
                const narrowReadableMinimum = Math.min(bubbleAvailable, 24);
                const frameMaximum = Math.min(bubbleAvailable, Math.max(preferredMaximum, narrowReadableMinimum));
                const measuringWidth = Math.max(1, frameMaximum - 4);
                const measuredBody = renderMarkdown(measuringWidth);
                const naturalContentWidth = Math.max(1, ...measuredBody.map((line: string) => visibleWidth(line)));
                const frameWidth = Math.min(frameMaximum, naturalContentWidth + 4);
                const contentWidth = Math.max(1, frameWidth - 4);
                const body = contentWidth === measuringWidth
                    ? measuredBody
                    : renderMarkdown(contentWidth);
                return {
                    framed: true,
                    rightPad,
                    leftPad: Math.max(0, terminalWidth - rightPad - frameWidth),
                    frameWidth,
                    contentWidth,
                    body,
                };
            };
            const border = (text: string) => state.currentExtensionUi?.theme?.fg
                ? state.currentExtensionUi.theme.fg("mdHeading", text)
                : markdownTheme.heading(text);
            const userText = typeof this.text === "string" ? this.text : "";
            const frame: Component = {
                render(width: number): string[] {
                    const measured = layout(width);
                    const left = " ".repeat(measured.leftPad);
                    const right = " ".repeat(measured.rightPad);
                    if (!measured.framed) {
                        return measured.body.map((line: string) => state.renderMode !== "clean"
                            ? cardBackground(line, width, state.defaultActivityTheme(), "toolPendingBg", "mdHeading") : left + line + right);
                    }
                    if (state.renderMode !== "clean") {
                        return frameNativeRows("User", measured.body, width, state.defaultActivityTheme(), undefined, frame, "mdHeading", "", "mdHeading").lines;
                    }
                    const top = border("╭" + "─".repeat(Math.max(0, measured.frameWidth - 2)) + "╮");
                    const bottom = border("╰" + "─".repeat(Math.max(0, measured.frameWidth - 2)) + "╯");
                    const body = measured.body.map((line: string) => {
                        const padding = fillToWidth(measured.contentWidth, [line]);
                        return state.sideBordersEnabled ? border("│ ") + line + padding + border(" │") : "  " + line + padding + "  ";
                    });
                    return [top, ...body, bottom].map((line: string) => left + line + right);
                },
                handleMouse(event: any) {
                    const measured = layout(event.width);
                    const height = measured.body.length + (measured.framed ? 2 : 0);
                    if (event.x < measured.leftPad ||
                        event.x >= measured.leftPad + measured.frameWidth ||
                        event.y < 0 || event.y >= height)
                        return undefined;
                    // Preserve code-block Copy controls before the enclosing bubble action.
                    const contentX = measured.leftPad + (measured.framed ? 2 : 0);
                    const contentY = measured.framed ? 1 : 0;
                    let result: {
                        handled?: boolean;
                        render?: boolean;
                    } | undefined;
                    if (markdown.handleMouse &&
                        event.x >= contentX && event.x < contentX + measured.contentWidth &&
                        event.y >= contentY && event.y < contentY + measured.body.length) {
                        result = state.withTranscriptMarkdown(() => markdown.handleMouse({
                            ...event,
                            x: event.x - contentX,
                            y: event.y - contentY,
                            width: measured.contentWidth,
                            height: measured.body.length,
                        }));
                        if (result?.handled)
                            return result;
                    }
                    if (state.fullscreenTui && event.type === "click" && event.button === "left" && userText.trim()) {
                        state.copyTranscriptText(userText);
                        return { handled: true };
                    }
                    return result;
                },
                invalidate() {
                    markdown.invalidate?.();
                },
            };
            const bubbleClickHitTest = (event: any) => {
                if (!state.fullscreenTui || !userText.trim())
                    return false;
                const measured = layout(event.width);
                return event.x >= measured.leftPad && event.x < measured.leftPad + measured.frameWidth &&
                    event.y >= 0 && event.y < measured.body.length + (measured.framed ? 2 : 0);
            };
            state.mouseClickHitTests.set(frame, bubbleClickHitTest);
            state.mouseClickHitTests.set(this, bubbleClickHitTest);
            this.clear();
            this.addChild(frame);
        };
        userMessagePrototype[userMessagePatchKey] = {
            originalRebuild: originalUserMessageRebuild,
            patchedRebuild: patchedUserMessageRebuild,
        };
        userMessagePrototype.rebuild = patchedUserMessageRebuild;
        pi.on("session_shutdown", () => {
            const patch = userMessagePrototype[userMessagePatchKey];
            if (!patch)
                return;
            if (patch.patchedRebuild === userMessagePrototype.rebuild) {
                userMessagePrototype.rebuild = patch.originalRebuild;
            }
            if (userMessagePrototype.rebuild === patch.originalRebuild) {
                delete userMessagePrototype[userMessagePatchKey];
            }
        });
    }
}
