import type { CustomerDetectionProfile } from '../../detectCustomer';

/**
 * 手造最小单页 PDF（测试专用）。
 *
 * 为什么需要它：公开仓库不携带真实客户 PO；正向与"缺行"这类**负向**场景都用合成 PDF。用最小 PDF + TL/T* 换行，pdf-parse 抽取后能保留行结构，
 * 于是负向用例可以走通 `parseOrderPdf` 全链（而不是只测 `parsePeerless`）。
 */
export function buildPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let content = 'BT\n/F1 10 Tf\n14 TL\n20 760 Td\n';
  lines.forEach((l, i) => {
    if (i > 0) content += 'T*\n';
    content += `(${esc(l)}) Tj\n`;
  });
  content += 'ET\n';

  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * 测试专用的虚构客户识别档案（公司名 / 税号 / 联系人 / 电话均为虚构，
 * 与任何真实客户无关）。生产中这些条件来自客户档案。
 */
export const TEST_PROFILE: CustomerDetectionProfile = {
  customerId: 'peerless',
  legalNames: ['Northwind Apparel Testing Inc.'],
  taxIds: ['Q.S.T. No 0000000001', 'G.S.T. No. 000000002'],
  contacts: ['Alex Sample/555-010-0100'],
  poNumberPattern: '\\b4500\\d{6}\\b',
};

/** 一份"结构完整、可被 detectCustomer（配 TEST_PROFILE）判为 peerless"的合成 PO 文本行。 */
export function peerlessHeaderLines(poNumber = '4500900001'): string[] {
  return [
    'Northwind Apparel Testing Inc.',
    'T.V.Q./Q.S.T. No 0000000001',
    'T.P.S./G.S.T. No. 000000002',
    'PO number / season / date',
    `${poNumber} / F26-INSTOCK / 2026/03/31`,
    'Contact person/Telephone',
    'Alex Sample/555-010-0100 EXT:100',
    'Currency USD',
  ];
}

export const TOTAL_NET_LINE = 'Tot. net item val. excl. tax USD 103.680,00';
export const ACTUAL_PRICE_LINE = 'Actual price 103.680,00';

const fmt = (n: number) =>
  n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** 带 N 条明细行的完整合成 PO 文本行（每行 1.000 M × 3,50 USD，出厂日 2026/07/01）。 */
export function syntheticPoLines(poNumber: string, lineCount: number): string[] {
  const items: string[] = [];
  for (let i = 1; i <= lineCount; i++) {
    items.push(
      `${String(i * 10).padStart(5, '0')} ${100000 + i} MQ-${i} Cotton twill ${i} 150 CM 2026/07/01 2026/07/15`,
      `1.000,00 M 3,50 SOLID 3.500,00 SEA`,
      '180 GSM',
      'WOVEN',
    );
  }
  const total = fmt(3500 * lineCount);
  return [
    ...peerlessHeaderLines(poNumber),
    ...items,
    `Tot. net item val. excl. tax USD ${total}`,
    `Actual price ${total}`,
  ];
}

export function syntheticPoPdf(poNumber: string, lineCount: number): Buffer {
  return buildPdf(syntheticPoLines(poNumber, lineCount));
}
