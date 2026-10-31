import fs from 'node:fs';
import path from 'node:path';

const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 读取 scripts/manual-capture.mjs 采集的真实界面帧；步骤数必须与课程一致。 */
export function loadCapture(wikiDir, lesson) {
  const file = path.join(wikiDir, 'assets/lessons', lesson.capture, 'capture.json');
  if (!fs.existsSync(file)) throw new Error(`${lesson.title}：缺少界面采集 ${path.relative(wikiDir, file)}（先运行 node scripts/manual-capture.mjs ${lesson.capture}）`);
  const capture = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (capture.frames.length !== lesson.steps.length) throw new Error(`${lesson.title}：采集 ${capture.frames.length} 帧，课程写了 ${lesson.steps.length} 步`);
  return capture;
}

/**
 * 引导式演示：每步一张真实界面截图，镜头推近到要操作的控件，压暗其余区域，
 * 光标移入并点击 / 输入，旁边气泡说明。读者可连续播放、暂停、重播本步，或自己点亮起的位置练习。
 */
export function renderLesson(lesson, capture, { assetVersion = '' } = {}) {
  const n = lesson.steps.length, base = `assets/lessons/${lesson.capture}/`;
  const source = image => base + (assetVersion ? `${encodeURIComponent(assetVersion)}/` : '') + image;
  const { width: W, height: H } = capture.viewport;
  const frames = capture.frames.map((f, i) => ({ src: source(f.image), x: f.target.x / W, y: f.target.y / H, w: f.target.width / W, h: f.target.height / H, kind: lesson.steps[i].kind || 'click', value: f.value || '', tip: lesson.steps[i].tip || lesson.steps[i].do }));
  const stepPanel = (s, i) => `<div class="lesson-panel" data-step-panel="${i}"${i ? ' hidden' : ''}>
   <p class="lesson-panel-count">第 ${i + 1} 步 / 共 ${n} 步</p>
   <h2 tabindex="-1">${esc(s.title)}</h2>
   <dl class="lesson-facts">
    <dt>操作</dt><dd>${esc(s.do)}</dd>
    ${s.fill ? `<dt>填写</dt><dd><span class="lesson-fill">${esc(s.fill)}</span></dd>` : ''}
    <dt>完成后</dt><dd>${esc(s.see)}</dd>
    ${s.quiz ? `<dt>想一想</dt><dd><p class="lesson-quiz-q">${esc(s.quiz.question)}</p><div class="lesson-choice" role="group" aria-label="${esc(s.quiz.question)}">${s.quiz.options.map((o, k) => `<button type="button" data-choice="${k}"${o.correct ? ' data-correct' : ''} data-reply="${esc(o.reply)}">${esc(o.label)}</button>`).join('')}</div><p class="lesson-reply" data-choice-reply aria-live="polite" hidden></p></dd>` : ''}
   </dl>
   ${s.failure ? `<details class="lesson-trouble"><summary>${esc(s.failure.title)}</summary><p>${esc(s.failure.text)}</p></details>` : ''}
  </div>`;
  return `<section id="${esc(lesson.id)}" class="chapter lesson" data-lesson data-frames="${esc(JSON.stringify(frames))}" data-result="${esc(source(capture.result))}" data-aspect="${H / W}">
 <p class="lesson-kicker">${esc(lesson.role)} · 分步教学</p>
 <h1>${esc(lesson.title)}</h1>
 <div class="lesson-meta">
  <span><small>谁来做</small>${esc(lesson.role)}</span><span><small>接手</small>${esc(lesson.handoff)}</span>
  <span><small>开始前</small>${esc(lesson.prerequisite)}</span><span><small>入口</small>${esc(lesson.entry)}</span>
 </div>
 <ol class="lesson-rail" style="--rail-n:${n}" aria-label="学习步骤">${lesson.steps.map((s, i) => `<li><button type="button" data-step="${i}" aria-label="${esc(`第${i + 1}步：${s.title}`)}"${i ? '' : ' aria-current="step"'}><span class="rail-n">${i + 1}</span><span class="rail-t">${esc(s.title)}</span></button></li>`).join('')}</ol>
 <div class="lesson-work">
  <div class="lesson-side">${lesson.steps.map(stepPanel).join('')}</div>
  <div class="lesson-stage" data-stage>
   <p class="lesson-player-state" data-player-state aria-live="polite">也可以直接点亮起的位置练习</p>
   <div class="lesson-media-error" data-media-error role="alert" hidden><p>画面未能加载，请重新加载课程。</p><button type="button" data-media-reload>重新加载课程</button></div>
   <div class="shot" data-shot>
    <div class="shot-camera" data-camera>
     <img class="shot-img" data-img alt="" decoding="async">
     <img class="shot-img shot-next" data-img-next alt="" decoding="async" hidden>
     <div class="shot-spot" data-spot></div>
     <div class="shot-value" data-value hidden></div>
     <button type="button" class="shot-hotspot" data-hotspot></button>
     <div class="shot-cursor" data-cursor hidden></div>
    </div>
    <p class="shot-tip" data-tip hidden></p>
    <p class="shot-hint" data-hint aria-live="polite" hidden></p>
    <span class="shot-label">本地演示数据</span>
   </div>
  </div>
 </div>
 <div class="lesson-footer"><button type="button" data-lesson-prev disabled>上一步</button><div class="lesson-player" role="group" aria-label="演示控制"><button type="button" class="lesson-play" data-play aria-label="播放演示">▶ 播放演示</button><button type="button" class="lesson-ghost" data-replay aria-label="重播本步">↻<span class="lesson-btn-text"> 重播本步</span></button><span data-step-status>第 1 步 / 共 ${n} 步</span></div><button type="button" data-lesson-next>下一步</button></div>
 <div class="lesson-done" data-lesson-done hidden>
  <h2 tabindex="-1">${esc(lesson.doneTitle)}</h2><p>${esc(lesson.result)}</p>
  <ol class="lesson-chain">${lesson.chain.map((c, i) => `<li${i === (lesson.chainAt || 0) ? ' class="me"' : ''}>${esc(c)}</li>`).join('')}</ol>
  ${lesson.nextLesson ? `<a class="lesson-next-link" href="#${esc(lesson.nextLesson.id)}">下一课：${esc(lesson.nextLesson.title)} →</a>` : ''}
  <button type="button" data-lesson-restart>重新学习</button>
 </div>
 <div class="lesson-sop"><h2>SOP 速查</h2><dl>${lesson.sop.map(r => `<dt>${esc(r.title)}</dt><dd>${esc(r.text)}</dd>`).join('')}</dl></div>
 <p class="lesson-review-note">画面为 Bambook 实际界面，使用本地演示公司数据录制，不涉及真实客户或资金。</p>
</section>`;
}

