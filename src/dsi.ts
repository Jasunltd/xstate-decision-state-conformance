import { differences, canonicalize, sha256, stableStringify, type CanonicalValue, type ValueDifference } from "./canonical.js";

export const DECISION_STATE_INDEX_SCHEMA = "xstate-decision-state-index/v1" as const;

export interface ActorIdentity {
  readonly id: string;
  readonly systemId?: string;
  readonly registryKey?: string;
  readonly address?: string;
}

export interface ScheduledDecisionObligation {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly delay: number;
  readonly event: CanonicalValue;
}

export interface ChildDecisionState {
  readonly actor: ActorIdentity;
  readonly status: string;
  readonly value?: CanonicalValue;
  readonly context?: CanonicalValue;
  readonly output?: CanonicalValue;
  readonly error?: CanonicalValue;
  readonly tags: readonly string[];
  readonly history: CanonicalValue;
  readonly children: Readonly<Record<string, ChildDecisionState>>;
}

export interface DecisionStateIndex extends ChildDecisionState {
  readonly schema: typeof DECISION_STATE_INDEX_SCHEMA;
  readonly scheduled: readonly ScheduledDecisionObligation[];
  readonly digest: string;
}

export interface DecisionStateComparison {
  readonly equivalent: boolean;
  readonly differences: readonly ValueDifference[];
}

interface SnapshotLike {
  readonly status?: unknown;
  readonly value?: unknown;
  readonly context?: unknown;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly tags?: unknown;
  readonly historyValue?: unknown;
  readonly children?: unknown;
  readonly timers?: unknown;
}

export interface DecisionActorLike {
  readonly id?: unknown;
  readonly sessionId?: unknown;
  readonly systemId?: unknown;
  readonly registryKey?: unknown;
  readonly address?: unknown;
  readonly system?: {
    getSnapshot?: () => unknown;
  };
  getSnapshot(): unknown;
}

function stableActorId(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return /^x:\d+$/.test(value) ? undefined : value;
}

function actorLabel(actor: unknown): string {
  if (!actor || typeof actor !== "object") return "[unknown-actor]";
  const row = actor as Record<string, unknown>;
  if (typeof row.address === "string") return "address:" + row.address;
  if (typeof row.registryKey === "string") return "registry:" + row.registryKey;
  if (typeof row.systemId === "string") return "system:" + row.systemId;
  const stableId = stableActorId(row.id);
  if (stableId) return "id:" + stableId;
  return "[generated-actor]";
}

function actorIdentity(actor: DecisionActorLike, role: string): ActorIdentity {
  return {
    id: stableActorId(actor.id) ?? role,
    ...(typeof actor.systemId === "string" ? { systemId: actor.systemId } : {}),
    ...(typeof actor.registryKey === "string" ? { registryKey: actor.registryKey } : {}),
    ...(typeof actor.address === "string" ? { address: actor.address } : {}),
  };
}

function normalizeTags(value: unknown): string[] {
  if (value instanceof Set) return [...value].map(String).sort();
  if (Array.isArray(value)) return value.map(String).sort();
  return [];
}

function normalizeHistory(value: unknown): CanonicalValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return canonicalize(value ?? {});
  }
  const out: Record<string, CanonicalValue> = {};
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
    if (Array.isArray(candidate)) {
      out[key] = candidate.map((item) => {
        if (item && typeof item === "object" && "id" in item) {
          const id = (item as { id?: unknown }).id;
          return typeof id === "string" ? id : canonicalize(id);
        }
        return canonicalize(item);
      });
    } else {
      out[key] = canonicalize(candidate);
    }
  }
  return out;
}

