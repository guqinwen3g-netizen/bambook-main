import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { HrError, type EmploymentEventType } from './hrService';

type Tx = Prisma.TransactionClient;
type ProfileInput = {
  userId: string; positionId?: string | null; hireDate?: string; regularDate?: string | null;
  contractType?: string | null; contractEnd?: string | null; phone?: string | null;
  emergencyContact?: string | null; workLocation?: string | null; notes?: string | null;
  employmentStatus?: string;
};
type EventInput = {
  userId: string; type: EmploymentEventType; effectiveDate: string; fromDeptId?: string | null;
  toDeptId?: string | null; fromPositionId?: string | null; toPositionId?: string | null; reason?: string | null;
};
type EventSnapshot = EventInput & { fromStatus?: string | null; toStatus?: string | null };
const ALLOWED: Record<EmploymentEventType, string[]> = {
  Onboard: ['Resigned', 'Terminated'], Regularize: ['Probation'], Transfer: ['Probation', 'Regular'],
  Promote: ['Probation', 'Regular'], Suspend: ['Probation', 'Regular'], Resume: ['Suspended'],
  Resign: ['Probation', 'Regular', 'Suspended'], Terminate: ['Probation', 'Regular', 'Suspended'],
};
const TARGET: Partial<Record<EmploymentEventType, string>> = {
  Onboard: 'Probation', Regularize: 'Regular', Suspend: 'Suspended', Resume: 'Regular',
  Resign: 'Resigned', Terminate: 'Terminated',
};
function date(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new HrError('VALIDATION_FAILED', label + '无效。');
  }
}
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const PROFILE_INCLUDE = { user: { include: { roles: { include: { role: true, department: true } } } }, position: true } as const;

