#!/usr/bin/python3
"""Minute-level health monitor for the Bambook development host, with Bark alerts.

Installed (only after explicit authorisation) by install-bambook-dev-monitor.sh as
/usr/local/sbin/bambook-dev-monitor and run as root by bambook-dev-monitor.timer. Linux/GNU only at runtime:
/usr/bin/python3 (3.8+, standard library only), systemd's /usr/bin/systemctl, flock(2) and statvfs(3).

Checks, every run:
- api / mist: GET http://127.0.0.1:8081|8082/api/health must be HTTP 200 JSON with status=ok and database=ok;
  mode=local is a failure (the local file store is not the production database).
- public-<name>: optional HTTPS health URLs from the config, same JSON rule, TLS verified, no redirects.
- disk: usage of / (df semantics, reserved blocks count as used) below diskThresholdPercent (default 85).
- bambook-dev.service and bambook-dev-mist.service must be "active".
- backup: the newest set under /var/backups/bambook-dev must be complete and not older than backupMaxAgeHours
  (default 36). New sets (bambook-dev-YYYYMMDD-HHMMSS/) need manifest.json plus both artifacts with matching size
  and file header every run, and a full SHA-256 match once per artifact (cached by size + mtime, so large files are
  not hashed every minute). Legacy sets need panda_hub_dev-YYYYMMDD.dump paired with a files archive of the
  same date; they carry no hashes, so only headers and sizes are checked.

Alerting: Bark settings come only from the private JSON config (root-owned, no group/world access, in a
directory nobody else can write). backend.env is never read. Device keys go in the POST body to an HTTPS endpoint
and are never printed or stored in the state. Message bodies hold check names, fixed status words and fixed
reason labels only: never URLs, host details, raw error text or credentials. A failure is sent once per episode
(check + reason), repeated every remindIntervalMinutes while it lasts, and its recovery is sent once. A message
counts as sent only when every configured device accepted it; otherwise it stays pending and is retried next run.

State lives in /var/lib/bambook-dev-monitor (0700; state.json written atomically, 0600) together with a flock so
runs never overlap. An unreadable or malformed state is moved aside, the run starts from an empty state (current
failures are alerted again, a reset notice is queued) and exits non-zero once; the next run proceeds normally.

Exit codes: 0 all checks ok and nothing undelivered; 1 a check is failing (alert delivered or not needed);
2 config missing/invalid or a needed notification was not delivered; 3 monitor error (probe crash, state reset).
Modes: --check-config (no network), --dry-run (checks only, no state write, no Bark), --send-test (one Bark test).
"""
import argparse
import collections
import datetime
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

CONFIG = Path('/etc/bambook-dev-monitor/config.json')
STATE_DIR = Path('/var/lib/bambook-dev-monitor')
BACKUP_DIR = Path('/var/backups/bambook-dev')
SYSTEMCTL = '/usr/bin/systemctl'
DISK_PATH = '/'
API_URL = 'http://127.0.0.1:8081/api/health'
MIST_URL = 'http://127.0.0.1:8082/api/health'
SERVICES = (('service-main', 'bambook-dev.service'), ('service-mist', 'bambook-dev-mist.service'))
SAFE_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'SYSTEMD_PAGER': ''}

DEFAULTS = {
    'remindIntervalMinutes': 240, 'diskThresholdPercent': 85, 'backupMaxAgeHours': 36, 'timeoutSeconds': 8,
    'legacyBackupGraceMinutes': 30, 'publicHealth': [], 'bark': None,
}
LIMITS = {
    'remindIntervalMinutes': (5, 10080), 'diskThresholdPercent': (50, 99), 'backupMaxAgeHours': (1, 240),
    'timeoutSeconds': (1, 30), 'legacyBackupGraceMinutes': (0, 720),
}
DEVICE_KEY = re.compile(r'[A-Za-z0-9]{8,64}')
PROBE_NAME = re.compile(r'[a-z0-9][a-z0-9-]{0,23}')
MAX_CONFIG = 64 * 1024
MAX_STATE = 4 * 1024 * 1024
MAX_BODY = 64 * 1024
HISTORY_LIMIT = 200