export const lessonStyles = `
.lesson{--l-accent:#34768D;--l-accent-ink:#275768;--l-tint:rgba(52,118,141,.09);--l-tint-2:rgba(52,118,141,.16);--l-fill:rgba(16,42,58,.045);--l-ring:#2f9bd0}
.lesson h1{font-size:32px;line-height:1.3;margin:8px 0 14px}.lesson-kicker{font-size:13px;letter-spacing:.06em;color:var(--l-accent);margin:0}
.lesson-meta{display:flex;flex-wrap:wrap;gap:10px 28px;font-size:14px;color:var(--ink-2);margin:0 0 22px}.lesson-meta small{display:block;font-size:12px;color:var(--ink-3);line-height:1.6}
.lesson-rail{display:grid;grid-template-columns:repeat(var(--rail-n,5),minmax(0,1fr));gap:6px;list-style:none;padding:0;margin:0 0 16px}.lesson-rail li{margin:0;padding:0}
.lesson-rail button{display:flex;align-items:center;gap:8px;width:100%;height:100%;font:inherit;font-size:13px;line-height:1.4;border:0;border-radius:10px;background:var(--l-fill);color:var(--ink-2);padding:10px;text-align:left;cursor:pointer}
.rail-n{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#fff;flex-shrink:0;font-size:12px}
.lesson-rail button[aria-current]{background:var(--l-tint-2);color:var(--l-accent-ink);font-weight:500}.lesson-rail button[aria-current] .rail-n{background:var(--l-accent);color:#fff}
.lesson-rail button.done .rail-n{background:#dcebe3;color:#2f6a4f;font-size:0}.lesson-rail button.done .rail-n::before{content:"✓";font-size:12px}
.lesson-work{display:grid;grid-template-columns:minmax(230px,280px) minmax(0,1fr);border-radius:16px;overflow:hidden;background:var(--l-fill)}
.lesson-side{background:#fff;padding:22px;border:1px solid var(--line);border-right:0;border-radius:16px 0 0 16px}
.lesson-panel-count{font-size:12px;color:var(--ink-3);margin:0}.lesson-panel h2{font-size:20px;margin:2px 0 12px;padding:0}.lesson-panel h2:focus{outline:none}
.lesson-facts{margin:0;display:grid;gap:4px}.lesson-facts dt{font-size:12px;color:var(--ink-3);margin-top:8px}.lesson-facts dd{margin:0;font-size:14.5px;line-height:1.7;color:var(--ink)}
.lesson-fill{display:inline-block;background:#fff6d8;border-radius:6px;padding:1px 8px;font-size:14px}
.lesson-quiz-q{margin:0 0 6px}.lesson-choice{display:flex;flex-wrap:wrap;gap:8px}.lesson-choice button{font:inherit;font-size:14px;border:0;border-radius:9px;padding:7px 14px;background:var(--l-fill);cursor:pointer}.lesson-choice button.right{background:#dcebe3;color:#2f6a4f}.lesson-choice button.wrong{background:#f6e3df;color:#94463a}
.lesson-reply{font-size:13.5px;margin:8px 0 0;color:var(--ink-2)}
.lesson-trouble{margin-top:16px;border-radius:10px;background:#faf6ee;padding:10px 14px}.lesson-trouble summary{cursor:pointer;font-size:13.5px;color:#7a5a2c}.lesson-trouble p{font-size:13.5px;margin:8px 0 0;color:var(--ink-2)}
.lesson-stage{padding:14px 16px 16px;display:flex;flex-direction:column;gap:10px;min-width:0;scroll-margin-top:72px}
.lesson-player{display:flex;align-items:center;gap:8px}
.lesson-footer .lesson-play{background:var(--l-tint-2);color:var(--l-accent-ink)}.lesson-footer .lesson-ghost{background:var(--l-fill);color:var(--ink-2)}
.lesson-player-state{font-size:12.5px;color:var(--ink-3);margin:0}
.shot{position:relative;width:100%;aspect-ratio:16/10;overflow:hidden;border-radius:12px;background:#dfe7ea;box-shadow:0 10px 30px rgba(16,42,58,.12);--px:1px;--inv:1}
.shot-camera{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:0 0;transition:transform .8s cubic-bezier(.45,.05,.2,1)}
.shot-img{position:absolute;inset:0;width:100%;height:100%;display:block;transition:opacity .45s ease}.shot-next{opacity:0}
.shot-spot{position:absolute;border-radius:calc(var(--px)*10);box-shadow:0 0 0 calc(var(--px)*3) var(--l-ring),0 0 0 200vmax rgba(14,26,33,0);transition:box-shadow .5s ease;pointer-events:none}
.shot[data-dim] .shot-spot{box-shadow:0 0 0 calc(var(--px)*3) var(--l-ring),0 0 0 200vmax rgba(14,26,33,.3)}
.shot[data-practice] .shot-spot{animation:shot-pulse 1.6s ease-in-out infinite}
@keyframes shot-pulse{50%{box-shadow:0 0 0 calc(var(--px)*7) rgba(47,155,208,.5),0 0 0 200vmax rgba(14,26,33,.3)}}
.shot-hotspot{position:absolute;border:0;background:transparent;padding:0;cursor:pointer;border-radius:calc(var(--px)*10);min-width:calc(var(--px)*30);min-height:calc(var(--px)*30)}.shot-hotspot:focus-visible{outline:3px solid #fff;outline-offset:2px}
.shot-value{position:absolute;display:flex;align-items:center;padding-left:calc(var(--px)*12);font-size:calc(var(--px)*14);color:#0E1A21;white-space:nowrap;overflow:hidden;pointer-events:none;background:rgba(237,240,241,.96);border-radius:calc(var(--px)*10)}
.shot-value.check{background:none;padding-left:0}.shot-value.check::before{content:"✓";display:grid;place-items:center;width:calc(var(--px)*20);height:calc(var(--px)*20);border-radius:calc(var(--px)*5);background:#34768D;color:#fff;font-size:calc(var(--px)*14)}
.shot-cursor{position:absolute;width:calc(var(--px)*26);height:calc(var(--px)*26);pointer-events:none;transform:scale(var(--inv));transform-origin:0 0;transition:left .75s cubic-bezier(.45,.05,.2,1),top .75s cubic-bezier(.45,.05,.2,1),transform .8s;background:no-repeat center/contain url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 2l15 11-7 1-4 7z' fill='%230E1A21' stroke='white' stroke-width='1.6' stroke-linejoin='round'/%3E%3C/svg%3E");z-index:3}
.shot-cursor.click::after{content:"";position:absolute;left:-40%;top:-40%;width:80%;height:80%;border-radius:50%;border:calc(var(--px)*2.5) solid var(--l-ring);animation:shot-ripple .55s ease-out forwards}
@keyframes shot-ripple{from{transform:scale(.3);opacity:1}to{transform:scale(1.8);opacity:0}}
.shot-tip{position:absolute;margin:0;width:max-content;max-width:min(320px,80%);background:#0E1A21;color:#fff;font-size:13.5px;line-height:1.5;padding:9px 13px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:4}
.shot-hint{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);margin:0;background:#fff;color:#0E1A21;font-size:12.5px;padding:6px 12px;border-radius:8px;z-index:5;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.15)}
.shot-label{position:absolute;right:8px;bottom:8px;font-size:11px;color:#fff;background:rgba(14,26,33,.45);padding:2px 8px;border-radius:6px;z-index:4;pointer-events:none}
.lesson-footer{position:sticky;bottom:0;z-index:5;display:flex;justify-content:space-between;align-items:center;margin:16px 0 0;padding:12px 0;background:#fffffff2;backdrop-filter:blur(10px);border-top:1px solid var(--line)}
.lesson-footer button,.lesson-done button,.lesson-media-error button{font:inherit;border:0;border-radius:9px;padding:10px 18px;cursor:pointer;background:var(--l-fill);color:var(--ink-2)}.lesson-footer [data-lesson-next]{background:var(--l-accent);color:#fff}.lesson-footer button:disabled{opacity:.4;cursor:default}.lesson-footer span{font-size:13px;color:var(--ink-3)}
.lesson-media-error{padding:12px;border-radius:10px;background:var(--bg);color:var(--ink-2)}.lesson-media-error p{margin:0 0 8px}
.lesson-footer [data-lesson-next].ready{box-shadow:0 0 0 4px var(--l-tint-2)}
.lesson-done{margin-top:20px;padding:22px 24px;background:#eef5f1;border-radius:14px}.lesson-done h2{margin:0 0 8px;padding:0}.lesson-done h2:focus{outline:none}.lesson-done p{margin:0 0 12px}
.lesson-chain{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:0 0 16px;font-size:13px}.lesson-chain li{margin:0;padding:5px 10px;border-radius:999px;background:#fff;color:#456b58}.lesson-chain li.me{background:#2f6a4f;color:#fff}.lesson-chain li+li::before{content:"→ ";color:#8aa596}
.lesson-next-link{display:inline-block;margin:0 16px 12px 0;font-weight:500}
.lesson-sop{margin-top:28px}.lesson-sop h2{font-size:17px;margin:0 0 8px}.lesson-sop dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 20px;margin:0;font-size:14px}.lesson-sop dt{color:var(--ink-3)}.lesson-sop dd{margin:0}
.lesson-review-note{font-size:12px;color:var(--ink-3);margin-top:24px}
.lesson button:focus-visible,.lesson summary:focus-visible{outline:3px solid var(--l-ring);outline-offset:3px}
@media(max-width:1060px){.lesson-work{grid-template-columns:1fr}.lesson-side{border-right:1px solid var(--line);border-bottom:0;border-radius:16px 16px 0 0}}
@media(max-width:700px){.lesson-footer button{padding:10px 12px}.lesson-footer [data-step-status]{display:none}.lesson-btn-text{display:none}.lesson-footer button{white-space:nowrap}.lesson-footer .lesson-play,.lesson-footer .lesson-ghost{min-width:44px}.lesson-footer .lesson-player{gap:6px}.lesson h1{font-size:26px}.lesson-meta{gap:8px 20px}.lesson-rail{display:flex;overflow-x:auto;scrollbar-width:none;margin:0 -20px 14px;padding:0 20px}.lesson-rail li{flex:0 0 auto}.lesson-rail button{padding:8px 10px}.lesson-rail button:not([aria-current]) .rail-t{display:none}
.lesson-work{margin:0 -20px;border-radius:0}.lesson-side{border-radius:0;border-left:0;border-right:0;padding:18px 20px}.lesson-stage{padding:12px 10px 16px}.shot{aspect-ratio:1/1;border-radius:10px}.shot-tip{font-size:12.5px;max-width:86%}
.lesson-sop dl{grid-template-columns:1fr;gap:2px}.lesson-sop dd{margin-bottom:8px}}
@media(prefers-reduced-motion:reduce){.shot-camera,.shot-cursor,.shot-img{transition:none}.shot[data-practice] .shot-spot{animation:none}}
`;

