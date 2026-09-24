// src/reconcile.ts
var DEFAULT_STALE_RUNNING_THRESHOLD_MS = 10 * 60 * 6e4;
var RUNNING_SESSION_STATUS_VALUES = /* @__PURE__ */ new Set([
  "busy",
  "running",
  "pending",
  "queued",
  "in_progress",
  "working",
  "compacting",
  "retry"
]);
var DONE_SESSION_STATUS_VALUES = /* @__PURE__ */ new Set([
  "idle",
  "done",
  "completed",
  "complete",
  "success",
  "succeeded"
]);
var ERROR_SESSION_STATUS_VALUES = /* @__PURE__ */ new Set([
  "error",
  "failed",
  "failure",
  "cancelled",
  "canceled",
  "aborted"
]);
function deriveOpenCodeSessionStatus(value) {
  if (hasStructuredErrorEvidence(value)) {
    return "error";
  }
  const values = collectOpenCodeSessionStatusValues(value);
  if (values.some((status) => ERROR_SESSION_STATUS_VALUES.has(status))) {
    return "error";
  }
  if (values.some((status) => RUNNING_SESSION_STATUS_VALUES.has(status))) {
    return "running";
  }
  if (values.some((status) => DONE_SESSION_STATUS_VALUES.has(status))) {
    return "done";
  }
  return void 0;
}
function hasStructuredErrorEvidence(value, depth = 0) {
  if (depth > 4) return false;
  const record = asRecord(value);
  if (!record) return false;
  if (record.error) return true;
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) {
      if (nested.some((item) => hasStructuredErrorEvidence(item, depth + 1))) {
        return true;
      }
      continue;
    }
    if (hasStructuredErrorEvidence(nested, depth + 1)) return true;
  }
  return false;
}
function asRecord(value) {
  return value && typeof value === "object" ? value : void 0;
}
function collectOpenCodeSessionStatusValues(value) {
  if (typeof value === "string") {
    const normalized = normalizeStatusValue(value);
    return normalized ? [normalized] : [];
  }
  const record = asRecord(value);
  if (!record) return [];
  const values = [
    normalizeStatusValue(record.type),
    normalizeStatusValue(record.status),
    normalizeStatusValue(record.state),
    normalizeStatusValue(record.phase),
    normalizeStatusValue(record.result)
  ].filter((status) => Boolean(status));
  if (record.error) values.push("error");
  if (record.busy === true || record.running === true) values.push("busy");
  return values;
}
function normalizeStatusValue(value) {
  if (typeof value !== "string") return void 0;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : void 0;
}

// src/state.ts
import { randomUUID } from "crypto";
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";
import os from "os";

// src/subagent-classification.ts
function isRealSessionID(value) {
  return typeof value === "string" && value.startsWith("ses_");
}
function isTrustedTargetSessionID(value) {
  return isRealSessionID(value);
}
function trustedTargetSessionID(item) {
  return isTrustedTargetSessionID(item.targetSessionID) ? item.targetSessionID : void 0;
}
function isRealExecution(item) {
  return item.source === "session" || isRealSessionID(item.id);
}
function realExecutionID(item) {
  return trustedTargetSessionID(item) ?? item.id;
}
function classifySubagentWorkItem(item) {
  if (isRealExecution(item)) {
    const executionID = realExecutionID(item);
    return {
      kind: "real-execution",
      executionID,
      targetSessionID: executionID
    };
  }
  const targetSessionID = trustedTargetSessionID(item);
  if (targetSessionID) {
    return {
      kind: "execution-proxy",
      executionID: targetSessionID,
      targetSessionID
    };
  }
  return { kind: "invocation-wrapper" };
}
function uniqueExecutionID(candidates) {
  const executionIDs = new Set(candidates.map((item) => realExecutionID(item)));
  return executionIDs.size === 1 ? [...executionIDs][0] : void 0;
}
function realExecutions(items) {
  return items.filter((item) => classifySubagentWorkItem(item).kind === "real-execution");
}
function resolveTrustedTargetExecutionID(item, realItems) {
  const targetSessionID = trustedTargetSessionID(item);
  if (!targetSessionID) return void 0;
  return realExecutions(realItems).some(
    (realItem) => realExecutionID(realItem) === targetSessionID
  ) ? targetSessionID : void 0;
}
function resolveSharedMessageExecutionID(item, realItems) {
  if (!item.messageID) return void 0;
  return uniqueExecutionID(
    realExecutions(realItems).filter(
      (realItem) => realItem.parentID === item.parentID && realItem.messageID === item.messageID
    )
  );
}
function resolveUniqueSameParentExecutionID(item, realItems) {
  return uniqueExecutionID(
    realExecutions(realItems).filter(
      (realItem) => realItem.parentID === item.parentID
    )
  );
}
function resolveCorrelatedExecutionID(item, realItems) {
  if (trustedTargetSessionID(item)) {
    return resolveTrustedTargetExecutionID(item, realItems);
  }
  return resolveSharedMessageExecutionID(item, realItems) ?? resolveUniqueSameParentExecutionID(item, realItems);
}
function correlateSubagentWorkItems(items) {
  const realItems = realExecutions(items);
  const executions = /* @__PURE__ */ new Map();
  for (const item of realItems) {
    const executionID = realExecutionID(item);
    if (!executions.has(executionID)) {
      executions.set(executionID, { executionID, real: item, proxies: [] });
    }
  }
  for (const item of items) {
    if (classifySubagentWorkItem(item).kind === "real-execution") continue;
    const executionID = resolveCorrelatedExecutionID(item, realItems);
    if (!executionID) continue;
    executions.get(executionID)?.proxies.push(item);
  }
  return [...executions.values()];
}
function mergeProxyMetadataWithRealExecution(real, proxy) {
  const executionID = realExecutionID(real);
  return {
    ...real,
    title: proxy.title ?? real.title,
    summary: proxy.summary ?? real.summary,
    agentName: proxy.agentName ?? real.agentName,
    messageID: real.messageID ?? proxy.messageID,
    id: real.id,
    parentID: real.parentID,
    source: "session",
    targetSessionID: real.targetSessionID ?? executionID,
    status: real.status,
    color: real.color,
    startedAt: real.startedAt,
    updatedAt: real.updatedAt,
    endedAt: real.endedAt,
    elapsedMs: real.elapsedMs,
    tokens: real.tokens,
    model: real.model
  };
}

