#!/usr/bin/env python3
"""Local verification and SSH delivery to the dedicated development host only."""
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tarfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex')) / 'private' / 'bambook-dev-direct'
PUBLIC = 'https://bambook-dev.sylway.cloud'
VERIFY = ['npm', 'run', 'verify:mist']
CHECKS = [[sys.executable, 'scripts/deploy/test_direct_dev.py'],
          [sys.executable, 'scripts/deploy/test_bambook_dev_receiver.py'], VERIFY]

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()

def clean_revision():
    if git('status', '--porcelain', '--untracked-files=normal'):
        raise ValueError('Commit or isolate source changes before deployment.')
    revision, tree = git('rev-parse', 'HEAD'), git('rev-parse', 'HEAD^{tree}')
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('Invalid committed revision.')
    node = subprocess.check_output(['node', '--version'], text=True).strip()
    if node.lstrip('v').split('.')[0] != (ROOT / '.nvmrc').read_text().strip():
        raise ValueError('Local Node major differs from .nvmrc.')
    return revision, tree, node

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(path)

def load_config(path):
    value = json.loads(path.read_text())
    if value.get('host') not in ('124.222.56.61', 'bambook-dev.sylway.cloud') or value.get('user') != 'bambook-deploy':
        raise ValueError('This command is restricted to the development delivery account.')
    for name in ('key', 'knownHosts'):
        target = Path(value[name]).expanduser().resolve()
        if not target.is_file():
            raise ValueError('Missing local ' + name + ' file.')
        if name == 'key' and stat.S_IMODE(target.stat().st_mode) & 0o077:
            raise ValueError('The SSH private key must be readable only by its owner.')
        value[name] = str(target)
    return value

def ssh_command(config, action):
    return ['ssh', '-F', '/dev/null', '-i', config['key'], '-o', 'IdentitiesOnly=yes',
            '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'UserKnownHostsFile=' + config['knownHosts'], '-o', 'ConnectTimeout=15',
            '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
            '-o', 'ClearAllForwardings=yes', config['user'] + '@' + config['host'], action]

def verify(tree, node, force=False):
    cache = PRIVATE / 'verification' / (tree + '.json')
    if not force and cache.is_file():
        proof = json.loads(cache.read_text())
        log = Path(proof.get('log', ''))
        if proof.get('tree') == tree and proof.get('node') == node and proof.get('commands') == CHECKS and log.is_file() and proof.get('logSha256') == digest(log):
            print('Local verification matches this exact committed source tree.', flush=True)
            return
    cache.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    log = cache.with_suffix('.log')
    print('Running full local application verification.', flush=True)
    with log.open('w') as output:
        for check in CHECKS:
            result = subprocess.run(check, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT)
            if result.returncode:
                break
    log.chmod(0o600)
    if result.returncode:
        raise ValueError('Local verification failed; see ' + str(log))
    if git('rev-parse', 'HEAD^{tree}') != tree or git('status', '--porcelain', '--untracked-files=normal'):
        raise ValueError('Source changed during verification.')
    save_json(cache, {'tree': tree, 'node': node, 'commands': CHECKS, 'log': str(log), 'logSha256': digest(log)})

def runtime_source(name):
    if name in ('.nvmrc', 'scripts/deploy/bambook-dev-release.sh'):
        return True
    parts = Path(name).parts
    blocked = {'node_modules', '__tests__', 'private', 'private-files', 'uploads', 'logs', 'storage', 'data', 'output', 'dist', 'docs', 'acceptance-tests', 'knowledge_api', 'scaffold-output', 'ops-panel'}
    return bool(parts and parts[0] == 'server' and not any(p in blocked or p.startswith(('.env', 'knowledge-base-')) for p in parts) and not re.search(r'\.(test|spec)\.[cm]?[jt]sx?$', name))

def archive_files(files, destination):
    """Stable metadata; only explicit regular-file bytes can enter the bundle."""
    directories = set()
    for name in files:
        p = Path(name)
        if p.is_absolute() or '..' in p.parts:
            raise ValueError('Unsafe package path.')
        directories.update(str(parent) for parent in p.parents if str(parent) != '.')
    with destination.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0, compresslevel=9) as zipped, tarfile.open(fileobj=zipped, mode='w|') as tar:
        for name in sorted(directories | set(files)):
            item = tarfile.TarInfo(name)
            item.uid = item.gid = item.mtime = 0
            if name in directories:
                item.type, item.mode = tarfile.DIRTYPE, 0o755
                tar.addfile(item)
            else:
                item.mode, item.size = 0o644, len(files[name])
                tar.addfile(item, io.BytesIO(files[name]))