NEW_SET = re.compile(r'bambook-dev-(\d{8}-\d{6})')
LEGACY_DUMP = re.compile(r'panda_hub_dev-(\d{8})\.dump')
LEGACY_FILES = re.compile(r'(?:bambook-files|mist-files)-(\d{8})\.tar\.gz')
ARTIFACTS = {'database.dump': b'PGDMP', 'files.tar.gz': b'\x1f\x8b'}
# The legacy hand-made script's dump format is not recorded in the repository: accept custom format or plain SQL.
LEGACY_DUMP_HEADERS = (b'PGDMP', b'--\n-- PostgreSQL database dump')

# Fixed vocabulary: the only words besides check labels that may reach a notification.
REASONS = {
    'timeout': '超时', 'unreachable': '无法连接', 'tls': '加密连接异常', 'redirect': '被重定向',
    'http-status': 'HTTP 异常', 'bad-response': '响应无效', 'database': '数据库不可用', 'local-mode': '非数据库模式',
    'not-ok': '状态异常', 'disk-full': '空间不足', 'inactive': '未运行', 'backup-stale': '备份过期',
    'backup-missing': '无完整备份', 'backup-incomplete': '备份不完整', 'backup-corrupt': '备份校验失败',
    'probe-error': '检查异常',
}
KINDS = {'fail': '故障', 'remind': '仍故障', 'recovery': '已恢复'}
EVENTS = {'state-reset': '监控状态已重置'}

Result = collections.namedtuple('Result', 'ok code info')

class MonitorError(Exception):
    """Short, already-sanitised message."""

class ConfigError(MonitorError):
    pass

# ---------------------------------------------------------------- runtime (replaced by fakes in tests)

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def _read_limited(response, deadline):
    chunks, total = [], 0
    while True:
        if time.monotonic() > deadline:
            raise socket.timeout('read deadline')
        chunk = response.read(8192)
        if not chunk:
            return b''.join(chunks)
        total += len(chunk)
        if total > MAX_BODY:
            raise ValueError('response too large')
        chunks.append(chunk)

class Runtime:
    def __init__(self, systemctl=SYSTEMCTL):
        self.systemctl = systemctl

    def now(self):
        return time.time()

    def euid(self):
        return os.geteuid()

    def http(self, url, timeout, data=None, headers=None):
        """Returns (status, body). Runs in a worker thread so a hung DNS lookup cannot outlast the deadline."""
        outcome = {}
        def work():
            try:
                outcome['value'] = self._http(url, timeout, data, headers)
            except BaseException as error:
                outcome['error'] = error
        worker = threading.Thread(target=work, daemon=True)
        worker.start()
        worker.join(timeout * 2 + 1)
        if worker.is_alive():
            raise socket.timeout('request deadline')
        if 'error' in outcome:
            raise outcome['error']
        return outcome['value']

    def _http(self, url, timeout, data, headers):
        """No proxies, no redirects, verified TLS, bounded size and time."""
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect(),
                                             urllib.request.HTTPSHandler(context=ssl.create_default_context()))
        request = urllib.request.Request(url, data=data, headers=dict(headers or {}, **{'User-Agent': 'bambook-dev-monitor'}),
                                         method='POST' if data is not None else 'GET')
        deadline = time.monotonic() + timeout
        try:
            response = opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            try:
                return error.code, _read_limited(error, deadline)
            finally:
                error.close()
        with response:
            return response.status, _read_limited(response, deadline)

    def unit_state(self, unit, timeout):
        try:
            completed = subprocess.run([self.systemctl, 'is-active', unit], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                       stderr=subprocess.DEVNULL, timeout=timeout, env=SAFE_ENV, check=False)
        except subprocess.TimeoutExpired:
            return 'timeout'
        return completed.stdout.decode('ascii', 'replace').strip()[:32] or 'unknown'

    def disk_percent(self, path):
        info = os.statvfs(path)
        used = info.f_blocks - info.f_bfree
        total = used + info.f_bavail
        return 100.0 if total <= 0 else used * 100.0 / total

    def sha256(self, path):
        digest = hashlib.sha256()
        with open(path, 'rb') as source:
            for block in iter(lambda: source.read(1 << 20), b''):
                digest.update(block)
        return digest.hexdigest()

def classify(error):
    """Map a transport exception to a reason code; None means unexpected (a monitor bug)."""
    reason = error.reason if isinstance(error, urllib.error.URLError) and not isinstance(error, urllib.error.HTTPError) else error
    if isinstance(reason, (socket.timeout, TimeoutError)):
        return 'timeout'
    if isinstance(reason, ssl.SSLError):
        return 'tls'
    if isinstance(reason, (http.client.HTTPException, ValueError, UnicodeError)):
        return 'bad-response'
    if isinstance(reason, (OSError, str)):
        return 'unreachable'
    return None

