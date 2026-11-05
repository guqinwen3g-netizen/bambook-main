import { expect, it } from 'vitest';
import { materialDeliveryFixture } from '../mist/__tests__/materialDelivery';

it('names the order and the next step when the receiving order owner has left the company', () => {
  const f = materialDeliveryFixture(20);
  const members = f.context.members!, at = members.findIndex(m => m.id === 'garment');
  const [left] = members.splice(at, 1);
  try {
    let message = '';
    try { f.issue(1); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/^订单 \S+ (指定的成衣接收负责人|的负责人)已不在本公司，请先(变更接收负责人|交接该订单)再发料$/);
  } finally { members.splice(at, 0, left); }
});

it('names the fabric order when its owner has left the company', () => {
  const f = materialDeliveryFixture(20);
  const members = f.context.members!, at = members.findIndex(m => m.id === 'owner');
  const [left] = members.splice(at, 1);
  try {
    let message = '';
    try { f.issue(1, 'reviewer'); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/^订单 \S+ 的面料负责人已不在本公司，请先交接该订单再发料$/);
  } finally { members.splice(at, 0, left); }
});
