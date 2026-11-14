import { padToWidth } from "../shared/text.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { editorChromeActive, editorPrototype } from "../integrated/ui-runtime.js";
interface EditorFrameState {
    setEditor(editor: any): void;
    readonly startedAt: number | undefined;
    readonly sideBorders: boolean;
    duration(milliseconds: number): string;
}
/** Preserve the native editor inside one frame, with powerline ownership explicit. */
export function installEditorFrame(pi: ExtensionAPI, state: EditorFrameState): void {
    const customEditorPrototype = editorPrototype();
    const editorFramePatchKey = Symbol.for("pretty-tui.rounded-editor-frame");
    if (!customEditorPrototype[editorFramePatchKey]) {
        const hadOwnRender = Object.prototype.hasOwnProperty.call(customEditorPrototype, "render");
        const hadOwnHandleMouse = Object.prototype.hasOwnProperty.call(customEditorPrototype, "handleMouse");
        const originalEditorRender = customEditorPrototype.render;
        const originalEditorTopBorder = customEditorPrototype.renderTopBorder;
        const originalEditorHandleMouse = customEditorPrototype.handleMouse;
        const patchedEditorTopBorder = function (this: any, width: number, hiddenLineCount: number): string {
            state.setEditor(this);
            const indicator = this.workingStatusIndicator;
            if (indicator?.kind !== "working" || state.startedAt === undefined) {
                return originalEditorTopBorder.call(this, width, hiddenLineCount);
            }
            const elapsed = state.duration(Date.now() - state.startedAt);
            const indicatorColor = (text: string) => this.borderColor(text);
            const originalRenderInBorder = indicator.renderInBorder;
            indicator.renderInBorder = function (availableWidth: number): string {
                const status = originalRenderInBorder.call(this, availableWidth);
                const suffix = ` ${elapsed}`;
                return visibleWidth(status) + visibleWidth(suffix) <= availableWidth
                    ? status + indicatorColor(suffix)
                    : status;
            };
            try {
                return originalEditorTopBorder.call(this, width, hiddenLineCount);
            }
            finally {
                indicator.renderInBorder = originalRenderInBorder;
            }
        };
        const patchedEditorRender = function (this: any, width: number): string[] {
            state.setEditor(this);
            if (width < 3)
                return originalEditorRender.call(this, width);
            // pi-powerline-footer's editor chrome draws the rounded frame itself; a
            // second frame would double borders and break its bottom-rule detection.
            if (editorChromeActive(this))
                return originalEditorRender.call(this, width);
            const innerWidth = width - 2;
            const lines = originalEditorRender.call(this, innerWidth) as string[];
            const visibleLineCount = Math.max(0, Number(this.renderedVisibleLineCount) || 0);
            const bottomBorderIndex = visibleLineCount + 1;
            const fitInnerWidth = (line: string) => padToWidth(line, innerWidth);
            return lines.map((line, index) => {
                const fitted = fitInnerWidth(line);
                if (index === 0)
                    return this.borderColor("╭") + fitted + this.borderColor("╮");
                if (index === bottomBorderIndex)
                    return this.borderColor("╰") + fitted + this.borderColor("╯");
                if (index < bottomBorderIndex)
                    return state.sideBorders ? this.borderColor("│") + fitted + this.borderColor("│") : " " + fitted + " ";
                // Autocomplete remains outside the input frame, aligned to its content.
                return " " + fitted + " ";
            });
        };
        const patchedEditorHandleMouse = function (this: any, event: any) {
            if (event.width < 3)
                return originalEditorHandleMouse.call(this, event);
            if (editorChromeActive(this))
                return originalEditorHandleMouse.call(this, event);
            const innerWidth = event.width - 2;
            return originalEditorHandleMouse.call(this, {
                ...event,
                x: Math.max(0, Math.min(innerWidth - 1, event.x - 1)),
                width: innerWidth,
            });
        };
        customEditorPrototype[editorFramePatchKey] = {
            hadOwnRender,
            hadOwnHandleMouse,
            originalRender: originalEditorRender,
            originalTopBorder: originalEditorTopBorder,
            originalHandleMouse: originalEditorHandleMouse,
            patchedRender: patchedEditorRender,
            patchedTopBorder: patchedEditorTopBorder,
            patchedHandleMouse: patchedEditorHandleMouse,
        };
        customEditorPrototype.render = patchedEditorRender;
        customEditorPrototype.renderTopBorder = patchedEditorTopBorder;
        customEditorPrototype.handleMouse = patchedEditorHandleMouse;
        pi.on("session_shutdown", () => {
            state.setEditor(undefined);
            const patch = customEditorPrototype[editorFramePatchKey];
            if (!patch)
                return;
            if (patch.patchedRender === customEditorPrototype.render) {
                if (patch.hadOwnRender)
                    customEditorPrototype.render = patch.originalRender;
                else
                    delete customEditorPrototype.render;
            }
            if (patch.patchedTopBorder === customEditorPrototype.renderTopBorder) {
                customEditorPrototype.renderTopBorder = patch.originalTopBorder;
            }
            if (patch.patchedHandleMouse === customEditorPrototype.handleMouse) {
                if (patch.hadOwnHandleMouse)
                    customEditorPrototype.handleMouse = patch.originalHandleMouse;
                else
                    delete customEditorPrototype.handleMouse;
            }
            if (customEditorPrototype.render === patch.originalRender &&
                customEditorPrototype.renderTopBorder === patch.originalTopBorder &&
                customEditorPrototype.handleMouse === patch.originalHandleMouse) {
                delete customEditorPrototype[editorFramePatchKey];
            }
        });
    }
}
