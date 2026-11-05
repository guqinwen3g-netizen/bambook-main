"""Offline behaviour of bambook-dev-monitor.py: fake HTTP / systemctl / disk, temp config, state and backups.
No public network, no real Bark, nothing installed. Real-socket tests bind only to 127.0.0.1."""
import contextlib
import datetime
import hashlib
import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import stat
import tempfile
import threading
import time
import unittest
import urllib.error

HERE = Path(__file__).parent
SCRIPT = HERE / 'bambook-dev-monitor.py'
spec = importlib.util.spec_from_file_location('monitor', SCRIPT)
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)

DEVICE_A, DEVICE_B = 'DeviceKeyAlpha123', 'DeviceKeyBravo456'
BARK = 'https://bark.example.test'
PUBLIC = 'https://portal.example.test/api/health?token=probe-secret-77'
API, MIST = monitor.API_URL, monitor.MIST_URL
OK_API = json.dumps({'status': 'ok', 'database': 'ok', 'build': 'x'}).encode()
OK_MIST = json.dumps({'status': 'ok', 'service': 'mist-workspace', 'database': 'ok'}).encode()
NOW = 1_800_000_000.0

class FakeRuntime:
    def __init__(self):
        self.clock = NOW
        self.routes = {API: (200, OK_API), MIST: (200, OK_MIST), PUBLIC: (200, OK_API)}
        self.units = {unit: 'active' for _n, unit in monitor.SERVICES}
        self.disk = 40.0
        self.bark = {}            # device key -> (status, body) or exception
        self.sent = []
        self.hashed = []

    def now(self):
        return self.clock

    def euid(self):
        return os.geteuid()

    def http(self, url, timeout, data=None, headers=None):
        assert timeout <= 30
        if data is not None:
            assert url == BARK + '/push', url
            payload = json.loads(data)
            outcome = self.bark.get(payload['device_key'], (200, b'{"code":200,"message":"success"}'))
            if isinstance(outcome, BaseException):
                raise outcome
            self.sent.append(payload)
            return outcome
        outcome = self.routes[url]
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    def unit_state(self, unit, timeout):
        return self.units[unit]

    def disk_percent(self, path):
        if isinstance(self.disk, BaseException):
            raise self.disk
        return self.disk

    def sha256(self, path):
        self.hashed.append(Path(path).name)
        return monitor.Runtime().sha256(path)

class MonitorCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.etc, self.state, self.backups = self.tmp / 'etc', self.tmp / 'state', self.tmp / 'backups'
        self.etc.mkdir(mode=0o700)
        self.backups.mkdir()
        self.config = self.etc / 'config.json'
        self.write_config({'publicHealth': [{'name': 'web', 'url': PUBLIC}], 'remindIntervalMinutes': 60,
                           'bark': {'server': BARK, 'deviceKeys': [DEVICE_A, DEVICE_B]}})
        self.rt = FakeRuntime()
        self.make_set(hours_ago=2)

    def write_config(self, data, mode=0o600):
        self.config.write_text(json.dumps(data))
        os.chmod(self.config, mode)

    def make_set(self, hours_ago, name=None, dump=b'PGDMP\x01dump', files=b'\x1f\x8bfiles', manifest=True):
        stamp = datetime.datetime.fromtimestamp(self.rt.clock - hours_ago * 3600 if hasattr(self, 'rt') else NOW - hours_ago * 3600)
        folder = self.backups / (name or 'bambook-dev-' + stamp.strftime('%Y%m%d-%H%M%S'))
        folder.mkdir()
        artifacts = {}
        for artifact, content in (('database.dump', dump), ('files.tar.gz', files)):
            if content is not None:
                (folder / artifact).write_bytes(content)
                artifacts[artifact] = {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
        if manifest:
            (folder / 'manifest.json').write_text(json.dumps({'version': 1, 'createdAt': stamp.isoformat(timespec='seconds'),
                                                              'artifacts': artifacts}))
        return folder

    def run_monitor(self, *extra):
        out, err = io.StringIO(), io.StringIO()
        argv = ['--config', str(self.config), '--state-dir', str(self.state), '--backup-dir', str(self.backups),
                '--disk-path', str(self.tmp), *extra]
        code = monitor.main(argv, runtime=self.rt, out=out, err=err)
        return code, out.getvalue(), err.getvalue()

    def saved(self):
        return json.loads((self.state / 'state.json').read_text())

    def bodies(self):
        return [m['body'] for m in self.rt.sent]

class CheckTests(MonitorCase):
    def test_all_ok_writes_private_state_and_sends_nothing(self):
        code, out, err = self.run_monitor()
        self.assertEqual((code, err), (0, ''), out)
        self.assertEqual(self.rt.sent, [])
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.state / 'state.json').stat().st_mode), 0o600)
        checks = self.saved()['checks']
        self.assertEqual(set(checks), {'api', 'mist', 'public-web', 'disk', 'service-main', 'service-mist', 'backup'})
        self.assertTrue(all(c['status'] == 'ok' for c in checks.values()))
        self.assertEqual(list(self.state.glob('.state-*')), [])

    def test_each_failure_is_detected_with_its_reason(self):
        cases = [
            ('api', 'local-mode', lambda r: r.routes.__setitem__(API, (200, b'{"status":"ok","mode":"local","storage":"local-file"}'))),
            ('api', 'database', lambda r: r.routes.__setitem__(API, (503, b'{"status":"error","database":"unavailable"}'))),
            ('api', 'database', lambda r: r.routes.__setitem__(API, (200, b'{"status":"ok"}'))),
            ('api', 'not-ok', lambda r: r.routes.__setitem__(API, (200, b'{"status":"degraded","database":"ok"}'))),
            ('api', 'bad-response', lambda r: r.routes.__setitem__(API, (200, b'<html>proxy</html>'))),
            ('api', 'http-status', lambda r: r.routes.__setitem__(API, (502, b'bad gateway'))),
            ('mist', 'timeout', lambda r: r.routes.__setitem__(MIST, socket.timeout('timed out'))),
            ('mist', 'timeout', lambda r: r.routes.__setitem__(MIST, urllib.error.URLError(socket.timeout('timed out')))),
            ('mist', 'unreachable', lambda r: r.routes.__setitem__(MIST, urllib.error.URLError(ConnectionRefusedError(111, 'refused')))),
            ('public-web', 'tls', lambda r: r.routes.__setitem__(PUBLIC, urllib.error.URLError(ssl.SSLError('cert verify failed')))),
            ('public-web', 'redirect', lambda r: r.routes.__setitem__(PUBLIC, (302, b''))),
            ('disk', 'disk-full', lambda r: setattr(r, 'disk', 85.0)),
            ('service-main', 'inactive', lambda r: r.units.__setitem__('bambook-dev.service', 'failed')),
            ('service-mist', 'timeout', lambda r: r.units.__setitem__('bambook-dev-mist.service', 'timeout')),
        ]
        for check, reason, breaks in cases:
            with self.subTest(check=check, reason=reason):
                self.rt = FakeRuntime()
                shutil.rmtree(self.state, ignore_errors=True)
                breaks(self.rt)
                code, out, err = self.run_monitor()
                self.assertEqual(code, 1, err)
                entry = self.saved()['checks'][check]
                self.assertEqual((entry['status'], entry['code']), ('fail', reason))
                self.assertEqual(len(self.rt.sent), 2)  # one message, two devices
                self.assertIn(monitor.REASONS[reason], self.rt.sent[0]['body'])
                failing = [n for n, c in self.saved()['checks'].items() if c['status'] == 'fail']
                self.assertEqual(failing, [check])

    def test_probe_crash_is_reported_as_monitor_error_without_message_text(self):
        self.rt.disk = RuntimeError('/dev/vda1 secret-host-detail')
        code, out, err = self.run_monitor()
        self.assertEqual(code, 3)
        self.assertNotIn('secret-host-detail', out + err + (self.state / 'state.json').read_text())
        self.assertIn('RuntimeError', out)
        self.assertEqual(self.saved()['checks']['disk']['code'], 'probe-error')
        self.assertIn('检查异常', self.bodies()[0])
        self.assertTrue(any(h['event'] == 'probe-error' for h in self.saved()['history']))

