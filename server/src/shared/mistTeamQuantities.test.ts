import { describe, expect, it } from 'vitest';
import { createMistState, type MistContext } from './mistWorkspace';
import { MIST_DEMO_ACCOUNTS } from './mistAccounts';
import { applyTeamCommand, formatTeamShipmentQuantities, myTeamReport, teamWeekRow, teamWeeklyReport, teamWeeklyText } from './mistTeam';

function fixture() {
  let n = 0;
  const context = { id: () => `quantity-${++n}`, now: '2026-10-19T02:00:00Z', actorName: '负责人', actorId: 'demo-admin', members: MIST_DEMO_ACCOUNTS } as unknown as MistContext;
  const s = createMistState(context, 'demo'), order = s.orders[0], line = s.orderLines[0];
  s.orders = ['a', 'b', 'c'].map((id, i) => ({ ...structuredClone(order), id, type: i ? 'fabric' : 'garment', ownerId: i === 1 ? 'demo-buyer' : 'demo-sales', createdAt: '2026-10-13T02:00:00Z' }));
  s.orderLines = ['件', '米', '码'].map((unit, i) => ({ ...structuredClone(line), id: `line-${i}`, orderId: s.orders[i].id, unit }));
  const item = (i: number, quantity: number) => ({ lineId: `line-${i}`, orderId: s.orders[i].id, quantity });
  // One garment shipment, and one same-customer fabric shipment shared by two order owners.
  s.fulfillment.shipments = [
    { id: 'garment', state: 'departed', departedAt: '2026-10-14T02:00:00Z', lines: [item(0, 780)] },
    { id: 'fabric', state: 'departed', departedAt: '2026-10-14T02:00:00Z', lines: [item(1, 200.5), item(2, 205)] },
  ] as any;
  return { s, context, directory: MIST_DEMO_ACCOUNTS.map(m => ({ ...m })), viewer: { id: 'demo-admin', owner: true } };
}
const quantities = (groups: Array<{ unit: string | null; quantity: string }>) => Object.fromEntries(groups.map(g => [g.unit ?? 'unknown', g.quantity]));

describe('team weekly physical quantities', () => {
  it('keeps pieces/metres/yards separate in rows, totals and generated text, and counts each physical shipment once', () => {
    const f = fixture(), r = teamWeeklyReport(f.s, f.directory, f.viewer, '2026-10-12', '2026-10-18');
    expect(quantities(r.totals.shippedQuantities)).toEqual({ '件': '780', '米': '200.5', '码': '205' });
    expect(r.totals).not.toHaveProperty('shippedQty'); expect(r.totals.shipments).toBe(2);
    const sales = r.rows.find(x => x.id === 'demo-sales')!, buyer = r.rows.find(x => x.id === 'demo-buyer')!;
    expect(quantities(sales.shippedQuantities)).toEqual({ '件': '780', '码': '205' });
    expect(quantities(buyer.shippedQuantities)).toEqual({ '米': '200.5' });
    expect(sales.shipments).toBe(2); expect(buyer.shipments).toBe(1);
    const text = teamWeeklyText(r); for (const part of ['780 件', '200.5 米', '205 码']) expect(text).toContain(part);
    expect(text).not.toContain('件/米'); expect(text).not.toContain('1185.5');
  });
  it('sums accepted four-decimal quantities exactly within each original unit without converting yards to metres', () => {
    const f = fixture(); f.s.orderLines.forEach(l => { l.unit = '米'; });
    f.s.fulfillment.shipments[0].lines[0].quantity = 0.1;
    f.s.fulfillment.shipments[1].lines[0].quantity = 0.2;
    f.s.fulfillment.shipments[1].lines[1].quantity = 0.0001;
    const r = teamWeeklyReport(f.s, f.directory, f.viewer, '2026-10-12', '2026-10-18');
    expect(quantities(r.totals.shippedQuantities)).toEqual({ '米': '0.3001' });
  });
  it('does not infer a unit from business domain when a source line/unit is unavailable', () => {
    const f = fixture(); f.s.orderLines[0].unit = ''; f.s.fulfillment.shipments[1].lines[1].lineId = 'unavailable';
    const r = teamWeeklyReport(f.s, f.directory, f.viewer, '2026-10-12', '2026-10-18');
    expect(quantities(r.totals.shippedQuantities)).toEqual({ unknown: '985', '米': '200.5' });
    expect(formatTeamShipmentQuantities(r.totals.shippedQuantities)).toContain('单位未记录');
    expect(formatTeamShipmentQuantities(undefined)).toBe('数量未分单位');
  });
  it('uses only departed lines in the selected week and the requested member ownership', () => {
    const f = fixture(); f.s.fulfillment.shipments[0].state = 'requested';
    const r = teamWeekRow(f.s, { id: 'demo-buyer', name: '经办' }, '2026-10-12', '2026-10-18');
    expect(quantities(r.shippedQuantities)).toEqual({ '米': '200.5' });
    f.s.fulfillment.shipments[1].departedAt = '2026-10-19T02:00:00Z';
    expect(teamWeekRow(f.s, { id: 'demo-buyer', name: '经办' }, '2026-10-12', '2026-10-18').shippedQuantities).toEqual([]);
  });
  it('rejects invalid source precision or non-finite quantities without mutating business data', () => {
    for (const quantity of [NaN, -1, 0.00001, null as any, '1' as any, { amount: 1 } as any]) {
      const f = fixture(); f.s.fulfillment.shipments[0].lines[0].quantity = quantity; const before = structuredClone(f.s);
      expect(() => teamWeeklyReport(f.s, f.directory, f.viewer, '2026-10-12', '2026-10-18')).toThrow('出运数量无法核对');
      expect(f.s).toEqual(before);
    }
  });
  it('freezes grouped quantities/text on archive and does not change them after source quantities or units change', () => {
    const f = fixture(); applyTeamCommand(f.s, { type: 'team.weekly.archive', payload: { weekStart: '2026-10-12' } }, f.context);
    const saved = structuredClone(myTeamReport(f.s, 'demo-admin', '2026-10-12')!);
    expect(quantities(saved.report.totals.shippedQuantities)).toEqual({ '件': '780', '米': '200.5', '码': '205' });
    f.s.orderLines[0].unit = '套'; f.s.fulfillment.shipments[0].lines[0].quantity = 1;
    expect(myTeamReport(f.s, 'demo-admin', '2026-10-12')).toEqual(saved); expect(saved.text).not.toContain('件/米');
  });
});
