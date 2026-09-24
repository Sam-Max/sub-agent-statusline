// src/v2/tui.tsx
import { effect as _$effect } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

// src/text-width.ts
var ELLIPSIS = "\u2026";
function isCombiningCodePoint(codePoint) {
  return codePoint >= 768 && codePoint <= 879 || codePoint >= 6832 && codePoint <= 6911 || codePoint >= 7616 && codePoint <= 7679 || codePoint >= 8400 && codePoint <= 8447 || codePoint >= 65024 && codePoint <= 65039 || codePoint >= 65056 && codePoint <= 65071;
}
function isWideCodePoint(codePoint) {
  return codePoint >= 4352 && (codePoint <= 4447 || codePoint === 9001 || codePoint === 9002 || codePoint >= 11904 && codePoint <= 42191 && codePoint !== 12351 || codePoint >= 44032 && codePoint <= 55203 || codePoint >= 63744 && codePoint <= 64255 || codePoint >= 65040 && codePoint <= 65049 || codePoint >= 65072 && codePoint <= 65135 || codePoint >= 65280 && codePoint <= 65376 || codePoint >= 65504 && codePoint <= 65510 || codePoint >= 127744 && codePoint <= 128591 || codePoint >= 128640 && codePoint <= 128767 || codePoint >= 131072 && codePoint <= 262141);
}
function characterWidth(character) {
  const codePoint = character.codePointAt(0);
  if (codePoint === void 0) return 0;
  if (codePoint === 0 || codePoint < 32 || codePoint >= 127 && codePoint < 160) {
    return 0;
  }
  if (codePoint === 8205 || isCombiningCodePoint(codePoint)) return 0;
  return isWideCodePoint(codePoint) ? 2 : 1;
}
function textColumns(value) {
  let columns = 0;
  for (const character of value) columns += characterWidth(character);
  return columns;
}
function takeColumns(value, maxColumns) {
  if (maxColumns <= 0) return "";
  let columns = 0;
  let result = "";
  for (const character of value) {
    const width = characterWidth(character);
    if (columns + width > maxColumns) break;
    columns += width;
    result += character;
  }
  return result;
}
function truncateToColumns(value, maxColumns) {
  if (maxColumns <= 0) return "";
  if (textColumns(value) <= maxColumns) return value;
  if (maxColumns <= textColumns(ELLIPSIS)) return ELLIPSIS;
  const prefix = takeColumns(
    value,
    maxColumns - textColumns(ELLIPSIS)
  ).trimEnd();
  return `${prefix}${ELLIPSIS}`;
}

// src/v2/reconcile.ts
var STALE_RUNNING_MS = 10 * 6e4;
function deriveStatus(session, now = Date.now()) {
  if (!session) return "unknown";
  if (session.outcome) {
    return session.outcome === "succeeded" ? "done" : "error";
  }
  const updated = session.time?.updated ?? session.time?.created;
  if (updated !== void 0 && now - updated > STALE_RUNNING_MS) return "stale";
  return "running";
}
function isBusy(session, now = Date.now()) {
  const status = deriveStatus(session, now);
  return status === "running" || status === "stale";
}
var STATUS_PRIORITY = {
  running: 0,
  stale: 1,
  error: 2,
  done: 3,
  unknown: 3
};
function byPriority(a, b, now = Date.now()) {
  const diff = STATUS_PRIORITY[deriveStatus(a, now)] - STATUS_PRIORITY[deriveStatus(b, now)];
  if (diff !== 0) return diff;
  return (b.time?.updated ?? 0) - (a.time?.updated ?? 0);
}
function maxCandidates(items, showCompleted, maxDone = 3) {
  if (showCompleted) return items;
  const active = items.filter((session) => deriveStatus(session) !== "done");
  const completed = items.filter((session) => deriveStatus(session) === "done");
  return [...active, ...completed.slice(0, maxDone)];
}

