/**
 * Shipment document types (P1-3). Own documents are issued by us (generated from shipment, packing and order data or uploaded);
 * external documents are issued by carriers, chambers, insurers or inspection bodies and can only be archived as originals.
 * CI and PL keep their special rules (CI creates the receivable, PL locks packing, both are required before departure).
 */
export const OWN_DOCUMENT_TYPES = ['CI', 'PL', 'SO', 'SI', 'DN', 'SA', 'BC', 'DFT', 'CD', 'CDA'] as const;
export const EXTERNAL_DOCUMENT_TYPES = ['BL', 'CO', 'INS', 'IC', 'OTHER'] as const;
export const DOCUMENT_TYPES = [...OWN_DOCUMENT_TYPES, ...EXTERNAL_DOCUMENT_TYPES] as const;
export type OwnDocumentType = typeof OWN_DOCUMENT_TYPES[number];
export type ShipmentDocumentType = typeof DOCUMENT_TYPES[number];
export const isOwnDocumentType = (type: string): type is OwnDocumentType => (OWN_DOCUMENT_TYPES as readonly string[]).includes(type);
/** Documents normally issued after the goods have left: they stay possible once the shipment has departed. */
export const POST_DEPARTURE_TYPES: readonly ShipmentDocumentType[] = ['SA', 'BC', 'DFT'];
/** One document per order (CI and the bill of exchange drawn on it); every other type covers the whole shipment. */
export const PER_ORDER_TYPES: readonly ShipmentDocumentType[] = ['CI', 'DFT'];
export const DOCUMENT_TYPE_LABEL: Record<ShipmentDocumentType, string> = {
  CI: '商业发票 CI', PL: '装箱单 PL', SO: '订舱委托书', SI: '提单补料', DN: '出货通知', SA: '装船通知', BC: '受益人证明', DFT: '汇票', CD: '报关单草稿', CDA: '报关委托书',
  BL: '提单 BL', CO: '原产地证 CO', INS: '保险单', IC: '检验证书', OTHER: '其他外部单据',
};
export type BillOfLadingKind = 'original' | 'telex' | 'seaway';
export const BL_KIND_LABEL: Record<BillOfLadingKind, string> = { original: '正本提单', telex: '电放', seaway: '海运单' };
/** Carrier B/L facts kept on the BL document: number, release form, originals, shipping-instruction and draft check, release. */
export type BillOfLadingDetails = {
  blNo: string; kind: BillOfLadingKind; originals: number; siDocumentId?: string;
  draftConfirmed?: { at: string; actor: string; evidence: string };
  released?: { at: string; actor: string; evidence: string };
  updatedAt: string; updatedBy: string;
};
