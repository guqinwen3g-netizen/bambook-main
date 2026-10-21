import { describe, expect, it } from 'vitest';
import { buildAccountAccessEmail, buildApprovalApprovedEmail, buildVerificationEmail } from '../email';
import { accountEmailHtml } from '../accountEmail';

describe('branded account emails', () => {
  it('escapes recipient-controlled company names and preserves full access links in both formats', () => {
    const url = 'https://bambook-dev.sylway.cloud/?view=account-access&kind=invite&email=user%2Bqa%40example.com#token';
    const message = buildAccountAccessEmail({ to: 'user@example.com', label: '<img src=x onerror=alert(1)>', kind: 'invite', setup: true, url });
    expect(message.text).toContain(url);
    expect(message.html).toContain('href="https://bambook-dev.sylway.cloud/?view=account-access&amp;kind=invite&amp;email=user%2Bqa%40example.com#token"');
    expect(message.html).not.toContain('<img src=x');
    expect(message.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(message.html).toContain('48 小时');
  });
  it('keeps the recovery and existing-account instructions distinct', () => {
    const common = { to: 'user@example.com', label: 'Sylway Cloud 平台', url: 'https://example.com/' };
    const recovery = buildAccountAccessEmail({ ...common, kind: 'recovery', setup: true });
    expect(recovery.html).toContain('30 分钟'); expect(recovery.text).toContain('原有设备会话将失效'); expect(recovery.text).not.toContain('两步验证');
    const existing = buildAccountAccessEmail({ ...common, kind: 'invite', setup: false });
    expect(existing.html).toContain('现有账号登录'); expect(existing.html).not.toContain('设置密码并加入'); expect(existing.text).not.toContain('小时');
  });
  it('uses the same brand for codes and approval, without legacy names or leaked codes in subjects', () => {
    const verification = buildVerificationEmail('123456');
    const approval = buildApprovalApprovedEmail({ displayName: '<script>x</script>', roles: ['<admin>'], department: '面料 & 成衣' });
    for (const message of [verification, approval]) {
      expect(message.html).toContain('Bambook'); expect(message.html).toContain('面料与成衣');
      expect(message.html).not.toMatch(/NEURAL|Enterprise Agent OS/);
    }
    expect(verification.subject).not.toContain('123456'); expect(verification.html).toContain('123456');
    expect(approval.html).toContain('&lt;script&gt;'); expect(approval.html).toContain('面料 &amp; 成衣');
  });
  it('rejects unsafe CTA schemes and URL credentials', () => {
    for (const url of ['javascript:alert(1)', 'https://user:pass@example.com/', 'http://example.com/']) {
      expect(() => accountEmailHtml({ title: 't', preheader: 'p', paragraphs: [], note: 'n', action: { label: 'open', url } })).toThrow();
    }
  });
});