# ---------------------------------------------------------------- config

def _https_url(value, allow_query):
    if not isinstance(value, str) or len(value) > 512 or any(ord(c) < 33 for c in value):
        return False
    parts = urllib.parse.urlsplit(value)
    if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password or parts.fragment:
        return False
    return allow_query or not parts.query

def local_url(value):
    parts = urllib.parse.urlsplit(value)
    return parts.scheme == 'http' and parts.hostname in ('127.0.0.1', 'localhost') and not parts.query

def _number(raw, key):
    value = raw.get(key, DEFAULTS[key])
    low, high = LIMITS[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
        raise ConfigError(f'{key} must be a number between {low} and {high}')
    return value

def parse_config(raw):
    if not isinstance(raw, dict):
        raise ConfigError('config must be a JSON object')
    if 'REPLACE' in json.dumps(raw):
        raise ConfigError('config still contains template placeholders')
    unknown = sorted(set(raw) - set(DEFAULTS))
    if unknown:
        raise ConfigError('unknown config keys: ' + ', '.join(k[:32] for k in unknown[:5]))
    config = {key: _number(raw, key) for key in LIMITS}
    probes = raw.get('publicHealth', [])
    if not isinstance(probes, list) or len(probes) > 5:
        raise ConfigError('publicHealth must be a list of at most 5 probes')
    config['publicHealth'] = []
    for probe in probes:
        if not isinstance(probe, dict) or set(probe) != {'name', 'url'}:
            raise ConfigError('each publicHealth probe needs exactly name and url')
        if not isinstance(probe['name'], str) or not PROBE_NAME.fullmatch(probe['name']):
            raise ConfigError('publicHealth name must be lowercase letters, digits or dashes')
        if not _https_url(probe['url'], allow_query=True):
            raise ConfigError(f'publicHealth {probe["name"]} must be an https URL without credentials')
        config['publicHealth'].append({'name': probe['name'], 'url': probe['url']})
    if len({p['name'] for p in config['publicHealth']}) != len(config['publicHealth']):
        raise ConfigError('publicHealth names must be unique')
    bark = raw.get('bark')
    config['bark'] = None
    if bark is not None:
        if not isinstance(bark, dict) or not set(bark) <= {'server', 'deviceKeys', 'title', 'group'}:
            raise ConfigError('bark must be an object with server, deviceKeys, title, group')
        server = bark.get('server', 'https://api.day.app')
        if not _https_url(server, allow_query=False):
            raise ConfigError('bark.server must be an https URL without credentials or query')
        keys = bark.get('deviceKeys', [])
        if not isinstance(keys, list) or len(keys) > 10 or not all(isinstance(k, str) and DEVICE_KEY.fullmatch(k) for k in keys):
            raise ConfigError('bark.deviceKeys must be a list of 8-64 character alphanumeric keys')
        title = bark.get('title', 'Bambook')
        group = bark.get('group', 'bambook-monitor')
        for name, value in (('title', title), ('group', group)):
            if not isinstance(value, str) or not 1 <= len(value) <= 32 or any(ord(c) < 32 for c in value):
                raise ConfigError(f'bark.{name} must be 1-32 printable characters')
        if keys:
            config['bark'] = {'server': server.rstrip('/'), 'deviceKeys': list(dict.fromkeys(keys)), 'title': title, 'group': group}
    return config

def load_config(path, euid):
    """Reads the private config. Refuses symlinks, foreign owners, group/world access and writable parents."""
    path = Path(path)
    try:
        parent = os.lstat(path.parent)
    except FileNotFoundError:
        raise ConfigError('monitor config is missing')
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != euid or parent.st_mode & 0o022:
        raise ConfigError('config directory must be owned by the monitor user and not group/world writable')
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, 'O_CLOEXEC', 0))
    except FileNotFoundError:
        raise ConfigError('monitor config is missing')
    except OSError:
        raise ConfigError('monitor config is not a regular readable file')
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != euid:
            raise ConfigError('monitor config must be a regular file owned by the monitor user')
        if info.st_mode & 0o077:
            raise ConfigError('monitor config must not be accessible by group or others (chmod 600)')
        if info.st_size > MAX_CONFIG:
            raise ConfigError('monitor config is too large')
        data = source.read(MAX_CONFIG + 1)
    try:
        raw = json.loads(data.decode('utf-8'))
    except (UnicodeError, ValueError):
        raise ConfigError('monitor config is not valid JSON')
    return parse_config(raw)