class AlertTests(MonitorCase):
    def test_failure_is_deduplicated_reminded_and_recovered_once(self):
        self.rt.routes[API] = (503, b'{"status":"error","database":"unavailable"}')
        self.assertEqual(self.run_monitor()[0], 1)
        self.assertEqual(len(self.bodies()), 2)
        self.assertIn('主 API：故障（数据库不可用）', self.bodies()[0])
        for minute in range(1, 59):
            self.rt.clock = NOW + minute * 60
            self.assertEqual(self.run_monitor()[0], 1)
        self.assertEqual(len(self.rt.sent), 2, 'no repeat inside the reminder interval')
        self.rt.clock = NOW + 60 * 60
        self.run_monitor()
        self.assertEqual(len(self.rt.sent), 4)
        self.assertIn('仍故障', self.bodies()[-1])
        self.rt.routes[API] = (200, OK_API)
        self.rt.clock += 60
        self.assertEqual(self.run_monitor()[0], 0)
        self.assertEqual(len(self.rt.sent), 6)
        self.assertIn('主 API：已恢复', self.bodies()[-1])
        self.assertEqual(self.rt.sent[-1]['title'], 'Bambook 恢复')
        self.rt.clock += 60
        self.run_monitor()
        self.assertEqual(len(self.rt.sent), 6, 'recovery is sent once')
        events = [(h['event'], h.get('to')) for h in self.saved()['history']]
        self.assertIn(('status', 'fail'), events)
        self.assertIn(('status', 'ok'), events)
        self.assertEqual(sum(1 for e in events if e[0] == 'notified'), 3)

    def test_changed_reason_opens_a_new_episode(self):
        self.rt.routes[MIST] = socket.timeout('t')
        self.run_monitor()
        self.rt.routes[MIST] = (503, b'{"status":"error","database":"unavailable"}')
        self.rt.clock += 60
        self.run_monitor()
        self.assertEqual(len(self.rt.sent), 4)
        self.assertIn('Mist API：故障（数据库不可用）', self.bodies()[-1])

    def test_send_failure_is_not_counted_and_is_retried(self):
        self.rt.units['bambook-dev-mist.service'] = 'failed'
        self.rt.bark[DEVICE_B] = urllib.error.URLError(socket.timeout('t'))
        code, out, err = self.run_monitor()
        self.assertEqual(code, 2)
        self.assertIn('NOT delivered', err)
        self.assertNotIn('notified', out)
        self.assertFalse(self.saved()['checks']['service-mist']['alertDelivered'])
        self.assertEqual(self.saved()['history'][-1]['event'], 'notify-failed')
        del self.rt.bark[DEVICE_B]
        self.rt.clock += 60
        code, out, _err = self.run_monitor()
        self.assertEqual(code, 1)
        self.assertIn('notified', out)
        self.assertTrue(self.saved()['checks']['service-mist']['alertDelivered'])
        self.rt.clock += 60
        before = len(self.rt.sent)
        self.run_monitor()
        self.assertEqual(len(self.rt.sent), before)

    def test_rejected_or_garbled_bark_response_is_not_delivery(self):
        for response in ((200, b'{"code":400,"message":"failed"}'), (500, b'error'), (200, b'not json')):
            with self.subTest(response=response):
                shutil.rmtree(self.state, ignore_errors=True)
                self.rt.disk = 99.0
                self.rt.bark[DEVICE_A] = response
                self.assertEqual(self.run_monitor()[0], 2)
                self.assertFalse(self.saved()['checks']['disk']['alertDelivered'])

    def test_missing_config_keeps_failure_exit_and_never_claims_notification(self):
        self.config.unlink()
        self.rt.routes[API] = urllib.error.URLError(ConnectionRefusedError(111, 'refused'))
        code, out, err = self.run_monitor()
        self.assertEqual(code, 2)
        self.assertIn('config rejected: monitor config is missing', err)
        self.assertIn('notification NOT sent', err)
        self.assertNotIn('notified', out)
        self.assertEqual(self.rt.sent, [])
        self.assertEqual(self.saved()['history'][-1]['event'], 'notify-unavailable')
        self.write_config({'bark': {'server': BARK, 'deviceKeys': [DEVICE_A]}})
        self.rt.clock += 60
        self.assertEqual(self.run_monitor()[0], 1)
        self.assertEqual(len(self.rt.sent), 1)

    def test_missing_config_with_healthy_host_still_exits_nonzero(self):
        self.config.unlink()
        self.assertEqual(self.run_monitor()[0], 2)

    def test_secrets_and_urls_stay_out_of_output_messages_and_state(self):
        self.rt.routes[PUBLIC] = urllib.error.URLError(ssl.SSLError('portal.example.test probe-secret-77'))
        self.rt.routes[API] = (503, b'{"status":"error","database":"unavailable","detail":"password authentication failed"}')
        self.rt.bark[DEVICE_B] = urllib.error.URLError(OSError('connect to bark.example.test DeviceKeyBravo456'))
        code, out, err = self.run_monitor()
        self.rt.clock += 60
        del self.rt.bark[DEVICE_B]
        out2, err2 = self.run_monitor()[1:]
        logs = out + err + out2 + err2 + (self.state / 'state.json').read_text()
        for secret in (DEVICE_A, DEVICE_B, 'probe-secret-77', 'portal.example.test', 'bark.example.test', 'password', '127.0.0.1'):
            self.assertNotIn(secret, logs)
        for message in self.rt.sent:
            for secret in ('probe-secret-77', 'portal.example.test', 'http', 'password', '127.0.0.1', '8081'):
                self.assertNotIn(secret, message['title'] + message['body'])
        self.assertIn('公网 web：故障（加密连接异常）', self.bodies()[0])