function projectChild(
  actor: DecisionActorLike,
  seen: Set<string>,
  depth: number,
  role: string,
): ChildDecisionState {
  const identity = actorIdentity(actor, role);
  const identityKey =
    typeof actor.sessionId === "string"
      ? actor.sessionId
      : identity.address ?? identity.registryKey ?? identity.systemId ?? identity.id;
  if (seen.has(identityKey)) {
    return {
      actor: identity,
      status: "[cycle]",
      tags: [],
      history: {},
      children: {},
    };
  }
  if (depth > 12) {
    return {
      actor: identity,
      status: "[depth-limit]",
      tags: [],
      history: {},
      children: {},
    };
  }

  seen.add(identityKey);
  try {
    const snapshot = (actor.getSnapshot() ?? {}) as SnapshotLike;
    const children: Record<string, ChildDecisionState> = {};
    if (snapshot.children && typeof snapshot.children === "object" && !Array.isArray(snapshot.children)) {
      for (const [key, child] of Object.entries(snapshot.children as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
        if (child && typeof child === "object" && typeof (child as DecisionActorLike).getSnapshot === "function") {
          children[key] = projectChild(child as DecisionActorLike, seen, depth + 1, key);
        }
      }
    }

    return {
      actor: identity,
      status: typeof snapshot.status === "string" ? snapshot.status : String(snapshot.status ?? "unknown"),
      ...("value" in snapshot ? { value: canonicalize(snapshot.value) } : {}),
      ...("context" in snapshot ? { context: canonicalize(snapshot.context) } : {}),
      output: canonicalize(snapshot.output),
      error: canonicalize(snapshot.error),
      tags: normalizeTags(snapshot.tags),
      history: normalizeHistory(snapshot.historyValue),
      children,
    };
  } finally {
    seen.delete(identityKey);
  }
}

function projectScheduled(actor: DecisionActorLike): ScheduledDecisionObligation[] {
  const actorSnapshot = (actor.getSnapshot() ?? {}) as SnapshotLike;

  // XState v6 exposes pending logical timers directly on the actor snapshot.
  if (
    actorSnapshot.timers &&
    typeof actorSnapshot.timers === "object" &&
    !Array.isArray(actorSnapshot.timers)
  ) {
    return Object.entries(actorSnapshot.timers as Record<string, unknown>)
      .map(([key, candidate]) => {
        const row = (candidate ?? {}) as Record<string, unknown>;
        const target = row.target;
        return {
          id: typeof row.id === "string" ? row.id : key,
          source: actorLabel(actor),
          target:
            typeof target === "string"
              ? target
              : actorLabel(target),
          delay: typeof row.delay === "number" ? row.delay : Number(row.delay ?? 0),
          event: canonicalize(row.event),
        } satisfies ScheduledDecisionObligation;
      })
      .sort((left, right) =>
        left.id.localeCompare(right.id) ||
        left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target)
      );
  }

  // XState v5 keeps delayed-transition obligations in the actor system
  // scheduler rather than the persisted machine snapshot.
  const snapshot = actor.system?.getSnapshot?.() as
    | { _scheduledEvents?: Record<string, unknown> }
    | undefined;
  const events = snapshot?._scheduledEvents ?? {};
  return Object.entries(events)
    .map(([key, candidate]) => {
      const row = (candidate ?? {}) as Record<string, unknown>;
      return {
        id: typeof row.id === "string" ? row.id : key,
        source: actorLabel(row.source),
        target: actorLabel(row.target),
        delay: typeof row.delay === "number" ? row.delay : Number(row.delay ?? 0),
        event: canonicalize(row.event),
      } satisfies ScheduledDecisionObligation;
    })
    .sort((left, right) =>
      left.id.localeCompare(right.id) ||
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target)
    );
}

function indexBody(index: DecisionStateIndex) {
  const { digest: _digest, ...body } = index;
  return body;
}

export function compareDecisionStateIndexes(
  expected: DecisionStateIndex,
  actual: DecisionStateIndex,
): DecisionStateComparison {
  const equivalent = stableStringify(indexBody(expected)) === stableStringify(indexBody(actual));
  return {
    equivalent,
    differences: equivalent ? [] : differences(indexBody(expected), indexBody(actual)),
  };
}

export function decisionStateIndex(actor: DecisionActorLike): DecisionStateIndex {
  const child = projectChild(actor, new Set<string>(), 0, "$root");
  const scheduled = projectScheduled(actor);
  const body = {
    schema: DECISION_STATE_INDEX_SCHEMA,
    ...child,
    scheduled,
  } as const;
  return {
    ...body,
    digest: sha256(body),
  };
}
