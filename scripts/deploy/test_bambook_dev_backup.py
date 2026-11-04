"""Behaviour of bambook-dev-backup.py with a temp shared/ tree and fake sudo/pg_dump/tar failures."""
import datetime
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('bambook-dev-backup.py')
spec = importlib.util.spec_from_file_location('backup', SCRIPT)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

FAKE_SUDO = """#!/bin/bash
# Fake: sudo -n -u postgres pg_dump --format=custom --dbname=NAME
[[ "$1 $2 $3 $4" == "-n -u postgres pg_dump" ]] || exit 99
if [[ -n "$FAKE_DUMP_FAIL" ]]; then printf 'PGDMP-partial'; echo 'pg_dump: error: connection failed' >&2; exit 1; fi
printf 'PGDMP\\x01fake-dump %s' "$6"
"""

class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.shared, self.dest, self.bin = self.tmp / 'shared', self.tmp / 'backups', self.tmp / 'bin'
        self.bin.mkdir()
        for name in backup.REQUIRED + ('market', 'mist-mail-credentials', 'logs', 'private-backups'):
            (self.shared / name).mkdir(parents=True)
        (self.shared / 'mist-files/ws-1').mkdir()
        (self.shared / 'mist-files/ws-1/f-1').write_bytes(b'%PDF-mock')
        (self.shared / 'uploads/order.png').write_bytes(b'png')
        (self.shared / 'private-files/evidence.pdf').write_bytes(b'pdf')
        (self.shared / 'ai-subscriptions/platform-api-providers.json').write_text('{"cipher":"x"}')
        (self.shared / 'mist-mail-credentials/m.json').write_text('{"iv":"x","data":"y"}')
        (self.shared / 'market/market-quotes.json').write_text('{}')
        (self.shared / 'storage/rendered.pdf').write_bytes(b'r')
        (self.shared / 'data/automation-config.json').write_text('{}')
        (self.shared / 'output/export.xlsx').write_bytes(b'x')
        (self.shared / 'logs/app.log').write_text('log')
        (self.shared / 'private-backups/old-script').write_text('copy')
        self.env = self.tmp / 'backend.env'
        self.env.write_text(f'MIST_FILES_DIR={self.shared}/mist-files\nBAMBOOK_MARKET_DIR={self.shared}/market\nJWT_SECRET=secret-value\n')
        sudo = self.bin / 'sudo'
        sudo.write_text(FAKE_SUDO)
        sudo.chmod(0o755)
        self.extra_env = {}

    def run_backup(self):
        env = {'PATH': f'{self.bin}:/usr/bin:/bin', 'HOME': str(self.tmp), **self.extra_env}
        return subprocess.run([sys.executable, '-I', str(SCRIPT), f'--dest={self.dest}', f'--shared={self.shared}', f'--environment={self.env}', '--database=panda_hub_dev'],
                              env=env, capture_output=True, text=True, timeout=60)

    def sets(self):
        return sorted(p.name for p in self.dest.iterdir() if not p.name.startswith('.')) if self.dest.exists() else []

    def fake_tar(self, body):
        tar = self.bin / 'tar'
        tar.write_text('#!/bin/bash\n' + body)
        tar.chmod(0o755)

    def test_complete_set_covers_persistent_data_with_private_permissions(self):
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        [name] = self.sets()
        self.assertRegex(name, r'^bambook-dev-\d{8}-\d{6}$')
        folder = self.dest / name
        self.assertEqual(sorted(p.name for p in folder.iterdir()), ['database.dump', 'files.tar.gz', 'manifest.json'])
        self.assertEqual(stat.S_IMODE(self.dest.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(folder.stat().st_mode), 0o700)
        for item in folder.iterdir():
            self.assertEqual(stat.S_IMODE(item.stat().st_mode), 0o600, item.name)
        with tarfile.open(folder / 'files.tar.gz') as bundle:
            names = {n.lstrip('./') for n in bundle.getnames()}
        for path in ['mist-files/ws-1/f-1', 'uploads/order.png', 'private-files/evidence.pdf', 'ai-subscriptions/platform-api-providers.json',
                     'mist-mail-credentials/m.json', 'market/market-quotes.json', 'storage/rendered.pdf', 'data/automation-config.json',
                     'output/export.xlsx', 'cutout-queue']:
            self.assertIn(path, names)
        self.assertFalse(any(n.startswith(('logs', 'private-backups')) for n in names))
        manifest = json.loads((folder / 'manifest.json').read_text())
        self.assertEqual(manifest['artifacts']['database.dump']['sha256'], backup.sha256(folder / 'database.dump'))
        self.assertEqual(manifest['notIncluded'], [])
        everything = b''.join(p.read_bytes() for p in folder.iterdir())
        self.assertNotIn(b'secret-value', everything)

    def test_missing_expected_directory_fails_without_a_set(self):
        shutil.rmtree(self.shared / 'uploads')
        result = self.run_backup()
        self.assertEqual(result.returncode, 1)
        self.assertIn('uploads', result.stderr)
        self.assertEqual(self.sets(), [])

    def test_optional_directories_may_be_absent(self):
        shutil.rmtree(self.shared / 'market')
        shutil.rmtree(self.shared / 'mist-mail-credentials')
        self.assertEqual(self.run_backup().returncode, 0)

    def test_database_failure_is_nonzero_leaves_no_partial_set_and_keeps_old_backups(self):
        old = self.dest / 'bambook-dev-20200101-000000'
        old.mkdir(parents=True)
        (old / 'database.dump').write_bytes(b'PGDMP')
        self.extra_env = {'FAKE_DUMP_FAIL': '1'}
        result = self.run_backup()
        self.assertEqual(result.returncode, 1)
        self.assertIn('pg_dump failed', result.stderr)
        self.assertEqual(self.sets(), [old.name])
        self.assertEqual(list(self.dest.glob('.incomplete-*')), [])

    def test_tar_failure_is_nonzero_and_keeps_old_backups(self):
        old = self.dest / 'bambook-dev-20200101-000000'
        old.mkdir(parents=True)
        self.fake_tar('echo "tar: ./uploads/big: Cannot write: No space left on device" >&2\necho "tar: Error is not recoverable: exiting now" >&2\nexit 2\n')
        result = self.run_backup()
        self.assertEqual(result.returncode, 1)
        self.assertIn('No space left', result.stderr)
        self.assertEqual(self.sets(), [old.name])

    def test_exit_one_with_a_real_error_is_not_treated_as_file_change(self):
        self.fake_tar('echo "tar: ./uploads/a: file changed as we read it" >&2\necho "tar: ./uploads/b: Read error at byte 0: Input/output error" >&2\nexit 1\n')
        result = self.run_backup()
        self.assertEqual(result.returncode, 1)
        self.assertIn('Input/output error', result.stderr)
        self.assertEqual(self.sets(), [])

    def test_files_changing_during_archive_are_accepted_when_archive_verifies(self):
        real = shutil.which('tar', path='/usr/bin:/bin')
        self.fake_tar(f'"{real}" "$@" || exit 2\necho "tar: ./uploads/order.png: file changed as we read it" >&2\nexit 1\n')
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        [name] = self.sets()
        self.assertEqual(json.loads((self.dest / name / 'manifest.json').read_text())['filesChangedDuringArchive'], 1)

    def test_truncated_archive_fails_verification(self):
        self.fake_tar('for a in "$@"; do [[ "$a" == --file=* ]] && printf "\\x1f\\x8b\\x08\\x00broken" > "${a#--file=}"; done\nexit 0\n')
        result = self.run_backup()
        self.assertEqual(result.returncode, 1)
        self.assertIn('verification', result.stderr)
        self.assertEqual(self.sets(), [])

    def test_retention_removes_only_expired_completed_sets_after_success(self):
        now = datetime.datetime.now()
        self.dest.mkdir(mode=0o700)
        expired = self.dest / ('bambook-dev-' + (now - datetime.timedelta(days=8)).strftime('%Y%m%d-%H%M%S'))
        recent = self.dest / ('bambook-dev-' + (now - datetime.timedelta(days=6)).strftime('%Y%m%d-%H%M%S'))
        legacy_old, legacy_new = self.dest / 'panda_hub_dev-20200101.dump', self.dest / 'mist-files-20991231.tar.gz'
        unrelated = self.dest / 'operator-notes.txt'
        for d in (expired, recent):
            d.mkdir()
        for f in (legacy_old, legacy_new, unrelated):
            f.write_text('x')
        stamp = (now - datetime.timedelta(days=9)).timestamp()
        os.utime(legacy_old, (stamp, stamp))
        os.utime(unrelated, (stamp, stamp))
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        left = set(self.sets())
        self.assertNotIn(expired.name, left)
        self.assertNotIn(legacy_old.name, left)
        self.assertTrue({recent.name, legacy_new.name, unrelated.name} <= left)
        self.assertEqual(len([n for n in left if backup.SET_NAME.fullmatch(n)]), 2)

    def test_stale_incomplete_directory_is_discarded(self):
        (self.dest / '.incomplete-bambook-dev-20200101-000000').mkdir(parents=True)
        self.assertEqual(self.run_backup().returncode, 0)
        self.assertEqual(list(self.dest.glob('.incomplete-*')), [])

    def test_data_directory_configured_outside_shared_is_reported(self):
        self.env.write_text(self.env.read_text() + 'MIST_MAIL_CREDENTIAL_DIR=/var/lib/elsewhere\n')
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('MIST_MAIL_CREDENTIAL_DIR=/var/lib/elsewhere', result.stderr)

    def test_database_mismatch_with_backend_env_fails(self):
        self.env.write_text(self.env.read_text() + 'DATABASE_URL=postgresql://u:pw@localhost:5432/other_db?schema=public\n')
        result = self.run_backup()
        self.assertEqual(result.returncode, 1)
        self.assertIn('different database', result.stderr)
        self.assertNotIn('pw', result.stderr)
        self.assertEqual(self.sets(), [])
        self.env.write_text(self.env.read_text().replace('other_db', 'panda_hub_dev'))
        self.assertEqual(self.run_backup().returncode, 0)

    def test_bootstrap_installs_this_script_as_the_only_cron_entry(self):
        text = Path(__file__).with_name('bootstrap-dev-server.sh').read_text()
        cron = text.split("cat > /etc/cron.daily/bambook-dev-backup <<'CRON'\n", 1)[1].split('CRON\n', 1)[0]
        self.assertEqual(cron, '#!/bin/sh\nexec /usr/local/sbin/bambook-dev-backup\n')
        self.assertIn('bambook-dev-backup.py" /usr/local/sbin/bambook-dev-backup', text)
        self.assertNotIn('pg_dump', text)

if __name__ == '__main__':
    unittest.main()
