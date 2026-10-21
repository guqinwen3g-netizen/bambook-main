/** 全站唯一密码规则（2026-10-21 用户定案）：至少 8 个字符，含字母和数字，不超过 72 字节（bcrypt 上限）。 */
export const PASSWORD_RULE_TEXT = '密码须包含字母和数字，至少 8 个字符且不超过 72 字节。';

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return PASSWORD_RULE_TEXT;
  return null;
}
