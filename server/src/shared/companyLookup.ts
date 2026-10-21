/** Company lookup uses a bounded prefix, never a suffix dictionary or a company directory. */
export const COMPANY_LOOKUP_POLICY = { minWeight: 4, maxWeight: 8, coverage: 0.5 } as const;

const normalized = (value: string) => value.trim().toLowerCase();
const weight = (value: string) => Array.from(value).reduce((sum, char) => sum + (/\p{Script=Han}/u.test(char) ? 2 : /[\p{L}\p{N}]/u.test(char) ? 1 : 0), 0);

export function validCompanyLookupQuery(value: string): boolean {
  const query = value.trim();
  // Pattern operators must not broaden the database prefix query.
  return query.length >= 2 && query.length <= 60 && !/[\\%_]/.test(query) && weight(query) >= 2;
}

export function matchingCompany<T extends { name: string }>(value: string, candidates: T[]): T[] {
  if (!validCompanyLookupQuery(value)) return [];
  const query = normalized(value);
  const names = candidates.filter(row => normalized(row.name).startsWith(query));
  const exact = names.filter(row => normalized(row.name) === query);
  if (exact.length) return exact.length === 1 ? exact : [];
  if (names.length !== 1) return [];
  const nameWeight = weight(normalized(names[0].name));
  const required = Math.min(nameWeight, Math.max(COMPANY_LOOKUP_POLICY.minWeight, Math.min(COMPANY_LOOKUP_POLICY.maxWeight, Math.ceil(nameWeight * COMPANY_LOOKUP_POLICY.coverage))));
  return weight(query) >= required ? names : [];
}
