#!/usr/bin/python3
"""Daily local backup of the Bambook development host. Installed root-owned by bootstrap-dev-server.sh
as /usr/local/sbin/bambook-dev-backup and run from /etc/cron.daily; this file is the only backup entry.

One run produces one set, /var/backups/bambook-dev/bambook-dev-YYYYMMDD-HHMMSS/ (0700) with
database.dump (pg_dump -Fc), files.tar.gz (persistent data under /srv/bambook-dev/shared) and
manifest.json (sizes, SHA-256, included directories), files 0600. The set is assembled in a hidden
.incomplete-* directory and renamed only after every step succeeded, so a failed run never leaves a
set that looks complete and never deletes earlier backups. Completed sets older than 7 days are removed
only after a new set was completed.

Scope: everything directly under shared/ except logs and private-backups (operator copies). Application
secrets in /etc/bambook-dev (backend.env with the encryption keys) are deliberately not included, so the
encrypted mail credentials (mist-mail-credentials) in the archive stay unreadable without them. Not every
credential under shared/ is encrypted: ai-subscriptions holds platform subscription tokens and API keys in
plain JSON, and any operator file there (such as mail-accounts.txt) is copied as is. The set therefore
stays root-only on this host; exclude or encrypt those before any copy leaves it.
No copy leaves this host; off-site copies are a separate, later decision.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile

DEST = Path('/var/backups/bambook-dev')
SHARED = Path('/srv/bambook-dev/shared')
ENVIRONMENT = Path('/etc/bambook-dev/backend.env')
DATABASE = 'panda_hub_dev'
RETAIN_DAYS = 7
# Created by bootstrap-dev-server.sh; a missing one means the host is not in the expected state.
REQUIRED = ('mist-files', 'ai-subscriptions', 'uploads', 'private-files', 'storage', 'data', 'output', 'cutout-queue')
# Not business data: service logs, and operator copies of earlier scripts/configuration.
EXCLUDED = ('logs', 'private-backups')
SET_NAME = re.compile(r'bambook-dev-(\d{8}-\d{6})')
LEGACY = re.compile(r'(panda_hub_dev-\d{8}\.dump|(mist-files|bambook-files)-\d{8}\.tar\.gz)')
# GNU tar exits 1 in create mode when files change or vanish while being read (live uploads). That is
# accepted only if every diagnostic is one of these; anything else (e.g. no space left) fails the run.
BENIGN_TAR = re.compile(r'tar: .*: (file changed as we read it|File removed before we read it|file is unchanged; not dumped|socket ignored)$')

class BackupError(Exception):
    pass

def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()

def outside_paths(environment, shared):
    """Data directories configured outside shared/ would silently miss the backup; report them."""
    try:
        lines = environment.read_text().splitlines()
    except OSError:
        return []
    found = []
    for line in lines:
        match = re.fullmatch(r'\s*([A-Z0-9_]+(?:_DIR|_QUEUE))=["\']?(/[^"\']*)["\']?\s*', line)
        if match:
            path = os.path.normpath(match.group(2))
            if path != str(shared) and not path.startswith(str(shared) + '/'):
                found.append(f'{match.group(1)}={path}')
    return found

def configured_database(environment):
    """Database name from DATABASE_URL in backend.env (only the name is used; nothing else is read out)."""
    try:
        lines = environment.read_text().splitlines()
    except OSError:
        return None
    for line in lines:
        match = re.fullmatch(r'\s*DATABASE_URL=["\']?postgres(?:ql)?://[^/]*/([^?"\'\s]+).*', line)
        if match:
            return match.group(1)
    return None

def dump_database(database, target):
    with target.open('xb') as output:
        result = subprocess.run(['sudo', '-n', '-u', 'postgres', 'pg_dump', '--format=custom', f'--dbname={database}'],
                                stdout=output, stderr=subprocess.PIPE, timeout=3600)
    if result.returncode != 0:
        detail = next((line for line in result.stderr.decode(errors='replace').splitlines() if line.strip()), '')
        raise BackupError(f'pg_dump failed with exit code {result.returncode}' + (f': {detail[:200]}' if detail else ''))
    with target.open('rb') as dump:
        if dump.read(5) != b'PGDMP':
            raise BackupError('pg_dump output is not a custom-format dump')

def archive_files(shared, names, target):
    result = subprocess.run(['tar', '--create', '--gzip', f'--file={target}', f'--directory={shared}', *[f'./{n}' for n in names]],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=7200)
    messages = [line for line in result.stderr.decode(errors='replace').splitlines() if line.strip()]
    changed = [line for line in messages if BENIGN_TAR.fullmatch(line.strip())]
    if result.returncode == 1 and len(changed) == len(messages):
        pass
    elif result.returncode != 0:
        detail = next((line for line in messages if line not in changed and 'exiting with failure' not in line), '')
        raise BackupError(f'tar failed with exit code {result.returncode}' + (f': {detail[:200]}' if detail else ''))
    # Read the whole archive back: a truncated or corrupt gzip stream fails here, not at restore time.
    try:
        with tarfile.open(target, 'r:gz') as bundle:
            entries = sum(1 for _ in bundle)
    except (tarfile.TarError, OSError, EOFError) as error:
        raise BackupError(f'files archive failed verification: {type(error).__name__}')
    return entries, len(changed)

def prune(dest, keep, now):
    cutoff = now - datetime.timedelta(days=RETAIN_DAYS)
    removed = []
    for entry in dest.iterdir():
        if entry == keep or entry.is_symlink():
            continue
        match = SET_NAME.fullmatch(entry.name)
        if match and entry.is_dir():
            if datetime.datetime.strptime(match.group(1), '%Y%m%d-%H%M%S') < cutoff:
                shutil.rmtree(entry)
                removed.append(entry.name)
        elif LEGACY.fullmatch(entry.name) and entry.is_file():
            if datetime.datetime.fromtimestamp(entry.stat().st_mtime) < cutoff:
                entry.unlink()
                removed.append(entry.name)
    return removed

def backup(dest, shared, environment, database, now=None):
    now = now or datetime.datetime.now()
    os.umask(0o077)
    dest.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(dest, 0o700)
    with (dest / '.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BackupError('another backup is running')
        # Leftovers of killed runs are never valid backups.
        for stale in dest.glob('.incomplete-*'):
            shutil.rmtree(stale, ignore_errors=True)
        configured = configured_database(environment)
        if configured is not None and configured != database:
            raise BackupError('backend.env DATABASE_URL names a different database than the one backed up')
        if not shared.is_dir():
            raise BackupError(f'{shared} is missing')
        missing = [name for name in REQUIRED if not (shared / name).is_dir()]
        if missing:
            raise BackupError('expected data directories are missing: ' + ', '.join(missing))
        names = sorted(entry.name for entry in shared.iterdir() if entry.name not in EXCLUDED)
        name = 'bambook-dev-' + now.strftime('%Y%m%d-%H%M%S')
        final = dest / name
        if final.exists():
            raise BackupError(f'{name} already exists')
        work = dest / f'.incomplete-{name}'
        work.mkdir(mode=0o700)
        try:
            # Database first, files second: attachments uploaded meanwhile are extra, never missing.
            dump_database(database, work / 'database.dump')
            entries, changed = archive_files(shared, names, work / 'files.tar.gz')
            artifacts = {}
            for artifact in ('database.dump', 'files.tar.gz'):
                path = work / artifact
                os.chmod(path, 0o600)
                artifacts[artifact] = {'bytes': path.stat().st_size, 'sha256': sha256(path)}
            manifest = {
                'version': 1, 'createdAt': now.isoformat(timespec='seconds'), 'database': database,
                'shared': str(shared), 'directories': names, 'excluded': list(EXCLUDED), 'archiveEntries': entries,
                'filesChangedDuringArchive': changed, 'notIncluded': outside_paths(environment, shared), 'artifacts': artifacts,
            }
            with (work / 'manifest.json').open('x') as output:
                json.dump(manifest, output, indent=2)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(work / 'manifest.json', 0o600)
            os.rename(work, final)
        except BaseException:
            shutil.rmtree(work, ignore_errors=True)
            raise
        dirfd = os.open(dest, os.O_RDONLY)
        try:
            os.fsync(dirfd)
        finally:
            os.close(dirfd)
        try:
            removed = prune(dest, final, now)
        except OSError as error:
            print(f'Backup completed; removing expired backups failed: {type(error).__name__}', file=sys.stderr)
            removed = []
        return final, manifest, removed

def main(argv=None):
    parser = argparse.ArgumentParser(description='Bambook development host daily backup (local only).')
    parser.add_argument('--dest', type=Path, default=DEST)
    parser.add_argument('--shared', type=Path, default=SHARED)
    parser.add_argument('--environment', type=Path, default=ENVIRONMENT)
    parser.add_argument('--database', default=DATABASE)
    args = parser.parse_args(argv)
    if not re.fullmatch(r'[A-Za-z0-9_]+', args.database):
        raise BackupError('invalid database name')
    final, manifest, removed = backup(args.dest, args.shared, args.environment, args.database)
    for item in manifest['notIncluded']:
        print(f'Warning: {item} is outside {args.shared} and not included in this backup.', file=sys.stderr)
    print(f'Backup {final.name} complete: {len(manifest["directories"])} directories, {len(removed)} expired removed.')

if __name__ == '__main__':
    try:
        main()
    except (BackupError, OSError, subprocess.SubprocessError) as error:
        print(f'Bambook backup failed: {error if isinstance(error, BackupError) else type(error).__name__}', file=sys.stderr)
        sys.exit(1)
