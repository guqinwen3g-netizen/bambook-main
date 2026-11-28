import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ASSISTANT_CONTEXT_MAX_LENGTH = 8192;
export const ASSISTANT_CONTEXT_MAX_TOKENS = 20;
export const ASSISTANT_CONTEXT_MAX_SOURCES = 24;
export const ASSISTANT_CONTEXT_MESSAGE_LIMIT = 2000;
const CONTEXT_LIFETIME_SECONDS = 24 * 60 * 60;
const localSecret = randomBytes(32);
const purpose = 'bambook-mist-assistant-context/v1';
const digestPattern = /^[A-Za-z0-9_-]{43}$/;

export type AssistantContextPrincipal = { actorId: string; workspaceId: string };
type ContextToken = { sourceKeys: string[]; facts: string; exchange: string; expiresAt: number };

function mac(domain: string, value: string): string {
  const key = createHmac('sha256', process.env.JWT_SECRET || localSecret).update(purpose).digest();
  return createHmac('sha256', key).update(domain).update('\0').update(value).digest('base64url');
}

export function assistantFactsDigest(facts: string): string {
  return mac('facts', facts);
}

export function assistantSourceKey(id: string): string {
  return createHash('sha256').update(id).digest('base64url');
}

function exchangeDigest(question: string, answer: string): string {
  return mac('exchange', JSON.stringify([question.slice(0, ASSISTANT_CONTEXT_MESSAGE_LIMIT), answer.slice(0, ASSISTANT_CONTEXT_MESSAGE_LIMIT)]));
}

function signature(principal: AssistantContextPrincipal, payload: string): string {
  return mac('signature', JSON.stringify([principal.actorId, principal.workspaceId, payload]));
}

export function signAssistantContext(principal: AssistantContextPrincipal, sourceKeys: string[], facts: string, question: string, answer: string): string {
  const payload = Buffer.from(JSON.stringify([
    sourceKeys, facts, exchangeDigest(question, answer), Math.floor(Date.now() / 1000) + CONTEXT_LIFETIME_SECONDS,
  ])).toString('base64url');
  return `mac1.${payload}.${signature(principal, payload)}`;
}

export function openAssistantContext(principal: AssistantContextPrincipal, token: string): ContextToken | undefined {
  if (token.length > ASSISTANT_CONTEXT_MAX_LENGTH) return;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'mac1' || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !digestPattern.test(parts[2])) return;
  if (!timingSafeEqual(Buffer.from(parts[2]), Buffer.from(signature(principal, parts[1])))) return;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 4) return;
    const [sourceKeys, facts, exchange, expiresAt] = parsed;
    if (!Array.isArray(sourceKeys) || sourceKeys.length > ASSISTANT_CONTEXT_MAX_SOURCES
      || sourceKeys.some(key => typeof key !== 'string' || !digestPattern.test(key))
      || typeof facts !== 'string' || !digestPattern.test(facts)
      || typeof exchange !== 'string' || !digestPattern.test(exchange)
      || !Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return;
    return { sourceKeys, facts, exchange, expiresAt };
  } catch { return; }
}

export function matchesAssistantExchange(context: ContextToken, question: string, answer: string): boolean {
  return context.exchange === exchangeDigest(question, answer);
}
