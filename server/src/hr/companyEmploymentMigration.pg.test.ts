import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const url = process.env.MIST_PG_CONFLICT_TEST_URL;
const bindir = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' }).stdout?.trim();
const psql = bindir && path.join(bindir, 'psql');
describe.skipIf(!url || !psql || !existsSync(psql))('company employment migration', () => {
  it('preserves attributed records and rolls back ambiguous ownership before changing constraints', () => {
    const connection = new URL(url!);
    if (!['127.0.0.1', 'localhost'].includes(connection.hostname) || !/^\/bambook_(account|acceptance|test)/.test(connection.pathname)) throw Error('A dedicated local acceptance database is required');
    const schema = 'employment_migration_' + randomUUID().replaceAll('-', '');
    const a = randomUUID(), b = randomUUID();
    const env = { ...process.env, PGHOST: connection.hostname, PGPORT: connection.port || '5432', PGDATABASE: connection.pathname.slice(1), PGUSER: decodeURIComponent(connection.username), PGPASSWORD: decodeURIComponent(connection.password) };
    const run = (sql: string) => spawnSync(psql!, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { env, input: 'SET search_path TO "' + schema + '";\n' + sql, encoding: 'utf8' });
    const ok = (sql: string) => { const r = run(sql); if (r.status !== 0) throw Error(r.stderr.slice(-1500)); return r.stdout.trim(); };
    const migration = readFileSync(path.resolve(__dirname, '../..', 'prisma/migrations/20261026143000_company_employment_ownership/migration.sql'), 'utf8');
    try {
      ok(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
        CREATE TABLE "Company" (id UUID PRIMARY KEY);
        CREATE TABLE "CompanyMember" ("userId" TEXT, "companyId" UUID);
        CREATE TABLE "Department" (id TEXT PRIMARY KEY, "companyId" UUID);
        CREATE TABLE "JobPosition" (id TEXT PRIMARY KEY, "departmentId" TEXT);
        CREATE TABLE "EmployeeProfile" (id TEXT PRIMARY KEY, "userId" TEXT, "employeeNo" TEXT, "positionId" TEXT);
        CREATE UNIQUE INDEX "EmployeeProfile_userId_key" ON "EmployeeProfile"("userId");
        CREATE UNIQUE INDEX "EmployeeProfile_employeeNo_key" ON "EmployeeProfile"("employeeNo");
        CREATE TABLE "EmploymentEvent" (id TEXT PRIMARY KEY, "userId" TEXT, type TEXT, "effectiveDate" TEXT, "createdAt" TIMESTAMP DEFAULT now(), "fromDeptId" TEXT, "toDeptId" TEXT, "fromPositionId" TEXT, "toPositionId" TEXT);
        INSERT INTO "Company" VALUES ('${a}'), ('${b}');
        INSERT INTO "CompanyMember" VALUES ('one','${a}'),('shared','${a}'),('shared','${b}'),('ambiguous','${a}'),('ambiguous','${b}');
        INSERT INTO "Department" VALUES ('dept-b','${b}');
        INSERT INTO "JobPosition" VALUES ('position-b','dept-b');
        INSERT INTO "EmployeeProfile" VALUES ('p1','one','E1',NULL),('p2','shared','E2','position-b'),('p3','unscoped','E3',NULL),('p4','ambiguous','E4',NULL);
        INSERT INTO "EmploymentEvent" (id,"userId",type,"effectiveDate","toDeptId") VALUES ('e1','one','Onboard','2026-10-01',NULL),('e2','shared','Onboard','2026-10-01','dept-b');`);
      expect(run(migration).status).not.toBe(0);
      expect(ok(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = 'EmployeeProfile' AND column_name = 'companyId'`)).toBe('0');
      expect(ok('SELECT count(*) FROM "EmployeeProfile"')).toBe('4');
      ok('DELETE FROM "EmployeeProfile" WHERE id = \'p4\';');
      ok(migration);
      expect(ok('SELECT "companyId" FROM "EmployeeProfile" WHERE id = \'p1\'')).toBe(a);
      expect(ok('SELECT "companyId" FROM "EmployeeProfile" WHERE id = \'p2\'')).toBe(b);
      expect(ok('SELECT "companyId" IS NULL FROM "EmployeeProfile" WHERE id = \'p3\'')).toBe('t');
      expect(ok('SELECT count(*) FROM "EmploymentEvent" WHERE "companyId" IS NOT NULL')).toBe('2');
      ok(`INSERT INTO "EmployeeProfile" (id,"userId","employeeNo","companyId") VALUES ('p5','one','E1','${b}')`);
      expect(run(`INSERT INTO "EmployeeProfile" (id,"userId","employeeNo","companyId") VALUES ('p6','one','E9','${a}')`).status).not.toBe(0);
      expect(run('INSERT INTO "EmployeeProfile" (id,"userId","employeeNo") VALUES (\'p7\',\'unscoped\',\'E8\')').status).not.toBe(0);
    } finally { ok('DROP SCHEMA "' + schema + '" CASCADE;'); }
  });
});
