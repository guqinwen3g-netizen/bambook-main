import { MistApiError } from './errors';

export type ResponseLocale = 'zh-CN' | 'en-US';

/** Request-scoped display preference. Never persist this on the company or user. */
export function responseLocale(value: unknown): ResponseLocale {
  if (value === undefined) return 'zh-CN';
  if (value === 'zh-CN' || value === 'en-US') return value;
  throw new MistApiError('INVALID_INPUT', '语言选项无效', 400);
}

/** A header keeps new clients compatible with servers that do not yet understand locale. */
export function withResponseLocale(body: unknown, header: string | undefined): unknown {
  if (header === undefined) return body;
  const locale = responseLocale(header);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  return { ...body, locale };
}

/** Repeat the selected language at the turn boundary; some providers follow the input language otherwise. */
export function responseUserMessage(message: string, locale: ResponseLocale): string {
  const language = locale === 'en-US' ? 'English (en-US)' : 'Simplified Chinese (zh-CN)';
  return `Interface language: ${language}. Reply in ${language} unless the user explicitly requests another output language. Keep the answer direct and concise.\n\nUser request:\n${message}`;
}

export function responseLanguagePrompt(locale: ResponseLocale): string {
  return `Default response language: ${locale === 'en-US' ? 'English' : 'Simplified Chinese'}. Follow an explicit user request for another output language. This preference applies to this request, regardless of the language of records or earlier replies. Answer directly and concisely. Omit introductions, repeated explanations, implementation notes and boilerplate disclaimers. Include only constraints or uncertainty needed for the user's decision. Preserve business names, identifiers, currencies and quoted source text. For structured output, keep JSON keys, enum values, IDs and numeric formats unchanged; apply the language preference only to human-readable text.`;
}
