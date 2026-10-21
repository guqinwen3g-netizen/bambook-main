/** 与服务端 passwordPolicy 一致：至少 8 个字符，含字母和数字，不超过 72 字节。 */
export const PASSWORD_HINT = '至少 8 位，包含字母和数字';
export const passwordChecks = (value: string) => [
  { label: '8 位以上', ok: value.length >= 8 && new TextEncoder().encode(value).length <= 72 },
  { label: '含字母', ok: /[A-Za-z]/.test(value) },
  { label: '含数字', ok: /[0-9]/.test(value) },
];
export const passwordOk = (value: string) => passwordChecks(value).every(check => check.ok);
