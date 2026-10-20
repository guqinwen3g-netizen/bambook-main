// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isListState, nextScrollKey } from './ReferenceApp';
import type { Route } from './nav';

const at = (route: Route, keepScroll = false) => ({ key: '', route, list: isListState(route, { keepScroll }) });
const step = (previous: ReturnType<typeof at> & { key: string }, route: Route, keepScroll = false) => { const list = isListState(route, { keepScroll }); return { key: nextScrollKey(previous, route, list), route, list }; };

describe('Mist scroll position across in-list selection', () => {
  it('keeps the page position while switching the previewed row inside the same list', () => {
    const list = { ...at({ view: 'products' }), key: 'products#list' };
    const a = step(list, { view: 'products', id: 'a' }, true), b = step(a, { view: 'products', id: 'b' }, true);
    expect(a.key).toBe(list.key); expect(b.key).toBe(list.key);
  });
  it('resets for full pages, other views and returns from a full page', () => {
    const picked = { ...at({ view: 'products', id: 'a' }, true), key: 'products#list' };
    const full = step(picked, { view: 'products', id: 'a', detail: 'full' });
    expect(full.key).not.toBe(picked.key);
    expect(step(full, { view: 'products', id: 'a' }, true).key).not.toBe(full.key);
    expect(step(picked, { view: 'suppliers' }).key).not.toBe(picked.key);
  });
  it('treats a record id without explicit in-list selection as a page change', () => {
    const list = { ...at({ view: 'claims' }), key: 'claims#list' };
    expect(step(list, { view: 'claims', id: 'x' }).key).not.toBe(list.key);
  });
});
