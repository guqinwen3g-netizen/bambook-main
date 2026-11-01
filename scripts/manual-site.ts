/** First-class employee manual: separate assets, same release, no company/API data. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ResolvedConfig } from 'vite';

type Builder = (output: string) => void;
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };

export function manualSitePath(base: string) {
  return new URL(base || '/', 'http://manual.local').pathname.replace(/\/?$/, '/') + 'manual';
}

/** Own /manual responses: malformed or missing assets must never fall through to the business SPA. */
export function manualMiddleware(directory: (request: IncomingMessage) => string, prefix: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const raw = (req.url || '/').split('?')[0];
    let pathname: string;
    try { pathname = decodeURIComponent(raw); }
    catch {
      if (raw.startsWith(prefix)) { res.statusCode = 400; res.end('Invalid manual path'); }
      else next();
      return;
    }
    if (pathname !== prefix && !pathname.startsWith(prefix + '/')) { next(); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method || '')) { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); res.end(); return; }
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.slice(prefix.length).split('/').some(part => part === '.' || part === '..')) { res.statusCode = 400; res.end('Invalid manual path'); return; }
    if (pathname === prefix) { res.statusCode = 308; res.setHeader('Location', prefix + '/' + ((req.url || '').includes('?') ? '?' + (req.url || '').split('?').slice(1).join('?') : '')); res.end(); return; }
    try {
      const root = fs.realpathSync(directory(req));
      const relative = pathname.slice(prefix.length + 1) || 'index.html';
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep) || !MIME[path.extname(file).toLowerCase()]) { res.statusCode = 404; res.end('Manual resource not found'); return; }
      if (!fs.existsSync(file) || !fs.lstatSync(file).isFile() || fs.realpathSync(file) !== file) { res.statusCode = 404; res.end('Manual resource not found'); return; }
      res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()]);
      res.setHeader('Content-Length', fs.statSync(file).size);
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (error) {
      // Build failures are visible during development; no filesystem paths or source details go to the browser.
      res.statusCode = 503; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('使用手册暂时无法加载');
    }
  };
}

export function manualSitePlugin(repoRoot: string, options: { build?: Builder } = {}): Plugin {
  let config: ResolvedConfig, current = '', stale = true, revisionKey = '';
  const owned = new Set<string>();
  const build = options.build || ((output: string) => {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts/wiki-build.mjs'), '--out-dir', output, ...(config.command === 'build' ? ['--require-tracked'] : [])], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  });
  const clean = () => { for (const directory of owned) fs.rmSync(directory, { recursive: true, force: true }); owned.clear(); current = ''; };
  const ensure = () => {
    if (current && !stale) return current;
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'bambook-manual-')); owned.add(output);
    try {
      build(output);
      for (const required of ['index.html', 'manual-version.json']) if (!fs.statSync(path.join(output, required)).isFile()) throw new Error(`Manual build missing ${required}`);
      const previous = current; current = output; stale = false;
      if (previous) { fs.rmSync(previous, { recursive: true, force: true }); owned.delete(previous); }
      return current;
    } catch (error) { fs.rmSync(output, { recursive: true, force: true }); owned.delete(output); throw error; }
  };
  const developmentDirectory = (request: IncomingMessage) => {
    const pathname = (request.url || '').split('?')[0];
    // A commit alone does not trigger HMR. Refresh document metadata after a commit or dirty-state change,
    // without doing Git work for each image or reloading any in-progress business page.
    if (/\/(?:index\.html|manual-version\.json)?$/.test(pathname)) {
      let key = '';
      try { key = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) + execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
      if (key !== revisionKey) { revisionKey = key; stale = true; }
    }
    return ensure();
  };
  const walk = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Manual output must not contain symbolic links');
    if (entry.isDirectory()) return walk(file);
    if (!entry.isFile() || !MIME[path.extname(file).toLowerCase()]) throw new Error(`Unsupported manual asset ${entry.name}`);
    return [file];
  });
  return {
    name: 'bambook-employee-manual',
    configResolved(value) { config = value; },
    configureServer(server) {
      const sources = [path.join(repoRoot, 'wiki'), ...['wiki-build.mjs', 'wiki-lib.mjs', 'manual-catalog.mjs', 'manual-lesson.mjs', 'manual-navigation.mjs', 'manual-media.mjs', 'manual-sop.mjs'].map(name => path.join(repoRoot, 'scripts', name))];
      const changed = (_event: string, file: string) => { if (sources.some(source => file === source || file.startsWith(source + path.sep))) stale = true; };
      server.watcher.add(sources); server.watcher.on('all', changed);
      server.httpServer?.once('close', () => { server.watcher.off('all', changed); clean(); });
      server.middlewares.use(manualMiddleware(developmentDirectory, manualSitePath(server.config.base)));
    },
    configurePreviewServer(server) {
      server.middlewares.use(manualMiddleware(() => path.resolve(server.config.root, server.config.build.outDir, 'manual'), manualSitePath(server.config.base)));
    },
    buildStart() { if (config.command === 'build') ensure(); },
    generateBundle() {
      const directory = ensure();
      for (const file of walk(directory)) this.emitFile({ type: 'asset', fileName: 'manual/' + path.relative(directory, file).split(path.sep).join('/'), source: fs.readFileSync(file) });
    },
    buildEnd(error) { if (error) clean(); },
    closeBundle() { if (config.command === 'build') clean(); },
  };
}
