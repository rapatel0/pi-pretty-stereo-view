import { CustomMessageComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { ActivityGroup, ActivityMember, ActivityTimeline } from "./activity-timeline.js";
interface PatchState {
    readonly customMessageKey: (message: any) => string;
    readonly nativeCustomBoundaryKeys: Set<string>;
    readonly activityTimeline: ActivityTimeline;
    readonly activityUpdateComponents: Map<string, Component>;
    readonly closeCleanAtNativeCustomBoundary: () => void;
    readonly renderMode: "full" | "compact" | "clean";
    readonly addPersistentActivityUpdate: (message: any) => ActivityMember;
    readonly renderActivityUpdateProjection: (group: ActivityGroup, member: ActivityMember, width: number, component?: any) => string[];
    readonly handleActivityUpdateMouse: (group: ActivityGroup, member: ActivityMember, event: any) => {
        handled: boolean;
    } | undefined;
}
export function installCustomMessages(pi: ExtensionAPI, state: PatchState): void {
    const customMessagePrototype = CustomMessageComponent.prototype as any;
    const customMessagePatchKey = Symbol.for("pretty-tui.clean-custom-message");
    if (!customMessagePrototype[customMessagePatchKey]) {
        const originalCustomRender = customMessagePrototype.render;
        const originalCustomHandleMouse = customMessagePrototype.handleMouse;
        const releaseSemanticCustomMessage = (component: any): boolean => {
            if (!component.customRenderer)
                return false;
            const key = state.customMessageKey(component.message);
            if (!state.nativeCustomBoundaryKeys.has(key)) {
                state.nativeCustomBoundaryKeys.add(key);
                const member = state.activityTimeline.memberForUpdate(key);
                if (member)
                    state.activityUpdateComponents.delete(member.id);
                state.activityTimeline.removeUpdate(key);
                state.closeCleanAtNativeCustomBoundary();
            }
            return true;
        };
        const patchedCustomRender = function (this: any, width: number): string[] {
            if (state.renderMode === "full")
                return originalCustomRender.call(this, width);
            if (releaseSemanticCustomMessage(this)) {
                return originalCustomRender.call(this, width);
            }
            const message = this.message;
            const key = state.customMessageKey(message);
            let member = state.activityTimeline.memberForUpdate(key);
            // Extension-injected custom messages do not always emit Pi's model
            // message_start event. Claim them at the component boundary so live
            // rendering matches transcript restoration instead of failing open to
            // the purple native box until the next reload.
            if (!member) {
                member = state.addPersistentActivityUpdate(message);
            }
            const group = member ? state.activityTimeline.groupForMember(member.id) : undefined;
            if (!member || !group) {
                return originalCustomRender.call(this, width);
            }
            state.activityUpdateComponents.set(member.id, this);
            return state.renderActivityUpdateProjection(group, member, width);
        };
        const patchedCustomHandleMouse = function (this: any, event: any) {
            if (state.renderMode === "full")
                return originalCustomHandleMouse?.call(this, event);
            if (releaseSemanticCustomMessage(this)) {
                return originalCustomHandleMouse?.call(this, event);
            }
            const member = state.activityTimeline.memberForUpdate(state.customMessageKey(this.message));
            const group = member ? state.activityTimeline.groupForMember(member.id) : undefined;
            if (!member || !group) {
                return originalCustomHandleMouse?.call(this, event);
            }
            return state.handleActivityUpdateMouse(group, member, event);
        };
        customMessagePrototype[customMessagePatchKey] = {
            originalRender: originalCustomRender,
            patchedRender: patchedCustomRender,
            originalHandleMouse: originalCustomHandleMouse,
            patchedHandleMouse: patchedCustomHandleMouse,
        };
        customMessagePrototype.render = patchedCustomRender;
        customMessagePrototype.handleMouse = patchedCustomHandleMouse;
        pi.on("session_shutdown", () => {
            const patch = customMessagePrototype[customMessagePatchKey];
            if (!patch)
                return;
            if (patch.patchedRender === customMessagePrototype.render) {
                customMessagePrototype.render = patch.originalRender;
            }
            if (patch.patchedHandleMouse === customMessagePrototype.handleMouse) {
                customMessagePrototype.handleMouse = patch.originalHandleMouse;
            }
            if (customMessagePrototype.render === patch.originalRender &&
                customMessagePrototype.handleMouse === patch.originalHandleMouse) {
                delete customMessagePrototype[customMessagePatchKey];
            }
        });
    }
}