// src/state.ts
var TERMINAL_CHILD_TTL_MS = 3 * 24 * 60 * 60 * 1e3;
var MAX_TERMINAL_CHILDREN = 1500;
function statusColor(status) {
  if (status === "done") return "green";
  if (status === "error") return "red";
  return "yellow";
}
function safeTimestamp(input, fallback) {
  if (typeof input !== "string") return fallback;
  return Number.isNaN(Date.parse(input)) ? fallback : input;
}
function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function toNonNegativeInteger(value) {
  const parsed = toFiniteNumber(value);
  if (parsed === void 0) return void 0;
  return Math.max(0, Math.floor(parsed));
}
function sanitizeCountedChildIDs(input) {
  if (!input || typeof input !== "object") return {};
  const counted = {};
  for (const [id, value] of Object.entries(input)) {
    if (!id) continue;
    if (value === true) {
      counted[id] = true;
    }
  }
  return counted;
}
function normalizeExecutionCounters(state) {
  state.countedChildIDs = sanitizeCountedChildIDs(state.countedChildIDs);
  const countedTotal = Object.keys(state.countedChildIDs).length;
  state.totalExecuted = Math.max(
    toNonNegativeInteger(state.totalExecuted) ?? 0,
    countedTotal
  );
}
function resolveExecutionCountIdentity(child) {
  const classification = classifySubagentWorkItem(child);
  return classification.kind === "real-execution" ? classification.executionID : void 0;
}
function countRetainedSubagentStatuses(input) {
  const children = Array.isArray(input.children) ? input.children : Object.values(input.children);
  const scopedChildren = input.parentSessionID ? children.filter((child) => child.parentID === input.parentSessionID) : children;
  const counts = { running: 0, done: 0, error: 0 };
  for (const { real } of correlateSubagentWorkItems(scopedChildren)) {
    counts[real.status] += 1;
  }
  return counts;
}
function reconcileCountedExecutionsWithChildren(state) {
  const executionIDs = correlateSubagentWorkItems(
    Object.values(state.children)
  ).map((execution) => execution.executionID);
  state.countedChildIDs = Object.fromEntries(
    executionIDs.map((id) => [id, true])
  );
  state.totalExecuted = executionIDs.length;
}
function countChildExecution(state, child) {
  normalizeExecutionCounters(state);
  const countIdentity = resolveExecutionCountIdentity(child);
  if (!countIdentity) return false;
  if (state.countedChildIDs[countIdentity]) return false;
  const previousTotal = Math.max(
    toNonNegativeInteger(state.totalExecuted) ?? 0,
    Object.keys(state.countedChildIDs).length
  );
  state.countedChildIDs[countIdentity] = true;
  state.totalExecuted = previousTotal + 1;
  return true;
}
function sanitizeTokens(input) {
  if (!input || typeof input !== "object") return void 0;
  const raw = input;
  const tokens = {
    input: toFiniteNumber(raw.input),
    output: toFiniteNumber(raw.output),
    total: toFiniteNumber(raw.total),
    contextPercent: toFiniteNumber(raw.contextPercent)
  };
  if (tokens.input === void 0 && tokens.output === void 0 && tokens.total === void 0 && tokens.contextPercent === void 0) {
    return void 0;
  }
  return tokens;
}
function sanitizeModel(input) {
  if (!input || typeof input !== "object") return void 0;
  const raw = input;
  const providerID = typeof raw.providerID === "string" ? raw.providerID.trim() : "";
  const modelID = typeof raw.modelID === "string" ? raw.modelID.trim() : "";
  const variant = typeof raw.variant === "string" ? raw.variant.trim() : "";
  if (!providerID || !modelID) return void 0;
  return { providerID, modelID, ...variant ? { variant } : {} };
}
function sanitizeTargetSessionID(value, fallback) {
  if (typeof value === "string" && value.startsWith("ses_")) {
    return value;
  }
  if (typeof fallback === "string" && fallback.startsWith("ses_")) {
    return fallback;
  }
  return void 0;
}
function mergeTokens(existing, incoming) {
  if (!existing && !incoming) return void 0;
  return {
    input: incoming?.input ?? existing?.input,
    output: incoming?.output ?? existing?.output,
    total: incoming?.total ?? existing?.total,
    contextPercent: incoming?.contextPercent ?? existing?.contextPercent
  };
}
function sameTokens(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function normalizeComparableText(value) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
function sanitizeSummary(value, title) {
  if (typeof value !== "string") return void 0;
  const summary = value.replace(/\s+/g, " ").trim();
  if (!summary) return void 0;
  if (normalizeComparableText(summary) === normalizeComparableText(title)) {
    return void 0;
  }
  return summary;
}
function sanitizeAgentName(value) {
  if (typeof value !== "string") return void 0;
  const agentName = value.replace(/^\((.*)\)$/, "$1").replace(/\s+/g, " ").trim();
  return agentName || void 0;
}
function resolveElapsedMs(child, nowMs) {
  const startedMs = Date.parse(child.startedAt);
  if (Number.isNaN(startedMs)) return 0;
  const endSource = child.endedAt ?? child.updatedAt;
  const endMs = child.endedAt ? Date.parse(endSource) : nowMs;
  if (Number.isNaN(endMs)) return 0;
  return Math.max(0, endMs - startedMs);
}
function terminalReferenceMs(child) {
  const parsed = Date.parse(
    child.endedAt ?? child.updatedAt ?? child.startedAt
  );
  return Number.isNaN(parsed) ? 0 : parsed;
}
function pruneTerminalChildren(state, now = /* @__PURE__ */ new Date()) {
  const nowMs = now.getTime();
  const terminalChildren = [];
  let pruned = 0;
  for (const child of Object.values(state.children)) {
    if (child.status === "running") continue;
    const referenceMs = terminalReferenceMs(child);
    if (nowMs - referenceMs > TERMINAL_CHILD_TTL_MS) {
      delete state.children[child.id];
      pruned += 1;
      continue;
    }
    terminalChildren.push({ id: child.id, referenceMs });
  }
  if (terminalChildren.length <= MAX_TERMINAL_CHILDREN) {
    return pruned;
  }
  terminalChildren.sort(
    (a, b) => b.referenceMs - a.referenceMs || a.id.localeCompare(b.id)
  );
  for (const child of terminalChildren.slice(MAX_TERMINAL_CHILDREN)) {
    delete state.children[child.id];
    pruned += 1;
  }
  return pruned;
}
function refreshDerivedFields(state, now = /* @__PURE__ */ new Date()) {
  const nowISO = now.toISOString();
  const nowMs = now.getTime();
  normalizeExecutionCounters(state);
  for (const [id, child] of Object.entries(state.children)) {
    const startedAt = safeTimestamp(child.startedAt, nowISO);
    const updatedAt = safeTimestamp(child.updatedAt, nowISO);
    const endedAt = child.endedAt ? safeTimestamp(child.endedAt, updatedAt) : void 0;
    const status = child.status === "done" || child.status === "error" || child.status === "running" ? child.status : "running";
    const targetSessionID = sanitizeTargetSessionID(
      child.targetSessionID,
      id.startsWith("ses_") ? id : void 0
    );
    state.children[id] = {
      ...child,
      startedAt,
      updatedAt,
      endedAt,
      status,
      targetSessionID,
      color: statusColor(status),
      tokens: sanitizeTokens(child.tokens),
      model: sanitizeModel(child.model),
      elapsedMs: resolveElapsedMs(
        {
          ...child,
          startedAt,
          updatedAt,
          endedAt,
          status,
          color: statusColor(status)
        },
        nowMs
      )
    };
  }
  reconcileCountedExecutionsWithChildren(state);
  state.updatedAt = safeTimestamp(state.updatedAt, nowISO);
  if (pruneTerminalChildren(state, now) > 0) {
    reconcileCountedExecutionsWithChildren(state);
    state.updatedAt = nowISO;
  }
}
var STATUS_DIRNAME = "opencode-subagent-statusline";
var STATUS_FILENAME = "state.json";
var STATUS_DIR_MODE = 448;
var STATUS_FILE_MODE = 384;
function sanitizeInstanceName(input) {
  return input.replace(/[^A-Za-z0-9._-]/g, "_");
}
function resolveDefaultInstanceName() {
  const fromEnv = process.env.OPENCODE_SUBAGENT_STATUSLINE_INSTANCE;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    const safe = sanitizeInstanceName(fromEnv);
    if (safe.length > 0) {
      return safe;
    }
  }
  return `pid-${process.pid}`;
}
function shouldPreserveStateOnStartup() {
  return process.env.OPENCODE_SUBAGENT_STATUSLINE_PRESERVE_STATE === "1";
}
function createEmptyState() {
  return {
    children: {},
    countedChildIDs: {},
    totalExecuted: 0,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function resolveStatePath() {
  const fromEnv = process.env.OPENCODE_SUBAGENT_STATUSLINE_STATE;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? os.tmpdir();
  const instance = resolveDefaultInstanceName();
  return join(runtimeDir, STATUS_DIRNAME, instance, STATUS_FILENAME);
}
function resolveTextPath(statePath) {
  return join(dirname(statePath), "status.txt");
}
async function loadState(statePath) {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return createEmptyState();
    }
    const children = parsed.children && typeof parsed.children === "object" ? parsed.children : {};
    const countedChildIDs = sanitizeCountedChildIDs(parsed.countedChildIDs);
    const state = {
      children,
      countedChildIDs,
      totalExecuted: Math.max(
        toNonNegativeInteger(parsed.totalExecuted) ?? 0,
        Object.keys(countedChildIDs).length
      ),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : (/* @__PURE__ */ new Date()).toISOString()
    };
    for (const [id, child] of Object.entries(children)) {
      const candidate = child;
      if (typeof candidate.title !== "string" || typeof candidate.parentID !== "string") {
        continue;
      }
      const targetSessionID = sanitizeTargetSessionID(
        candidate.targetSessionID,
        id.startsWith("ses_") ? id : void 0
      );
      const countIdentity = resolveExecutionCountIdentity({
        id,
        title: candidate.title,
        parentID: candidate.parentID,
        messageID: candidate.messageID,
        source: candidate.source,
        targetSessionID
      });
      if (countIdentity) {
        state.countedChildIDs[countIdentity] = true;
      }
    }
    reconcileCountedExecutionsWithChildren(state);
    refreshDerivedFields(state);
    return state;
  } catch {
    return createEmptyState();
  }
}
async function writeLocalStatusFile(path, contents) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: STATUS_DIR_MODE });
  const tempPath = join(
    directory,
    `.${basename(path)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(tempPath, contents, {
      encoding: "utf8",
      mode: STATUS_FILE_MODE
    });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => void 0);
    throw error;
  }
}
async function saveStatusText(textPath, contents) {
  await writeLocalStatusFile(textPath, contents);
}
async function saveState(statePath, state) {
  refreshDerivedFields(state);
  await writeLocalStatusFile(statePath, JSON.stringify(state, null, 2));
}
function upsertRunningChild(state, input) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const observedUpdatedAt = safeTimestamp(input.updatedAt, now);
  const observedStartedAt = safeTimestamp(input.startedAt, observedUpdatedAt);
  const existing = state.children[input.id];
  const targetSessionID = sanitizeTargetSessionID(
    input.targetSessionID ?? existing?.targetSessionID,
    input.id.startsWith("ses_") ? input.id : void 0
  );
  const source = input.source ?? existing?.source ?? "session";
  const counted = existing ? false : countChildExecution(state, {
    id: input.id,
    title: input.title,
    parentID: input.parentID,
    messageID: input.messageID,
    source,
    targetSessionID
  });
  const shouldKeepCompletedTiming = existing?.status === "done" || existing?.status === "error";
  const next = {
    id: input.id,
    title: input.title,
    summary: sanitizeSummary(input.summary, input.title) ?? sanitizeSummary(existing?.summary, input.title),
    agentName: sanitizeAgentName(input.agentName) ?? existing?.agentName,
    parentID: input.parentID,
    messageID: input.messageID ?? existing?.messageID,
    source,
    toolName: input.toolName ?? existing?.toolName,
    targetSessionID,
    status: shouldKeepCompletedTiming ? existing.status : "running",
    color: statusColor(shouldKeepCompletedTiming ? existing.status : "running"),
    startedAt: existing?.startedAt ?? observedStartedAt,
    updatedAt: observedUpdatedAt,
    endedAt: shouldKeepCompletedTiming ? existing.endedAt : void 0,
    elapsedMs: existing?.elapsedMs,
    tokens: existing?.tokens,
    model: existing?.model
  };
  if (existing && next.title === existing.title && next.summary === existing.summary && next.agentName === existing.agentName && next.parentID === existing.parentID && next.messageID === existing.messageID && next.source === existing.source && next.toolName === existing.toolName && next.targetSessionID === existing.targetSessionID && next.status === existing.status && next.color === existing.color && next.startedAt === existing.startedAt && next.endedAt === existing.endedAt && sameTokens(next.tokens, existing.tokens) && JSON.stringify(next.model) === JSON.stringify(existing.model)) {
    return counted;
  }
  state.children[input.id] = next;
  state.updatedAt = observedUpdatedAt;
  return true;
}
function markChildStatus(state, childID, status, endedAt) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let changed = false;
  let stateUpdatedAt = state.updatedAt;
  for (const child of Object.values(state.children)) {
    if (child.id !== childID && child.targetSessionID !== childID) continue;
    const observedEndedAt = endedAt ? safeTimestamp(endedAt, now) : child.endedAt ?? now;
    if (child.status === status && child.color === statusColor(status) && child.updatedAt === observedEndedAt && child.endedAt === observedEndedAt) {
      continue;
    }
    const nextChild = {
      ...child,
      status,
      color: statusColor(status),
      updatedAt: observedEndedAt,
      endedAt: observedEndedAt
    };
    state.children[child.id] = {
      ...nextChild,
      elapsedMs: resolveElapsedMs(nextChild, Date.now())
    };
    stateUpdatedAt = observedEndedAt;
    changed = true;
  }
  if (changed) {
    state.updatedAt = stateUpdatedAt;
  }
  return changed;
}
function upsertChildDetails(state, childID, input) {
  const existing = state.children[childID];
  if (!existing) return false;
  const nextTitle = typeof input.title === "string" && input.title.trim().length > 0 ? input.title : existing.title;
  const nextSummary = sanitizeSummary(input.summary, nextTitle) ?? sanitizeSummary(existing.summary, nextTitle);
  const nextAgentName = sanitizeAgentName(input.agentName) ?? existing.agentName;
  const mergedTokens = mergeTokens(existing.tokens, input.tokens);
  const nextTargetSessionID = sanitizeTargetSessionID(
    input.targetSessionID ?? existing.targetSessionID,
    existing.id.startsWith("ses_") ? existing.id : void 0
  );
  const detailsChanged = nextTitle !== existing.title || nextSummary !== existing.summary || nextAgentName !== existing.agentName || !sameTokens(mergedTokens, existing.tokens) || nextTargetSessionID !== existing.targetSessionID;
  if (!detailsChanged) return false;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const observedUpdatedAt = safeTimestamp(input.updatedAt, now);
  const next = {
    ...existing,
    title: nextTitle,
    summary: nextSummary,
    agentName: nextAgentName,
    tokens: mergedTokens,
    targetSessionID: nextTargetSessionID,
    updatedAt: observedUpdatedAt
  };
  state.children[childID] = next;
  state.updatedAt = observedUpdatedAt;
  return true;
}
function setChildModel(state, sessionID, model, updatedAt) {
  const matches = Object.values(state.children).filter(
    (child) => child.id === sessionID || child.targetSessionID === sessionID
  );
  if (matches.length === 0) return false;
  let changed = false;
  const observedUpdatedAt = safeTimestamp(updatedAt, (/* @__PURE__ */ new Date()).toISOString());
  for (const child of matches) {
    const sanitized = sanitizeModel(model);
    if (JSON.stringify(child.model) === JSON.stringify(sanitized)) continue;
    state.children[child.id] = { ...child, model: sanitized };
    changed = true;
  }
  if (changed) state.updatedAt = observedUpdatedAt;
  return changed;
}

// src/events.ts
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function normalizeMessage(value) {
  const message = isRecord(value) ? value : void 0;
  if (!message) return void 0;
  return isRecord(message.info) ? message.info : message;
}
function messageActivityMs(message) {
  const time = isRecord(message.time) ? message.time : void 0;
  const value = time?.completed ?? time?.updated ?? time?.created;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}
function extractLatestAssistantModel(input) {
  const values = Array.isArray(input) ? input : [input];
  const assistants = values.map((value, index) => ({ message: normalizeMessage(value), index })).filter(
    (entry) => entry.message?.role === "assistant"
  ).sort(
    (left, right) => messageActivityMs(left.message) - messageActivityMs(right.message) || left.index - right.index
  );
  const latest = assistants.at(-1)?.message;
  if (!latest) return void 0;
  const sessionID = asString(latest.sessionID);
  if (!sessionID) return void 0;
  const providerID = asString(latest.providerID)?.trim();
  const modelID = asString(latest.modelID)?.trim();
  const variant = asString(latest.variant)?.trim();
  const model = providerID && modelID ? { providerID, modelID, ...variant ? { variant } : {} } : void 0;
  const activity = messageActivityMs(latest);
  return {
    sessionID,
    model,
    updatedAt: activity > 0 ? new Date(activity).toISOString() : void 0
  };
}
function conciseText(value) {
  if (typeof value !== "string") return void 0;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return void 0;
  return text.length > 180 ? `${text.slice(0, 179)}\u2026` : text;
}
function sameDisplayText(a, b) {
  if (!a || !b) return false;
  return a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
}
function firstDistinctSummary(candidates, title) {
  for (const candidate of candidates) {
    const summary = conciseText(candidate);
    if (summary && !sameDisplayText(summary, title)) return summary;
  }
  return void 0;
}
function isTechnicalDelegationTitle(value) {
  if (!value) return false;
  return /^delegation:\s+/i.test(value.trim());
}
function promptTitle(value) {
  const text = conciseText(value);
  if (!text) return void 0;
  const sentence = text.match(/^(.+?[.!?])\s/)?.[1]?.trim();
  const title = sentence && sentence.length <= 100 ? sentence : text;
  return title.length > 100 ? `${title.slice(0, 99)}\u2026` : title;
}
function firstUsefulTitle(candidates) {
  for (const candidate of candidates) {
    const title = promptTitle(candidate);
    if (title && !isTechnicalDelegationTitle(title)) return title;
  }
  return void 0;
}
function extractCreatedChild(event) {
  const info = event.properties?.info;
  const parentID = asString(info?.parentID);
  if (!parentID) return null;
  const id = asString(info?.id) ?? asString(event.properties?.id);
  if (!id) return null;
  const title = asString(info?.title) ?? "subagent";
  const agentName = asString(info?.agent) ?? asString(info?.subagent_type);
  const startedAt = extractEventTimestamp(event, [
    "started",
    "start",
    "created",
    "updated"
  ]);
  const updatedAt = extractEventTimestamp(event, ["updated", "created", "started", "start"]) ?? startedAt;
  return { id, title, agentName, parentID, startedAt, updatedAt };
}
function extractSessionID(event) {
  return asString(event.properties?.sessionID) ?? asString(event.properties?.sessionId) ?? asString(event.properties?.info?.sessionID) ?? asString(event.properties?.info?.sessionId) ?? asString(event.sessionID) ?? asString(event.sessionId) ?? asString(event.properties?.info?.id) ?? asString(event.properties?.id);
}
function isRecord(value) {
  return !!value && typeof value === "object";
}
function isSessionID(value) {
  return typeof value === "string" && value.startsWith("ses_");
}
function collectSessionIDs(input, target, depth = 0) {
  if (depth > 4 || !input) return;
  if (isSessionID(input)) {
    target.add(input);
    return;
  }
  if (!isRecord(input) && !Array.isArray(input)) return;
  if (Array.isArray(input)) {
    for (const value of input) {
      collectSessionIDs(value, target, depth + 1);
    }
    return;
  }
  for (const [key, value] of Object.entries(input)) {
    if (!key.toLowerCase().includes("session")) continue;
    collectSessionIDs(value, target, depth + 1);
  }
}
function resolveSyntheticTargetSessionID(state, synthetic, explicitCandidates = []) {
  const candidates = new Set(explicitCandidates.filter(isSessionID));
  const byMessage = Object.values(state.children).filter(
    (child) => child.id.startsWith("ses_") && child.parentID === synthetic.parentID && child.messageID && synthetic.messageID && child.messageID === synthetic.messageID
  );
  if (byMessage.length === 1) {
    candidates.add(byMessage[0].id);
  }
  const byParent = Object.values(state.children).filter(
    (child) => child.id.startsWith("ses_") && child.parentID === synthetic.parentID
  );
  if (byParent.length === 1) {
    candidates.add(byParent[0].id);
  }
  if (candidates.size !== 1) return void 0;
  return [...candidates][0];
}
function extractPartTargetSessionCandidates(event) {
  const part = isRecord(event.properties?.part) ? event.properties.part : void 0;
  if (!part) return [];
  const candidates = /* @__PURE__ */ new Set();
  collectSessionIDs(part, candidates);
  const parentSessionID = asString(part.sessionID) ?? extractSessionID(event);
  if (parentSessionID) candidates.delete(parentSessionID);
  return [...candidates];
}
function parseTaskSessionIDFromOutput(value, parentSessionID) {
  if (typeof value !== "string") return void 0;
  const matches = [...value.matchAll(/\b(?:task_id\s*:\s*)?(ses_[a-zA-Z0-9_-]+)\b/gi)];
  const candidates = new Set(matches.map((match) => match[1]));
  if (parentSessionID) candidates.delete(parentSessionID);
  return candidates.size === 1 ? [...candidates][0] : void 0;
}
function backfillSyntheticTargetsForSession(state, session) {
  const targetlessSynthetic = Object.values(state.children).filter(
    (child) => (child.source === "tool" || child.source === "subtask") && !child.targetSessionID && child.parentID === session.parentID
  );
  const messageMatches = session.messageID ? targetlessSynthetic.filter(
    (child) => child.messageID === session.messageID
  ) : [];
  const existingSessionSiblings = Object.values(state.children).filter(
    (child) => child.id !== session.id && (child.source === "session" || child.id.startsWith("ses_")) && child.parentID === session.parentID
  );
  const candidates = messageMatches.length > 0 ? messageMatches : targetlessSynthetic;
  if (candidates.length !== 1) return false;
  if (messageMatches.length === 0 && existingSessionSiblings.length > 0) {
    return false;
  }
  const synthetic = candidates[0];
  const targetSessionID = resolveSyntheticTargetSessionID(
    state,
    {
      id: synthetic.id,
      parentID: synthetic.parentID,
      messageID: synthetic.messageID
    },
    [session.id]
  );
  if (targetSessionID !== session.id) return false;
  return upsertChildDetails(state, synthetic.id, {
    targetSessionID,
    updatedAt: session.updatedAt
  });
}
function extractTaskToolEvidence(event) {
  const part = event.properties?.part;
  if (!isRecord(part) || part.type !== "tool") return null;
  if (asString(part.tool) !== "task") return null;
  const state = isRecord(part.state) ? part.state : void 0;
  if (!state) return null;
  const rawStatus = asString(state.status);
  const status = rawStatus === "completed" ? "done" : rawStatus === "error" ? "error" : "running";
  const metadata = isRecord(state.metadata) ? state.metadata : void 0;
  const targetFromMetadata = asString(metadata?.sessionId);
  const parentSessionID = asString(part.sessionID) ?? extractSessionID(event);
  const targetFromOutput = parseTaskSessionIDFromOutput(
    state.output,
    parentSessionID
  );
  const targetCandidates = extractPartTargetSessionCandidates(event);
  const targetSessionID = targetFromMetadata ?? targetFromOutput ?? (targetCandidates.length === 1 ? targetCandidates[0] : void 0);
  const endedAt = status === "done" || status === "error" ? extractEventTimestamp(event, ["completed", "end", "ended", "updated"]) : void 0;
  return {
    status,
    targetSessionID,
    endedAt
  };
}
function mapTaskToolToSubtaskID(state, task) {
  const runningSubtasks = Object.values(state.children).filter(
    (child) => child.source === "subtask" && child.status === "running" && child.parentID === task.parentID
  );
  const primaryCandidates = runningSubtasks.filter(
    (child) => child.messageID === task.messageID
  );
  const legacyCandidates = task.parentMessageID ? runningSubtasks.filter(
    (child) => child.messageID === task.parentMessageID
  ) : [];
  const candidates = primaryCandidates.length > 0 ? primaryCandidates : legacyCandidates;
  if (candidates.length === 0) return void 0;
  if (task.targetSessionID) {
    const byTarget = candidates.filter(
      (child) => child.targetSessionID === task.targetSessionID
    );
    if (byTarget.length === 1) return byTarget[0].id;
  }
  const byTitle = candidates.filter(
    (child) => sameDisplayText(child.title, task.title)
  );
  if (byTitle.length === 1) return byTitle[0].id;
  const bySummary = candidates.filter(
    (child) => sameDisplayText(child.summary, task.summary)
  );
  if (bySummary.length === 1) return bySummary[0].id;
  const byAgent = task.agentName ? candidates.filter(
    (child) => sameDisplayText(child.agentName, task.agentName)
  ) : [];
  if (byAgent.length === 1) return byAgent[0].id;
  if (candidates.length === 1) return candidates[0].id;
  return void 0;
}
function extractParentMessageID(event) {
  return asString(event.properties?.info?.parentID) ?? asString(event.properties?.parentID) ?? asString(event.parentID);
}
function toIsoTimestamp(value) {
  if (typeof value === "string") {
    if (value.trim().length === 0) return void 0;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return void 0;
    return new Date(parsed).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return void 0;
    const millis = value < 1e10 ? value * 1e3 : value;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? void 0 : parsed.toISOString();
  }
  return void 0;
}
function extractEventTimestamp(event, keys) {
  const part = isRecord(event.properties?.part) ? event.properties?.part : void 0;
  const state = isRecord(part?.state) ? part?.state : void 0;
  const sources = [
    isRecord(event.properties?.info?.time) ? event.properties?.info?.time : void 0,
    isRecord(part?.time) ? part?.time : void 0,
    isRecord(part?.timestamps) ? part?.timestamps : void 0,
    isRecord(state?.time) ? state?.time : void 0,
    isRecord(state?.timestamps) ? state?.timestamps : void 0,
    state,
    part
  ];
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const candidate = toIsoTimestamp(source[key]);
      if (candidate) return candidate;
    }
  }
  return void 0;
}
function extractSubtaskChild(event) {
  const part = event.properties?.part;
  if (!isRecord(part) || part.type !== "subtask") return null;
  const partID = asString(part.id);
  const parentID = asString(part.sessionID) ?? extractSessionID(event);
  const messageID = asString(part.messageID);
  if (!partID || !parentID || !messageID) return null;
  const description = asString(part.description);
  const command = asString(part.command);
  const agent = asString(part.agent);
  const title = description || command || agent || "subtask";
  const state = isRecord(part.state) ? part.state : void 0;
  const input = isRecord(state?.input) ? state.input : void 0;
  const summary = firstDistinctSummary(
    [input?.prompt, input?.description, part.description, state?.description],
    title
  );
  const startedAt = extractEventTimestamp(event, [
    "started",
    "start",
    "created",
    "updated"
  ]);
  const updatedAt = extractEventTimestamp(event, ["updated", "created", "started", "start"]) ?? startedAt;
  const targetCandidates = extractPartTargetSessionCandidates(event);
  const targetSessionID = targetCandidates.length === 1 ? targetCandidates[0] : void 0;
  return {
    id: `subtask:${partID}`,
    title,
    summary,
    agentName: agent,
    parentID,
    messageID,
    targetSessionID,
    startedAt,
    updatedAt
  };
}
function extractToolChild(event) {
  const part = event.properties?.part;
  if (!isRecord(part) || part.type !== "tool") return null;
  const tool = asString(part.tool);
  if (tool !== "delegate" && tool !== "task") return null;
  const partID = asString(part.id);
  const parentID = asString(part.sessionID) ?? extractSessionID(event);
  const messageID = asString(part.messageID);
  const state = isRecord(part.state) ? part.state : void 0;
  if (!partID || !parentID || !messageID || !state) return null;
  const taskEvidence = extractTaskToolEvidence(event);
  const rawStatus = asString(state.status);
  const status = taskEvidence?.status ?? (rawStatus === "completed" ? "done" : rawStatus === "error" ? "error" : "running");
  const input = isRecord(state.input) ? state.input : {};
  const description = asString(input.description);
  const subagentType = asString(input.subagent_type);
  const rawTitle = asString(state.title);
  const title = (isTechnicalDelegationTitle(rawTitle) ? void 0 : rawTitle) || description || firstUsefulTitle([input.prompt, part.description, state.description]) || subagentType || tool;
  const summary = firstDistinctSummary(
    [input.prompt, input.description, part.description, state.description],
    title
  );
  const startedAt = extractEventTimestamp(event, [
    "started",
    "start",
    "created",
    "updated"
  ]);
  const updatedAt = extractEventTimestamp(event, [
    "updated",
    "completed",
    "created",
    "started",
    "start"
  ]) ?? startedAt;
  const endedAt = status === "done" || status === "error" ? extractEventTimestamp(event, ["completed", "end", "ended", "updated"]) : void 0;
  const targetCandidates = extractPartTargetSessionCandidates(event);
  const targetSessionID = taskEvidence?.targetSessionID ?? (targetCandidates.length === 1 ? targetCandidates[0] : void 0);
  return {
    id: `tool:${partID}`,
    title,
    summary,
    agentName: subagentType,
    parentID,
    messageID,
    toolName: tool,
    targetSessionID,
    status,
    startedAt,
    updatedAt,
    endedAt
  };
}
function extractCompletedAssistantMessage(event) {
  const info = event.properties?.info;
  if (!isRecord(info)) return null;
  if (info.role !== "assistant") return null;
  const time = info.time;
  if (!isRecord(time) || typeof time.completed !== "number") return null;
  const sessionID = asString(info.sessionID) ?? extractSessionID(event);
  const messageID = asString(info.id);
  if (!sessionID || !messageID) return null;
  return { sessionID, messageID };
}
function extractDetailTargetIDs(event) {
  const ids = /* @__PURE__ */ new Set();
  const part = event.properties?.part;
  if (isRecord(part)) {
    const partID = asString(part.id);
    if (part.type === "subtask" && partID) {
      ids.add(`subtask:${partID}`);
    }
    if (part.type === "tool") {
      const tool = asString(part.tool);
      if ((tool === "delegate" || tool === "task") && partID) {
        ids.add(`tool:${partID}`);
      }
    }
  }
  const sessionID = extractSessionID(event);
  if (sessionID) ids.add(sessionID);
  return [...ids];
}
function normalizePercent(value) {
  if (value > 0 && value <= 1) {
    return value * 100;
  }
  return value;
}
function extractChildDetails(event) {
  const details = {};
  details.updatedAt = extractEventTimestamp(event, [
    "updated",
    "completed",
    "created",
    "started",
    "start"
  ]);
  const titleCandidates = [
    event.properties?.info?.title,
    event.properties?.title,
    event.properties?.info?.name,
    event.properties?.name,
    event.title,
    event.name
  ];
  for (const candidate of titleCandidates) {
    const title = asString(candidate);
    if (title) {
      details.title = title;
      break;
    }
  }
  const part = isRecord(event.properties?.part) ? event.properties.part : void 0;
  const partState = isRecord(part?.state) ? part.state : void 0;
  const partInput = isRecord(partState?.input) ? partState.input : void 0;
  details.agentName = asString(partInput?.subagent_type) ?? asString(partInput?.agent) ?? asString(part?.agent) ?? asString(event.properties?.info?.agent) ?? asString(event.properties?.info?.subagent_type);
  details.summary = firstDistinctSummary(
    [
      partInput?.prompt,
      partInput?.description,
      part?.description,
      partState?.description
    ],
    details.title
  );
  if (isTechnicalDelegationTitle(details.title)) {
    const replacementTitle = asString(partInput?.description) ?? firstUsefulTitle([
      partInput?.prompt,
      part?.description,
      partState?.description
    ]);
    if (replacementTitle) {
      details.title = replacementTitle;
    }
  }
  const tokenHints = {};
  const visited = /* @__PURE__ */ new Set();
  const walk = (node, depth) => {
    if (!isRecord(node) || depth > 6) return;
    if (visited.has(node)) return;
    visited.add(node);
    for (const [rawKey, rawValue] of Object.entries(node)) {
      const key = rawKey.toLowerCase();
      const asNumber = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" && rawValue.trim().length > 0 ? Number(rawValue) : void 0;
      if (typeof asNumber === "number" && Number.isFinite(asNumber)) {
        if (key.includes("context") && key.includes("percent")) {
          tokenHints.contextPercent = normalizePercent(asNumber);
        } else if (key.includes("context") && key.includes("usage")) {
          tokenHints.contextPercent = normalizePercent(asNumber);
        } else if ((key.includes("input") || key.includes("prompt")) && key.includes("token")) {
          tokenHints.input = asNumber;
        } else if ((key.includes("output") || key.includes("completion")) && key.includes("token")) {
          tokenHints.output = asNumber;
        } else if (key.includes("total") && key.includes("token")) {
          tokenHints.total = asNumber;
        } else if (key === "tokens" || key === "token") {
          tokenHints.total = asNumber;
        }
      }
      if (isRecord(rawValue)) {
        walk(rawValue, depth + 1);
      }
    }
  };
  walk(event, 0);
  if (tokenHints.input !== void 0 || tokenHints.output !== void 0 || tokenHints.total !== void 0 || tokenHints.contextPercent !== void 0) {
    details.tokens = tokenHints;
  }
  return details;
}
function applySubagentEvent(state, event) {
  const e = event ?? {};
  const type = asString(e.type);
  if (!type) return false;
  if (type === "session.created" || type === "session.updated") {
    const child = extractCreatedChild(e);
    if (child) {
      const details = extractChildDetails(e);
      let changed2 = upsertRunningChild(state, {
        ...child,
        source: "session",
        targetSessionID: child.id
      });
      changed2 = upsertChildDetails(state, child.id, details) || changed2;
      changed2 = backfillSyntheticTargetsForSession(state, {
        id: child.id,
        parentID: child.parentID,
        updatedAt: child.updatedAt
      }) || changed2;
      const sessionStatusFromUpdate = type === "session.updated" ? hasStructuredErrorEvidence(e.properties ?? e) ? "error" : deriveOpenCodeSessionStatus(
        e.properties?.status ?? e.properties?.state ?? e.properties?.info?.status ?? e.status ?? e.state
      ) : void 0;
      if (sessionStatusFromUpdate === "done" || sessionStatusFromUpdate === "error") {
        const endedAt = extractEventTimestamp(e, [
          "completed",
          "end",
          "ended",
          "updated"
        ]);
        changed2 = markChildStatus(state, child.id, sessionStatusFromUpdate, endedAt) || changed2;
      }
      return changed2;
    }
    return false;
  }
  if (type === "session.idle") {
    const childID = extractSessionID(e);
    if (!childID) return false;
    const endedAt = extractEventTimestamp(e, [
      "completed",
      "end",
      "ended",
      "updated"
    ]);
    const details = extractChildDetails(e);
    const status = deriveOpenCodeSessionStatus(e.properties ?? e) === "error" || hasStructuredErrorEvidence(e.properties ?? e) ? "error" : "done";
    let changed2 = markChildStatus(state, childID, status, endedAt);
    changed2 = upsertChildDetails(state, childID, details) || changed2;
    return changed2;
  }
  if (type === "session.error") {
    const childID = extractSessionID(e);
    if (!childID) return false;
    const endedAt = extractEventTimestamp(e, [
      "completed",
      "end",
      "ended",
      "updated"
    ]);
    const details = extractChildDetails(e);
    let changed2 = markChildStatus(state, childID, "error", endedAt);
    changed2 = upsertChildDetails(state, childID, details) || changed2;
    return changed2;
  }
  if (type === "session.status") {
    const childID = extractSessionID(e);
    if (!childID) return false;
    const status = hasStructuredErrorEvidence(e.properties ?? e) ? "error" : deriveOpenCodeSessionStatus(
      e.properties?.status ?? e.properties?.state ?? e.properties?.info?.status ?? e.status ?? e.state ?? e.properties
    );
    if (!status) return false;
    const endedAt = status === "done" || status === "error" ? extractEventTimestamp(e, ["completed", "end", "ended", "updated"]) : void 0;
    const details = extractChildDetails(e);
    let changed2 = status === "running" ? false : markChildStatus(state, childID, status, endedAt);
    changed2 = upsertChildDetails(state, childID, details) || changed2;
    return changed2;
  }
  let changed = false;
  if (type === "message.part.updated") {
    const subtask = extractSubtaskChild(e);
    if (subtask) {
      const targetSessionID = resolveSyntheticTargetSessionID(
        state,
        {
          id: subtask.id,
          parentID: subtask.parentID,
          messageID: subtask.messageID
        },
        subtask.targetSessionID ? [subtask.targetSessionID] : []
      );
      changed = upsertRunningChild(state, {
        ...subtask,
        source: "subtask",
        targetSessionID,
        startedAt: subtask.startedAt,
        updatedAt: subtask.updatedAt
      }) || changed;
    }
    const tool = extractToolChild(e);
    if (tool) {
      const targetSessionID = resolveSyntheticTargetSessionID(
        state,
        {
          id: tool.id,
          parentID: tool.parentID,
          messageID: tool.messageID
        },
        tool.targetSessionID ? [tool.targetSessionID] : []
      );
      const childChanged = upsertRunningChild(state, {
        ...tool,
        source: "tool",
        targetSessionID,
        startedAt: tool.startedAt,
        updatedAt: tool.updatedAt
      });
      changed = childChanged || changed;
      if (tool.status === "done" || tool.status === "error") {
        changed = markChildStatus(
          state,
          tool.id,
          tool.status,
          tool.endedAt ?? tool.updatedAt
        ) || changed;
        if (asString(
          e.properties?.part?.tool
        ) === "task") {
          const subtaskID = mapTaskToolToSubtaskID(state, {
            parentID: tool.parentID,
            messageID: tool.messageID,
            parentMessageID: extractParentMessageID(e),
            title: tool.title,
            summary: tool.summary,
            agentName: tool.agentName,
            targetSessionID
          });
          if (subtaskID) {
            if (targetSessionID) {
              changed = upsertChildDetails(state, subtaskID, {
                targetSessionID,
                updatedAt: tool.updatedAt
              }) || changed;
            }
            changed = markChildStatus(
              state,
              subtaskID,
              tool.status,
              tool.endedAt ?? tool.updatedAt
            ) || changed;
          }
        }
      }
    }
  }
  if (type === "message.updated") {
    const assistantModel = extractLatestAssistantModel(e.properties?.info ?? e);
    if (assistantModel) {
      changed = setChildModel(
        state,
        assistantModel.sessionID,
        assistantModel.model,
        assistantModel.updatedAt
      ) || changed;
    }
    const completed = extractCompletedAssistantMessage(e);
    if (completed) {
      for (const child of Object.values(state.children)) {
        if (child.source === "subtask" && child.status === "running" && child.parentID === completed.sessionID && child.messageID === completed.messageID) {
          changed = markChildStatus(state, child.id, "done") || changed;
        }
      }
    }
  }
  if (type === "message.updated" || type === "message.part.updated") {
    const details = extractChildDetails(e);
    for (const childID of extractDetailTargetIDs(e)) {
      if (state.children[childID]) {
        changed = upsertChildDetails(state, childID, details) || changed;
      }
    }
  }
  return changed;
}

// src/render.ts
var ansi = {
  reset: "\x1B[0m",
  gray: "\x1B[90m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  red: "\x1B[31m"
};
function colorsEnabled() {
  if (process.env.NO_COLOR) return false;
  const fromEnv = process.env.OPENCODE_SUBAGENT_STATUSLINE_COLOR;
  if (fromEnv === "0") return false;
  return true;
}
function paint(text, color, enabled) {
  if (!enabled) return text;
  return `${color}${text}${ansi.reset}`;
}
function formatDuration(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor((elapsedMs ?? 0) / 1e3));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function formatNumber(value) {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}
function resolveTokenTotal(child) {
  const total = child.tokens?.total;
  if (typeof total === "number" && Number.isFinite(total)) {
    return total;
  }
  const inTokens = child.tokens?.input;
  const outTokens = child.tokens?.output;
  if (typeof inTokens === "number" || typeof outTokens === "number") {
    return (inTokens ?? 0) + (outTokens ?? 0);
  }
  return void 0;
}
function formatPercentUsed(percent) {
  const rounded = Math.round(percent * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.05) {
    return `${Math.round(rounded)}% used`;
  }
  return `${rounded.toFixed(1)}% used`;
}
function formatTokenCount(total) {
  const label = total === 1 ? "token" : "tokens";
  return `${formatNumber(total)} ${label}`;
}
function formatContextDetails(child) {
  const total = resolveTokenTotal(child);
  const percent = child.tokens?.contextPercent;
  const hasPercent = typeof percent === "number" && Number.isFinite(percent);
  const hasTotal = typeof total === "number" && Number.isFinite(total);
  if (hasTotal && hasPercent) {
    return `${formatTokenCount(total)} \xB7 ${formatPercentUsed(percent)}`;
  }
  if (hasTotal) {
    return formatTokenCount(total);
  }
  if (hasPercent) {
    return formatPercentUsed(percent);
  }
  return void 0;
}
function formatContext(child) {
  const details = formatContextDetails(child);
  if (!details) return "";
  return `ctx ${details}`;
}
function childColor(child) {
  if (child.color === "green") return ansi.green;
  if (child.color === "red") return ansi.red;
  return ansi.yellow;
}
function byPriority(a, b) {
  const startedDiff = b.startedAt.localeCompare(a.startedAt);
  if (startedDiff !== 0) return startedDiff;
  return a.id.localeCompare(b.id);
}
var RECENT_TERMINAL_VISIBLE_MS = 10 * 60 * 1e3;
function collapseSubagentWorkItems(children) {
  return correlateSubagentWorkItems(children).map(
    ({ real, proxies }) => proxies.reduce(
      (current, proxy) => mergeProxyMetadataWithRealExecution(current, proxy),
      real
    )
  );
}
function isTerminalWorkItem(child) {
  return child.status === "done" || child.status === "error";
}
function isVisibleWorkItem(child, nowMs = Date.now()) {
  if (!isTerminalWorkItem(child)) return true;
  const endedMs = Date.parse(child.endedAt ?? child.updatedAt);
  if (Number.isNaN(endedMs)) return false;
  return nowMs - endedMs <= RECENT_TERMINAL_VISIBLE_MS;
}
function visibleSubagentWorkItems(children, nowMs = Date.now(), options = {}) {
  const collapsed = collapseSubagentWorkItems(children);
  if (options.showCompletedHistory) return collapsed;
  const visible = collapsed.filter((child) => isVisibleWorkItem(child, nowMs));
  const hasRunning = visible.some((child) => child.status === "running");
  const activeMessageIDs = new Set(
    visible.filter((child) => child.status === "running" && child.messageID).map((child) => child.messageID)
  );
  if (!hasRunning) return visible;
  return visible.filter((child) => {
    if (child.status === "running") return true;
    if (!child.messageID) return false;
    return activeMessageIDs.has(child.messageID);
  });
}
function renderStatusLine(state) {
  const children = visibleSubagentWorkItems(Object.values(state.children)).sort(
    byPriority
  );
  const counts = countRetainedSubagentStatuses({ children: state.children });
  const totalExecuted = formatNumber(state.totalExecuted ?? 0);
  const colorOn = colorsEnabled();
  const aggregate = `\u21B3 ${counts.running} running \xB7 ${counts.done} done \xB7 ${counts.error} error \xB7 \u03A3 ${totalExecuted} total`;
  if (children.length === 0) return aggregate;
  const details = children.map((child) => {
    const context = formatContext(child);
    const label = [child.title, formatDuration(child.elapsedMs), context].filter((part) => part.length > 0).join(" ");
    return paint(label, childColor(child), colorOn);
  }).join(paint(" \xB7 ", ansi.gray, colorOn));
  return `${aggregate} \xB7 ${details}`;
}

// src/index.ts
var SubagentStatusline = async () => {
  const statePath = resolveStatePath();
  const textPath = resolveTextPath(statePath);
  if (!shouldPreserveStateOnStartup()) {
    try {
      const emptyState = createEmptyState();
      await saveState(statePath, emptyState);
      await saveStatusText(textPath, renderStatusLine(emptyState));
    } catch {
    }
  }
  return {
    event: async ({ event }) => {
      try {
        const state = await loadState(statePath);
        const changed = applySubagentEvent(state, event);
        if (changed) {
          await saveState(statePath, state);
          const line = renderStatusLine(state);
          await saveStatusText(textPath, line);
        }
      } catch {
      }
    }
  };
};
export {
  SubagentStatusline
};