def default_config():
    return parse_config({})

# ---------------------------------------------------------------- checks

def evaluate_health(status, body):
    if 300 <= status < 400:
        return Result(False, 'redirect', f'HTTP {status}')
    try:
        data = json.loads(body.decode('utf-8'))
    except (UnicodeError, ValueError):
        data = None
    if status != 200:
        if status == 503 and isinstance(data, dict) and data.get('database') == 'unavailable':
            return Result(False, 'database', 'HTTP 503 database unavailable')
        return Result(False, 'http-status', f'HTTP {status}')
    if not isinstance(data, dict):
        return Result(False, 'bad-response', 'HTTP 200 without a JSON object')
    if data.get('mode') == 'local':
        return Result(False, 'local-mode', 'mode=local')
    if data.get('database') != 'ok':
        return Result(False, 'database', 'database not ok')
    if data.get('status') != 'ok':
        return Result(False, 'not-ok', 'status not ok')
    return Result(True, None, 'status=ok database=ok')

def probe_health(runtime, url, timeout):
    try:
        status, body = runtime.http(url, timeout)
    except Exception as error:
        code = classify(error)
        if code is None:
            raise
        return Result(False, code, code)
    return evaluate_health(status, body)

def check_disk(runtime, path, threshold):
    percent = runtime.disk_percent(path)
    return Result(percent < threshold, None if percent < threshold else 'disk-full', f'{percent:.1f}% used')

def check_unit(runtime, unit, timeout):
    state = runtime.unit_state(unit, timeout)
    if state == 'active':
        return Result(True, None, 'active')
    return Result(False, 'timeout' if state == 'timeout' else 'inactive', re.sub(r'[^a-z-]', '', state)[:32] or 'unknown')

def _local_epoch(stamp, fmt):
    return datetime.datetime.strptime(stamp, fmt).timestamp()

def _regular(path):
    try:
        info = os.lstat(path)
    except OSError:
        return None
    return info if stat.S_ISREG(info.st_mode) else None

def _header_ok(path, *magics):
    try:
        with open(path, 'rb') as source:
            head = source.read(max(len(m) for m in magics))
    except OSError:
        return False
    return any(head.startswith(m) for m in magics)

def verify_new_set(runtime, path, cache):
    """None when complete; otherwise a reason code. Full hashes only when the artifact changed since last verified."""
    try:
        info = os.lstat(path)
    except OSError:
        return 'backup-incomplete'
    if not stat.S_ISDIR(info.st_mode):
        return 'backup-incomplete'
    manifest_path = path / 'manifest.json'
    manifest_info = _regular(manifest_path)
    if manifest_info is None or manifest_info.st_size > MAX_STATE:
        return 'backup-incomplete'
    try:
        manifest = json.loads(manifest_path.read_text('utf-8'))
    except (OSError, UnicodeError, ValueError):
        return 'backup-incomplete'
    if not isinstance(manifest, dict) or manifest.get('version') != 1:
        return 'backup-incomplete'
    artifacts = manifest.get('artifacts')
    if not isinstance(artifacts, dict) or not set(ARTIFACTS) <= set(artifacts):
        return 'backup-incomplete'
    try:
        created = datetime.datetime.fromisoformat(str(manifest.get('createdAt')))
    except ValueError:
        return 'backup-incomplete'
    if created.strftime('%Y%m%d-%H%M%S') != NEW_SET.fullmatch(path.name).group(1):
        return 'backup-incomplete'
    verified = {}
    for name, magic in ARTIFACTS.items():
        entry = artifacts[name]
        if not isinstance(entry, dict) or isinstance(entry.get('bytes'), bool) or not isinstance(entry.get('bytes'), int) \
                or entry['bytes'] <= 0 or not isinstance(entry.get('sha256'), str) or not re.fullmatch(r'[0-9a-f]{64}', entry['sha256']):
            return 'backup-incomplete'
        artifact = path / name
        artifact_info = _regular(artifact)
        if artifact_info is None or artifact_info.st_size != entry['bytes']:
            return 'backup-incomplete'
        if not _header_ok(artifact, magic):
            return 'backup-corrupt'
        signature = [artifact_info.st_size, artifact_info.st_mtime_ns, entry['sha256']]
        if (cache.get(path.name) or {}).get(name) != signature:
            if runtime.sha256(artifact) != entry['sha256']:
                cache.pop(path.name, None)
                return 'backup-corrupt'
        verified[name] = signature
    cache[path.name] = verified
    return None

