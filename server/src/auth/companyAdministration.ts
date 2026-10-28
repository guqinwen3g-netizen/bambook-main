/** Company system administration is independent of the employee's business role. */
export const COMPANY_ADMINISTRATION_SCOPES = [
  'cockpit:read', 'dashboard:read', 'users:read', 'users:write', 'users:admin',
  'hr:read', 'hr:write', 'settings:system:read', 'settings:account',
] as const;

export function companyAdministratorIds(settings: unknown): string[] {
  const ids = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? (settings as Record<string, unknown>).administratorIds : undefined;
  return Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === 'string' && !!id.trim()))] : [];
}
export function isCompanyAdministrator(membership: any, userId: string): boolean {
  return membership?.userId === userId && membership?.status === 'active' && membership.company?.status === 'active'
    && companyAdministratorIds(membership.company.settings).includes(userId);
}
