import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('direct', Path(__file__).with_name('direct-dev.py'))
direct = importlib.util.module_from_spec(spec)
spec.loader.exec_module(direct)

class DirectDeliveryTests(unittest.TestCase):
    def test_github_workflows_have_no_automatic_triggers(self):
        for name in ['mist.yml', 'bambook-dev-deploy.yml']:
            content = (direct.ROOT / '.github/workflows' / name).read_text()
            trigger = content.split('\non:', 1)[1].split('\npermissions:', 1)[0]
            self.assertIn('workflow_dispatch:', trigger)
            for event in ['push:', 'pull_request:', 'workflow_run:']:
                self.assertNotIn(event, trigger)

    def test_failed_verification_prevents_packaging_and_upload(self):
        with mock.patch.object(direct.sys, 'argv', ['direct-dev.py', 'deploy']), mock.patch.object(direct, 'clean_revision', return_value=('a'*40, 'b'*40, 'v22.0.0')), mock.patch.object(direct, 'load_config', return_value={'host':'124.222.56.61','user':'bambook-deploy','key':'key','knownHosts':'hosts'}), mock.patch.object(direct, 'already_live', return_value=False), mock.patch.object(direct.subprocess, 'run') as command, mock.patch.object(direct, 'verify', side_effect=ValueError('failed')), mock.patch.object(direct, 'package') as package:
            with self.assertRaises(ValueError): direct.main()
            package.assert_not_called()
            self.assertEqual(command.call_count, 1)
            self.assertEqual(command.call_args.args[0][-1], 'check')

    def test_retry_does_not_reinstall_current_healthy_revision(self):
        with mock.patch.object(direct.sys, 'argv', ['direct-dev.py', 'deploy']), mock.patch.object(direct, 'clean_revision', return_value=('a'*40, 'b'*40, 'v22.0.0')), mock.patch.object(direct, 'load_config', return_value={'host':'124.222.56.61','user':'bambook-deploy','key':'key','knownHosts':'hosts'}), mock.patch.object(direct, 'already_live', return_value=True), mock.patch.object(direct.subprocess, 'run') as command, mock.patch.object(direct, 'verify') as verify, mock.patch.object(direct, 'package') as package:
            direct.main()
            verify.assert_not_called()
            package.assert_not_called()
            self.assertEqual(command.call_count, 1)

    def test_runtime_bundle_excludes_private_files_and_test_sources(self):
        for path in ['server/.env', 'server/private/session.key', 'server/node_modules/a.js', 'server/src/__tests__/a.ts', 'server/src/foo.test.ts', 'server/uploads/customer.pdf', 'server/logs/trace.log', '.git/config', 'private-files/photo.png']:
            with self.subTest(path=path):
                self.assertFalse(direct.runtime_source(path))
        for path in ['.nvmrc', 'server/package-lock.json', 'server/src/index.ts', 'server/prisma/schema.prisma', 'scripts/deploy/bambook-dev-release.sh']:
            self.assertTrue(direct.runtime_source(path))

    def test_archive_is_byte_stable_and_contains_no_owner_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            first, second = Path(folder) / 'a.gz', Path(folder) / 'b.gz'
            direct.archive_files({'web/index.html': b'hello', 'server/package.json': b'{}'}, first)
            direct.archive_files({'server/package.json': b'{}', 'web/index.html': b'hello'}, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with tarfile.open(first) as bundle:
                for entry in bundle.getmembers():
                    self.assertEqual((entry.uid, entry.gid, entry.mtime), (0, 0, 0))
                    self.assertFalse(entry.issym() or entry.islnk())

    def test_archive_rejects_path_escape(self):
        with tempfile.TemporaryDirectory() as folder:
            for path in ['/etc/passwd', 'server/../../outside']:
                with self.assertRaises(ValueError):
                    direct.archive_files({path: b'no'}, Path(folder) / 'bundle.gz')

    def test_production_target_and_unprotected_keys_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); key = root / 'key'; known = root / 'hosts'; config = root / 'config.json'
            key.write_text('private'); known.write_text('pinned host'); key.chmod(0o600)
            data = {'host': 'jiangsupanda.com', 'user': 'bambook-deploy', 'key': str(key), 'knownHosts': str(known)}
            config.write_text(json.dumps(data))
            with self.assertRaises(ValueError): direct.load_config(config)
            data['host'] = '124.222.56.61'; config.write_text(json.dumps(data)); key.chmod(0o644)
            with self.assertRaises(ValueError): direct.load_config(config)
            key.chmod(0o600)
            command = direct.ssh_command(direct.load_config(config), 'check')
            self.assertIn('StrictHostKeyChecking=yes', command)
            self.assertIn('IdentitiesOnly=yes', command)
            self.assertIn('ClearAllForwardings=yes', command)
            self.assertEqual(command[-1], 'check')

    def test_dirty_checkout_cannot_start_delivery(self):
        with mock.patch.object(direct, 'git', return_value=' M source.ts'):
            with self.assertRaisesRegex(ValueError, 'Commit or isolate'):
                direct.clean_revision()

    def test_public_confirmation_requires_exact_revision_and_clean_build(self):
        sha = 'a' * 40
        for value in [{'commit': '', 'localChanges': 0}, {'commit': 'b' * 7, 'localChanges': 0}, {'commit': 'a' * 7, 'localChanges': 1}]:
            with mock.patch.object(direct.urllib.request, 'urlopen', side_effect=lambda *a, **k: io.BytesIO(json.dumps(value).encode())), mock.patch.object(direct.time, 'sleep'):
                with self.assertRaises(ValueError): direct.public_version(sha)
        value = {'commit': 'a' * 7, 'localChanges': 0}
        with mock.patch.object(direct.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(value).encode())):
            self.assertEqual(direct.public_version(sha), value)

if __name__ == '__main__':
    unittest.main()