def package(revision, tree):
    directory = PRIVATE / 'releases' / revision
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    bundle, manifest = directory / 'bundle.tar.gz', directory / 'bundle.json'
    if bundle.is_file() and manifest.is_file():
        saved = json.loads(manifest.read_text())
        if saved.get('tree') != tree or saved.get('sha256') != digest(bundle):
            raise ValueError('Saved bundle failed integrity verification.')
        return bundle
    print('Building the committed same-origin frontend locally.', flush=True)
    env = {**os.environ, 'BAMBOOK_WEB_SUBDOMAIN': '1', 'VITE_API_BASE_URL': '/api'}
    with (directory / 'build.log').open('w') as log:
        subprocess.run(['npm', 'run', 'build'], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
    if git('rev-parse', 'HEAD') != revision or git('status', '--porcelain', '--untracked-files=normal'):
        raise ValueError('Source changed during packaging.')
    files = {}
    for line in subprocess.check_output(['git', 'ls-tree', '-rz', 'HEAD'], cwd=ROOT).decode().split('\0'):
        if not line:
            continue
        meta, name = line.split('\t', 1)
        if runtime_source(name):
            if meta.split()[0] != '100644' and meta.split()[0] != '100755':
                raise ValueError('Runtime source contains a non-regular file.')
            files[name] = subprocess.check_output(['git', 'show', revision + ':' + name], cwd=ROOT)
    web = ROOT / 'dist'
    for path in sorted(web.rglob('*')):
        relative = path.relative_to(web)
        if path.is_symlink():
            raise ValueError('Frontend output contains a symbolic link.')
        if not path.is_file() or relative.parts[0] in ('data', 'geo', 'glyphs') or path.suffix == '.geojson' or relative.name.startswith('earth_'):
            continue
        files['web/' + relative.as_posix()] = path.read_bytes()
    version = json.loads(files['web/mist-version.json'])
    if not revision.startswith(version['commit']) or version['localChanges'] != 0:
        raise ValueError('Frontend version does not match the committed source.')
    required = {'.nvmrc', 'server/package.json', 'server/package-lock.json', 'server/src/index.ts', 'server/src/mist/standalone.ts', 'scripts/deploy/bambook-dev-release.sh', 'web/index.html'}
    if not required.issubset(files):
        raise ValueError('Incomplete runtime bundle.')
    archive_files(files, bundle)
    if bundle.stat().st_size > 64 * 1024 * 1024:
        raise ValueError('Runtime bundle exceeds receiver limit.')
    save_json(manifest, {'revision': revision, 'tree': tree, 'sha256': digest(bundle), 'bytes': bundle.stat().st_size})
    return bundle

def public_version(revision):
    for attempt in range(12):
        try:
            request = urllib.request.Request(PUBLIC + '/mist-version.json?release=' + revision, headers={'Cache-Control': 'no-cache'})
            with urllib.request.urlopen(request, timeout=10) as response:
                value = json.load(response)
            commit = value.get('commit', '')
            if isinstance(commit, str) and re.fullmatch(r'[0-9a-f]{7,40}', commit) and revision.startswith(commit) and value.get('localChanges') == 0:
                return value
        except (OSError, ValueError):
            pass
        if attempt < 11:
            time.sleep(2)
    raise ValueError('Public frontend version has not confirmed the requested release.')

def already_live(revision):
    """Do not reinstall a running release after an uncertain SSH response."""
    try:
        request = urllib.request.Request(PUBLIC + '/mist-version.json?release=' + revision, headers={'Cache-Control': 'no-cache'})
        with urllib.request.urlopen(request, timeout=5) as response:
            version = json.load(response)
        commit = version.get('commit', '')
        if not isinstance(commit, str) or not re.fullmatch(r'[0-9a-f]{7,40}', commit) or not revision.startswith(commit) or version.get('localChanges') != 0:
            return False
        with urllib.request.urlopen(PUBLIC + '/api/health', timeout=5) as response:
            health = json.load(response)
        return health.get('status') == 'ok' and health.get('database') == 'ok' and health.get('mode') != 'local'
    except (OSError, ValueError):
        return False

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('check', 'verify', 'deploy'))
    parser.add_argument('--config', type=Path, default=PRIVATE / 'config.json')
    args = parser.parse_args()
    revision, tree, node = clean_revision()
    if args.action == 'verify':
        verify(tree, node, force=True)
        print('Local verification passed.')
        return
    config = load_config(args.config)
    subprocess.run(ssh_command(config, 'check'), check=True, timeout=30)
    if args.action == 'check':
        return
    if already_live(revision):
        print('Requested revision is already live; public frontend and API health confirmed.')
        return
    verify(tree, node)
    bundle = package(revision, tree)
    log_path = bundle.parent / 'delivery.log'
    with log_path.open('a') as log:
        print('Uploading runtime bundle directly to the development server.', flush=True)
        with bundle.open('rb') as data:
            subprocess.run(ssh_command(config, 'receive ' + revision), stdin=data, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=600)
        print('Activating release; server health checks and rollback remain enabled.', flush=True)
        subprocess.run(ssh_command(config, 'activate ' + revision), stdout=log, stderr=subprocess.STDOUT, check=True, timeout=2400)
    version = public_version(revision)
    receipt = {'revision': revision, 'tree': tree, 'bundleSha256': digest(bundle), 'publicVersion': version, 'deployedAt': datetime.now(timezone.utc).isoformat()}
    save_json(bundle.parent / 'receipt.json', receipt)
    print('Development release and public frontend version verified: ' + revision[:12])

if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print('Direct development delivery stopped: ' + str(error), file=sys.stderr)
        sys.exit(1)