/**
 * 在浏览器里运行（构建时以源码字符串内联）。不访问网络、不提交业务。
 * 坐标以截图比例（0–1）表示。相机宽 = 画框宽、高按截图比例；放大 z 倍后平移，使目标居中且画面不露边。
 * k = 画框高 / 相机高：画框比截图“高”（窄屏）时 k > 1，至少放大到 k 才能铺满。
 */
function lessonMain(doc) {
  const lessons = [...doc.querySelectorAll('[data-lesson]')], controllers = new Map();
  const mount = lesson => {
    if (controllers.has(lesson)) return;
    const $ = s => lesson.querySelector(s), $$ = s => [...lesson.querySelectorAll(s)];
    const frames = JSON.parse(lesson.dataset.frames), resultSrc = lesson.dataset.result, imgAspect = Number(lesson.dataset.aspect) || .625;
    const shot = $('[data-shot]'), camera = $('[data-camera]'), img = $('[data-img]'), imgNext = $('[data-img-next]'), spot = $('[data-spot]'), valueBox = $('[data-value]'), hotspot = $('[data-hotspot]'), cursor = $('[data-cursor]'), tip = $('[data-tip]'), hint = $('[data-hint]');
    const panels = $$('[data-step-panel]'), rail = $$('[data-step]'), play = $('[data-play]'), playerState = $('[data-player-state]');
    const next = $('[data-lesson-next]'), prev = $('[data-lesson-prev]'), done = $('[data-lesson-done]');
    const mediaError = $('[data-media-error]'), replay = $('[data-replay]');
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
    let step = 0, completed = new Set(), run = null, playing = false, hintTimer = 0, cursorAt = { x: .5, y: .5 }, cam = { z: 1, tx: 0, ty: 0, k: 1 }, target = frames[0], loadEpoch = 0, mediaLoading = false, mediaFailed = false;

    const pct = v => (v * 100).toFixed(3) + '%';
    const place = (el, f) => { el.style.left = pct(f.x); el.style.top = pct(f.y); el.style.width = pct(f.w); el.style.height = pct(f.h); };
    const setCamera = (z, cx = .5, cy = .5) => {
      const w = shot.clientWidth || 1000, h = shot.clientHeight || w * imgAspect, k = (h / w) / imgAspect;
      const zz = Math.max(z, k, 1), clamp = (v, lo) => Math.min(0, Math.max(lo, v));
      cam = { z: zz, tx: clamp(.5 - cx * zz, 1 - zz), ty: clamp(k / 2 - cy * zz, k - zz), k };
      shot.style.setProperty('--px', (w / 1440) + 'px'); shot.style.setProperty('--inv', String(1 / zz));
      camera.style.height = pct(1 / k);
      camera.style.transform = `translate(${pct(cam.tx)},${pct(cam.ty)}) scale(${zz})`;
    };
    // 桌面：推近到能看清文字，并让整个目标留在画面内（目标宽度不超过画框的 92%）。
    // 手机：截图整体太小，优先可读——固定约 3.2 倍；目标比画框宽时，对准它的起始处（标签和输入内容所在）。
    const focusZoom = f => narrow() ? 3.2 : Math.max(1, Math.min(1 / Math.max(f.w * 1.25, .38), .92 / Math.max(f.w, .01), 2.6));
    const zoomTo = f => { const z = focusZoom(f), cx = f.w * z > .9 ? f.x + .45 / z : f.x + f.w / 2; setCamera(z, cx, f.y + f.h / 2); };
    const onScreen = (x, y) => ({ x: cam.tx + x * cam.z, y: (cam.ty + y * cam.z) / cam.k });
    const showTip = f => {
      tip.textContent = f.tip; tip.hidden = false;
      const bottom = onScreen(f.x + f.w / 2, f.y + f.h), top = onScreen(f.x + f.w / 2, f.y), x = Math.min(.97, Math.max(.03, bottom.x)), below = bottom.y < .7;
      tip.style.left = pct(x); tip.style.top = pct(below ? bottom.y : top.y);
      tip.style.transform = `translate(-${Math.round(x * 100)}%, ${below ? '12px' : 'calc(-100% - 12px)'})`;
    };
    const say = (text, ms = 2200) => { clearTimeout(hintTimer); hint.textContent = text; hint.hidden = !text; if (text) hintTimer = setTimeout(() => { hint.hidden = true; }, ms); };
    const setPlayer = (label, pressed, status) => { play.textContent = narrow() ? label.slice(0, 1) : label; play.setAttribute('aria-label', label.slice(2).trim()); play.dataset.state = pressed ? 'playing' : 'idle'; playerState.textContent = status; };
    const mediaControls = () => { play.disabled = mediaFailed || (mediaLoading && !playing); replay.disabled = hotspot.disabled = mediaFailed || mediaLoading; next.disabled = mediaFailed || mediaLoading || !done.hidden; };
    const idle = () => { playing = false; mediaControls(); setPlayer('▶ 播放演示', false, mediaFailed ? '画面未能加载' : mediaLoading ? '正在加载画面…' : !done.hidden ? '本课已完成，可查看下方交接' : completed.has(step) ? '这一步已完成，可以点「下一步」' : '也可以直接点亮起的位置练习'); };
    const loadImage = (element, src, r) => new Promise(resolve => {
      const epoch = loadEpoch, started = Date.now(); mediaLoading = true; mediaFailed = false; mediaError.hidden = true; mediaControls();
      if (!r?.paused) playerState.textContent = '正在加载画面…';
      if (element.getAttribute('src') !== src) element.src = src;
      const check = () => {
        if (epoch !== loadEpoch || r?.cancelled || element.getAttribute('src') !== src) { resolve(false); return; }
        if (element.complete || Date.now() - started >= 15000) {
          mediaLoading = false;
          const ok = element.complete && element.naturalWidth > 0;
          if (!ok) { stop(); playing = false; mediaFailed = true; mediaError.hidden = false; hotspot.hidden = spot.hidden = cursor.hidden = tip.hidden = true; }
          mediaControls();
          if (!playing) idle(); else playerState.textContent = r?.paused ? '已暂停' : '演示中…';
          resolve(ok); return;
        }
        setTimeout(check, 50);
      };
      check();
    });

    // 暂停时计时停止；每次至少等一个计时周期，逐字输入才看得到。
    const wait = (r, ms) => new Promise(resolve => { let left = reduced ? Math.min(ms, 150) : ms; const slice = Math.min(50, Math.max(10, left)); const tick = () => { if (r.cancelled) return resolve(false); if (!r.paused) left -= slice; if (left <= 0) return resolve(true); setTimeout(tick, slice); }; setTimeout(tick, slice); });
    const swap = async (src, r) => {
      const epoch = loadEpoch;
      if (img.getAttribute('src') === src && img.complete && img.naturalWidth > 0) return true;
      if (!await loadImage(imgNext, src, r) || epoch !== loadEpoch) return false;
      imgNext.hidden = false; void imgNext.offsetWidth; imgNext.style.opacity = '1';
      const ok = !r || await wait(r, 450); if (!ok || epoch !== loadEpoch) return false;
      img.src = src; imgNext.style.opacity = '0'; imgNext.hidden = true; return true;
    };
    const showFrame = (i, r) => {
      target = frames[i]; place(spot, target); place(hotspot, target); place(valueBox, target);
      hotspot.setAttribute('aria-label', target.tip); hotspot.hidden = false; spot.hidden = false;
      valueBox.hidden = true; valueBox.textContent = ''; valueBox.className = 'shot-value'; tip.hidden = true;
      return loadImage(img, target.src, r);
    };
    const moveCursor = (x, y) => { cursorAt = { x, y }; cursor.style.left = pct(x); cursor.style.top = pct(y); };
    const perform = async (r, f) => {
      cursor.hidden = false; moveCursor(f.x + Math.min(f.w * .5, .03), f.y + f.h * .55);
      if (r && !await wait(r, 600)) return false;
      cursor.classList.remove('click'); void cursor.offsetWidth; cursor.classList.add('click');
      if (f.kind === 'check') { valueBox.className = 'shot-value check'; valueBox.hidden = false; }
      if (f.kind === 'type' || f.kind === 'select') {
        valueBox.hidden = false; valueBox.textContent = '';
        if (f.kind === 'select' || !r) valueBox.textContent = f.value;
        else { const per = Math.max(10, Math.min(40, Math.floor(900 / Math.max(1, f.value.length)))); for (const ch of f.value) { valueBox.textContent += ch; if (!await wait(r, per)) return false; } }
      }
      return !r || wait(r, 450);
    };
    const markStep = () => {
      panels.forEach((p, k) => { p.hidden = k !== step; });
      rail.forEach((b, k) => { if (k === step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
      prev.disabled = step === 0; next.disabled = false; next.classList.remove('ready'); next.textContent = '下一步';
      $('[data-step-status]').textContent = `第 ${step + 1} 步 / 共 ${frames.length} 步`;
    };
    const complete = () => { completed.add(step); rail[step].classList.add('done'); next.classList.add('ready'); shot.removeAttribute('data-practice'); if (step === frames.length - 1) next.textContent = '看结果'; };
    const finish = async r => {
      shot.removeAttribute('data-dim'); shot.removeAttribute('data-practice'); hotspot.hidden = true; spot.hidden = true; cursor.hidden = true; valueBox.hidden = true; tip.hidden = true;
      setCamera(1); if (!await swap(resultSrc, r)) return;
      done.hidden = false; next.disabled = true; next.textContent = '已完成'; playerState.textContent = '本课已完成，可查看下方交接'; done.querySelector('h2').focus({ preventScroll: true });
    };
    const stop = () => { loadEpoch++; mediaLoading = false; if (run) { run.cancelled = true; run = null; } imgNext.hidden = true; cursor.classList.remove('click'); };
    // 练习：先给全局画面，片刻后推近到操作位置并亮起，读者知道这一步在页面的哪里。
    const go = (i, user) => {
      stop(); step = Math.max(0, Math.min(frames.length - 1, i)); markStep();
      done.hidden = true; say(''); completed.delete(step); rail[step].classList.remove('done');
      setCamera(1); cursor.hidden = true; shot.setAttribute('data-dim', ''); shot.setAttribute('data-practice', '');
      const r = run = { cancelled: false, paused: false };
      showFrame(step, r).then(ok => ok && wait(r, 550)).then(ok => ok && (zoomTo(target), wait(r, 850))).then(ok => { if (ok && run === r) { showTip(target); run = null; } });
      idle();
      if (user && narrow()) $('[data-stage]').scrollIntoView?.({ block: 'start' });
    };
    const demoStep = async r => {
      const f = frames[step];
      if (!await showFrame(step, r)) return false;
      shot.setAttribute('data-dim', ''); shot.removeAttribute('data-practice'); setCamera(1);
      cursor.hidden = false; moveCursor(cursorAt.x, cursorAt.y);
      if (!await wait(r, 350)) return false;
      zoomTo(f); if (!await wait(r, 650)) return false;
      showTip(f);
      if (!await perform(r, f)) return false;
      complete(); return true;
    };
    const playAll = async () => {
      const r = run = { cancelled: false, paused: false }; playing = true; setPlayer('❚❚ 暂停', true, '演示中…');
      done.hidden = true; completed.delete(step); rail[step].classList.remove('done');
      for (;;) {
        if (!await demoStep(r)) return;
        if (step === frames.length - 1) { await finish(r); break; }
        if (!await wait(r, 250)) return;
        tip.hidden = true; setCamera(1); if (!await wait(r, 350)) return;
        step++; markStep(); completed.delete(step); rail[step].classList.remove('done');
        if (!await swap(frames[step].src, r)) return;
      }
      if (run === r) run = null; idle();
    };

    play.addEventListener('click', () => {
      if (!playing) { stop(); void playAll(); return; }
      run.paused = !run.paused;
      setPlayer(run.paused ? '▶ 继续' : '❚❚ 暂停', true, run.paused ? '已暂停' : '演示中…');
    });
    $('[data-replay]').addEventListener('click', async () => {
      stop(); done.hidden = true; completed.delete(step); rail[step].classList.remove('done'); markStep();
      const r = run = { cancelled: false, paused: false }; playing = true; setPlayer('❚❚ 暂停', true, '演示中…');
      if (await demoStep(r) && run === r) { run = null; idle(); }
    });
    hotspot.addEventListener('click', async event => {
      event.stopPropagation(); if (completed.has(step) || playing) return;
      stop(); zoomTo(target); showTip(target); await perform(null, target); complete(); idle();
    });
    shot.addEventListener('click', () => { if (!completed.has(step) && !playing && done.hidden) say('点击亮起的位置'); });
    $$('[data-choice]').forEach(b => b.addEventListener('click', () => {
      const group = b.parentElement, reply = group.parentElement.querySelector('[data-choice-reply]'), right = b.hasAttribute('data-correct');
      [...group.children].forEach(x => x.classList.remove('right', 'wrong')); b.classList.add(right ? 'right' : 'wrong');
      reply.hidden = false; reply.textContent = b.dataset.reply;
    }));
    rail.forEach((b, i) => b.addEventListener('click', () => go(i, true)));
    prev.addEventListener('click', () => go(step - 1, true));
    next.addEventListener('click', () => {
      if (step === frames.length - 1) { stop(); if (!completed.has(step)) complete(); idle(); void finish(null); return; }
      if (!completed.has(step)) complete();
      go(step + 1, true); panels[step].querySelector('h2').focus({ preventScroll: true });
    });
    $('[data-lesson-restart]').addEventListener('click', () => { completed.clear(); rail.forEach(b => b.classList.remove('done')); go(0); lesson.scrollIntoView?.({ block: 'start' }); });
    $('[data-media-reload]').addEventListener('click', () => globalThis.location.reload());
    const refresh = () => {
      if (!mediaFailed && !mediaLoading && (!img.complete || !img.naturalWidth)) {
        const r = run = { cancelled: false, paused: false };
        void showFrame(step, r).then(ok => { if (ok && run === r) { zoomTo(target); showTip(target); run = null; } });
      } else if (cam.z > 1 && done.hidden) zoomTo(target); else setCamera(1);
    };
    globalThis.addEventListener?.('resize', () => { if (!lesson.hidden) refresh(); });
    controllers.set(lesson, { pause: () => { stop(); clearTimeout(hintTimer); idle(); }, refresh });
    go(0);
  };
  // Hidden courses must not load images or run animations. Search can expose several courses;
  // use the viewport observer so only the one being read is initialized.
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting && !entry.target.hidden) { mount(entry.target); controllers.get(entry.target)?.refresh(); }
      else controllers.get(entry.target)?.pause();
    }
  }) : null;
  for (const lesson of lessons) observer?.observe(lesson);
  const changed = () => {
    for (const lesson of lessons) {
      if (lesson.hidden) controllers.get(lesson)?.pause();
      else if (!observer) { mount(lesson); controllers.get(lesson)?.refresh(); }
    }
  };
  globalThis.addEventListener?.('hashchange', changed);
  doc.getElementById('q')?.addEventListener('input', changed);
  changed();
}

export const lessonRuntime = `(${lessonMain.toString()})(document);`;
