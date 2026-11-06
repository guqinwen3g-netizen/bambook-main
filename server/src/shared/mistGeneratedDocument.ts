/**
 * Generated business documents (P1-3): one frozen snapshot shape rendered by one bilingual template.
 * Shipment documents (CI, PL, booking, shipping instructions, notices, draft, customs draft and power of attorney),
 * order documents (PI, sales contract) and lookbooks all freeze their content here; the PDF is rendered from the snapshot
 * on the server, archived in private storage and bound to the command context. The client never supplies content.
 */
import { creditDocumentFingerprint } from './mistCreditDocuments';
import type { MistCompanyProfile } from './mistWorkspace';

export const GENERATED_DOCUMENT_TEMPLATE_VERSION = 1 as const;
export type Bilingual = { zh: string; en: string };
export type GeneratedColumn = { key: string; label: Bilingual; num?: boolean };
export type GeneratedDocSnapshot = {
  templateVersion: typeof GENERATED_DOCUMENT_TEMPLATE_VERSION;
  kind: string; number: string; date: string; title: Bilingual;
  issuer: Pick<MistCompanyProfile, 'legalName' | 'englishName' | 'address' | 'englishAddress' | 'phone' | 'email' | 'taxId' | 'customsCode'>;
  parties: Array<{ label: Bilingual; name: string; detail: string }>;
  facts: Array<{ label: Bilingual; value: string }>;
  table?: { columns: GeneratedColumn[]; rows: Array<Record<string, string>>; totals?: Record<string, string> };
  paragraphs: Array<{ title?: Bilingual; text: string }>;
  amountInWords?: string;
  signatures: Array<{ label: Bilingual; name: string }>;
  generatedAt: string; generatedBy: string; generatedById: string;
};
export type GeneratedDocRecord = { id: string; kind: string; number: string; fileId: string; fileName: string; sha256: string; bytes: number; templateVersion: number; snapshotFingerprint: string; snapshot: GeneratedDocSnapshot; generatedAt: string; generatedBy: string; /** 加盖电子公章的版本对应的用印记录（见 mistSeals）。 */ sealUseId?: string };
export type GeneratedDocFile = { id: string; name: string; mimeType: string; size: number; storageKey: string; createdAt: string; uploadedBy?: string };
/** Server-rendered and stored before the command runs; the command re-derives the snapshot and must match it exactly. */
export type GeneratedDocArtifact = { requestId: string; record: GeneratedDocRecord; file: GeneratedDocFile };
export const generatedDocFingerprint = (s: unknown) => creditDocumentFingerprint(s);
export const generatedDocFileName = (s: Pick<GeneratedDocSnapshot, 'number' | 'title'>) => `${s.number}-${s.title.zh}.pdf`.replace(/[\\/:*?"<>|\s]+/g, '_');
/** Snapshot content without generation identity, for “has anything changed since the last file” checks. */
export const generatedDocContent = (s: GeneratedDocSnapshot) => { const { generatedAt: _a, generatedBy: _b, generatedById: _c, ...content } = s; return content; };

export function issuerOf(profile: MistCompanyProfile | undefined): GeneratedDocSnapshot['issuer'] | null {
  if (!profile?.legalName) return null;
  return { legalName: profile.legalName, englishName: profile.englishName || '', address: profile.address || '', englishAddress: profile.englishAddress || '', phone: profile.phone || '', email: profile.email || '', taxId: profile.taxId || '', customsCode: profile.customsCode || '' };
}
export const money2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const qtyText = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 4 });

const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
const CURRENCY_WORDS: Record<string, string> = { USD: 'US DOLLARS', EUR: 'EUROS', GBP: 'POUNDS STERLING', JPY: 'JAPANESE YEN', CNY: 'CHINESE YUAN', HKD: 'HONG KONG DOLLARS', AUD: 'AUSTRALIAN DOLLARS', CAD: 'CANADIAN DOLLARS' };
/** “SAY TOTAL US DOLLARS ... ONLY”, the wording used on commercial invoices and drafts. Amount in major units, two decimals. */
export function amountInWords(amount: number, currency: string): string {
  const two = (n: number) => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  const three = (n: number) => { const h = Math.floor(n / 100), r = n % 100; return [h ? ONES[h] + ' HUNDRED' : '', h && r ? 'AND' : '', r ? two(r) : ''].filter(Boolean).join(' '); };
  const cents = Math.round(amount * 100) % 100; let whole = Math.floor(Math.round(amount * 100) / 100);
  const parts: string[] = [];
  for (const [scale, label] of [[1e9, 'BILLION'], [1e6, 'MILLION'], [1e3, 'THOUSAND']] as const) if (whole >= scale) { parts.push(three(Math.floor(whole / scale)) + ' ' + label); whole %= scale; }
  if (whole) parts.push(three(whole));
  return `SAY TOTAL ${CURRENCY_WORDS[currency] || currency} ${parts.join(' ') || 'ZERO'}${cents ? ' AND CENTS ' + two(cents) : ''} ONLY`.replace(/\s+/g, ' ');
}
