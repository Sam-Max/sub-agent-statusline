import { TuiPluginModule, TuiPluginApi } from '@opencode-ai/plugin/tui';

type RunningReconcileEvidence = {
    status?: "running" | "done" | "error";
    endedAt?: string;
    checkedMessages?: boolean;
    sawRunningEvidence?: boolean;
    probeFailed?: boolean;
    canApplyStaleFallback?: boolean;
};

type ChildStatus = "running" | "done" | "error";
interface ChildTokenState {
    input?: number;
    output?: number;
    total?: number;
    contextPercent?: number;
}
interface ChildModelState {
    providerID: string;
    modelID: string;
    variant?: string;
}
interface ChildSessionState {
    id: string;
    title: string;
    summary?: string;
    agentName?: string;
    parentID: string;
    messageID?: string;
    source?: "session" | "subtask" | "tool";
    toolName?: string;
    targetSessionID?: string;
    status: ChildStatus;
    color: "yellow" | "green" | "red";
    startedAt: string;
    updatedAt: string;
    endedAt?: string;
    elapsedMs?: number;
    tokens?: ChildTokenState;
    model?: ChildModelState;
}
interface StatuslineState {
    children: Record<string, ChildSessionState>;
    countedChildIDs: Record<string, true>;
    totalExecuted: number;
    updatedAt: string;
}
interface StatusCounts {
    running: number;
    done: number;
    error: number;
}

interface SidebarScrollAnchor {
    childIDs: string[];
    intraRowOffset: number;
}
interface SidebarScrollRowLayout {
    id: string;
    height: number;
}
declare function preservedSidebarAnchorScrollTop(input: {
    expanded: boolean;
    anchor?: SidebarScrollAnchor;
    rows: SidebarScrollRowLayout[];
    leadingHeight?: number;
    scrollTop: number;
    scrollHeight: number;
    viewportHeight: number;
}): number | undefined;
declare function preservedSidebarScrollTop(input: {
    expanded: boolean;
    offsetTop: number;
    anchor?: SidebarScrollAnchor;
    rows?: SidebarScrollRowLayout[];
    leadingHeight?: number;
    scrollTop: number;
    scrollHeight: number;
    viewportHeight: number;
}): number | undefined;
declare function runTuiStateMaintenance(api: TuiPluginApi, current: StatuslineState): StatuslineState;
declare function createTuiMaintenanceTimers(input: {
    onElapsedTick: () => void;
    onMaintenanceTick: () => void;
}): {
    syncElapsedTimer: (hasRunningChild: boolean) => void;
    dispose: () => void;
};
declare function backfillHydratedTargetSessionIDs(state: StatuslineState, parentSessionID: string): boolean;
declare function wrapCompactText(value: string, width: number, maxLines: number): string[];
declare function subagentRowHeight(input: {
    child: ChildSessionState;
    nowMs: number;
    sidebarWidth?: number;
    reservedWidth?: number;
}): number;
declare function formatChildModelLine(child: ChildSessionState, providers: TuiPluginApi["state"]["provider"], width: number): string | undefined;
interface TuiSubagentSnapshot {
    visibleChildren: ChildSessionState[];
    visibleCounts: StatusCounts;
    totalExecuted: number;
    showingOtherSessions: boolean;
}
declare function resolveTuiSubagentSnapshot(input: {
    state: StatuslineState;
    sessionID?: string;
    nowMs?: number;
    showCompletedHistory?: boolean;
}): TuiSubagentSnapshot;
declare function resolveSidebarSubagentSnapshot(input: {
    state: StatuslineState;
    sessionID: string;
    nowMs?: number;
    showCompletedHistory?: boolean;
}): TuiSubagentSnapshot;
declare function hydratePreviousSubagents(api: TuiPluginApi, currentSessionID: string, statePath: string, textPath: string, setState: (fn: (prev: StatuslineState) => StatuslineState) => void): Promise<boolean>;
declare function probeRunningEvidence(input: {
    api: TuiPluginApi;
    targetSessionID: string;
    directory: string;
    candidateAgeMs: number;
    nowMs: number;
}): Promise<RunningReconcileEvidence>;
declare const plugin: TuiPluginModule;

export { type SidebarScrollAnchor, type SidebarScrollRowLayout, type TuiSubagentSnapshot, backfillHydratedTargetSessionIDs, createTuiMaintenanceTimers, plugin as default, formatChildModelLine, hydratePreviousSubagents, preservedSidebarAnchorScrollTop, preservedSidebarScrollTop, probeRunningEvidence, resolveSidebarSubagentSnapshot, resolveTuiSubagentSnapshot, runTuiStateMaintenance, subagentRowHeight, wrapCompactText };
