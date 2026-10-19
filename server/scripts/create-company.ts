/**
 * 在命令行创建一家公司（租户）并指定所有者。
 *
 * 平台后台界面完成前，用这个脚本开户；与 POST /api/platform/companies 走同一套初始化逻辑。
 *
 * 用法（在 server/ 下）：
 *   npx tsx scripts/create-company.ts --slug acme-textile --name 阿克米纺织 \
 *     --owner-email owner@acme.example --owner-name 张三 [--owner-password 初始密码]
 *
 * 不传 --owner-password 时生成随机口令并只打印一次。
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createCompany } from '../src/platform/companyProvisioning';
import { SYSTEM_ROLE_IDS } from '../src/_shared/rolePermissionMatrix';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const flag = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

async function main() {
  const slug = flag('slug').trim().toLowerCase();
  const name = flag('name').trim();
  const ownerEmail = flag('owner-email').trim().toLowerCase();
  const ownerName = flag('owner-name').trim();
  const ownerPassword = flag('owner-password');

  if (!slug || !name || !ownerEmail) {
    console.error('必填：--slug <公司标识> --name <公司名称> --owner-email <所有者邮箱>');
    process.exitCode = 1;
    return;
  }
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
    console.error('公司标识只能用小写字母、数字和连字符，2–50 位。');
    process.exitCode = 1;
    return;
  }
  if (await prisma.company.findUnique({ where: { slug }, select: { id: true } })) {
    console.error(`公司标识已被占用：${slug}`);
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.userAccount.findFirst({
    where: { email: { equals: ownerEmail, mode: 'insensitive' }, deletedAt: null },
    select: { id: true, status: true },
  });
  let generated: string | null = null;
  let ownerUserId = existing?.id ?? null;
  if (!ownerUserId) {
    const password = ownerPassword || randomBytes(9).toString('base64url');
    if (!ownerPassword) generated = password;
    const created = await prisma.userAccount.create({
      data: {
        id: `usr_${randomUUID()}`,
        displayName: ownerName || ownerEmail.split('@')[0],
        email: ownerEmail,
        passwordHash: await bcrypt.hash(password, 12),
        status: 'active',
      },
      select: { id: true },
    });
    ownerUserId = created.id;
  } else if (existing && existing.status !== 'active') {
    console.error(`所有者账号未启用（${existing.status}）：${ownerEmail}`);
    process.exitCode = 1;
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const created = await createCompany(tx, {
      slug,
      name,
      legalName: flag('legal-name') || null,
      englishName: flag('english-name') || null,
      ownerUserId,
      ownerJobTitle: flag('owner-title', '总经理'),
    });
    await tx.userRole.upsert({
      where: { id: `ur_${ownerUserId}_${SYSTEM_ROLE_IDS.SUPER_ADMIN}@${created.company.id}` },
      update: {},
      create: {
        id: `ur_${ownerUserId}_${SYSTEM_ROLE_IDS.SUPER_ADMIN}@${created.company.id}`,
        userId: ownerUserId!,
        roleId: `${SYSTEM_ROLE_IDS.SUPER_ADMIN}@${created.company.id}`,
        departmentId: `dept-company@${created.company.id}`,
      },
    });
    return created;
  });

  console.log('公司已创建：');
  console.log(`  ${result.company.name}（${result.company.slug}）`);
  console.log(`  公司 ID：${result.company.id}`);
  console.log(`  系统角色：${result.roles} 个`);
  console.log(`  所有者：${ownerEmail}${ownerUserId ? `（${ownerUserId}）` : ''}`);
  if (generated) console.log(`  初始密码（只显示一次）：${generated}`);
  console.log('\n所有者首次登录后会自动建立该公司的空白工作空间。');
}

main()
  .catch((error) => {
    console.error('创建公司失败：', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
