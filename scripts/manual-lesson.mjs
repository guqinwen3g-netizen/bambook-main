import { lessonMocks } from './manual-lesson-mocks.mjs';

const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 分步教学：左侧步骤说明，右侧演练窗口（模板见 manual-lesson-mocks.mjs）。
 * lesson.initial 是演练开始时的界面状态，每步的 after 是该步完成后的变化；
 * 跳到任意一步时把前面各步的 after 依次合并，所以“下一步 / 跳步 / 重播”不依赖读者是否亲手做过前一步。
 */
export function renderLesson(lesson) {
  const e = lesson.example, n = lesson.steps.length, mock = lessonMocks[lesson.template];
  if (!mock) throw new Error(`${lesson.title}：未知演练模板 ${lesson.template}`);
  const stepPanel = (s, i) => `<div class="lesson-panel" data-step-panel="${i}"${i ? ' hidden' : ''}>
   <p class="lesson-panel-count">第 ${i + 1} 步 / 共 ${n} 步</p>
   <h2 tabindex="-1">${esc(s.title)}</h2>
   <dl class="lesson-facts">
    <dt>操作</dt><dd>${esc(s.do)}</dd>
    ${s.fill ? `<dt>填写</dt><dd><span class="lesson-fill">${esc(s.fill)}</span></dd>` : ''}
    ${s.kind === 'choice' ? `<dt>选择</dt><dd><div class="lesson-choice" role="group" aria-label="${esc(s.do)}">${s.options.map((o, k) => `<button type="button" data-choice="${k}"${o.correct ? ' data-correct' : ''}>${esc(o.label)}</button>`).join('')}</div><p class="lesson-reply" data-choice-reply aria-live="polite" hidden></p></dd>` : ''}
    <dt>完成后</dt><dd>${esc(s.see)}</dd>
   </dl>
   ${s.failure ? `<details class="lesson-trouble" data-trouble>
    <summary>${esc(s.failure.title)}</summary><p>${esc(s.failure.text)}</p>
    ${s.failure.preview ? `<button type="button" class="lesson-link" data-preview>在演练窗口里看看</button>` : ''}
   </details>` : ''}
  </div>`;
  const runtimeSteps = lesson.steps.map(s => ({ target: s.target, kind: s.kind, do: s.do, input: s.input || '', text: s.kind === 'type' ? s.fill : '', after: s.after, preview: s.failure?.preview || null, options: s.kind === 'choice' ? s.options.map(o => ({ reply: o.reply, target: o.target || '' })) : null }));
  return `<section id="${esc(lesson.id)}" class="chapter lesson" data-lesson data-steps="${esc(JSON.stringify(runtimeSteps))}" data-initial="${esc(JSON.stringify(lesson.initial))}">
 <p class="lesson-kicker">${esc(lesson.role)} · 分步教学</p>
 <h1>${esc(lesson.title)}</h1>
 <div class="lesson-meta">
  <span><small>谁来做</small>${esc(lesson.role)}</span><span><small>接手</small>${esc(lesson.handoff)}</span>
  <span><small>开始前</small>${esc(lesson.prerequisite)}</span><span><small>入口</small>${esc(lesson.entry)}</span>
 </div>
 <ol class="lesson-rail" style="--rail-n:${n}" aria-label="学习步骤">${lesson.steps.map((s, i) => `<li><button type="button" data-step="${i}"${i ? '' : ' aria-current="step"'}><span class="rail-n">${i + 1}</span><span class="rail-t">${esc(s.title)}</span></button></li>`).join('')}</ol>
 <div class="lesson-work">
  <div class="lesson-side">
   ${lesson.steps.map(stepPanel).join('')}
  </div>
  <div class="lesson-stage" data-stage>
   <div class="lesson-player" role="group" aria-label="演示控制">
    <button type="button" class="lesson-play" data-play aria-pressed="false">▶ 看演示</button>
    <button type="button" class="lesson-ghost" data-replay>↻ 重播</button>
    <span class="lesson-player-state" data-player-state aria-live="polite">也可以直接在蓝框处操作</span>
   </div>
   <div class="mock" data-mock>
    <div class="mock-label">教学演练 · 演示数据</div>
    <p class="mock-step" data-mock-step></p>
    ${mock(e)}
    <div class="mock-cursor" data-cursor aria-hidden="true" hidden></div>
    <p class="mock-hint" data-hint aria-live="polite" hidden></p>
   </div>
  </div>
 </div>
 <div class="lesson-footer"><button type="button" data-lesson-prev disabled>上一步</button><span data-step-status>第 1 步 / 共 ${n} 步</span><button type="button" data-lesson-next>下一步</button></div>
 <div class="lesson-done" data-lesson-done hidden>
  <h2 tabindex="-1">${esc(lesson.doneTitle)}</h2><p>${esc(lesson.result)}</p>
  <ol class="lesson-chain">${lesson.chain.map((c, i) => `<li${i === (lesson.chainAt || 0) ? ' class="me"' : ''}>${esc(c)}</li>`).join('')}</ol>
  ${lesson.nextLesson ? `<a class="lesson-next-link" href="#${esc(lesson.nextLesson.id)}">下一课：${esc(lesson.nextLesson.title)} →</a>` : ''}
  <button type="button" data-lesson-restart>重新学习</button>
 </div>
 <div class="lesson-sop"><h2>SOP 速查</h2><dl>${lesson.sop.map(r => `<dt>${esc(r.title)}</dt><dd>${esc(r.text)}</dd>`).join('')}</dl></div>
 <p class="lesson-review-note">演练窗口按 Bambook 实际页面简化重绘；示例公司和数字为演示数据，不连接任何业务库，练习不会提交业务记录。</p>
</section>`;
}

