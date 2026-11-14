import { mouseInputPrototype } from "../integrated/ui-runtime.js";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, getOsc8LinkAtColumn } from "@earendil-works/pi-tui";
interface PatchState {
    readonly collapseLabel: string;
    renderMode: "full" | "compact" | "clean";
    readonly mouseClickHitTests: WeakMap<object, (event: any) => boolean>;
}
export function installMouseInput(pi: ExtensionAPI, state: PatchState): void {
    const altScreenPrototype = mouseInputPrototype() as any;
    const cleanSummaryClickPatchKey = Symbol.for("pretty-tui.clean-summary-click");
    const cleanSummaryPressKey = Symbol("pretty-tui.clean-summary-press");
    const cleanControlPressKey = Symbol("pretty-tui.control-press");
    if (!altScreenPrototype[cleanSummaryClickPatchKey]) {
        const originalHandleSelectionMouseEvent = altScreenPrototype.handleSelectionMouseEvent;
        const originalHandleMouseEvent = altScreenPrototype.handleMouseEvent;
        const summaryAtPoint = (screen: any, x: number, y: number): boolean => {
            const line = stripTerminalSequences(screen.previousScreen?.[y] ?? "");
            const match = /●\s+(?:Done|Running)\([^)]*\)/.exec(line);
            if (match) {
                const start = visibleWidth(line.slice(0, match.index));
                if (x >= start && x < start + visibleWidth(match[0]))
                    return true;
            }
            const collapse = line.indexOf(state.collapseLabel);
            const start = visibleWidth(line.slice(0, collapse));
            return state.renderMode === "clean" && collapse >= 0 && x >= start && x < start + visibleWidth(state.collapseLabel);
        };
        const interactiveAtPoint = (screen: any, x: number, y: number): boolean => {
            if (screen.hasOverlay?.())
                return false;
            if (getOsc8LinkAtColumn(screen.previousScreen?.[y] ?? "", x))
                return false;
            const visit = (box: any): boolean => {
                if (!box?.rect || !box?.clip || x < box.clip.x || y < box.clip.y ||
                    x >= box.clip.x + box.clip.width || y >= box.clip.y + box.clip.height)
                    return false;
                if ((box.children ?? []).some(visit))
                    return true;
                const hitTest = state.mouseClickHitTests.get(box.component);
                return Boolean(hitTest?.({
                    x: x - box.rect.x, y: y - box.rect.y,
                    width: box.rect.width, height: box.rect.height,
                }));
            };
            return visit(screen.currentLayout?.root) || summaryAtPoint(screen, x, y);
        };
        const withinTolerance = (press: any, event: any): boolean => event.y === press.y && Math.abs(event.x - press.x) <= 2;
        const isUnmodifiedLeftPress = (event: any): boolean => !event.release && (event.button & (32 | 64 | 4 | 8 | 16)) === 0 && (event.button & 3) === 0;
        // Copy controls can consume press, bypassing the selection handler entirely.
        const patchedHandleMouseEvent = function (this: any, event: any) {
            if (isUnmodifiedLeftPress(event)) {
                if (interactiveAtPoint(this, event.x, event.y))
                    this[cleanControlPressKey] = { x: event.x, y: event.y };
                else
                    delete this[cleanControlPressKey];
            }
            else {
                const press = this[cleanControlPressKey];
                if (press && this.mousePressTarget && !this.mouseCapture) {
                    if ((event.button & 32) !== 0 && withinTolerance(press, event))
                        return;
                    if (event.release) {
                        delete this[cleanControlPressKey];
                        if (withinTolerance(press, event)) {
                            return originalHandleMouseEvent.call(this, { ...event, x: press.x });
                        }
                    }
                    else
                        delete this[cleanControlPressKey];
                }
                if (event.release || (event.button & 64) !== 0)
                    delete this[cleanControlPressKey];
            }
            return originalHandleMouseEvent.call(this, event);
        };
        const patchedHandleSelectionMouseEvent = function (this: any, event: any) {
            const isMotion = (event.button & 32) !== 0;
            const isLeftPress = isUnmodifiedLeftPress(event);
            if (isLeftPress) {
                if (interactiveAtPoint(this, event.x, event.y)) {
                    this[cleanSummaryPressKey] = { x: event.x, y: event.y };
                }
                else {
                    delete this[cleanSummaryPressKey];
                }
                return originalHandleSelectionMouseEvent.call(this, event);
            }
            const press = this[cleanSummaryPressKey];
            if (press) {
                const withinClickTolerance = withinTolerance(press, event);
                if (isMotion && withinClickTolerance) {
                    return;
                }
                if (event.release) {
                    delete this[cleanSummaryPressKey];
                    if (withinClickTolerance) {
                        return originalHandleSelectionMouseEvent.call(this, { ...event, x: press.x });
                    }
                }
                else if (isMotion) {
                    delete this[cleanSummaryPressKey];
                }
            }
            return originalHandleSelectionMouseEvent.call(this, event);
        };
        altScreenPrototype[cleanSummaryClickPatchKey] = {
            originalHandleSelectionMouseEvent,
            patchedHandleSelectionMouseEvent,
            originalHandleMouseEvent,
            patchedHandleMouseEvent,
        };
        altScreenPrototype.handleSelectionMouseEvent = patchedHandleSelectionMouseEvent;
        altScreenPrototype.handleMouseEvent = patchedHandleMouseEvent;
        pi.on("session_shutdown", () => {
            const patch = altScreenPrototype[cleanSummaryClickPatchKey];
            if (patch?.patchedHandleMouseEvent === altScreenPrototype.handleMouseEvent) {
                altScreenPrototype.handleMouseEvent = patch.originalHandleMouseEvent;
            }
            if (patch?.patchedHandleSelectionMouseEvent === altScreenPrototype.handleSelectionMouseEvent) {
                altScreenPrototype.handleSelectionMouseEvent = patch.originalHandleSelectionMouseEvent;
            }
            if (patch &&
                altScreenPrototype.handleSelectionMouseEvent === patch.originalHandleSelectionMouseEvent &&
                altScreenPrototype.handleMouseEvent === patch.originalHandleMouseEvent) {
                delete altScreenPrototype[cleanSummaryClickPatchKey];
            }
        });
    }
}
