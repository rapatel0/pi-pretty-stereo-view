import { fillToWidth } from "../shared/text.js";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth, type TuiMouseEvent, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
interface PatchState {
    readonly transcriptMarkdownActive: () => boolean;
    readonly mouseClickHitTests: WeakMap<object, (event: any) => boolean>;
    fullscreenTui: boolean;
    currentExtensionUi: any;
    sideBordersEnabled: boolean;
    readonly copyTranscriptText: (text: string) => void;
}
export function installMarkdown(pi: ExtensionAPI, state: PatchState): void {
    // Refine Pi's Markdown presentation while preserving its parser and themes.
    const markdownPrototype = Markdown.prototype as any;
    const codeBlockPatchKey = Symbol.for("pretty-tui.code-blocks");
    const codeBlockCollectionKey = Symbol("pretty-tui.code-block-collection");
    const codeBlockRegionsKey = Symbol("pretty-tui.code-block-regions");
    const transcriptMarkdownStateKey = Symbol("pretty-tui.transcript-markdown-state");
    if (!markdownPrototype[codeBlockPatchKey]) {
        const originalInvalidate = markdownPrototype.invalidate;
        const originalRender = markdownPrototype.render;
        const originalRenderToken = markdownPrototype.renderToken;
        const originalHandleMouse = markdownPrototype.handleMouse;
        const stripTerminalStyles = (value: string): string => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
        const patchedInvalidate = function (this: any) {
            delete this[codeBlockCollectionKey];
            delete this[codeBlockRegionsKey];
            return originalInvalidate.call(this);
        };
        const patchedRender = function (this: any, width: number): string[] {
            const scoped = state.transcriptMarkdownActive();
            state.mouseClickHitTests.set(this, (event) => state.fullscreenTui &&
                this[transcriptMarkdownStateKey] === true &&
                (this[codeBlockRegionsKey] ?? []).some((region: any) => event.y === region.y && event.x >= region.xStart && event.x < region.xEnd));
            if (this[transcriptMarkdownStateKey] !== scoped) {
                delete this[codeBlockCollectionKey];
                delete this[codeBlockRegionsKey];
                originalInvalidate.call(this);
                this[transcriptMarkdownStateKey] = scoped;
            }
            if (!scoped)
                return originalRender.call(this, width);
            const needsRender = !this.cachedLines || this.cachedText !== this.text || this.cachedWidth !== width;
            if (needsRender)
                this[codeBlockCollectionKey] = [];
            const lines = originalRender.call(this, width);
            if (!needsRender)
                return lines;
            const regions: Array<{
                xStart: number;
                xEnd: number;
                y: number;
                code: string;
            }> = [];
            let searchFrom = 0;
            for (const block of this[codeBlockCollectionKey] ?? []) {
                let headerLine = -1;
                for (let lineIndex = searchFrom; lineIndex < lines.length; lineIndex += 1) {
                    const renderedLine = lines[lineIndex] ?? "";
                    if (renderedLine.includes(block.styledTopRule) ||
                        stripTerminalStyles(renderedLine).includes(block.topRule)) {
                        headerLine = lineIndex;
                        break;
                    }
                }
                if (headerLine < 0)
                    continue;
                regions.push({
                    xStart: Number(this.paddingX ?? 0) + block.buttonStart,
                    xEnd: Number(this.paddingX ?? 0) + block.buttonStart + block.buttonWidth,
                    y: headerLine,
                    code: block.code,
                });
                searchFrom = headerLine + 1;
            }
            this[codeBlockRegionsKey] = regions;
            delete this[codeBlockCollectionKey];
            return lines;
        };
        const patchedRenderToken = function (this: any, token: any, width: number, nextTokenType?: string, styleContext?: any): string[] {
            if (!state.transcriptMarkdownActive()) {
                return originalRenderToken.call(this, token, width, nextTokenType, styleContext);
            }
            if (token?.type === "heading") {
                const level = Math.max(1, Math.min(6, Number(token.depth) || 1));
                const maxWidth = Math.max(1, width);
                const addHeadingSpacing = (lines: string[]) => {
                    if (nextTokenType && nextTokenType !== "space")
                        lines.push("");
                    return lines;
                };
                const headingStyle = (text: string) => this.theme.heading(text);
                const foregroundLuminance = (styled: string): number | undefined => {
                    const trueColor = /\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(styled);
                    if (!trueColor)
                        return undefined;
                    const [, red, green, blue] = trueColor.map(Number);
                    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
                };
                const defaultLuminance = foregroundLuminance(this.applyDefaultStyle("M"));
                const headingLuminance = foregroundLuminance(headingStyle("M"));
                const darkTheme = defaultLuminance !== undefined
                    ? defaultLuminance >= 128
                    : (headingLuminance ?? 255) >= 160;
                const whiteStyle = (text: string) => `\x1b[97m${text}\x1b[39m`;
                const titleStyle = level === 1 || level === 3
                    ? (text: string) => headingStyle(this.theme.bold(this.theme.underline(text)))
                    : level === 2
                        ? (text: string) => (darkTheme ? whiteStyle : headingStyle)(this.theme.bold(this.theme.underline(text)))
                        : level === 4
                            ? (text: string) => headingStyle(this.theme.bold(text))
                            : level === 5
                                ? headingStyle
                                : (text: string) => this.theme.quote(this.theme.italic(text));
                const titleContext = {
                    applyText: titleStyle,
                    stylePrefix: this.getStylePrefix(titleStyle),
                };
                const title = this.renderInlineTokens(token.tokens || [], titleContext);
                if (level === 1 && maxWidth >= 6) {
                    const maximumInnerWidth = maxWidth - 4;
                    const titleLines = wrapTextWithAnsi(title, Math.max(1, maximumInnerWidth));
                    const innerWidth = Math.max(1, ...titleLines.map((line: string) => visibleWidth(line)));
                    const frameWidth = Math.min(maxWidth, innerWidth + 4);
                    const frameStyle = (text: string) => headingStyle(this.theme.bold(text));
                    const lines = [
                        frameStyle(`╔${"═".repeat(frameWidth - 2)}╗`),
                        ...titleLines.map((line: string) => {
                            const padding = fillToWidth(innerWidth, [line]);
                            return frameStyle("║ ") + line + frameStyle(`${padding} ║`);
                        }),
                        frameStyle(`╚${"═".repeat(frameWidth - 2)}╝`),
                    ];
                    return addHeadingSpacing(lines);
                }
                if (level === 2) {
                    // Reverse only the rendered title cells: the theme's heading color
                    // becomes a compact, content-width background label with no frame.
                    const lines = wrapTextWithAnsi(title, maxWidth).map((line: string) => darkTheme
                        ? `\x1b[48;5;94m${line}\x1b[49m`
                        : `\x1b[107m\x1b[7m${line}\x1b[27m\x1b[49m`);
                    return addHeadingSpacing(lines);
                }
                if (level === 5 && maxWidth >= 8) {
                    const prefix = "┄┄ ";
                    const suffix = " ┄┄";
                    const contentWidth = Math.max(1, maxWidth - visibleWidth(prefix) - visibleWidth(suffix));
                    const wrapped = wrapTextWithAnsi(title, contentWidth);
                    const lines = wrapped.map((line: string, index: number) => {
                        const left = index === 0 ? this.theme.heading(prefix) : " ".repeat(visibleWidth(prefix));
                        const right = index === wrapped.length - 1 ? this.theme.heading(suffix) : "";
                        return left + line + right;
                    });
                    return addHeadingSpacing(lines);
                }
                return addHeadingSpacing(wrapTextWithAnsi(title, maxWidth));
            }
            if (token?.type !== "code") {
                return originalRenderToken.call(this, token, width, nextTokenType, styleContext);
            }
            const maxWidth = Math.max(1, width);
            const code = String(token.text ?? "");
            const useRoundedFrame = maxWidth >= 8;
            const maximumCodeWidth = useRoundedFrame ? maxWidth - 4 : maxWidth;
            const highlighted = this.theme.highlightCode
                ? this.theme.highlightCode(code, token.lang)
                : code.split("\n").map((line: string) => this.theme.codeBlock(line));
            const codeLines: string[] = [];
            for (const line of highlighted.length > 0 ? highlighted : [""]) {
                const wrapped = wrapTextWithAnsi(line, maximumCodeWidth);
                codeLines.push(...(wrapped.length > 0 ? wrapped : [""]));
            }
            if (!useRoundedFrame) {
                if (nextTokenType && nextTokenType !== "space")
                    codeLines.push("");
                return codeLines;
            }
            const copyLabel = "[Copy]";
            const showCopyButton = state.fullscreenTui && maxWidth >= 18;
            const topSuffix = showCopyButton ? ` ${copyLabel} ╮` : "╮";
            const rawLanguage = typeof token.lang === "string" ? token.lang.trim() : "";
            const language = rawLanguage.split(/\s+/, 1)[0] || "code";
            const label = truncateToWidth(language, Math.max(1, maxWidth - visibleWidth(topSuffix) - 7), "…");
            const topPrefix = `╭─ ${label} `;
            const contentWidth = codeLines.reduce((widest, line) => Math.max(widest, visibleWidth(line)), 0);
            const minimumFrameWidth = visibleWidth(topPrefix) + 3 + visibleWidth(topSuffix);
            const frameWidth = Math.min(maxWidth, Math.max(contentWidth + 4, minimumFrameWidth));
            const fillWidth = Math.max(0, frameWidth - visibleWidth(topPrefix) - visibleWidth(topSuffix));
            const buttonStart = visibleWidth(topPrefix) + fillWidth + (showCopyButton ? 1 : 0);
            const topRule = topPrefix + "─".repeat(fillWidth) + topSuffix;
            const frameBorder = (text: string) => state.currentExtensionUi?.theme?.fg
                ? state.currentExtensionUi.theme.fg("borderMuted", text)
                : this.theme.codeBlockBorder(text);
            // Keep labels and Copy at their original contrast; soften only the frame.
            const styledTopRule = frameBorder("╭─ ") + this.theme.codeBlockBorder(label + " ") +
                frameBorder("─".repeat(fillWidth)) +
                (showCopyButton ? this.theme.codeBlockBorder(` ${copyLabel} `) : "") + frameBorder("╮");
            const framedCodeWidth = Math.max(1, frameWidth - 4);
            const lines = [
                styledTopRule,
                ...codeLines.map((line) => (state.sideBordersEnabled ? frameBorder("│ ") : "  ") +
                    line +
                    fillToWidth(framedCodeWidth, [line]) +
                    (state.sideBordersEnabled ? frameBorder(" │") : "  ")),
                frameBorder(`╰${"─".repeat(Math.max(0, frameWidth - 2))}╯`),
            ];
            if (showCopyButton && Array.isArray(this[codeBlockCollectionKey])) {
                this[codeBlockCollectionKey].push({
                    buttonStart,
                    buttonWidth: visibleWidth(copyLabel),
                    code,
                    styledTopRule,
                    topRule,
                });
            }
            if (nextTokenType && nextTokenType !== "space")
                lines.push("");
            return lines;
        };
        const patchedHandleMouse = function (this: any, event: TuiMouseEvent) {
            // Fullscreen layout hit-testing may dispatch directly to this Markdown
            // leaf instead of traversing AssistantMessageComponent.handleMouse. The
            // most recent render therefore records whether this instance belongs to
            // the main transcript; dynamic render scope alone is not sufficient.
            const transcriptOwned = state.transcriptMarkdownActive() || this[transcriptMarkdownStateKey] === true;
            if (!transcriptOwned) {
                delete this[codeBlockRegionsKey];
                return originalHandleMouse?.call(this, event);
            }
            if (event.button === "left" && (event.type === "press" || event.type === "click")) {
                const region = (this[codeBlockRegionsKey] ?? []).find((candidate: any) => event.y === candidate.y && event.x >= candidate.xStart && event.x < candidate.xEnd);
                if (region) {
                    if (event.type === "click")
                        state.copyTranscriptText(region.code);
                    return { handled: true, render: false };
                }
            }
            return originalHandleMouse?.call(this, event);
        };
        markdownPrototype[codeBlockPatchKey] = {
            originalHandleMouse,
            originalInvalidate,
            originalRender,
            originalRenderToken,
            patchedHandleMouse,
            patchedInvalidate,
            patchedRender,
            patchedRenderToken,
        };
        markdownPrototype.invalidate = patchedInvalidate;
        markdownPrototype.render = patchedRender;
        markdownPrototype.renderToken = patchedRenderToken;
        markdownPrototype.handleMouse = patchedHandleMouse;
        pi.on("session_shutdown", () => {
            const patch = markdownPrototype[codeBlockPatchKey];
            if (patch?.patchedInvalidate === markdownPrototype.invalidate) {
                markdownPrototype.invalidate = patch.originalInvalidate;
            }
            if (patch?.patchedRender === markdownPrototype.render) {
                markdownPrototype.render = patch.originalRender;
            }
            if (patch?.patchedRenderToken === markdownPrototype.renderToken) {
                markdownPrototype.renderToken = patch.originalRenderToken;
            }
            if (patch?.patchedHandleMouse === markdownPrototype.handleMouse) {
                if (patch.originalHandleMouse)
                    markdownPrototype.handleMouse = patch.originalHandleMouse;
                else
                    delete markdownPrototype.handleMouse;
            }
            if (patch &&
                markdownPrototype.invalidate === patch.originalInvalidate &&
                markdownPrototype.render === patch.originalRender &&
                markdownPrototype.renderToken === patch.originalRenderToken &&
                markdownPrototype.handleMouse === patch.originalHandleMouse) {
                delete markdownPrototype[codeBlockPatchKey];
            }
        });
    }
    const listPatchKey = Symbol.for("pretty-tui.list-bullets");
    if (!markdownPrototype[listPatchKey]) {
        const originalRenderList = markdownPrototype.renderList;
        const patchedRenderList = function (this: any, token: any, depth: number, width: number, styleContext?: any): string[] {
            const originalListBullet = this.theme.listBullet;
            this.theme.listBullet = (marker: string) => originalListBullet(marker.replace(/^- /, "• "));
            try {
                return originalRenderList.call(this, token, depth, width, styleContext);
            }
            finally {
                this.theme.listBullet = originalListBullet;
            }
        };
        markdownPrototype[listPatchKey] = { originalRenderList, patchedRenderList };
        markdownPrototype.renderList = patchedRenderList;
        pi.on("session_shutdown", () => {
            const patch = markdownPrototype[listPatchKey];
            if (patch?.patchedRenderList === markdownPrototype.renderList) {
                markdownPrototype.renderList = patch.originalRenderList;
            }
            if (patch)
                delete markdownPrototype[listPatchKey];
        });
    }
}