export const lessonStyles = `
.lesson{--l-accent:#34768D;--l-accent-ink:#275768;--l-tint:rgba(52,118,141,.09);--l-tint-2:rgba(52,118,141,.16);--l-fill:rgba(16,42,58,.045);--l-ring:#1d7fb0}
.lesson h1{font-size:32px;line-height:1.3;margin:8px 0 14px}.lesson-kicker{font-size:13px;letter-spacing:.06em;color:var(--l-accent);margin:0}
.lesson-meta{display:flex;flex-wrap:wrap;gap:10px 28px;font-size:14px;color:var(--ink-2);margin:0 0 22px}.lesson-meta small{display:block;font-size:12px;color:var(--ink-3);line-height:1.6}
.lesson-rail{display:grid;grid-template-columns:repeat(var(--rail-n,5),minmax(0,1fr));gap:6px;list-style:none;padding:0;margin:0 0 16px}.lesson-rail li{margin:0;padding:0}
.lesson-rail button{display:flex;align-items:center;gap:8px;width:100%;height:100%;font:inherit;font-size:13px;line-height:1.4;border:0;border-radius:10px;background:var(--l-fill);color:var(--ink-2);padding:10px;text-align:left;cursor:pointer}
.rail-n{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#fff;flex-shrink:0;font-size:12px}
.lesson-rail button[aria-current]{background:var(--l-tint-2);color:var(--l-accent-ink);font-weight:500}.lesson-rail button[aria-current] .rail-n{background:var(--l-accent);color:#fff}
.lesson-rail button.done .rail-n{background:#dcebe3;color:#2f6a4f}.lesson-rail button.done .rail-n::before{content:"✓"}.lesson-rail button.done .rail-n{font-size:0}.lesson-rail button.done .rail-n::before{font-size:12px}
.lesson-work{display:grid;grid-template-columns:minmax(250px,320px) minmax(0,1fr);gap:0;border-radius:16px;overflow:hidden;background:var(--l-fill)}
.lesson-side{background:#fff;padding:22px 22px 18px;display:flex;flex-direction:column;gap:16px;border:1px solid var(--line);border-right:0;border-radius:16px 0 0 16px}
.lesson-panel-count{font-size:12px;color:var(--ink-3);margin:0}.lesson-panel h2{font-size:20px;margin:2px 0 12px;padding:0}.lesson-panel h2:focus{outline:none}
.lesson-facts{margin:0;display:grid;gap:4px}.lesson-facts dt{font-size:12px;color:var(--ink-3);margin-top:8px}.lesson-facts dd{margin:0;font-size:14.5px;line-height:1.7;color:var(--ink)}
.lesson-fill{display:inline-block;background:#fff6d8;border-radius:6px;padding:1px 8px;font-size:14px}
.lesson-choice{display:flex;gap:8px;margin-top:4px}.lesson-choice button{font:inherit;font-size:14px;border:0;border-radius:9px;padding:8px 16px;background:var(--l-fill);cursor:pointer}.lesson-choice button.right{background:#dcebe3;color:#2f6a4f}.lesson-choice button.wrong{background:#f6e3df;color:#94463a}
.lesson-reply{font-size:13.5px;margin:8px 0 0;color:var(--ink-2)}
.lesson-trouble{border-radius:10px;background:#faf6ee;padding:10px 14px}.lesson-trouble summary{cursor:pointer;font-size:13.5px;color:#7a5a2c}.lesson-trouble p{font-size:13.5px;margin:8px 0;color:var(--ink-2)}
.lesson-link{font:inherit;font-size:13px;border:0;background:none;color:var(--l-accent-ink);padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.lesson-player{display:flex;flex-wrap:wrap;align-items:center;gap:8px;width:100%;max-width:640px}
.lesson-play,.lesson-ghost{font:inherit;font-size:13.5px;border:0;border-radius:9px;padding:8px 14px;cursor:pointer}.lesson-play{background:var(--l-tint-2);color:var(--l-accent-ink)}.lesson-ghost{background:var(--l-fill);color:var(--ink-2)}
.lesson-player-state{font-size:12px;color:var(--ink-3);line-height:1.5;margin-left:4px}
.lesson-stage{padding:16px 18px 18px;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;scroll-margin-top:72px}
.mock{position:relative;width:100%;max-width:640px;font-size:13px;line-height:1.5;color:#0E1A21;user-select:none}
.mock-label{position:absolute;right:4px;top:-18px;font-size:11px;line-height:16px;color:var(--ink-3)}
.mock-app{position:relative;display:grid;grid-template-columns:118px minmax(0,1fr);min-height:420px;background:#F4F6F5;border-radius:14px;overflow:hidden;box-shadow:0 10px 32px rgba(16,42,58,.08);margin-top:14px}
.mock-side{display:flex;flex-direction:column;gap:2px;padding:16px 10px;background:rgba(16,42,58,.03);font-size:12.5px;color:rgba(14,26,33,.6)}.mock-side b{font-weight:500;color:#0E1A21;margin:0 6px 12px}.mock-side span{padding:6px 8px;border-radius:7px}.mock-side span.on{background:#fff;color:#275768}
.mock-main{padding:18px 18px 22px;min-width:0}.mock-eyebrow{font-size:11.5px;color:rgba(14,26,33,.42);margin:0}.mock-main h3{font-size:20px;font-weight:400;margin:0 0 14px;padding:0}
.mock-card{background:#fff;border-radius:12px;padding:6px 0}.mock-card-h{font-size:13.5px;font-weight:500;padding:8px 14px 6px}
.mock-row{display:flex;align-items:center;gap:10px;width:100%;font:inherit;text-align:left;background:none;border:0;border-top:1px solid rgba(16,42,58,.075);padding:10px 14px;color:inherit;cursor:pointer}.mock-row:first-of-type{border-top:0}.mock-row>span:first-child{flex:1;min-width:0}.mock-row b{display:block;font-weight:500}.mock-row small{display:block;font-size:11.5px;color:rgba(14,26,33,.5)}.mock-row em{font-style:normal;font-size:11.5px;color:rgba(14,26,33,.5)}.mock-row.is-static{cursor:default}
.mock-row.is-selected{background:rgba(52,118,141,.08)}
.mock-tabs,.mock-seg{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;font-size:12.5px;color:rgba(14,26,33,.55)}.mock-tabs span{padding:6px 10px;border-radius:8px}.mock-tabs span.on{background:#fff;color:#0E1A21}.mock-seg span{padding:4px 9px;border-radius:999px;background:rgba(16,42,58,.045)}.mock-seg span.on{background:rgba(52,118,141,.16);color:#275768}.mock-seg i{font-style:normal}
.mock-thead{display:flex;gap:10px;padding:6px 14px;font-size:11.5px;color:rgba(14,26,33,.42)}.mock-thead span:first-child{flex:1}
.mock-empty{margin:0;padding:18px 14px;color:rgba(14,26,33,.42);font-size:12.5px}
.mock-num{font-variant-numeric:tabular-nums;min-width:72px;text-align:right}.mock-pill{font-style:normal;background:#f6ecd6;color:#7a5a2c!important;border-radius:999px;padding:2px 8px}
.mock-detail{display:flex;flex-direction:column;gap:2px;margin-top:10px;background:#fff;border-radius:12px;padding:12px 14px;font-size:12.5px;color:rgba(14,26,33,.65)}.mock-detail b{font-weight:500;color:#0E1A21}
.mock-side{grid-row:1;grid-column:1}.mock-main{grid-row:1;grid-column:2}.mock-dialog-layer{grid-row:1;grid-column:1/-1;position:relative;z-index:3;background:rgba(14,26,33,.22);display:flex;align-items:flex-start;justify-content:center;padding:18px 14px}
.mock-dialog{width:100%;max-width:440px;background:#fff;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px;box-shadow:0 16px 40px rgba(14,26,33,.18)}
.mock-dialog-h{font-size:16px;font-weight:500}
.mock-field{display:flex;flex-direction:column;gap:4px}.mock-field label{font-size:12px;color:rgba(14,26,33,.6)}.mock-field label i{color:#b4553f;font-style:normal}
.mock-select{background:rgba(16,42,58,.045);border-radius:8px;padding:7px 10px}.mock-select.is-disabled{color:rgba(14,26,33,.6)}
.mock-facts{display:flex;flex-wrap:wrap;gap:6px 20px;background:rgba(16,42,58,.03);border-radius:8px;padding:8px 10px}.mock-facts span{display:flex;flex-direction:column;font-variant-numeric:tabular-nums}.mock-facts small{font-size:11px;color:rgba(14,26,33,.45)}.mock-facts b{font-weight:500;transition:background .3s}.mock-facts b.flash{background:#fff1c2;border-radius:4px}
.mock-check{display:flex;align-items:flex-start;gap:8px;font:inherit;text-align:left;background:none;border:0;padding:4px 2px;color:inherit;cursor:pointer;border-radius:6px}.mock-check .box{width:16px;height:16px;border-radius:4px;background:rgba(16,42,58,.09);flex-shrink:0;margin-top:2px;display:grid;place-items:center;color:#fff;font-size:11px}.mock-check[aria-checked="true"] .box{background:#34768D}.mock-check[aria-checked="true"] .box::before{content:"✓"}.mock-check:disabled{color:rgba(14,26,33,.4);cursor:not-allowed}.mock-check em{font-style:normal}
.mock-field textarea{font:inherit;font-size:13px;border:0;border-radius:8px;background:rgba(16,42,58,.045);padding:7px 10px;resize:none;color:#0E1A21;width:100%}.mock-field textarea:disabled{opacity:1}
.mock-dialog-f{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}.mock-btn{font:inherit;font-size:13px;border:0;border-radius:9px;padding:7px 14px;background:rgba(16,42,58,.06);color:#0E1A21;display:inline-block;width:max-content}.mock-btn.sm{font-size:12px;padding:5px 10px}.mock-btn.primary{background:#34768D;color:#fff;cursor:pointer}
.mock-banner{display:flex;flex-direction:column;border-radius:8px;padding:8px 10px;background:rgba(16,42,58,.05);font-size:12.5px}.mock-banner b{font-weight:500}.mock-banner.bad{background:#f8e5e1;color:#8c3f33}
.mock .is-target{position:relative;outline:3px solid var(--l-ring);outline-offset:3px;border-radius:8px;animation:lesson-pulse 1.6s ease-in-out infinite;z-index:2}
.mock .is-target::after{content:attr(data-n);position:absolute;left:-14px;top:-14px;width:22px;height:22px;border-radius:50%;background:var(--l-ring);color:#fff;font-size:12px;font-weight:500;display:grid;place-items:center;line-height:1;font-style:normal}
@keyframes lesson-pulse{50%{outline-color:rgba(29,127,176,.35)}}
.mock-cursor{position:absolute;left:0;top:0;width:22px;height:22px;z-index:10;pointer-events:none;transition:transform .7s cubic-bezier(.4,.1,.2,1);background:no-repeat center/contain url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M4 2l15 11-7 1-4 7z' fill='%230E1A21' stroke='white' stroke-width='1.6' stroke-linejoin='round'/%3E%3C/svg%3E")}
.mock-cursor.click::after{content:"";position:absolute;left:-9px;top:-9px;width:22px;height:22px;border-radius:50%;border:2px solid var(--l-ring);animation:lesson-ripple .5s ease-out forwards}
@keyframes lesson-ripple{from{transform:scale(.4);opacity:1}to{transform:scale(1.6);opacity:0}}
.mock{scroll-margin-top:76px}
.mock-dialog-h small{display:block;font-size:12px;font-weight:400;color:rgba(14,26,33,.5)}
.mock-split{display:grid;grid-template-columns:150px minmax(0,1fr);gap:10px;align-items:start}.mock-list .mock-row{flex-direction:column;align-items:flex-start;gap:4px;cursor:default}
.mock-detail-full{margin-top:0;gap:8px}.mock-detail-h{display:flex;align-items:center;gap:8px;font-size:15px}.mock-note{font-size:11.5px;color:rgba(14,26,33,.5)}
.mock-actions{display:flex;flex-wrap:wrap;gap:6px}.mock-actions .mock-btn:not(.primary){cursor:pointer}.mock-actions span.mock-btn{cursor:default}.mock-btn:disabled{opacity:.45;cursor:not-allowed}
.mock-sub{display:flex;flex-direction:column;font-size:12px}.mock-sub small{font-size:11px;color:rgba(14,26,33,.45)}
.mock-pill.on{background:#dcebe3;color:#2f6a4f!important}.mock-banner.ok{background:#e4f0e9;color:#2f6a4f}
.lesson-next-link{display:inline-block;margin:0 16px 12px 0;font-weight:500}.mock-step{display:none}
.mock-hint{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);margin:0;background:#0E1A21;color:#fff;font-size:12.5px;padding:6px 12px;border-radius:8px;z-index:11;white-space:nowrap}
.mock[data-previewing] .mock-app{box-shadow:0 0 0 3px #e3b16a,0 10px 32px rgba(16,42,58,.08)}
.lesson-footer{position:sticky;bottom:0;z-index:5;display:flex;justify-content:space-between;align-items:center;margin:16px 0 0;padding:12px 0;background:#fffffff2;backdrop-filter:blur(10px);border-top:1px solid var(--line)}
.lesson-footer button,.lesson-done button{font:inherit;border:0;border-radius:9px;padding:10px 18px;cursor:pointer;background:var(--l-fill);color:var(--ink-2)}.lesson-footer [data-lesson-next]{background:var(--l-accent);color:#fff}.lesson-footer button:disabled{opacity:.4;cursor:default}.lesson-footer span{font-size:13px;color:var(--ink-3)}
.lesson-footer [data-lesson-next].ready{box-shadow:0 0 0 4px var(--l-tint-2)}
.lesson-done{margin-top:20px;padding:22px 24px;background:#eef5f1;border-radius:14px}.lesson-done h2{margin:0 0 8px;padding:0}.lesson-done h2:focus{outline:none}.lesson-done p{margin:0 0 12px}
.lesson-chain{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:0 0 16px;font-size:13px}.lesson-chain li{margin:0;padding:5px 10px;border-radius:999px;background:#fff;color:#456b58}.lesson-chain li.me{background:#2f6a4f;color:#fff}.lesson-chain li+li::before{content:"→ ";color:#8aa596}
.lesson-sop{margin-top:28px}.lesson-sop h2{font-size:17px;margin:0 0 8px}.lesson-sop dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 20px;margin:0;font-size:14px}.lesson-sop dt{color:var(--ink-3)}.lesson-sop dd{margin:0}
.lesson-review-note{font-size:12px;color:var(--ink-3);margin-top:24px}
.lesson button:focus-visible,.lesson summary:focus-visible{outline:3px solid var(--l-ring);outline-offset:3px}
@media(max-width:1060px){.lesson-work{grid-template-columns:1fr}.lesson-side{border-right:1px solid var(--line);border-bottom:0;border-radius:16px 16px 0 0}}
@media(max-width:700px){.mock-split{grid-template-columns:1fr}.mock-list{display:none}.mock-step{display:grid;grid-template-columns:20px 1fr;gap:6px 8px;align-items:start;margin:22px 0 -4px;font-size:13.5px;line-height:1.5;color:var(--l-accent-ink)}.mock-step-choice{grid-column:2;display:flex;gap:6px}.mock-step-choice button{font:inherit;font-size:13px;border:0;border-radius:8px;padding:5px 12px;background:#fff;color:var(--ink);cursor:pointer}.mock-hint{white-space:normal;width:max-content;max-width:calc(100% - 24px)}.mock-step b{flex-shrink:0;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--l-ring);color:#fff;font-size:12px;font-weight:500}.lesson h1{font-size:26px}.lesson-meta{gap:8px 20px}.lesson-rail{display:flex;overflow-x:auto;scrollbar-width:none;margin:0 -20px 14px;padding:0 20px}.lesson-rail li{flex:0 0 auto}.lesson-rail button{padding:8px 10px}.lesson-rail button:not([aria-current]) .rail-t{display:none}
.lesson-work{margin:0 -20px;border-radius:0}.lesson-side{border-radius:0;border-left:0;border-right:0;padding:18px 20px}.lesson-stage{padding:12px 10px 16px}
.mock-app{grid-template-columns:1fr;min-height:400px}.mock-side{display:none}.mock-main{grid-column:1}.mock-main{padding:14px 12px 18px}.mock-dialog-layer{padding:10px 8px}.mock-dialog{padding:14px}.mock-thead span:nth-child(2),.mock-num{display:none}
.lesson-sop dl{grid-template-columns:1fr;gap:2px}.lesson-sop dd{margin-bottom:8px}}
@media(prefers-reduced-motion:reduce){.mock .is-target{animation:none}.mock-cursor{transition:none}}
`;

