/**
 * 测试用模拟出口方档案（虚构公司/银行信息，仅供测试）。
 * 生产环境不携带任何兜底抬头：未配置时单据生成一律拒绝，真实值由管理后台填写。
 */
import { EXPORTER_PROFILE_CONFIG_ID, EXPORTER_PROFILE_CONFIG_KEY, type ExporterProfileValue } from '../systemConfigRoute';

export const DEMO_EXPORTER_PROFILE: ExporterProfileValue = {
  nameEn: 'DEMO EXPORT CO.,LTD.',
  addressEn: 'ROOM 101 DEMO TOWER,\nDEMO CITY, 000000 PR\nCHINA',
  beneficiary: 'DEMO EXPORT CO.,LTD.',
  bankName: 'DEMO BANK SAMPLE SUB-BRANCH',
  swiftCode: 'DEMOCNXX001',
  bankAddress: '1 DEMO ROAD, DEMO CITY, P.R.CHINA.',
  usdAccountNumber: '000000000001',
};

/** SystemConfig 行（已配置态），可直接作为 prisma.systemConfig.findUnique 的返回值 */
export function demoExporterProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EXPORTER_PROFILE_CONFIG_ID, scope: 'global', key: EXPORTER_PROFILE_CONFIG_KEY, group: 'company',
    label: '出口方档案（单据抬头/收款账户）', valueType: 'json', value: { ...DEMO_EXPORTER_PROFILE },
    encrypted: false, version: 1, description: null, meta: null, updatedBy: null, auditReason: null,
    createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: BigInt(1790000000000), ...overrides,
  };
}
