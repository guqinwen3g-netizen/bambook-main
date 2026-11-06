"""Behaviour of bambook-dev-release.sh's schema gate, run against a temp root with fake external commands.

The test copies the script and only relocates its fixed root paths (/srv/bambook-dev, /etc/bambook-dev)
and the approval owner uid; the script itself has no switch to skip the gate.
"""
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('bambook-dev-release.sh')
OLD, NEW = 'a' * 40, 'b' * 40

FAKES = {
    # node: version probe, and the read-only migration history query (rows come from a fixture file).
    'node': """#!/bin/bash
if [[ "$1" == --version ]]; then echo v22.20.0; exit 0; fi
if [[ "$1" == -e ]]; then
  echo "node-e" >> "$FAKE_LOG"
  [[ -f "$FAKE_MIGRATIONS" ]] || exit 3
  cat "$FAKE_MIGRATIONS"; exit 0
fi
exit 9
""",
    'npm': '#!/bin/bash\necho "npm $*" >> "$FAKE_LOG"\n',
    'sudo': '#!/bin/bash\necho "sudo $*" >> "$FAKE_LOG"\n',
    'curl': '#!/bin/bash\necho \'{"status":"ok","database":"ok","mode":"pg"}\'\n',
    # GNU mv -T is not available on macOS; same atomic replace semantics.
    'mv': '#!/bin/bash\n[[ "$1" == -Tf ]] && exec /usr/bin/python3 -c \'import os,sys; os.replace(sys.argv[1], sys.argv[2])\' "$2" "$3"\nexec /bin/mv "$@"\n',
    'sleep': '#!/bin/bash\n',
}

def release_tree(path, migrations, schema='model A { id Int @id }\n'):
    (path / 'server/prisma/migrations').mkdir(parents=True)
    (path / 'server/prisma/schema.prisma').write_text(schema)
    (path / 'server/prisma/migrations/migration_lock.toml').write_text('provider = "postgresql"\n')
    for name, sql in migrations.items():
        (path / 'server/prisma/migrations' / name).mkdir()
        (path / 'server/prisma/migrations' / name / 'migration.sql').write_text(sql)
    (path / 'server/package-lock.json').write_text('{}')
    (path / '.nvmrc').write_text('22\n')
    (path / '.delivery.json').write_text('{}')

class ReleaseSchemaGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(os.path.realpath(tempfile.mkdtemp()))
        self.addCleanup(shutil.rmtree, self.tmp)
        self.root, self.etc, self.bin = self.tmp / 'srv', self.tmp / 'etc', self.tmp / 'bin'
        for d in (self.root / 'releases', self.root / 'shared', self.etc, self.bin):
            d.mkdir(parents=True)
        (self.etc / 'backend.env').write_text('DATABASE_URL=postgresql://u:p@localhost/x\nJWT_SECRET=j\nSYSTEM_CONFIG_ENCRYPTION_KEY=k\nBAMBOOK_HOST=127.0.0.1\nPDML_SYNC_DISABLED=true\n')
        for name, body in FAKES.items():
            (self.bin / name).write_text(body)
            (self.bin / name).chmod(0o755)
        script = SCRIPT.read_text().replace('/srv/bambook-dev', str(self.root)).replace('/etc/bambook-dev', str(self.etc))
        self.assertIn('approval_owner=0\n', script)
        self.script = self.tmp / 'release.sh'
        self.script.write_text(script.replace('approval_owner=0\n', f'approval_owner={os.getuid()}\n'))
        self.log, self.rows = self.tmp / 'calls.log', self.tmp / 'rows.json'
        self.base = {'20260101000000_init': 'CREATE TABLE a();\n'}
        self.old, self.new = self.root / 'releases' / OLD, self.root / 'releases' / NEW
        release_tree(self.old, self.base)
        (self.root / 'current').symlink_to(self.old)

    def run_release(self):
        env = {'PATH': f'{self.bin}:/usr/bin:/bin:/usr/sbin:/sbin', 'FAKE_LOG': str(self.log), 'FAKE_MIGRATIONS': str(self.rows), 'HOME': str(self.tmp)}
        result = subprocess.run(['/bin/bash', str(self.script), str(self.new)], env=env, capture_output=True, text=True, timeout=60)
        return result.returncode, result.stderr

    def calls(self):
        return self.log.read_text() if self.log.exists() else ''

    def current(self):
        return os.readlink(self.root / 'current')

    def approve(self, rollback, schema=None, release=NEW, frm=OLD):
        if schema is None:
            # Read the fingerprint from the refusal message, as an operator would.
            code, err = self.run_release()
            self.assertEqual(code, 3, err)
            schema = err.split('schema ')[-1].split(',')[0]
        folder = self.etc / 'schema-approvals'
        folder.mkdir(mode=0o755, exist_ok=True)
        path = folder / f'{release}.json'
        path.write_text(json.dumps({'release': release, 'schema': schema, 'from': frm, 'rollback': rollback}))
        path.chmod(0o644)
        self.log.unlink(missing_ok=True)
        return path

    def applied(self, names, rows=None):
        tree = self.new / 'server/prisma/migrations'
        import hashlib
        data = [{'migration_name': n, 'checksum': hashlib.sha256((tree / n / 'migration.sql').read_bytes()).hexdigest(), 'finished': True, 'active': True} for n in names]
        self.rows.write_text(json.dumps(data + (rows or [])))

    def assert_refused_before_switch(self, code, err):
        self.assertEqual(code, 3, err)
        self.assertIn('Activation refused', err)
        self.assertEqual(self.current(), str(self.old))
        self.assertFalse((self.root / '.activation.json').exists())
        self.assertNotIn('systemctl', self.calls())
        self.assertNotIn('password', err)

    def test_unchanged_schema_activates_without_reading_the_database(self):
        release_tree(self.new, self.base)
        code, err = self.run_release()
        self.assertEqual(code, 0, err)
        self.assertEqual(self.current(), str(self.new))
        self.assertNotIn('node-e', self.calls())
        self.assertIn('prisma generate', self.calls())

    def test_added_modified_and_removed_files_are_refused_before_build_and_switch(self):
        cases = {
            'added': ({**self.base, '20261101000000_add': 'ALTER TABLE a ADD b int;\n'}, None),
            'modified': ({'20260101000000_init': 'CREATE TABLE a(b int);\n'}, None),
            'removed': ({}, None),
            'schema': (self.base, 'model A { id Int @id\n b Int }\n'),
        }
        for label, (migrations, schema) in cases.items():
            with self.subTest(label):
                shutil.rmtree(self.new, ignore_errors=True)
                self.log.unlink(missing_ok=True)
                release_tree(self.new, migrations, **({'schema': schema} if schema else {}))
                code, err = self.run_release()
                self.assert_refused_before_switch(code, err)
                self.assertNotIn('npm', self.calls())
                self.assertIn('schema-approvals', err)

    def test_extra_file_under_prisma_is_detected(self):
        release_tree(self.new, self.base)
        (self.new / 'server/prisma/sql').mkdir()
        (self.new / 'server/prisma/sql/manual.sql').write_text('DROP TABLE a;\n')
        self.assert_refused_before_switch(*self.run_release())

    def test_first_activation_without_active_release_is_refused(self):
        (self.root / 'current').unlink()
        release_tree(self.new, self.base)
        code, err = self.run_release()
        self.assertEqual(code, 3, err)
        self.assertIn('no active release', err)
        self.assertFalse((self.root / 'current').exists())

    def test_approved_change_requires_every_new_migration_applied_with_matching_checksum(self):
        release_tree(self.new, {**self.base, '20261101000000_add': 'ALTER TABLE a ADD b int;\n'})
        self.approve('previous')
        # Not applied yet.
        self.rows.write_text(json.dumps([{'migration_name': '20260101000000_init', 'checksum': 'x', 'finished': True, 'active': True}]))
        code, err = self.run_release()
        self.assert_refused_before_switch(code, err)
        self.assertIn('20261101000000_add', err)
        # Applied but with different SQL than this release.
        self.rows.write_text(json.dumps([{'migration_name': '20261101000000_add', 'checksum': 'other', 'finished': True, 'active': True}]))
        self.assert_refused_before_switch(*self.run_release())
        # A failed migration anywhere blocks activation.
        self.applied(['20261101000000_add'], [{'migration_name': 'x', 'checksum': 'y', 'finished': False, 'active': True}])
        code, err = self.run_release()
        self.assert_refused_before_switch(code, err)
        self.assertIn('unfinished', err)
        # History unreadable (e.g. database down): refuse, do not guess.
        self.rows.unlink()
        code, err = self.run_release()
        self.assert_refused_before_switch(code, err)
        self.assertIn('could not be read', err)

    def test_approved_and_applied_change_activates(self):
        release_tree(self.new, {**self.base, '20261101000000_add': 'ALTER TABLE a ADD b int;\n'})
        self.approve('previous')
        self.applied(['20261101000000_add'])
        code, err = self.run_release()
        self.assertEqual(code, 0, err)
        self.assertEqual(self.current(), str(self.new))
        self.assertIn('node-e', self.calls())

    def test_rollback_stop_never_restores_old_code_after_failed_health(self):
        release_tree(self.new, {**self.base, '20261101000000_add': 'ALTER TABLE a ADD b int;\n'})
        self.approve('stop')
        self.applied(['20261101000000_add'])
        (self.bin / 'curl').write_text('#!/bin/bash\nexit 7\n')
        code, err = self.run_release()
        self.assertEqual(code, 1, err)
        self.assertFalse((self.root / 'current').exists())
        lines = self.calls().splitlines()
        self.assertEqual([l for l in lines if 'systemctl' in l][-2:], ['sudo -n /usr/bin/systemctl stop bambook-dev.service', 'sudo -n /usr/bin/systemctl stop bambook-dev-mist.service'])
        self.assertFalse((self.root / '.activation.json').exists())

    def test_rollback_previous_restores_old_code_after_failed_health(self):
        release_tree(self.new, {**self.base, '20261101000000_add': 'ALTER TABLE a ADD b int;\n'})
        self.approve('previous')
        self.applied(['20261101000000_add'])
        (self.bin / 'curl').write_text('#!/bin/bash\nexit 7\n')
        code, _ = self.run_release()
        self.assertEqual(code, 1)
        self.assertEqual(self.current(), str(self.old))

    def test_approval_must_match_release_schema_and_active_release(self):
        release_tree(self.new, {**self.base, '20261101000000_add': 'ALTER TABLE a ADD b int;\n'})
        self.applied(['20261101000000_add'])
        for label, kwargs in {'schema': {'schema': '0' * 64}, 'from': {'frm': 'c' * 40}}.items():
            with self.subTest(label):
                self.approve('previous')
                path = self.etc / 'schema-approvals' / f'{NEW}.json'
                data = json.loads(path.read_text())
                data.update({'schema': kwargs.get('schema', data['schema']), 'from': kwargs.get('frm', data['from'])})
                path.write_text(json.dumps(data))
                code, err = self.run_release()
                self.assert_refused_before_switch(code, err)
                self.assertIn('does not match', err)
        with self.subTest('rollback value'):
            self.approve('maybe')
            code, err = self.run_release()
            self.assert_refused_before_switch(code, err)

    def test_first_activation_approval_allows_only_stop(self):
        (self.root / 'current').unlink()
        release_tree(self.new, self.base)
        code, err = self.run_release()
        schema = err.split('schema ')[-1].split(',')[0]
        self.approve('previous', schema=schema, frm='')
        code, err = self.run_release()
        self.assertEqual(code, 3, err)
        self.assertIn('first activation allows only "stop"', err)
        self.approve('stop', schema=schema, frm='')
        # With nothing to compare against, every migration of the release must be recorded as applied.
        self.applied([])
        code, err = self.run_release()
        self.assertEqual(code, 3, err)
        self.assertIn('20260101000000_init', err)
        self.applied(['20260101000000_init'])
        code, err = self.run_release()
        self.assertEqual(code, 0, err)
        self.assertEqual(self.current(), str(self.new))

    def test_group_or_world_writable_approval_is_rejected(self):
        release_tree(self.new, {**self.base, '20261101000000_add': 'ALTER TABLE a ADD b int;\n'})
        self.applied(['20261101000000_add'])
        path = self.approve('previous')
        path.chmod(0o666)
        code, err = self.run_release()
        self.assert_refused_before_switch(code, err)
        self.assertIn('writable by others', err)

if __name__ == '__main__':
    unittest.main()