/**
 * 在浏览器里运行（构建时以源码字符串内联）。不访问网络、不提交表单。
 * 演示与练习共用同一份界面状态；演示只是替读者执行同样的点击和输入。
 */
function lessonMain(doc) {
  const test = (expr, s) => expr.split('&').every(part => {
    const ne = part.indexOf('!='), eq = part.indexOf('=');
    if (ne > 0) return String(s[part.slice(0, ne)] ?? '') !== part.slice(ne + 2);
    if (eq > 0) return String(s[part.slice(0, eq)] ?? '') === part.slice(eq + 1);
    return part[0] === '!' ? !s[part.slice(1)] : !!s[part];
  });
  for (const lesson of doc.querySelectorAll('[data-lesson]')) {
    const $ = s => lesson.querySelector(s), $$ = s => [...lesson.querySelectorAll(s)];
    const steps = JSON.parse(lesson.dataset.steps), initial = JSON.parse(lesson.dataset.initial);
    const mock = $('[data-mock]'), cursor = $('[data-cursor]'), hint = $('[data-hint]');
    const panels = $$('[data-step-panel]'), rail = $$('[data-step]'), play = $('[data-play]'), playerState = $('[data-player-state]');
    const next = $('[data-lesson-next]'), prev = $('[data-lesson-prev]'), done = $('[data-lesson-done]');
    const inputs = $$('[data-input]');
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
    let step = 0, state = { ...initial }, completed = new Set(), demo = null, previewing = false, hintTimer = 0;
    const entryState = i => steps.slice(0, i).reduce((s, x) => ({ ...s, ...x.after }), { ...initial });
    const inputFor = key => inputs.find(el => el.dataset.input === key);

    const render = () => {
      const view = previewing ? { ...state, ...steps[step].preview } : { ...state };
      view.navHome = view.screen === 'home'; view.navFinance = view.screen !== 'home';
      $$('[data-if]').forEach(el => { el.hidden = !test(el.dataset.if, view); });
      $$('[data-text]').forEach(el => { const v = String(view[el.dataset.text] ?? ''); if (el.textContent !== v) el.textContent = v; });
      $$('[data-checked]').forEach(el => el.setAttribute('aria-checked', String(!!view[el.dataset.checked])));
      $$('[data-disabled]').forEach(el => { el.disabled = !!view[el.dataset.disabled]; });
      $$('[data-on]').forEach(el => el.classList.toggle('on', !!view[el.dataset.on]));
      $$('[data-selected]').forEach(el => el.classList.toggle('is-selected', !!view[el.dataset.selected]));
      inputs.forEach(el => { const v = String(view[el.dataset.input] ?? ''); if (el.value !== v) el.value = v; el.disabled = previewing || steps[step].input !== el.dataset.input; });
      mock.toggleAttribute('data-previewing', previewing);
      $$('.is-target').forEach(el => { el.classList.remove('is-target'); el.removeAttribute('data-n'); });
      const target = !previewing && !completed.has(step) && $(`[data-t="${steps[step].target}"]`);
      if (target && !target.hidden) { target.classList.add('is-target'); target.dataset.n = String(step + 1); }
    };
    const say = (text, ms = 2200) => { clearTimeout(hintTimer); hint.textContent = text; hint.hidden = !text; if (text) hintTimer = setTimeout(() => { hint.hidden = true; }, ms); };
    const setPlayer = (label, pressed, status) => { play.textContent = label; play.setAttribute('aria-pressed', String(pressed)); playerState.textContent = status; };
    const idlePlayer = () => setPlayer('▶ 看演示', false, completed.has(step) ? '这一步已完成，可以点「下一步」' : '也可以直接在蓝框处操作');

    const complete = () => {
      const before = new Map($$('[data-text]').map(el => [el, el.textContent]));
      state = { ...state, ...steps[step].after };
      completed.add(step);
      rail[step].classList.add('done');
      next.classList.add('ready');
      render(); idlePlayer();
      before.forEach((text, el) => { if (el.tagName === 'B' && el.textContent !== text) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 900); } });
      if (step === steps.length - 1) finish();
    };
    const finish = () => { done.hidden = false; next.disabled = true; const h = done.querySelector('h2'); h.focus({ preventScroll: true }); done.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); };
    const stopDemo = () => { if (demo) { demo.cancelled = true; demo = null; } cursor.hidden = true; cursor.classList.remove('click'); };
    const go = (i, user) => {
      stopDemo(); previewing = false;
      step = Math.max(0, Math.min(steps.length - 1, i));
      state = entryState(step);
      panels.forEach((p, k) => { p.hidden = k !== step; });
      rail.forEach((b, k) => { if (k === step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
      $$('[data-trouble]').forEach(d => { d.open = false; });
      $$('[data-preview]').forEach(b => { b.textContent = '在演练窗口里看看'; });
      $$('[data-choice]').forEach(b => b.classList.remove('right', 'wrong'));
      $$('[data-choice-reply]').forEach(p => { p.hidden = true; });
      completed.delete(step); rail[step].classList.remove('done');
      prev.disabled = step === 0; next.disabled = false; next.classList.remove('ready');
      next.textContent = step === steps.length - 1 ? '完成' : '下一步';
      $('[data-step-status]').textContent = `第 ${step + 1} 步 / 共 ${steps.length} 步`;
      done.hidden = true; say('');
      const strip = $('[data-mock-step]'); strip.textContent = ''; const badge = doc.createElement('b'); badge.textContent = String(step + 1); strip.append(badge, steps[step].do);
      if (steps[step].kind === 'choice') { const g = doc.createElement('span'); g.className = 'mock-step-choice'; $$(`[data-step-panel="${step}"] [data-choice]`).forEach((c, k) => { const x = doc.createElement('button'); x.type = 'button'; x.textContent = c.textContent; x.addEventListener('click', () => { if (!demo && !completed.has(step)) answer(k); }); g.append(x); }); strip.append(g); }
      render(); idlePlayer();
      if (user && narrow()) {
        // 窄屏：先让演练窗口顶到视口，目标仍在底部吸附栏下面时再上移，保证能看到要点的位置。
        $('[data-stage]').scrollIntoView?.({ block: 'start' });
        const target = $('.is-target'), limit = (globalThis.innerHeight || 0) - 110;
        if (target && limit > 0) { const r = target.getBoundingClientRect(); if (r.bottom > limit) globalThis.scrollBy?.(0, r.bottom - limit); }
      }
    };
    const answer = k => {
      const buttons = $$(`[data-step-panel="${step}"] [data-choice]`), reply = $(`[data-step-panel="${step}"] [data-choice-reply]`);
      const correct = buttons[k].hasAttribute('data-correct'), text = steps[step].options[k].reply;
      buttons.forEach((b, j) => b.classList.toggle(correct ? 'right' : 'wrong', j === k));
      reply.hidden = false; reply.textContent = text;
      if (narrow()) say(text, 3600);
      if (correct) complete();
    };
    const act = t => {
      const s = steps[step];
      if (previewing) { previewing = false; render(); }
      if (completed.has(step)) return;
      if (s.kind === 'choice') { const k = s.options.findIndex(o => o.target === t); return k >= 0 ? answer(k) : say(narrow() ? '在上方选择答案' : '在左侧选择答案'); }
      if (inputFor(t) && s.input === inputFor(t).dataset.input) return;
      if (t !== s.target) return say('先点击蓝框标出的位置');
      complete();
    };

    // 演示：移动光标 → 点击 / 输入，读者可随时暂停、继续或重播当前一步。
    const wait = (run, ms) => new Promise(resolve => { let left = reduced ? Math.min(ms, 120) : ms; const tick = () => { if (run.cancelled) return resolve(false); if (!run.paused) left -= 50; if (left <= 0) return resolve(true); setTimeout(tick, 50); }; tick(); });
    const pointAt = el => { const m = mock.getBoundingClientRect(), r = el.getBoundingClientRect(); cursor.style.transform = `translate(${r.left - m.left + Math.min(r.width * .5, 60)}px,${r.top - m.top + r.height * .55}px)`; };
    const tap = async (run, el) => { pointAt(el); if (!await wait(run, 800)) return false; cursor.classList.remove('click'); void cursor.offsetWidth; cursor.classList.add('click'); return wait(run, 350); };
    const runDemo = async () => {
      go(step);
      const s = steps[step], run = demo = { cancelled: false, paused: false };
      setPlayer('❚❚ 暂停', true, '演示中…');
      cursor.hidden = false; cursor.style.transform = 'translate(40px,40px)';
      if (!await wait(run, 300)) return;
      if (s.kind === 'choice') {
        if (!await tap(run, $(`[data-t="${s.target}"]`))) return;
        if (!await wait(run, 600)) return;
        cursor.hidden = true; answer($$(`[data-step-panel="${step}"] [data-choice]`).findIndex(b => b.hasAttribute('data-correct')));
      } else {
        if (s.kind === 'type') {
          const field = inputFor(s.input);
          if (!await tap(run, field)) return;
          state[s.input] = '';
          for (const ch of s.text) { state[s.input] += ch; render(); if (!await wait(run, 45)) return; }
        }
        if (!await tap(run, $(`[data-t="${s.target}"]`))) return;
        complete();
        if (!await wait(run, 900)) return;
        cursor.hidden = true;
      }
      demo = null; idlePlayer();
    };

    play.addEventListener('click', () => {
      if (!demo) return void runDemo();
      demo.paused = !demo.paused;
      setPlayer(demo.paused ? '▶ 继续' : '❚❚ 暂停', !demo.paused, demo.paused ? '已暂停' : '演示中…');
    });
    $('[data-replay]').addEventListener('click', () => void runDemo());
    mock.addEventListener('click', event => { if (demo) return; const el = event.target.closest('[data-t]'); if (el) act(el.dataset.t); else if (!previewing && !completed.has(step) && event.target.closest('.mock-app')) say('先点击蓝框标出的位置'); });
    inputs.forEach(el => el.addEventListener('input', () => { state[el.dataset.input] = el.value; }));
    $$('[data-choice]').forEach(b => b.addEventListener('click', () => { if (!demo && !completed.has(step)) answer(Number(b.dataset.choice)); }));
    $$('[data-preview]').forEach(b => b.addEventListener('click', () => {
      stopDemo(); idlePlayer(); previewing = !previewing; render();
      b.textContent = previewing ? '恢复正常界面' : '在演练窗口里看看';
      if (previewing) say('这是出错时的样子', 1800);
    }));
    $$('[data-trouble]').forEach(d => d.addEventListener('toggle', () => { if (!d.open && previewing) { previewing = false; render(); const b = d.querySelector('[data-preview]'); if (b) b.textContent = '在演练窗口里看看'; } }));
    rail.forEach((b, i) => b.addEventListener('click', () => go(i, true)));
    prev.addEventListener('click', () => go(step - 1, true));
    next.addEventListener('click', () => {
      if (!completed.has(step)) { stopDemo(); previewing = false; complete(); if (step === steps.length - 1) return; }
      if (step < steps.length - 1) { go(step + 1, true); panels[step].querySelector('h2').focus({ preventScroll: true }); }
    });
    $('[data-lesson-restart]').addEventListener('click', () => { completed.clear(); rail.forEach(b => b.classList.remove('done')); go(0); lesson.scrollIntoView?.({ block: 'start' }); });
    go(0);
  }
}

export const lessonRuntime = `(${lessonMain.toString()})(document);`;
