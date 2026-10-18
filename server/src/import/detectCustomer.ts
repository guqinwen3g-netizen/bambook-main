import { DetectionResult } from './types';

/**
 * 客户识别条件 —— 来自客户档案（由调用方读取后传入），代码里不写死任何真实客户的
 * 公司名 / 税号 / 联系人 / 电话。没有传入档案时一律识别不出客户。
 */
export interface CustomerDetectionProfile {
  /** 与 `parsersByCustomer` 的键一致，例如 'peerless'。 */
  customerId: string;
  /** 客户法定名称（可多个写法）。命中 +0.5。 */
  legalNames?: string[];
  /** 税号等登记号码（原样文本，如 "Q.S.T. No 1234567890"）。每命中一个 +0.25。 */
  taxIds?: string[];
  /** 联系人或联系人/电话串。命中 +0.2。 */
  contacts?: string[];
  /** PO 号正则源码（不含斜杠），如 "\\b4500\\d{6}\\b"。命中 +0.1。 */
  poNumberPattern?: string;
}

/** 去重音、合并空白、转小写，避免 "Vêtements" / "Vetements" 这类写法差异漏判。 */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function contains(haystack: string, needle: string): boolean {
  const n = normalize(needle);
  return n.length > 0 && haystack.includes(n);
}

function safeRegExp(source: string): RegExp | null {
  try {
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}

export function detectCustomer(
  text: string,
  profiles: readonly CustomerDetectionProfile[] = [],
): DetectionResult {
  const hay = normalize(text);
  let bestId: string | null = null;
  let best = { score: 0, reasons: [] as string[] };
  for (const p of profiles) {
    let score = 0;
    const reasons: string[] = [];
    if ((p.legalNames ?? []).some((n) => contains(hay, n))) {
      score += 0.5;
      reasons.push('legal name');
    }
    const taxHits = (p.taxIds ?? []).filter((t) => contains(hay, t)).length;
    if (taxHits > 0) {
      score += 0.25 * taxHits;
      reasons.push(taxHits > 1 ? `tax id ×${taxHits}` : 'tax id');
    }
    if ((p.contacts ?? []).some((c) => contains(hay, c))) {
      score += 0.2;
      reasons.push('contact');
    }
    const po = p.poNumberPattern ? safeRegExp(p.poNumberPattern) : null;
    if (po && po.test(text)) {
      score += 0.1;
      reasons.push('PO number pattern');
    }
    if (score > best.score) {
      best = { score, reasons };
      bestId = p.customerId;
    }
  }
  return {
    customerId: bestId,
    confidence: Math.min(1, best.score),
    reasons: best.reasons,
  };
}
