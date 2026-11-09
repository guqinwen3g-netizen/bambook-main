import { expect, it } from 'vitest';
import { markAgentProposalConfirmed } from '../shared/mistAgentProposals';

const proposal = (id: string) => ({ id, ownerId: 'u1', owner: '本人', command: { type: 'order.document.generate', payload: { orderId: 'o1', kind: 'PI' } }, summary: ['生成 PI'], createdAt: '', state: 'pending', taskId: 't1' });

it('keeps the file a confirmed proposal produced, and only a file that really exists', () => {
  const state = { files: [{ id: 'f1', name: 'PI-SO-G-2026-017-v2.pdf', mimeType: 'application/pdf', size: 1, storageKey: 'k', createdAt: '' }], agentProposals: [proposal('p1'), proposal('p2'), proposal('p3')] } as any;
  const command = { type: 'order.document.generate', payload: { orderId: 'o1', kind: 'PI' } };
  markAgentProposalConfirmed(state, 'p1', command, 'u1', 'now', { id: 'o1', fileId: 'f1' });
  markAgentProposalConfirmed(state, 'p2', command, 'u1', 'now', { id: 'o1', fileId: 'missing' });
  markAgentProposalConfirmed(state, 'p3', command, 'u1', 'now');
  expect(state.agentProposals[0]).toMatchObject({ state: 'confirmed', produced: { fileId: 'f1', fileName: 'PI-SO-G-2026-017-v2.pdf' } });
  expect(state.agentProposals[1].produced).toBeUndefined();
  expect(state.agentProposals[2]).toMatchObject({ state: 'confirmed' });
  expect(state.agentProposals[2].produced).toBeUndefined();
});