export function createCompanyEmploymentService(prisma: PrismaClient, companyId: string, actorId: string) {
  const membership = (userId: string) => ({ companyId_userId: { companyId, userId } });
  const profileWhere = (userId: string) => ({ companyId_userId: { companyId, userId } });
  const view = (row: any) => {
    const department = row.user?.roles?.find((r: any) => r.role?.companyId === companyId)?.department;
    return { ...row, displayName: row.user?.displayName ?? null, email: row.user?.email ?? null,
      departmentId: department?.id ?? null, department: department?.name ?? null,
      position: row.position?.title ?? null, user: undefined };
  };
  async function lock(tx: Tx) {
    await tx.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${companyId}::uuid FOR UPDATE`;
    const company = await tx.company.findUnique({ where: { id: companyId } });
    if (!company || company.status !== 'active') throw new HrError('COMPANY_UNAVAILABLE', '公司未启用。', 409);
    return company;
  }
  async function member(tx: Tx, userId: string) {
    const row = await tx.companyMember.findUnique({
      where: membership(userId), include: { user: { include: { roles: { where: { role: { companyId } }, include: { role: true, department: true } } } } },
    });
    if (!row || !['active', 'suspended'].includes(row.status) || row.user.deletedAt !== null) {
      throw new HrError('USER_NOT_FOUND', '员工不存在。', 404);
    }
    return row;
  }
  async function assertCanManage(tx: Tx, userId: string) {
    const target = await member(tx, userId);
    const owner = (roles: typeof target.user.roles) => roles.some(r => r.roleId === 'role-super-admin@' + companyId);
    if (owner(target.user.roles) && !owner((await member(tx, actorId)).user.roles)) {
      throw new HrError('FORBIDDEN', '总经理账号只能由总经理维护。', 403);
    }
    return target;
  }
  async function audit(tx: Tx, action: string, userId: string, detail: Record<string, unknown>) {
    await tx.auditLog.create({ data: { id: randomUUID(), actorId, action, targetType: 'EmployeeProfile', targetId: userId, detail: { ...detail, companyId } as Prisma.InputJsonValue } });
  }
  async function event(tx: Tx, input: EventSnapshot) {
    return tx.employmentEvent.create({ data: { id: randomUUID(), companyId, userId: input.userId,
      type: input.type, fromStatus: input.fromStatus ?? null, toStatus: input.toStatus ?? null,
      effectiveDate: input.effectiveDate, fromDeptId: input.fromDeptId ?? null,
      toDeptId: input.toDeptId ?? null, fromPositionId: input.fromPositionId ?? null,
      toPositionId: input.toPositionId ?? null, reason: input.reason?.trim() || null, operatorId: actorId } });
  }
  async function availableSeat(tx: Tx, company: { seatLimit: number | null }, userId: string) {
    const current = await tx.companyMember.findUniqueOrThrow({ where: membership(userId) });
    if (current.status === 'active') return;
    if (company.seatLimit !== null && await tx.companyMember.count({ where: { companyId, status: 'active', user: { status: 'active', deletedAt: null } } }) >= company.seatLimit) {
      throw new HrError('SEAT_LIMIT_REACHED', '公司席位已用完。', 409);
    }
  }
  async function selectedPosition(tx: Tx, positionId: string) {
    if (typeof positionId !== 'string' || !positionId) throw new HrError('INVALID_POSITION', '请选择有效岗位。', 400);
    const position = await tx.jobPosition.findFirst({ where: { id: positionId, deletedAt: null, status: 'active', department: { companyId, status: 'active' } } });
    if (!position) throw new HrError('INVALID_POSITION', '岗位不存在或已停用。', 400);
    return position;
  }
  function departmentOf(user: { roles: Array<{ departmentId: string | null }> }) {
    return user.roles.find(r => r.departmentId)?.departmentId ?? null;
  }
  return {
    async listProfiles(query: { status?: string; deptId?: string; q?: string } = {}) {
      const rows = await prisma.employeeProfile.findMany({ where: { companyId, deletedAt: null, ...(query.status ? { employmentStatus: query.status } : {}) }, include: PROFILE_INCLUDE, orderBy: { employeeNo: 'asc' } });
      return rows.map(view).filter(row => (!query.deptId || row.departmentId === query.deptId)
        && (!query.q || [row.displayName, row.email, row.employeeNo].some(v => v?.toLowerCase().includes(query.q!.toLowerCase()))));
    },
    async getProfile(userId: string) {
      const row = await prisma.employeeProfile.findUnique({ where: profileWhere(userId), include: PROFILE_INCLUDE });
      return row && !row.deletedAt ? view(row) : null;
    },
    async upsertProfile(input: ProfileInput) {
      if (typeof input.userId !== 'string' || !input.userId) throw new HrError('VALIDATION_FAILED', '请选择员工。');
      const result = await prisma.$transaction(async tx => {
        await lock(tx);
        const person = await assertCanManage(tx, input.userId);
        const existing = await tx.employeeProfile.findUnique({ where: profileWhere(input.userId) });
        const creating = !existing || existing.deletedAt !== null;
        if (person.user.status !== 'active' || creating && person.status !== 'active') throw new HrError('ACCOUNT_UNAVAILABLE', '请先启用员工账号。', 409);
        if (input.employmentStatus && input.employmentStatus !== existing?.employmentStatus) throw new HrError('STATUS_VIA_EVENT_ONLY', '请通过在职变动调整状态。', 400);
        if (input.hireDate !== undefined) date(input.hireDate, '入职日期');
        if (creating && !input.hireDate) throw new HrError('VALIDATION_FAILED', '请填写入职日期。');
        if (input.hireDate && input.hireDate > today()) throw new HrError('VALIDATION_FAILED', '入职日期不能晚于今天。');
        if (input.regularDate) date(input.regularDate, '转正日期');
        if (input.regularDate && input.regularDate > today()) throw new HrError('VALIDATION_FAILED', '转正日期不能晚于今天。');
        if (input.contractEnd) date(input.contractEnd, '合同到期');
        if (input.regularDate && input.regularDate < (input.hireDate || existing!.hireDate)) throw new HrError('VALIDATION_FAILED', '转正日期不能早于入职日期。');
        if (!creating && input.regularDate !== undefined && input.regularDate !== existing!.regularDate) throw new HrError('STATUS_VIA_EVENT_ONLY', '请通过转正办理在职变动。');
        if (input.contractType && !['FixedTerm', 'OpenEnded', 'PartTime', 'Intern'].includes(input.contractType)) throw new HrError('VALIDATION_FAILED', '合同类型无效。');
        if (input.positionId) {
          const position = await selectedPosition(tx, input.positionId);
          if (position.departmentId !== departmentOf(person.user)) throw new HrError('POSITION_DEPARTMENT_MISMATCH', '岗位不属于任职部门，请先办理调岗。');
          await tx.companyMember.update({ where: membership(input.userId), data: { jobTitle: position.title } });
        }
        if (!creating && existing!.positionId && input.positionId !== undefined && input.positionId !== existing!.positionId) throw new HrError('STATUS_VIA_EVENT_ONLY', '请通过调岗调整岗位。');
        const fields = ['positionId', 'hireDate', 'regularDate', 'contractType', 'contractEnd', 'phone', 'emergencyContact', 'workLocation', 'notes'] as const;
        const patch = Object.fromEntries(fields.filter(k => input[k] !== undefined).map(k => [k, input[k] || null]));
        let saved;
        if (creating) {
          const existingNumbers = await tx.employeeProfile.findMany({ where: { companyId }, select: { employeeNo: true } });
          const used = new Set(existingNumbers.map(row => row.employeeNo));
          let next = existingNumbers.length + 1;
          while (used.has('E' + String(next).padStart(4, '0'))) next++;
          const employeeNo = existing?.employeeNo ?? 'E' + String(next).padStart(4, '0');
          const data = { ...patch, companyId, userId: input.userId, employeeNo, hireDate: input.hireDate!, employmentStatus: input.regularDate ? 'Regular' : 'Probation', deletedAt: null };
          saved = existing ? await tx.employeeProfile.update({ where: { id: existing.id }, data }) : await tx.employeeProfile.create({ data: { ...data, id: randomUUID() } });
          await event(tx, { userId: input.userId, type: 'Onboard', effectiveDate: input.hireDate!, toDeptId: departmentOf(person.user), toPositionId: input.positionId, toStatus: 'Probation' });
          if (input.regularDate) await event(tx, { userId: input.userId, type: 'Regularize', effectiveDate: input.regularDate, toDeptId: departmentOf(person.user), toPositionId: input.positionId, fromStatus: 'Probation', toStatus: 'Regular' });
        } else saved = await tx.employeeProfile.update({ where: { id: existing!.id }, data: patch });
        await audit(tx, creating ? 'onboard_employee' : 'upsert_employee', input.userId, { positionId: saved.positionId, employmentStatus: saved.employmentStatus, fields: Object.keys(patch), fromHireDate: existing?.hireDate ?? null, toHireDate: saved.hireDate });
        return { profile: saved, created: creating };
      });
      return result;
    },
    async deleteProfile(userId: string) {
      await prisma.$transaction(async tx => {
        await lock(tx); await assertCanManage(tx, userId);
        const profile = await tx.employeeProfile.findUnique({ where: profileWhere(userId) });
        if (!profile) throw new HrError('PROFILE_NOT_FOUND', '员工档案不存在。', 404);
        if (!['Resigned', 'Terminated'].includes(profile.employmentStatus)) throw new HrError('INVALID_TRANSITION', '请先办理离职。', 409);
        await tx.employeeProfile.update({ where: { id: profile.id }, data: { deletedAt: BigInt(Date.now()) } });
        await audit(tx, 'archive_employee', userId, {});
      });
      return { deleted: true };
    },
    async listEmploymentEvents(query: { userId?: string; type?: string; limit?: number } = {}) {
      return prisma.employmentEvent.findMany({ where: { companyId, ...(query.userId ? { userId: query.userId } : {}), ...(query.type ? { type: query.type } : {}) },
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }], take: Math.min(query.limit ?? 200, 500) });
    },
    async recordEmploymentEvent(_actorId: string, input: EventInput) {
      if (typeof input.userId !== 'string' || !input.userId) throw new HrError('VALIDATION_FAILED', '请选择员工。');
      if (input.reason !== undefined && input.reason !== null && typeof input.reason !== 'string') throw new HrError('VALIDATION_FAILED', '请填写有效原因。');
      date(input.effectiveDate, '生效日期');
      if (input.effectiveDate > today()) throw new HrError('VALIDATION_FAILED', '生效日期不能晚于今天。');
      if (!ALLOWED[input.type]) throw new HrError('VALIDATION_FAILED', '变动类型无效。');
      return prisma.$transaction(async tx => {
        const company = await lock(tx), person = await assertCanManage(tx, input.userId);
        const profile = await tx.employeeProfile.findUnique({ where: profileWhere(input.userId) });
        if (!profile || profile.deletedAt !== null) throw new HrError('PROFILE_NOT_FOUND', '请先建立员工档案。', 404);
        if (!ALLOWED[input.type].includes(profile.employmentStatus)) throw new HrError('INVALID_TRANSITION', '当前状态不能办理该变动。', 409);
        const previous = await tx.employmentEvent.findFirst({ where: { companyId, userId: input.userId }, orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }] });
        if (input.effectiveDate < profile.hireDate || previous && input.effectiveDate < previous.effectiveDate) throw new HrError('INVALID_TRANSITION', '生效日期不能早于已登记的变动。', 409);
        const currentDepartment = departmentOf(person.user);
        if (input.fromDeptId !== undefined && input.fromDeptId !== currentDepartment || input.fromPositionId !== undefined && input.fromPositionId !== profile.positionId) throw new HrError('CONFLICT', '任职信息已更新，请重新打开。', 409);
        let nextDepartment = currentDepartment, nextPosition = profile.positionId, leftTeams = 0;
        if (input.type === 'Transfer' || input.type === 'Promote') {
          if (!input.toPositionId) throw new HrError('INVALID_POSITION', '请选择新岗位。');
          const position = await selectedPosition(tx, input.toPositionId);
          if (input.toDeptId && input.toDeptId !== position.departmentId) throw new HrError('POSITION_DEPARTMENT_MISMATCH', '岗位与调入部门不一致。');
          nextDepartment = position.departmentId; nextPosition = position.id;
          await tx.userRole.updateMany({ where: { userId: input.userId, role: { companyId } }, data: { departmentId: nextDepartment } });
          await tx.companyMember.update({ where: membership(input.userId), data: { jobTitle: position.title } });
        }
        const ending = ['Resign', 'Terminate'].includes(input.type), suspending = input.type === 'Suspend';
        const restoring = input.type === 'Onboard' || input.type === 'Resume';
        if ((ending || suspending) && input.userId === actorId) throw new HrError('SELF_DISABLE', '不能停用自己的访问。', 400);
        if (restoring) {
          if (person.user.status !== 'active') throw new HrError('ACCOUNT_UNAVAILABLE', '账号已停用，无法恢复公司访问。', 409);
          await availableSeat(tx, company, input.userId);
          await tx.companyMember.update({ where: membership(input.userId), data: { status: 'active' } });
        } else if (ending || suspending) await tx.companyMember.update({ where: membership(input.userId), data: { status: 'suspended' } });
        if (ending || nextDepartment !== currentDepartment) {
          leftTeams = (await tx.teamMember.updateMany({ where: { userId: input.userId, leftAt: null, team: { department: { companyId }, ...(ending ? {} : { departmentId: { not: nextDepartment! } }) } }, data: { leftAt: new Date() } })).count;
          await tx.team.updateMany({ where: { leaderId: input.userId, department: { companyId }, ...(ending ? {} : { departmentId: { not: nextDepartment! } }) }, data: { leaderId: null } });
        }
        let status = TARGET[input.type] ?? profile.employmentStatus;
        if (input.type === 'Resume') {
          const suspension = await tx.employmentEvent.findFirst({ where: { companyId, userId: input.userId, type: 'Suspend' }, orderBy: { createdAt: 'desc' } });
          if (!suspension?.fromStatus || !['Probation', 'Regular'].includes(suspension.fromStatus)) throw new HrError('INVALID_TRANSITION', '无法确认停职前状态，请核对在职记录。', 409);
          status = suspension.fromStatus;
        }
        const patch = { employmentStatus: status, positionId: nextPosition,
          ...(input.type === 'Regularize' ? { regularDate: input.effectiveDate } : {}),
          ...(input.type === 'Onboard' ? { hireDate: input.effectiveDate, regularDate: null } : {}) };
        await tx.employeeProfile.update({ where: { id: profile.id }, data: patch });
        const savedEvent = await event(tx, { ...input, fromDeptId: currentDepartment, fromPositionId: profile.positionId, toDeptId: nextDepartment, toPositionId: nextPosition, fromStatus: profile.employmentStatus, toStatus: patch.employmentStatus });
        await audit(tx, 'employment_' + input.type.toLowerCase(), input.userId, { eventId: savedEvent.id, fromStatus: profile.employmentStatus, toStatus: patch.employmentStatus });
        return { event: savedEvent, accountDisabled: ending || suspending, accountReenabled: restoring, leftTeams };
      });
    },
  };
}