// src/v2/format.ts
var SIDEBAR_ROW_WIDTH = 34;
var LABEL_WIDTH = SIDEBAR_ROW_WIDTH - 5;
var LABEL_INDENT = "    ";
var CLOCK_ICON = "\uF017";
var TOKEN_ICON = "\uF51E";
var SIDEBAR_ARROW_EXPANDED = "\u25BC";
var SIDEBAR_ARROW_COLLAPSED = "\u25B6";
var FOCUS_INDICATOR = "\u25CF";
var CURSOR_MARKER = "\u203A";
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
function resolveTokensTotal(session) {
  const tokens = session.tokens;
  if (!tokens) return void 0;
  const input = tokens.input;
  const output = tokens.output;
  if (typeof input === "number" || typeof output === "number") {
    return Math.max(0, (input ?? 0) + (output ?? 0));
  }
  return void 0;
}
function tokensFor(session) {
  const tokens = resolveTokensTotal(session);
  if (tokens === void 0 || tokens <= 0) return void 0;
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M tok`;
  return `${formatNumber(tokens)} tok`;
}
function statusMarker(session) {
  switch (deriveStatus(session)) {
    case "done":
      return "[\u2713]";
    case "error":
      return "[x]";
    case "stale":
      return "[~]";
    default:
      return "[ ]";
  }
}
function labelFor(session) {
  const title = typeof session.title === "string" ? session.title.trim() : "";
  const agent = typeof session.agent === "string" ? session.agent.trim() : "";
  const hasAgent = agent.length > 0 && agent !== "code";
  const mentionsAgent = hasAgent && title.toLowerCase().includes(agent.toLowerCase());
  if (title && hasAgent && !mentionsAgent) return `${title} (${agent})`;
  if (title) return title;
  return hasAgent ? agent : "subagent";
}
function elapsedFor(session, now) {
  const end = session.outcome ? session.time?.idle ?? session.time?.updated ?? now : now;
  return formatDuration(end - (session.time?.created ?? now));
}
function metaFor(session, now) {
  const parts = [`\u21B3 ${CLOCK_ICON} ${elapsedFor(session, now)}`];
  const tokens = tokensFor(session);
  if (tokens) parts.push(`${TOKEN_ICON} ${tokens}`);
  return `${LABEL_INDENT}${parts.join(" ")}`;
}
function ellipsize(value, width) {
  return truncateToColumns(value, width);
}
function wrapLabel(value, width, maxLines) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return [""];
  const lines = [];
  let remaining = normalized;
  while (textColumns(remaining) > width && lines.length < maxLines - 1) {
    const probe = takeColumns(remaining, width);
    const breakAt = probe.lastIndexOf(" ");
    const cut = breakAt > 0 ? breakAt : probe.length;
    if (cut <= 0) break;
    lines.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  lines.push(
    lines.length === maxLines - 1 ? ellipsize(remaining, Math.max(1, width)) : remaining
  );
  return lines;
}

// src/v2/tui.tsx
var PLUGIN_ID = "subagent-monitor";
var REFRESH_COALESCE_MS = 200;
var ELAPSED_TICK_MS = 1e3;
var MAX_DONE_ROWS = 3;
var state = {
  context: null,
  prefs: null,
  setPrefs: null
};
var [tick, setTick] = createSignal(0);
var [focused, setFocused] = createSignal(false);
var [cursor, setCursor] = createSignal(0);
var [activeSessionID, setActiveSessionID] = createSignal(void 0);
var lastRefreshAt = 0;
function requestRefresh() {
  const now = Date.now();
  if (now - lastRefreshAt < REFRESH_COALESCE_MS) return;
  lastRefreshAt = now;
  setTick((value) => value + 1);
}
function toV2Session(session) {
  if (!session) return void 0;
  return {
    id: session.id,
    parentID: session.parentID,
    title: session.title,
    agent: session.agent,
    outcome: session.outcome,
    tokens: session.tokens,
    time: session.time
  };
}
function childrenOf(sessionID) {
  const context = state.context;
  tick();
  if (!context || !sessionID) return [];
  try {
    return (context.data.session.family(sessionID) ?? []).map((id) => toV2Session(context.data.session.get(id))).filter((session) => Boolean(session && session.parentID)).sort((a, b) => byPriority(a, b));
  } catch {
    return [];
  }
}
function allSubagents() {
  const context = state.context;
  tick();
  if (!context) return [];
  try {
    return (context.data.session.list() ?? []).map((session) => toV2Session(session)).filter((session) => Boolean(session && session.parentID));
  } catch {
    return [];
  }
}
function colorToHex(value) {
  if (typeof value === "string") return value;
  const record = value;
  const buffer = record?.buffer;
  if (!Array.isArray(buffer)) return void 0;
  const pair = (channel) => Math.max(0, Math.min(255, Math.round(Number(channel) || 0))).toString(16).padStart(2, "0");
  return `#${pair(buffer[0])}${pair(buffer[1])}${pair(buffer[2])}`;
}
function resolveFg(context, tokenPath, fallback) {
  try {
    const value = tokenPath.split(".").reduce((acc, key) => acc?.[key], context?.theme);
    return colorToHex(value) ?? fallback;
  } catch {
    return fallback;
  }
}
function fgFor(session) {
  switch (deriveStatus(session)) {
    case "running":
      return resolveFg(state.context, "text.feedback.warning.default", "#ffcb6b");
    case "stale":
      return resolveFg(state.context, "hue.purple.200", "#c792ea");
    case "error":
      return resolveFg(state.context, "text.feedback.error.default", "#f07178");
    case "done":
      return resolveFg(state.context, "text.feedback.success.default", "#c3e88d");
    default:
      return resolveFg(state.context, "text.subdued", "#546e7a");
  }
}
function commandsFor(context) {
  const openCursor = () => {
    if (!focused()) return false;
    const target = childrenOf(activeSessionID())[cursor()];
    if (!target) return;
    context.ui.router.navigate({
      type: "session",
      sessionID: target.id
    });
  };
  const mutatePrefs = (mutation) => {
    if (!state.setPrefs) return;
    void state.setPrefs(mutation).catch(() => {
    });
  };
  return [{
    id: `${PLUGIN_ID}.focus`,
    title: "Toggle subagent list focus",
    group: "Subagents",
    bind: "alt+b",
    palette: true,
    run: () => {
      setFocused((value) => !value);
    }
  }, {
    id: `${PLUGIN_ID}.up`,
    bind: "k",
    run: () => {
      if (!focused()) return false;
      setCursor((value) => Math.max(0, value - 1));
    }
  }, {
    id: `${PLUGIN_ID}.down`,
    bind: "j",
    run: () => {
      if (!focused()) return false;
      setCursor((value) => value + 1);
    }
  }, {
    id: `${PLUGIN_ID}.open`,
    bind: "enter",
    run: openCursor
  }, {
    id: `${PLUGIN_ID}.history`,
    title: "Toggle completed subagent history",
    group: "Subagents",
    bind: "c",
    run: () => {
      if (!focused()) return false;
      mutatePrefs((draft) => {
        draft.showCompleted = !draft.showCompleted;
      });
    }
  }, {
    id: `${PLUGIN_ID}.collapse`,
    title: "Collapse subagent monitor",
    group: "Subagents",
    bind: "h",
    run: () => {
      if (!focused()) return false;
      mutatePrefs((draft) => {
        draft.expanded = false;
      });
    }
  }, {
    id: `${PLUGIN_ID}.expand`,
    title: "Expand subagent monitor",
    group: "Subagents",
    bind: "l",
    run: () => {
      if (!focused()) return false;
      mutatePrefs((draft) => {
        draft.expanded = true;
      });
    }
  }, {
    id: `${PLUGIN_ID}.unfocus`,
    bind: "escape",
    run: () => {
      if (!focused()) return false;
      setFocused(false);
    }
  }];
}
function useKeymapLayer(context) {
  try {
    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      commands: commandsFor(context)
    }));
  } catch {
  }
}
function SidebarSubagents(props) {
  const context = usePlugin();
  useKeymapLayer(context);
  createEffect(() => {
    const sessionID = props.sessionID;
    if (!sessionID) return;
    setActiveSessionID(sessionID);
    context.data.session.sync(sessionID).catch(() => {
    });
    requestRefresh();
  });
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    onCleanup(() => clearInterval(timer));
  });
  const items = createMemo(() => childrenOf(props.sessionID));
  const visible = createMemo(() => maxCandidates(items(), state.prefs?.showCompleted ?? false, MAX_DONE_ROWS));
  createEffect(() => {
    const length = visible().length;
    if (length > 0 && cursor() >= length) setCursor(length - 1);
  });
  const counts = createMemo(() => {
    let running = 0;
    let stale = 0;
    let done = 0;
    let failed = 0;
    for (const session of items()) {
      switch (deriveStatus(session)) {
        case "done":
          done += 1;
          break;
        case "error":
          failed += 1;
          break;
        case "stale":
          stale += 1;
          break;
        default:
          running += 1;
      }
    }
    return {
      running,
      stale,
      done,
      failed
    };
  });
  const headerColor = resolveFg(context, "text.default", "#eeffff");
  const subdued = resolveFg(context, "text.subdued", "#546e7a");
  const selected = resolveFg(context, "text.action.primary.selected", "#82aaff");
  const runningColor = resolveFg(context, "text.feedback.warning.default", "#ffcb6b");
  const doneColor = resolveFg(context, "text.feedback.success.default", "#c3e88d");
  const failedColor = resolveFg(context, "text.feedback.error.default", "#f07178");
  const staleColor = resolveFg(context, "hue.purple.200", "#c792ea");
  const toggleExpanded = () => {
    if (!state.setPrefs) return;
    void state.setPrefs((draft) => {
      draft.expanded = !draft.expanded;
    }).catch(() => {
    });
  };
  return (() => {
    var _el$ = _$createElement("box"), _el$2 = _$createElement("box"), _el$3 = _$createElement("text"), _el$5 = _$createElement("box"), _el$6 = _$createElement("text"), _el$7 = _$createElement("text"), _el$9 = _$createElement("text"), _el$0 = _$createElement("text"), _el$10 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$5);
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$, "paddingX", 1);
    _$setProp(_el$, "paddingY", 1);
    _$insertNode(_el$2, _el$3);
    _$setProp(_el$2, "flexDirection", "row");
    _$setProp(_el$2, "onMouseDown", toggleExpanded);
    _$setProp(_el$3, "fg", headerColor);
    _$insert(_el$3, () => `${state.prefs?.expanded ? SIDEBAR_ARROW_EXPANDED : SIDEBAR_ARROW_COLLAPSED} Subagents`);
    _$insert(_el$2, _$createComponent(Show, {
      get when() {
        return focused();
      },
      get children() {
        var _el$4 = _$createElement("text");
        _$setProp(_el$4, "fg", selected);
        _$insert(_el$4, ` ${FOCUS_INDICATOR}`);
        return _el$4;
      }
    }), null);
    _$insertNode(_el$5, _el$6);
    _$insertNode(_el$5, _el$7);
    _$insertNode(_el$5, _el$9);
    _$insertNode(_el$5, _el$0);
    _$insertNode(_el$5, _el$10);
    _$setProp(_el$5, "flexDirection", "row");
    _$setProp(_el$6, "fg", runningColor);
    _$insert(_el$6, () => `\u25CF ${counts().running} run`);
    _$insertNode(_el$7, _$createTextNode(` \xB7 `));
    _$setProp(_el$7, "fg", subdued);
    _$setProp(_el$9, "fg", doneColor);
    _$insert(_el$9, () => `\u2713 ${counts().done} done`);
    _$insertNode(_el$0, _$createTextNode(` \xB7 `));
    _$setProp(_el$0, "fg", subdued);
    _$setProp(_el$10, "fg", failedColor);
    _$insert(_el$10, () => `\u2715 ${counts().failed} err`);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return counts().stale > 0;
      },
      get children() {
        var _el$11 = _$createElement("text");
        _$setProp(_el$11, "fg", staleColor);
        _$insert(_el$11, () => `\u25D0 ${counts().stale} stale`);
        return _el$11;
      }
    }), null);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return state.prefs?.expanded;
      },
      get children() {
        return _$createComponent(For, {
          get each() {
            return visible();
          },
          children: (item, i) => {
            const labelLines = () => wrapLabel(labelFor(item), LABEL_WIDTH, 2);
            const isCursor = () => focused() && cursor() === i();
            return (() => {
              var _el$14 = _$createElement("box"), _el$15 = _$createElement("box"), _el$16 = _$createElement("text"), _el$17 = _$createElement("text"), _el$18 = _$createElement("text"), _el$20 = _$createElement("text");
              _$insertNode(_el$14, _el$15);
              _$insertNode(_el$14, _el$20);
              _$setProp(_el$14, "flexDirection", "column");
              _$insertNode(_el$15, _el$16);
              _$insertNode(_el$15, _el$17);
              _$insertNode(_el$15, _el$18);
              _$setProp(_el$15, "flexDirection", "row");
              _$insert(_el$16, () => isCursor() ? CURSOR_MARKER : " ");
              _$insert(_el$17, () => `${statusMarker(item)} `);
              _$insert(_el$18, () => labelLines()[0] ?? "");
              _$insert(_el$14, _$createComponent(Show, {
                get when() {
                  return (labelLines()[1] ?? "") !== "";
                },
                get children() {
                  var _el$19 = _$createElement("text");
                  _$insert(_el$19, () => `${LABEL_INDENT}${labelLines()[1]}`);
                  _$effect((_$p) => _$setProp(_el$19, "fg", isCursor() ? headerColor : fgFor(item), _$p));
                  return _el$19;
                }
              }), _el$20);
              _$insert(_el$20, () => metaFor(item, now()));
              _$effect((_p$) => {
                var _v$ = isCursor() ? selected : subdued, _v$2 = fgFor(item), _v$3 = isCursor() ? headerColor : fgFor(item), _v$4 = isCursor() ? headerColor : subdued;
                _v$ !== _p$.e && (_p$.e = _$setProp(_el$16, "fg", _v$, _p$.e));
                _v$2 !== _p$.t && (_p$.t = _$setProp(_el$17, "fg", _v$2, _p$.t));
                _v$3 !== _p$.a && (_p$.a = _$setProp(_el$18, "fg", _v$3, _p$.a));
                _v$4 !== _p$.o && (_p$.o = _$setProp(_el$20, "fg", _v$4, _p$.o));
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0,
                o: void 0
              });
              return _el$14;
            })();
          }
        });
      }
    }), null);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return focused();
      },
      get children() {
        var _el$12 = _$createElement("text");
        _$insertNode(_el$12, _$createTextNode(`j/k \xB7 enter \xB7 c \xB7 h/l \xB7 esc`));
        _$setProp(_el$12, "fg", subdued);
        return _el$12;
      }
    }), null);
    return _el$;
  })();
}
function FooterSummary() {
  const all = createMemo(() => allSubagents());
  const busyCount = createMemo(() => all().filter((session) => isBusy(session)).length);
  const failedCount = createMemo(() => all().filter((session) => deriveStatus(session) === "error").length);
  const doneCount = createMemo(() => all().filter((session) => deriveStatus(session) === "done").length);
  const summary = createMemo(() => {
    if (busyCount() + doneCount() + failedCount() === 0) return "";
    return `\u21B3 ${busyCount()} run \xB7 ${doneCount()} done \xB7 ${failedCount()} err`;
  });
  const info = resolveFg(state.context, "text.feedback.warning.default", "#ffcb6b");
  const error = resolveFg(state.context, "text.feedback.error.default", "#f07178");
  return _$createComponent(Show, {
    get when() {
      return summary() !== "";
    },
    get children() {
      var _el$21 = _$createElement("text");
      _$insert(_el$21, summary);
      _$effect((_$p) => _$setProp(_el$21, "fg", failedCount() > 0 ? error : info, _$p));
      return _el$21;
    }
  });
}
var tui_default = Plugin.define({
  id: PLUGIN_ID,
  setup(context) {
    state.context = context;
    const [prefs, setPrefs] = context.storage.store("prefs", {
      initial: {
        expanded: true,
        showCompleted: false
      }
    });
    state.prefs = prefs;
    state.setPrefs = setPrefs;
    const stopEvents = context.data.listen(() => {
      requestRefresh();
    });
    const releaseSidebar = context.ui.slot({
      append: "sidebar.content",
      render: (input) => _$createComponent(SidebarSubagents, {
        get sessionID() {
          return input.sessionID;
        }
      })
    });
    const releaseFooter = context.ui.slot({
      append: "home.footer.status",
      render: () => _$createComponent(FooterSummary, {})
    });
    requestRefresh();
    return () => {
      stopEvents?.();
      releaseSidebar?.();
      releaseFooter?.();
      state.context = null;
      state.prefs = null;
      state.setPrefs = null;
    };
  }
});
export {
  tui_default as default
};