class ConfigTests(MonitorCase):
    def test_permissions_and_content_are_enforced(self):
        good = {'bark': {'server': BARK, 'deviceKeys': [DEVICE_A]}}
        bad = [
            (good, 0o640, 'group or others'),
            (good, 0o604, 'group or others'),
            ({'bark': {'server': 'http://bark.example.test', 'deviceKeys': [DEVICE_A]}}, 0o600, 'https'),
            ({'bark': {'server': BARK + '/?k=1', 'deviceKeys': [DEVICE_A]}}, 0o600, 'https'),
            ({'bark': {'server': 'https://u:p@bark.example.test', 'deviceKeys': [DEVICE_A]}}, 0o600, 'https'),
            ({'bark': {'server': BARK, 'deviceKeys': ['bad key!']}}, 0o600, 'deviceKeys'),
            ({'publicHealth': [{'name': 'web', 'url': 'http://portal.example.test/api/health'}]}, 0o600, 'https'),
            ({'diskThresholdPercent': 120}, 0o600, 'between'),
            ({'bark': {'server': BARK, 'deviceKeys': ['REPLACEWITHDEVICEKEY']}}, 0o600, 'placeholders'),
            ({'barkKey': DEVICE_A}, 0o600, 'unknown config keys'),
        ]
        for data, mode, message in bad:
            with self.subTest(message=message, mode=oct(mode)):
                self.write_config(data, mode)
                code, out, err = self.run_monitor('--check-config')
                self.assertEqual(code, 2)
                self.assertIn(message, err)
                self.assertNotIn(DEVICE_A, out + err)
        self.write_config(good)
        code, out, _err = self.run_monitor('--check-config')
        self.assertEqual(code, 0)
        self.assertIn('1 Bark device(s)', out)
        self.assertEqual(self.rt.sent, [])
        self.assertFalse(self.state.exists(), '--check-config writes nothing')

    def test_config_in_writable_directory_or_symlink_is_rejected(self):
        os.chmod(self.etc, 0o777)
        self.assertIn('config directory', self.run_monitor('--check-config')[2])
        os.chmod(self.etc, 0o700)
        real = self.etc / 'real.json'
        self.config.rename(real)
        self.config.symlink_to(real)
        self.assertIn('not a regular readable file', self.run_monitor('--check-config')[2])

    def test_config_without_device_keys_is_not_ready(self):
        self.write_config({'remindIntervalMinutes': 60})
        self.assertEqual(self.run_monitor('--check-config')[0], 2)

    def test_dry_run_and_send_test(self):
        self.rt.disk = 95.0
        code, out, _err = self.run_monitor('--dry-run')
        self.assertEqual(code, 1)
        self.assertIn('FAIL disk [disk-full]', out)
        self.assertEqual(self.rt.sent, [])
        self.assertFalse(self.state.exists())
        code, out, _err = self.run_monitor('--send-test')
        self.assertEqual(code, 0)
        self.assertEqual([m['body'] for m in self.rt.sent], ['测试通知', '测试通知'])
        self.rt.bark[DEVICE_A] = (500, b'')
        self.assertEqual(self.run_monitor('--send-test')[0], 2)
        self.config.unlink()
        code, _out, err = self.run_monitor('--send-test')
        self.assertEqual(code, 2)
        self.assertIn('not sent', err)

    def test_local_probe_urls_must_be_loopback(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            monitor.parse_args(['--api-url', 'https://portal.example.test/api/health'])

class BackupTests(MonitorCase):
    def check(self):
        return monitor.check_backup(self.rt, self.backups, 36, 30, {}, self.rt.clock)

    def test_complete_recent_set_passes_and_hashes_are_cached(self):
        self.assertEqual(self.run_monitor()[0], 0)
        self.assertEqual(sorted(self.rt.hashed), ['database.dump', 'files.tar.gz'])
        for _ in range(3):
            self.rt.clock += 60
            self.run_monitor()
        self.assertEqual(len(self.rt.hashed), 2, 'unchanged artifacts are not re-hashed every minute')
        folder = next(self.backups.iterdir())
        (folder / 'files.tar.gz').write_bytes(b'\x1f\x8bFILES')  # same size, new content
        os.utime(folder / 'files.tar.gz', ns=(1, 1))
        self.rt.clock += 60
        self.assertEqual(self.run_monitor()[0], 1)
        self.assertEqual(self.saved()['checks']['backup']['code'], 'backup-corrupt')

    def test_stale_and_broken_sets_fail(self):
        shutil.rmtree(self.backups)
        self.assertEqual(self.check().code, 'backup-missing')
        self.backups.mkdir()
        self.assertEqual(self.check().code, 'backup-missing')
        old = self.make_set(hours_ago=40)
        self.assertEqual(self.check().code, 'backup-stale')
        shutil.rmtree(old)
        cases = {
            'no manifest': (dict(manifest=False), 'backup-incomplete'),
            'no files archive': (dict(files=None), 'backup-incomplete'),
            'bad dump header': (dict(dump=b'XXXXX-not-a-dump'), 'backup-corrupt'),
        }
        for label, (kwargs, reason) in cases.items():
            with self.subTest(label):
                folder = self.make_set(hours_ago=1, **kwargs)
                self.assertEqual(self.check().code, reason)
                shutil.rmtree(folder)
        folder = self.make_set(hours_ago=1)
        (folder / 'database.dump').write_bytes(b'PGDMP\x01dumpX')
        self.assertEqual(self.check().code, 'backup-incomplete', 'size differs from manifest')
        shutil.rmtree(folder)
        folder = self.make_set(hours_ago=1)
        (folder / 'database.dump').write_bytes(b'PGDMP\x01dumX')
        self.assertEqual(self.check().code, 'backup-corrupt', 'hash differs from manifest')
        shutil.rmtree(folder)
        folder = self.make_set(hours_ago=1)
        (folder / 'manifest.json').write_text('{"version": 1, "artifacts": ')
        self.assertEqual(self.check().code, 'backup-incomplete')

    def test_newest_broken_set_is_not_masked_by_an_older_good_one(self):
        self.make_set(hours_ago=1, files=None)
        self.assertEqual(self.check().code, 'backup-incomplete')

    def test_unfinished_incomplete_directory_is_ignored(self):
        (self.backups / '.incomplete-bambook-dev-20991231-000000').mkdir()
        self.assertTrue(self.check().ok)

    def test_legacy_pairs(self):
        shutil.rmtree(self.backups)
        self.backups.mkdir()
        def legacy(hours_ago, dump=b'PGDMP\x01x', files=b'\x1f\x8bx', archive='bambook-files'):
            when = self.rt.clock - hours_ago * 3600
            date = datetime.datetime.fromtimestamp(when).strftime('%Y%m%d')
            paths = []
            for name, content in ((f'panda_hub_dev-{date}.dump', dump), (f'{archive}-{date}.tar.gz', files)):
                if content is not None:
                    (self.backups / name).write_bytes(content)
                    os.utime(self.backups / name, (when, when))
                    paths.append(self.backups / name)
            return paths
        legacy(30)
        self.assertTrue(self.check().ok, self.check())
        for path in self.backups.iterdir():
            path.unlink()
        legacy(30, files=None)
        self.assertEqual(self.check().code, 'backup-incomplete')
        for path in self.backups.iterdir():
            path.unlink()
        legacy(30, files=b'')
        self.assertEqual(self.check().code, 'backup-incomplete', 'empty archive is no backup')
        for path in self.backups.iterdir():
            path.unlink()
        legacy(30, dump=b'--\n-- PostgreSQL database dump\n', archive='mist-files')
        self.assertTrue(self.check().ok)
        for path in self.backups.iterdir():
            path.unlink()
        legacy(50)
        self.assertEqual(self.check().code, 'backup-stale')
        # A pair still being written (inside the grace period) does not count yet; the previous one decides.
        legacy(0.1, files=None)
        self.assertEqual(self.check().code, 'backup-stale')
        self.rt.clock += 3600
        self.assertEqual(self.check().code, 'backup-incomplete')

class StateTests(MonitorCase):
    def test_corrupt_state_fails_closed_once_then_recovers(self):
        self.rt.disk = 97.0
        for garbage in ('{not json', json.dumps({'version': 1, 'checks': {'disk': {'status': 'fail', 'alertDelivered': True}},
                                                 'history': [], 'pendingEvents': [], 'backupVerified': {}}), '[]'):
            with self.subTest(garbage=garbage[:20]):
                shutil.rmtree(self.state, ignore_errors=True)
                self.state.mkdir(mode=0o700)
                (self.state / 'state.json').write_text(garbage)
                sent = len(self.rt.sent)
                code, _out, err = self.run_monitor()
                self.assertEqual(code, 3)
                self.assertIn('moved aside', err)
                self.assertEqual(len(list(self.state.glob('state.json.corrupt-*'))), 1)
                body = self.rt.sent[-1]['body']
                self.assertEqual(len(self.rt.sent), sent + 2, 'current failure is alerted again after a reset')
                self.assertIn('监控状态已重置', body)
                self.assertIn('根分区：故障（空间不足）', body)
                self.rt.clock += 60
                self.assertEqual(self.run_monitor()[0], 1, 'next run is normal, not stuck')
                self.assertEqual(len(self.rt.sent), sent + 2)

    def test_reset_notice_waits_for_bark_like_any_alert(self):
        self.state.mkdir(mode=0o700)
        (self.state / 'state.json').write_text('garbage')
        self.config.unlink()
        self.assertEqual(self.run_monitor()[0], 3)
        self.assertEqual(self.saved()['pendingEvents'], ['state-reset'])
        self.write_config({'bark': {'server': BARK, 'deviceKeys': [DEVICE_A]}})
        self.rt.clock += 60
        self.assertEqual(self.run_monitor()[0], 0)
        self.assertEqual(self.bodies(), ['监控状态已重置'])
        self.assertEqual(self.saved()['pendingEvents'], [])

    def test_overlapping_run_is_skipped(self):
        self.assertEqual(self.run_monitor()[0], 0)
        before = (self.state / 'state.json').read_bytes()
        lock = monitor.acquire_lock(self.state)
        self.addCleanup(os.close, lock)
        self.rt.disk = 99.0
        code, out, _err = self.run_monitor()
        self.assertEqual(code, 0)
        self.assertIn('skipped', out)
        self.assertEqual((self.state / 'state.json').read_bytes(), before)
        self.assertEqual(self.rt.sent, [])

    def test_history_is_bounded_and_repeats_are_collapsed(self):
        self.rt.disk = 99.0
        self.rt.bark[DEVICE_A] = (500, b'')
        for minute in range(5):
            self.rt.clock = NOW + minute * 60
            self.run_monitor()
        failed = [h for h in self.saved()['history'] if h['event'] == 'notify-failed']
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]['repeat'], 5)
        state = monitor.fresh_state()
        for i in range(monitor.HISTORY_LIMIT + 50):
            monitor.record(state, str(i), 'probe-error', check=str(i))
        self.assertEqual(len(state['history']), monitor.HISTORY_LIMIT)

    def test_unexpected_error_prints_only_its_type(self):
        class Boom(FakeRuntime):
            def euid(self):
                raise OSError(13, 'denied /etc/bambook-dev/backend.env DeviceKeyAlpha123')
        self.rt = Boom()
        code, out, err = self.run_monitor()
        self.assertEqual(code, 3)
        self.assertEqual(err.strip(), 'monitor error: PermissionError')

