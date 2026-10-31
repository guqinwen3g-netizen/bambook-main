import { describe, expect, it } from 'vitest';
import { agentAuditChanges, createAgentCommandAudit, publicCommandReceiptResult, redactAgentAuditValue } from './agentAudit';

describe('Agent audit evidence', () => {
  it('tracks fields by literal record IDs and distinguishes deletion, absence and null', () => {
    const before = { lines: [{ id: 'a', qty: 2, note: null }, { id: 'b', qty: 1 }], label: null };
    const after = { lines: [{ id: 'a', qty: 3, note: 'approved' }, { id: 'c', qty: 5 }], extra: null };
    const changes = agentAuditChanges(before, after);
    expect(changes).toContainEqual({ path: ['k:lines', 'i:a', 'k:qty'], operation: 'replace', before: 2, after: 3 });
    expect(changes).toContainEqual({ path: ['k:lines', 'i:b'], operation: 'remove', before: { id: 'b', qty: 1 }, beforeIndex: 1 });
    expect(changes).toContainEqual({ path: ['k:extra'], operation: 'add', after: null });
    expect(changes).toContainEqual({ path: ['k:label'], operation: 'remove', before: null });
    expect(changes).toContainEqual({ path: ['k:lines', 'i:c'], operation: 'add', after: { id: 'c', qty: 5 }, afterIndex: 1 });
    expect(changes.some(change => change.operation === 'reorder')).toBe(false);
    expect(agentAuditChanges({ a: { b: 1, c: 2 } }, { a: { c: 2, b: 1 } })).toEqual([]);
  });

  it('keeps event appends proportional to the new event, while preserving actual reordering', () => {
    const events = Array.from({ length: 2000 }, (_, index) => ({ id: 'event-' + index, text: 'existing event' }));
    const appended = agentAuditChanges({ events }, { events: [...events, { id: 'new-event', text: 'new' }] });
    expect(appended).toEqual([{ path: ['k:events', 'i:new-event'], operation: 'add', after: { id: 'new-event', text: 'new' }, afterIndex: 2000 }]);
    expect(JSON.stringify(appended).length).toBeLessThan(300);
    expect(agentAuditChanges({ rows: [{ id: 'a' }, { id: 'b' }] }, { rows: [{ id: 'b' }, { id: 'a' }] })).toEqual([{ path: ['k:rows'], operation: 'reorder', before: ['a', 'b'], after: ['b', 'a'] }]);
  });

  it('records credential changes without retaining either old or new secrets, including nested commands', () => {
    const before = { credentials: { api_key: 'old-key' }, smtpPassword: 'old-password', image: 'data:image/png;base64,b2xk' };
    const after = { credentials: { api_key: 'new-key' }, smtpPassword: 'new-password', image: 'data:image/png;base64,bmV3' };
    const changes = agentAuditChanges(before, after), text = JSON.stringify(changes);
    for (const value of ['old-key', 'new-key', 'old-password', 'new-password', 'b2xk', 'bmV3']) expect(text).not.toContain(value);
    expect(changes).toContainEqual({ path: ['k:smtpPassword'], operation: 'replace', before: '[redacted]', after: '[redacted]' });
    expect(redactAgentAuditValue({ command: { payload: { access_token: 'token', headers: { Authorization: 'Bearer value' } } }, amount: 125 })).toEqual({ command: { payload: { access_token: '[redacted]', headers: { Authorization: '[redacted]' } } }, amount: 125 });
    expect(redactAgentAuditValue({ private_key: 'private', headers: { 'x-bambook-delegation': 'signed token' } })).toEqual({ private_key: '[redacted]', headers: { 'x-bambook-delegation': '[redacted]' } });
  });

  it('keeps the original request, actual revision interval and immutable source evidence without mutating inputs', () => {
    const before = { total: 1 }, after = { total: 2 };
    const audit = createAgentCommandAudit({ workspaceId: 'w', requestId: 'request', at: '2026-10-31T08:00:00Z', actor: { id: 'user', name: 'User' }, source: 'agent', agentSessionId: 'session', phase: 'executed', command: { type: 'record.save', payload: { apiKey: 'private', amount: 2 } }, requestedRevision: 0, baseRevision: 2, committedRevision: 3, before, after });
    expect(audit).toMatchObject({ schemaVersion: 1, agentSessionId: 'session', requestedRevision: 0, baseRevision: 2, committedRevision: 3, command: { payload: { apiKey: '[redacted]', amount: 2 } } });
    expect(audit.changes).toEqual([{ path: ['k:total'], operation: 'replace', before: 1, after: 2 }]);
    expect(before).toEqual({ total: 1 }); expect(after).toEqual({ total: 2 });
  });

  it('preserves existing public receipt fields and removes only internal audit evidence', () => {
    const stored = { revision: 4, result: { id: 'business' }, expectedRevision: 3, __agentAudit: { command: 'private' } };
    expect(publicCommandReceiptResult(stored)).toEqual({ revision: 4, result: { id: 'business' }, expectedRevision: 3 });
    expect(stored.__agentAudit).toEqual({ command: 'private' });
  });
});