def backup_candidates(directory, now, grace_seconds):
    """[(epoch, label, verify)] newest first. Legacy pairs still being written (inside the grace) are skipped."""
    candidates, legacy = [], {}
    for entry in directory.iterdir():
        match = NEW_SET.fullmatch(entry.name)
        if match:
            try:
                candidates.append((_local_epoch(match.group(1), '%Y%m%d-%H%M%S'), entry.name, ('new', entry)))
            except ValueError:
                pass
            continue
        for kind, pattern in (('dump', LEGACY_DUMP), ('files', LEGACY_FILES)):
            match = pattern.fullmatch(entry.name)
            if match:
                legacy.setdefault(match.group(1), {}).setdefault(kind, []).append(entry)
    for date, parts in legacy.items():
        files = [p for group in parts.values() for p in group]
        stats = [_regular(p) for p in files]
        mtimes = [s.st_mtime for s in stats if s is not None]
        if mtimes and now - max(mtimes) < grace_seconds:
            continue
        epoch = min(mtimes) if mtimes else _local_epoch(date, '%Y%m%d')
        candidates.append((epoch, f'legacy {date}', ('legacy', parts)))
    candidates.sort(key=lambda item: item[0], reverse=True)
    return [c for c in candidates if c[0] <= now + 600]

def _nonempty(paths):
    return [p for p in paths if (_regular(p) or os.stat_result((0,) * 10)).st_size > 0]

def verify_legacy(parts):
    """Legacy sets carry no hashes: a non-empty dump with the custom-format header plus a gzip files archive."""
    dumps, archives = _nonempty(parts.get('dump', [])), _nonempty(parts.get('files', []))
    if not dumps or not archives:
        return 'backup-incomplete'
    if not all(_header_ok(p, *LEGACY_DUMP_HEADERS) for p in dumps) or not all(_header_ok(p, ARTIFACTS['files.tar.gz']) for p in archives):
        return 'backup-corrupt'
    return None

def check_backup(runtime, directory, max_age_hours, grace_minutes, cache, now):
    directory = Path(directory)
    if not directory.is_dir():
        return Result(False, 'backup-missing', 'backup directory missing')
    candidates = backup_candidates(directory, now, grace_minutes * 60)
    if not candidates:
        return Result(False, 'backup-missing', 'no backup set')
    epoch, label, (kind, target) = candidates[0]
    problem = verify_new_set(runtime, target, cache) if kind == 'new' else verify_legacy(target)
    present = {c[1] for c in candidates if c[2][0] == 'new'}
    for name in list(cache):
        if name not in present:
            del cache[name]
    age = (now - epoch) / 3600
    if problem:
        return Result(False, problem, f'newest {label}: {problem}')
    if age > max_age_hours:
        return Result(False, 'backup-stale', f'newest {label} is {age:.1f}h old')
    return Result(True, None, f'{label}, {age:.1f}h old')

def run_checks(config, runtime, options, cache):
    """Ordered {name: (label, Result)}. A probe crash becomes probe-error instead of aborting the others."""
    now, timeout = runtime.now(), config['timeoutSeconds']
    plan = [('api', '主 API', lambda: probe_health(runtime, options.api_url, timeout)),
            ('mist', 'Mist API', lambda: probe_health(runtime, options.mist_url, timeout))]
    for probe in config['publicHealth']:
        plan.append(('public-' + probe['name'], '公网 ' + probe['name'], lambda url=probe['url']: probe_health(runtime, url, timeout)))
    plan.append(('disk', '根分区', lambda: check_disk(runtime, options.disk_path, config['diskThresholdPercent'])))
    for name, unit in SERVICES:
        plan.append((name, unit, lambda unit=unit: check_unit(runtime, unit, 10)))
    plan.append(('backup', '备份', lambda: check_backup(runtime, options.backup_dir, config['backupMaxAgeHours'],
                                                        config['legacyBackupGraceMinutes'], cache, now)))
    results = collections.OrderedDict()
    for name, label, probe in plan:
        try:
            results[name] = (label, probe())
        except Exception as error:
            results[name] = (label, Result(False, 'probe-error', type(error).__name__))
    return results

