import { expect, it } from 'vitest';
import { dropStoredSignatures } from './auth';

it('drops signature images from local recovery records but keeps the records', () => {
  const store = new Map<string, string>();
  const storage = { get length() { return store.size; }, key: (i: number) => [...store.keys()][i] ?? null, getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() } as Storage;
  storage.setItem('bambook.mist.pending:u1', JSON.stringify({ requestId: 'r1', command: { type: 'payable.settlement.confirm' }, signature: { svg: '<svg/>' } }));
  storage.setItem('bambook.mist.review-pending:u1', JSON.stringify({ requestId: 'r2', decision: 'approved', signature: { svg: '<svg/>' } }));
  storage.setItem('other', JSON.stringify({ signature: 'keep' }));
  dropStoredSignatures(storage);
  expect(JSON.parse(storage.getItem('bambook.mist.pending:u1')!)).toEqual({ requestId: 'r1', command: { type: 'payable.settlement.confirm' } });
  expect(JSON.parse(storage.getItem('bambook.mist.review-pending:u1')!)).toEqual({ requestId: 'r2', decision: 'approved' });
  expect(JSON.parse(storage.getItem('other')!)).toEqual({ signature: 'keep' });
});