class RuntimeTests(unittest.TestCase):
    """The real Runtime against loopback servers and a fake systemctl; no public network."""
    def serve(self, handler):
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f'http://127.0.0.1:{server.server_address[1]}'

    def test_http_reads_json_and_does_not_follow_redirects(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == '/moved':
                    self.send_response(302)
                    self.send_header('Location', '/api/health')
                    self.end_headers()
                    return
                body = OK_API if self.path == '/api/health' else b'{"status":"error","database":"unavailable"}'
                self.send_response(200 if self.path == '/api/health' else 503)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *args):
                pass
        base = self.serve(Handler)
        runtime = monitor.Runtime()
        self.assertTrue(monitor.probe_health(runtime, base + '/api/health', 3).ok)
        self.assertEqual(monitor.probe_health(runtime, base + '/moved', 3).code, 'redirect')
        self.assertEqual(monitor.probe_health(runtime, base + '/down', 3).code, 'database')

    def test_silent_server_times_out(self):
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen(1)
        self.addCleanup(listener.close)
        started = time.monotonic()
        result = monitor.probe_health(monitor.Runtime(), f'http://127.0.0.1:{listener.getsockname()[1]}/api/health', 1)
        self.assertEqual(result.code, 'timeout')
        self.assertLess(time.monotonic() - started, 5)

    def test_closed_port_is_unreachable(self):
        probe = socket.socket()
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
        probe.close()
        self.assertEqual(monitor.probe_health(monitor.Runtime(), f'http://127.0.0.1:{port}/api/health', 2).code, 'unreachable')

    def test_systemctl_and_disk(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp)
        fake = tmp / 'systemctl'
        fake.write_text('#!/bin/sh\n[ "$1" = is-active ] || exit 9\ncase "$2" in bambook-dev.service) echo active;; '
                        'slow.service) sleep 5;; *) echo failed; exit 3;; esac\n')
        fake.chmod(0o755)
        runtime = monitor.Runtime(str(fake))
        self.assertEqual(monitor.check_unit(runtime, 'bambook-dev.service', 3), monitor.Result(True, None, 'active'))
        self.assertEqual(monitor.check_unit(runtime, 'bambook-dev-mist.service', 3).code, 'inactive')
        self.assertEqual(monitor.check_unit(runtime, 'slow.service', 1).code, 'timeout')
        self.assertTrue(0 <= runtime.disk_percent(str(tmp)) <= 100)

class SourceTests(unittest.TestCase):
    def test_monitor_never_reads_backend_env_and_holds_no_keys(self):
        code = SCRIPT.read_text().split('"""', 2)[2]
        self.assertNotIn('backend.env', code)
        self.assertNotIn('EnvironmentFile', code)
        self.assertNotRegex(code, r'api\.day\.app/[A-Za-z0-9]{8,}')

    def test_installer_scope(self):
        text = (HERE / 'install-bambook-dev-monitor.sh').read_text()
        commands = '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('#'))
        for forbidden in ('backend.env', 'EnvironmentFile', 'restart', 'bootstrap', 'pg_', 'rm -', '/var/backups/bambook-dev/',
                          '--send-test', 'curl'):
            self.assertNotIn(forbidden, commands)
        self.assertIn('if [[ -f "$etc/config.json" ]] && "$bin" --check-config; then', commands)
        enable = commands.index('enable --now bambook-dev-monitor.timer')
        self.assertLess(commands.index('"$bin" --check-config'), enable)
        self.assertNotIn('> "$etc/config.json"', commands, 'existing config is never overwritten')
        self.assertIn('ReadWritePaths=/var/lib/bambook-dev-monitor', commands)

if __name__ == '__main__':
    unittest.main()
