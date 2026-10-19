/**
 * 授予 / 撤销平台管理员身份（跨公司运营入口）。
 *
 * 平台管理员只用于开户与运维，不是公司内的老板角色；两者互不替代。
 *
 * 用法（在 server/ 下）：
 *   npx tsx scripts/grant-platform-admin.ts --email ops@example.com
 *   npx tsx scripts/grant-platform-admin.ts --email ops@example.com --revoke
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const flag = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name: string) => args.includes(`--${name}`);

async function main() {
  const email = flag('email').trim().toLowerCase();
  if (!email) {
    console.error('用法：npx tsx scripts/grant-platform-admin.ts --email <邮箱> [--revoke]');
    process.exitCode = 1;
    return;
  }
  const user = await prisma.userAccount.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
    select: { id: true, displayName: true, email: true, status: true, platformRole: true },
  });
  if (!user) {
    console.error(`没有找到账号：${email}`);
    process.exitCode = 1;
    return;
  }
  if (user.status !== 'active') {
    console.error(`账号未启用（${user.status}），请先启用：${email}`);
    process.exitCode = 1;
    return;
  }
  const nextRole = has('revoke') ? null : 'platform_admin';
  await prisma.userAccount.update({ where: { id: user.id }, data: { platformRole: nextRole } });
  console.log(`${has('revoke') ? '已撤销' : '已授予'}平台管理员：${user.displayName} <${user.email}>（${user.id}）`);
}

main()
  .catch((error) => {
    console.error('操作失败：', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