# ---------------------------------------------------------------- state

def fresh_state():
    return {'version': 1, 'checks': {}, 'history': [], 'pendingEvents': [], 'backupVerified': {}}

def _valid_entry(entry):
    return (isinstance(entry, dict) and entry.get('status') in ('ok', 'fail')
            and (entry.get('code') is None or entry.get('code') in REASONS)
            and isinstance(entry.get('alertDelivered', False), bool) and isinstance(entry.get('recoveryPending', False), bool)
            and (entry.get('lastAlertAt') is None or (isinstance(entry['lastAlertAt'], (int, float)) and not isinstance(entry['lastAlertAt'], bool)))
            # A delivered alert needs its time, or the reminder arithmetic would fail on every later run.
            and (not entry.get('alertDelivered') or entry.get('lastAlertAt') is not None))

def valid_state(data):
    return (isinstance(data, dict) and data.get('version') == 1 and isinstance(data.get('checks'), dict)
            and all(isinstance(k, str) and _valid_entry(v) for k, v in data['checks'].items())
            and isinstance(data.get('history'), list) and isinstance(data.get('pendingEvents'), list)
            and all(e in EVENTS for e in data['pendingEvents']) and isinstance(data.get('backupVerified'), dict)
            and all(isinstance(v, dict) for v in data['backupVerified'].values()))

def prepare_state_dir(path, euid):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = os.lstat(path)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != euid:
        raise MonitorError('state directory is not a directory owned by the monitor user')
    os.chmod(path, 0o700)
    for stale in path.glob('.state-*.tmp'):
        try:
            stale.unlink()
        except OSError:
            pass

