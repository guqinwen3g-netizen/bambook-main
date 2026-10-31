/** Course assets and declared review status. A complete capture is not a training acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MANUAL_TRACKS = ['报价到订单', '采购与生产', '采购结算与付款'];
const text = value => typeof value === 'string' && !!value.trim();
const sha = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const instant = value => text(value) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value);
const imageName = value => typeof value === 'string' && /^[\w-][\w.-]*\.(?:webp|png|jpe?g)$/i.test(value) && !value.includes('..');

export function readLessonCatalog({ wikiDir = path.join(ROOT, 'wiki'), rootDir = ROOT, git = true } = {}) {
  const issues = [], lessons = [], images = new Map();
  const relative = file => path.relative(rootDir, file).split(path.sep).join('/');
  let committedFiles = null;
  if (git) {
    try { committedFiles = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', relative(path.join(wikiDir, 'lessons')), relative(path.join(wikiDir, 'assets/lessons'))], { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')); } catch {}
  }
  const problem = (lessonId, file, code, message) => issues.push({ severity: 'error', lessonId, file: relative(file), code, message });
  const parse = (file, id) => {
    try {
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('符号链接不能作为课程源文件');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { problem(id, file, 'JSON_SOURCE', '课程或采集 JSON 缺失、无效或不是普通文件'); return null; }
  };
  const directory = path.join(wikiDir, 'lessons');
  if (!fs.existsSync(directory)) {
    problem('', directory, 'LESSONS_MISSING', '缺少课程目录');
    return { lessons, tracks: [], totals: { lessons: 0, steps: 0, images: 0 }, issues, verification: {} };
  }
  const lessonFiles = fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort();
  if (!lessonFiles.length) problem('', directory, 'LESSONS_EMPTY', '没有可构建的引导课程');
  for (const name of lessonFiles) {
    const file = path.join(directory, name), lesson = parse(file, name);
    if (!object(lesson)) { if (lesson !== null) problem(name, file, 'LESSON_SHAPE', '课程须为 JSON 对象'); continue; }
    const id = text(lesson.id) ? lesson.id : name;
    if (!identifier(lesson.id)) problem(id, file, 'LESSON_ID', '课程 ID 须为字母、数字、短横线或下划线');
    for (const key of ['title', 'role', 'handoff', 'prerequisite', 'entry', 'doneTitle', 'result']) {
      if (!text(lesson[key])) problem(id, file, 'LESSON_FIELD', `缺少课程字段 ${key}`);
    }
    if (!Number.isFinite(lesson.order) || lesson.order < 0) problem(id, file, 'LESSON_ORDER', '课程顺序无效');
    if (lesson.track !== undefined && !text(lesson.track)) problem(id, file, 'LESSON_TRACK', '业务链名称无效');
    const steps = Array.isArray(lesson.steps) ? lesson.steps : [];
    if (!steps.length) problem(id, file, 'LESSON_STEPS', '课程至少需要一个步骤');
    for (const [index, step] of steps.entries()) {
      if (!object(step) || !['title', 'do', 'see'].every(key => text(step[key])) || (step.kind && !['click', 'type', 'select', 'check'].includes(step.kind))) problem(id, file, 'STEP_SHAPE', `第 ${index + 1} 步的操作、结果或类型无效`);
      if (object(step) && (['tip', 'fill'].some(key => step[key] !== undefined && typeof step[key] !== 'string') || (step.failure !== undefined && (!object(step.failure) || !text(step.failure.title) || !text(step.failure.text))))) problem(id, file, 'STEP_HELP', `第 ${index + 1} 步的填写或失败恢复说明无效`);
      if (step?.quiz && (!object(step.quiz) || !text(step.quiz.question) || !Array.isArray(step.quiz.options) || step.quiz.options.length < 2 || !step.quiz.options.some(option => object(option) && option.correct === true) || !step.quiz.options.every(option => object(option) && text(option.label) && text(option.reply)))) problem(id, file, 'QUIZ_SHAPE', `第 ${index + 1} 步的问答无效`);
    }
    if (!Array.isArray(lesson.chain) || !lesson.chain.length || !lesson.chain.every(text)) problem(id, file, 'HANDOFF_CHAIN', '缺少完成后的交接链');
    if (lesson.chainAt !== undefined && (!Number.isInteger(lesson.chainAt) || lesson.chainAt < 0 || lesson.chainAt >= (lesson.chain?.length || 0))) problem(id, file, 'HANDOFF_POSITION', '当前交接位置无效');
    if (!Array.isArray(lesson.sop) || !lesson.sop.length || !lesson.sop.every(row => object(row) && text(row.title) && text(row.text))) problem(id, file, 'SOP_SHAPE', '缺少岗位 SOP');
    if (lesson.nextLesson && (!object(lesson.nextLesson) || !identifier(lesson.nextLesson.id) || !text(lesson.nextLesson.title))) problem(id, file, 'NEXT_SHAPE', '下一课引用无效');

    let capture = null, captureFile = null;
    const imageFiles = new Set(), captureId = lesson.capture;
    if (!identifier(captureId)) problem(id, file, 'CAPTURE_PATH', '采集目录名无效');
    else {
      const base = path.join(wikiDir, 'assets', 'lessons', captureId);
      captureFile = path.join(base, 'capture.json');
      // No symlinked capture directory may escape the public teaching asset tree.
      const inside = fs.existsSync(base) && fs.lstatSync(base).isDirectory()
        && fs.realpathSync(base) === path.join(fs.realpathSync(wikiDir), 'assets', 'lessons', captureId);
      if (!inside) problem(id, captureFile, 'CAPTURE_PATH', '采集目录缺失或包含符号链接');
      else {
        capture = parse(captureFile, id);
        if (!object(capture)) { if (capture !== null) problem(id, captureFile, 'CAPTURE_SHAPE', '采集须为 JSON 对象'); capture = null; }
        if (capture) {
          const frames = Array.isArray(capture.frames) ? capture.frames : [];
          const viewport = capture.viewport;
          const validViewport = object(viewport) && Number.isFinite(viewport.width) && Number.isFinite(viewport.height) && viewport.width > 0 && viewport.height > 0;
          if (!validViewport) problem(id, captureFile, 'VIEWPORT', '采集视口无效');
          if (frames.length !== steps.length) problem(id, captureFile, 'FRAME_COUNT', '课程步骤与采集帧数不一致');
          for (const [index, frame] of frames.entries()) {
            const target = frame?.target;
            if (!object(target) || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(target[key])) || target.x < 0 || target.y < 0 || target.width <= 0 || target.height <= 0 || (validViewport && (target.x + target.width > viewport.width + .01 || target.y + target.height > viewport.height + .01))) problem(id, captureFile, 'TARGET', `第 ${index + 1} 帧目标超出视口或无效`);
            if (frame?.value !== undefined && typeof frame.value !== 'string') problem(id, captureFile, 'FRAME_VALUE', `第 ${index + 1} 帧的演示输入须为文本`);
          }
          for (const image of [...frames.map(frame => frame?.image), capture.result]) {
            if (!imageName(image)) { problem(id, captureFile, 'IMAGE_PATH', '图片路径须为采集目录内的本地图片名'); continue; }
            const imageFile = path.join(base, image);
            if (!fs.existsSync(imageFile) || !fs.lstatSync(imageFile).isFile() || fs.statSync(imageFile).size === 0) problem(id, imageFile, 'IMAGE_MISSING', '缺少有效的步骤或结果图片');
            else { imageFiles.add(imageFile); if (!images.has(imageFile)) images.set(imageFile, fs.readFileSync(imageFile)); }
          }
        }
      }
    }
    const hash = createHash('sha256');
    const { verification: ignoredReview, ...content } = lesson;
    hash.update(JSON.stringify(content)); hash.update('\0'); hash.update(JSON.stringify(capture));
    for (const imageFile of [...imageFiles].sort()) { hash.update(path.basename(imageFile)); hash.update('\0'); hash.update(images.get(imageFile)); }
    const contentSha256 = hash.digest('hex');
    const provenance = object(capture?.provenance) ? capture.provenance : {};
    if (capture?.provenance !== undefined && (!sha(provenance.softwareCommit, 40) || !instant(provenance.capturedAt))) problem(id, captureFile, 'PROVENANCE', '采集版本登记需要完整提交号和采集时间');
    const review = object(lesson.verification) ? lesson.verification : {};
    if (lesson.verification !== undefined && !object(lesson.verification)) problem(id, file, 'VERIFICATION', '课程核验登记须为对象');
    const statuses = {};
    for (const [kind, allowed] of [['playback', ['pending', 'passed', 'failed']], ['employee', ['pending', 'accepted', 'changes-requested']]]) {
      const record = review[kind];
      statuses[kind] = { status: 'unknown', checkedAt: null, softwareCommit: null };
      if (record !== undefined) {
        if (!object(record) || !allowed.includes(record.status)
          || (record.checkedAt !== undefined && !instant(record.checkedAt))
          || (record.softwareCommit !== undefined && !sha(record.softwareCommit, 40))
          || (record.contentSha256 !== undefined && !sha(record.contentSha256, 64))
          || (record.status !== 'pending' && (!instant(record.checkedAt) || !sha(record.contentSha256, 64) || (kind === 'playback' && !sha(record.softwareCommit, 40))))) problem(id, file, 'VERIFICATION', `${kind} 核验登记无效`);
        else statuses[kind] = { status: record.status !== 'pending' && record.contentSha256 !== contentSha256 ? 'stale' : record.status, checkedAt: record.checkedAt || null, softwareCommit: record.softwareCommit || null };
      }
    }
    const tracked = committedFiles ? [file, captureFile, ...imageFiles].filter(Boolean).every(source => committedFiles.has(relative(source))) : null;
    let assetRevision = { status: 'unknown', commit: null, changedAt: null, dirty: null, tracked };
    if (git && captureFile) {
      try {
        const sources = [relative(file), relative(path.dirname(captureFile))];
        const log = execFileSync('git', ['log', '-1', '--format=%H%n%cI', '--', ...sources], { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n');
        const dirty = !!execFileSync('git', ['status', '--porcelain', '--', ...sources], { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (sha(log[0], 40)) assetRevision = { status: 'recorded', commit: log[0], changedAt: log[1], dirty, tracked };
      } catch { /* Standalone copied manuals need not have a Git checkout. */ }
    }
    const registered = sha(provenance.softwareCommit, 40) && instant(provenance.capturedAt);
    lessons.push({ id, title: lesson.title, file: relative(file), captureFile: captureFile ? relative(captureFile) : null, lesson, capture, track: lesson.track || '采购结算与付款', order: lesson.order, stepCount: steps.length, imageCount: imageFiles.size, imageFiles: [...imageFiles].map(relative), contentSha256, provenance: { status: registered ? 'registered' : 'unknown', softwareCommit: registered ? provenance.softwareCommit : null, capturedAt: registered ? provenance.capturedAt : null }, verification: statuses, assetRevision });
  }
  const ids = new Set();
  for (const row of lessons) {
    if (ids.has(row.id)) problem(row.id, path.join(rootDir, row.file), 'DUPLICATE_ID', '课程 ID 重复');
    ids.add(row.id);
  }
  for (const row of lessons) if (row.lesson.nextLesson && !ids.has(row.lesson.nextLesson.id)) problem(row.id, path.join(rootDir, row.file), 'NEXT_MISSING', '下一课不存在');
  const order = track => MANUAL_TRACKS.includes(track) ? MANUAL_TRACKS.indexOf(track) : MANUAL_TRACKS.length;
  lessons.sort((a, b) => order(a.track) - order(b.track) || String(a.track).localeCompare(String(b.track)) || a.order - b.order || a.id.localeCompare(b.id));
  const tracks = [...new Set(lessons.map(row => row.track))].map(name => {
    const rows = lessons.filter(row => row.track === name);
    return { name, lessons: rows.length, steps: rows.reduce((n, row) => n + row.stepCount, 0), images: rows.reduce((n, row) => n + row.imageCount, 0) };
  });
  return { lessons, tracks, totals: { lessons: lessons.length, steps: lessons.reduce((n, row) => n + row.stepCount, 0), images: images.size }, issues, verification: {
    provenanceRegistered: lessons.filter(row => row.provenance.status === 'registered').length,
    provenanceUnknown: lessons.filter(row => row.provenance.status === 'unknown').length,
    playback: Object.fromEntries(['unknown', 'pending', 'passed', 'failed', 'stale'].map(status => [status, lessons.filter(row => row.verification.playback.status === status).length])),
    employee: Object.fromEntries(['unknown', 'pending', 'accepted', 'changes-requested', 'stale'].map(status => [status, lessons.filter(row => row.verification.employee.status === status).length])),
  } };
}

export function requireTrackedLessonSources(catalog) {
  const missing = catalog.lessons.filter(row => row.assetRevision.tracked !== true);
  if (missing.length) throw new Error(`正式教学构建需要已纳入Git的课程与引用素材：${missing.map(row => row.id).join('、')}`);
}

/** Only non-personal, repository-relative teaching metadata may enter the published package. */
export function publicManualCatalog(catalog, build) {
  const publishedBuild = { productVersion: typeof build.productVersion === 'string' ? build.productVersion : null, commit: typeof build.commit === 'string' && /^[a-f0-9]{7,40}$/.test(build.commit) ? build.commit : 'unknown', generatedAt: instant(build.generatedAt) ? build.generatedAt : null, localChanges: Number.isInteger(build.localChanges) && build.localChanges >= 0 ? build.localChanges : null };
  return { schemaVersion: 1, build: publishedBuild, totals: catalog.totals, tracks: catalog.tracks, courses: catalog.lessons.map(row => ({ id: row.id, title: row.title, track: row.track, capture: row.lesson.capture, steps: row.stepCount, images: row.imageCount, contentSha256: row.contentSha256, provenance: row.provenance, verification: row.verification, assetRevision: row.assetRevision })) };
}
