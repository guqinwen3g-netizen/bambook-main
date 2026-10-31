/** Internal receipt evidence. Never spread this field into a public receipt or workspace. */
export const AGENT_AUDIT_FIELD = '__agentAudit';
/** Existing releases already reject this entire namespace at every public receipt entry. */
export const AGENT_AUDIT_PREFIX = 'mist-revision:agent-audit:';
export const AGENT_AUDIT_HASH = 'mist-agent-audit:v1';
export const agentAuditReceiptId = (requestId: string) => AGENT_AUDIT_PREFIX + requestId;
export type AgentAuditChange = {
  /** k:object key / i:record id; these are literal segments, not an executable path. */
  path: string[];
  operation: 'add' | 'remove' | 'replace' | 'reorder';
  before?: unknown;
  after?: unknown;
  beforeIndex?: number;
  afterIndex?: number;
};
export type AgentCommandAudit = {
  schemaVersion: 1;
  workspaceId: string;
  requestId: string;
  at: string;
  actor: { id: string; name: string };
  source: 'agent' | 'human_confirmation' | 'human_rejection';
  /** null only for a historical proposal whose originating session was never recorded. */
  agentSessionId: string | null;
  agentIdentity?:{id:string;name:string};
  proposalId?: string;
  phase: 'executed' | 'proposed' | 'confirmed' | 'rejected';
  command: { type: string; payload: Record<string, unknown> };
  trigger?: { type: string; payload: Record<string, unknown> };
  requestedRevision: number;
  baseRevision: number;
  committedRevision: number;
  changes: AgentAuditChange[];
};

const secretKey = /password|passphrase|secret|token|apiKey|privateKey|signingKey|authorization|cookie|credential|delegation|sessionKey|^jwt$/i;
const secretName = (key: string) => secretKey.test(key.replace(/[_-]/g, ''));
const stable = (value: unknown): string => value === undefined ? 'undefined' : Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',')}}` : JSON.stringify(value);

/** Keep business values, redact credentials and inline binary content, including nested proposal commands. */
export function redactAgentAuditValue(value: unknown, key = ''): any {
  if (secretName(key)) return '[redacted]';
  if (typeof value === 'string' && /^data:/i.test(value)) return '[inline binary redacted]';
  if (Array.isArray(value)) return value.map(item => redactAgentAuditValue(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([name, item]) => [name, redactAgentAuditValue(item, name)]));
  return value;
}

const records = (value: unknown[]): Map<string, unknown> | undefined => {
  const map = new Map<string, unknown>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string') return;
    const id = (item as { id: string }).id;
    if (!id || map.has(id)) return;
    map.set(id, item);
  }
  return map;
};

/** Actual committed differences, not predicted events. Presence and null remain distinguishable. */
export function agentAuditChanges(before: unknown, after: unknown): AgentAuditChange[] {
  const changes: AgentAuditChange[] = [];
  const walk = (left: unknown, right: unknown, path: string[], key = '', position?: { beforeIndex?: number; afterIndex?: number }) => {
    if (Object.is(left, right) || stable(left) === stable(right)) return;
    if (!secretName(key) && Array.isArray(left) && Array.isArray(right)) {
      const a = records(left), b = records(right);
      if (a && b) {
        const oldIds = [...a.keys()], newIds = [...b.keys()];
        const oldIndex = new Map(oldIds.map((id, index) => [id, index])), newIndex = new Map(newIds.map((id, index) => [id, index]));
        for (const id of new Set([...a.keys(), ...b.keys()])) walk(a.get(id), b.get(id), [...path, 'i:' + id], '', {
          ...(a.has(id) ? { beforeIndex: oldIndex.get(id) } : {}), ...(b.has(id) ? { afterIndex: newIndex.get(id) } : {}),
        });
        // Adds/removes already carry their positions. Only changed relative order of retained IDs
        // needs a separate order delta; appending an event must not copy the entire event history.
        const oldCommon = oldIds.filter(id => b.has(id)), newCommon = newIds.filter(id => a.has(id));
        if (stable(oldCommon) !== stable(newCommon)) {
          changes.push({ path, operation: 'reorder', before: oldCommon, after: newCommon });
        }
        return;
      }
    }
    if (!secretName(key) && left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
      for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[name], b[name], [...path, 'k:' + name], name);
      return;
    }
    changes.push({ path, operation: left === undefined ? 'add' : right === undefined ? 'remove' : 'replace', ...position,
      ...(left === undefined ? {} : { before: redactAgentAuditValue(left, key) }),
      ...(right === undefined ? {} : { after: redactAgentAuditValue(right, key) }) });
  };
  walk(before, after, []);
  return changes;
}

export function createAgentCommandAudit(input: Omit<AgentCommandAudit, 'schemaVersion' | 'changes' | 'command' | 'trigger'> & {
  command: AgentCommandAudit['command']; trigger?: AgentCommandAudit['trigger']; before: unknown; after: unknown;
}): AgentCommandAudit {
  const { before, after, command, trigger, ...metadata } = input;
  return { schemaVersion: 1, ...metadata, command: redactAgentAuditValue(command), ...(trigger ? { trigger: redactAgentAuditValue(trigger) } : {}), changes: agentAuditChanges(before, after) };
}

/** Normal receipt compatibility is preserved; audit requires its own permission-checked read path. */
export function publicCommandReceiptResult<T extends Record<string, any>>(stored: T): Omit<T, typeof AGENT_AUDIT_FIELD> {
  const { [AGENT_AUDIT_FIELD]: _audit, ...result } = stored;
  return result;
}
