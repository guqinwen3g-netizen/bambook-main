import { describe, expect, it } from 'vitest';
import { cartonVolume, GSM_PER_OZ_YD2, YARN_UNITS } from './BusinessCalculators';
it('computes carton CBM, gross weight and air chargeable weight', () => {
  const v = cartonVolume(60, 40, 50, 10, 12.5);
  expect(v.cartonCbm).toBeCloseTo(0.12, 10); expect(v.totalCbm).toBeCloseTo(1.2, 10); expect(v.totalGross).toBe(125); expect(v.airChargeableKg).toBeCloseTo(200, 10);
  expect(cartonVolume(60, 40, 50, 1, null).totalGross).toBeNull();
});
it('uses the exact ounce and square-yard definitions for fabric weight', () => { expect(GSM_PER_OZ_YD2).toBeCloseTo(33.9057, 4); });
describe('yarn count conversion', () => {
  it('converts Ne 40 to about 14.8 tex, 133 D and Nm 67.7', () => {
    const tex = YARN_UNITS.Ne.toTex(40);
    expect(tex).toBeCloseTo(14.76, 2);
    expect(YARN_UNITS.D.fromTex(tex)).toBeCloseTo(132.9, 1);
    expect(YARN_UNITS.Nm.fromTex(tex)).toBeCloseTo(67.74, 1);
  });
});