def acquire_lock(path):
    fd = os.open(path / '.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | getattr(os, 'O_CLOEXEC', 0), 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        return None
    return fd

def read_state(path, euid):
    """Returns the state, None when absent; raises ValueError when unusable."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, 'O_CLOEXEC', 0))
    except FileNotFoundError:
        return None
    except OSError as error:
        raise ValueError('unreadable') from error
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != euid or info.st_size > MAX_STATE:
            raise ValueError('unexpected file')
        data = json.loads(source.read(MAX_STATE + 1).decode('utf-8'))
    if not valid_state(data):
        raise ValueError('malformed')
    return data

def load_state(directory, euid, now):
    """(state, reset). A broken state is moved aside, never silently trusted and never blocking later runs."""
    path = directory / 'state.json'
    try:
        data = read_state(path, euid)
    except (ValueError, OSError):
        try:
            os.rename(path, directory / f'state.json.corrupt-{int(now)}')
        except OSError:
            try:
                os.unlink(path)
            except OSError:
                raise MonitorError('monitor state is unusable and cannot be moved aside')
        for old in sorted(directory.glob('state.json.corrupt-*'))[:-3]:
            try:
                old.unlink()
            except OSError:
                pass
        state = fresh_state()
        state['pendingEvents'] = ['state-reset']
        return state, True
    return (data if data is not None else fresh_state()), False

def save_state(directory, state):
    fd, temp = tempfile.mkstemp(dir=str(directory), prefix='.state-', suffix='.tmp')
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump(state, output, ensure_ascii=False, indent=1, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, directory / 'state.json')
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise
    dirfd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(dirfd)
    finally:
        os.close(dirfd)

def iso(epoch):
    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

def record(state, at, event, **fields):
    """Appends to the bounded history; an identical repeat (e.g. a retry every minute) only bumps a counter."""
    entry = dict(event=event, **fields)
    last = state['history'][-1] if state['history'] else None
    if isinstance(last, dict) and {k: v for k, v in last.items() if k not in ('at', 'lastAt', 'repeat')} == entry:
        last['lastAt'], last['repeat'] = at, last.get('repeat', 1) + 1
        return
    state['history'].append(dict(at=at, **entry))
    del state['history'][:-HISTORY_LIMIT]

def apply_results(state, results, now, remind_seconds, prune):
    """Updates per-check episodes; returns [(check, label, kind, code)] that need a notification."""
    at, notices = iso(now), []
    for name, (label, result) in results.items():
        entry = state['checks'].get(name) or {}
        previous, status = entry.get('status'), 'ok' if result.ok else 'fail'
        if status == 'fail':
            if previous != 'fail' or entry.get('code') != result.code:
                record(state, at, 'status', check=name, to='fail', code=result.code, info=result.info, **{'from': previous})
                entry = {'status': 'fail', 'code': result.code, 'since': at, 'alertDelivered': False, 'lastAlertAt': None, 'recoveryPending': False}
                notices.append((name, label, 'fail', result.code))
            elif not entry.get('alertDelivered'):
                notices.append((name, label, 'fail', result.code))
            elif now - entry['lastAlertAt'] >= remind_seconds:
                notices.append((name, label, 'remind', result.code))
        else:
            if previous == 'fail':
                record(state, at, 'status', check=name, to='ok', code=None, info=result.info, **{'from': 'fail'})
                entry = {'status': 'ok', 'code': None, 'since': at, 'alertDelivered': False, 'lastAlertAt': None, 'recoveryPending': True}
            elif previous is None:
                entry = {'status': 'ok', 'code': None, 'since': at, 'alertDelivered': False, 'lastAlertAt': None, 'recoveryPending': False}
            if entry.get('recoveryPending'):
                notices.append((name, label, 'recovery', None))
        entry['lastChecked'], entry['info'] = at, result.info
        state['checks'][name] = entry
    if prune:
        for name in [n for n in state['checks'] if n not in results]:
            del state['checks'][name]
    return notices

def mark_delivered(state, notices, now):
    for name, _label, kind, _code in notices:
        entry = state['checks'][name]
        if kind == 'recovery':
            entry['recoveryPending'] = False
        else:
            entry['alertDelivered'], entry['lastAlertAt'] = True, now
    state['pendingEvents'] = []

# ---------------------------------------------------------------- Bark

def compose(title, notices, events):
    lines = [EVENTS[e] for e in events]
    for _name, label, kind, code in notices:
        lines.append(f'{label}：{KINDS[kind]}' + (f'（{REASONS[code]}）' if code else ''))
    alarm = any(kind != 'recovery' for _n, _l, kind, _c in notices) or bool(events)
    return title + (' 告警' if alarm else ' 恢复'), '\n'.join(lines), 'timeSensitive' if alarm else 'active'

def send_bark(runtime, bark, title, body, level, timeout):
    """(delivered, short summary). Delivered only if every device accepted the message."""
    failures = []
    for key in bark['deviceKeys']:
        payload = json.dumps({'device_key': key, 'title': title, 'body': body, 'group': bark['group'],
                              'level': level, 'isArchive': 1}, ensure_ascii=False).encode('utf-8')
        try:
            status, response = runtime.http(bark['server'] + '/push', timeout, data=payload,
                                            headers={'Content-Type': 'application/json; charset=utf-8'})
        except Exception as error:
            failures.append(classify(error) or 'error')
            continue
        try:
            accepted = status == 200 and json.loads(response.decode('utf-8')).get('code') == 200
        except (UnicodeError, ValueError, AttributeError):
            accepted = False
        if not accepted:
            failures.append(f'HTTP {status}' if status != 200 else 'rejected')
    if failures:
        return False, f'{len(failures)} of {len(bark["deviceKeys"])} device(s) failed ({", ".join(sorted(set(failures)))})'
    return True, f'{len(bark["deviceKeys"])} device(s)'

# ---------------------------------------------------------------- entry

def parse_args(argv):
    parser = argparse.ArgumentParser(description='Bambook development host monitor (see module docstring).')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check-config', action='store_true', help='validate the private config only; no network')
    mode.add_argument('--dry-run', action='store_true', help='run checks and print; no state write, no notification')
    mode.add_argument('--send-test', action='store_true', help='send one Bark test message')
    parser.add_argument('--config', type=Path, default=CONFIG)
    parser.add_argument('--state-dir', type=Path, default=STATE_DIR)
    parser.add_argument('--backup-dir', type=Path, default=BACKUP_DIR)
    parser.add_argument('--disk-path', default=DISK_PATH)
    parser.add_argument('--systemctl', default=SYSTEMCTL)
    parser.add_argument('--api-url', default=API_URL)
    parser.add_argument('--mist-url', default=MIST_URL)
    options = parser.parse_args(argv)
    if not local_url(options.api_url) or not local_url(options.mist_url):
        parser.error('--api-url and --mist-url must be http://127.0.0.1 or http://localhost URLs')
    return options

def execute(options, runtime, out, err):
    euid = runtime.euid()
    try:
        config, config_problem = load_config(options.config, euid), None
    except ConfigError as error:
        config, config_problem = default_config(), str(error)
    if options.check_config:
        if config_problem:
            print(f'config rejected: {config_problem}', file=err)
            return 2
        if not config['bark']:
            print('config rejected: no Bark device key configured', file=err)
            return 2
        print(f'config ok: {len(config["bark"]["deviceKeys"])} Bark device(s), {len(config["publicHealth"])} public probe(s)', file=out)
        return 0
    if options.send_test:
        if config_problem or not config['bark']:
            print(f'not sent: {config_problem or "no Bark device key configured"}', file=err)
            return 2
        delivered, summary = send_bark(runtime, config['bark'], config['bark']['title'] + ' 监控测试', '测试通知', 'active', config['timeoutSeconds'])
        print(('test notification delivered to ' if delivered else 'test notification NOT delivered: ') + summary, file=out if delivered else err)
        return 0 if delivered else 2
    if config_problem:
        print(f'config rejected: {config_problem}; running checks without notifications', file=err)

    if options.dry_run:
        try:
            cache = (read_state(options.state_dir / 'state.json', euid) or fresh_state())['backupVerified']
        except (ValueError, OSError):
            cache = {}
        results = run_checks(config, runtime, options, dict(cache))
        report(results, out)
        code = 3 if any(r.code == 'probe-error' for _l, r in results.values()) else 1 if any(not r.ok for _l, r in results.values()) else 0
        return max(code, 2) if config_problem else code

    prepare_state_dir(options.state_dir, euid)
    lock = acquire_lock(options.state_dir)
    if lock is None:
        print('another monitor run is in progress; skipped', file=out)
        return 0
    try:
        now = runtime.now()
        state, reset = load_state(options.state_dir, euid, now)
        if reset:
            print('monitor state was unreadable; moved aside and started fresh', file=err)
            record(state, iso(now), 'state-reset')
        results = run_checks(config, runtime, options, state['backupVerified'])
        report(results, out)
        for name, (_label, result) in results.items():
            if result.code == 'probe-error':
                record(state, iso(now), 'probe-error', check=name, info=result.info)
        notices = apply_results(state, results, now, config['remindIntervalMinutes'] * 60, prune=not config_problem)
        exit_code = 1 if any(not r.ok for _l, r in results.values()) else 0
        if notices or state['pendingEvents']:
            items = [f'{n}:{k}' for n, _l, k, _c in notices] + list(state['pendingEvents'])
            if config_problem or not config['bark']:
                record(state, iso(now), 'notify-unavailable', items=items)
                print(f'notification NOT sent ({len(items)} pending): ' + (config_problem or 'no Bark device key configured'), file=err)
                exit_code = 2
            else:
                title, body, level = compose(config['bark']['title'], notices, state['pendingEvents'])
                delivered, summary = send_bark(runtime, config['bark'], title, body, level, config['timeoutSeconds'])
                if delivered:
                    mark_delivered(state, notices, now)
                    record(state, iso(now), 'notified', items=items)
                    print(f'notified {len(items)} item(s) to {summary}', file=out)
                else:
                    record(state, iso(now), 'notify-failed', items=items, info=summary)
                    print(f'notification NOT delivered, will retry: {summary}', file=err)
                    exit_code = 2
        elif config_problem:
            exit_code = 2
        save_state(options.state_dir, state)
        if reset or any(r.code == 'probe-error' for _l, r in results.values()):
            exit_code = 3
        return exit_code
    finally:
        os.close(lock)

def report(results, out):
    for name, (_label, result) in results.items():
        print(f'{"OK  " if result.ok else "FAIL"} {name}' + ('' if result.ok else f' [{result.code}]') + f': {result.info}', file=out)

def main(argv=None, runtime=None, out=None, err=None):
    out, err = out or sys.stdout, err or sys.stderr
    options = parse_args(argv)
    os.umask(0o077)
    try:
        return execute(options, runtime or Runtime(options.systemctl), out, err)
    except MonitorError as error:
        print(f'monitor error: {error}', file=err)
        return 3
    except Exception as error:
        # Type only: messages of OS/JSON errors can carry paths or payload fragments.
        print(f'monitor error: {type(error).__name__}', file=err)
        return 3

if __name__ == '__main__':
    sys.exit(main())
