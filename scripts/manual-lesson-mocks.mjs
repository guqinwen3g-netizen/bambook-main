/**
 * 教学演练窗口的界面模板：按 Mist 实际页面简化重绘，每个模板对应 wiki/lessons/*.json 的 template。
 * 只输出静态 HTML，界面变化全部由 manual-lesson.mjs 运行时按以下属性绑定到演练状态：
 *   data-if="a&!b&screen=home&screen!=home"  不满足时隐藏
 *   data-text="key"      文本取自状态
 *   data-checked="key"   aria-checked
 *   data-disabled="key"  disabled
 *   data-on="key" / data-selected="key"  切换 on / is-selected 样式
 *   data-input="key"     输入框与状态双向绑定，仅当前步骤的 input 可编辑
 *   data-t="name"        可被步骤指向、点击的目标
 * 实际界面依据写在各模板注释里；改动实际页面时同步检查这里的文字和顺序。
 */
const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const shell = (main, overlay) => `<div class="mock-app">
 <aside class="mock-side" aria-hidden="true"><b>Bambook</b><span data-on="navHome">首页</span><span>订单</span><span>采购与加工</span><span data-on="navFinance">财务管理</span></aside>
 <div class="mock-main">${main}</div>${overlay}
</div>`;
const queue = (rows, others) => `<section data-screen="home" data-if="screen=home">
 <p class="mock-eyebrow">今天</p><h3>首页</h3>
 <div class="mock-card"><div class="mock-card-h">接着完成</div>${rows}${others.map(([t, m, w]) => `<div class="mock-row is-static"><span><b>${esc(t)}</b><small>${esc(m)}</small></span><em>${esc(w)}</em></div>`).join('')}</div>
</section>`;
const financeHead = count => `<p class="mock-eyebrow">财务与成本 · 财务</p><h3>财务管理</h3>
 <div class="mock-tabs"><span>应收待办</span><span class="on">应付待办</span><span>收付款记录</span></div>
 <div class="mock-seg"><span>应付票据 · 0</span><span>付款申请 · 0</span><span class="on">结算 · <i data-text="${count}"></i></span></div>`;
const dialog = (title, body, footer, sub = '') => `<div class="mock-dialog-layer" data-dialog data-if="screen=dialog">
 <div class="mock-dialog" role="group" aria-label="${esc(title)}（演练）">
  <div class="mock-dialog-h">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>
  <div class="mock-banner bad" data-error data-if="error"><b data-text="errorTitle"></b><span data-text="error"></span></div>
  ${body}
  <div class="mock-dialog-f">${footer}</div>
 </div>
</div>`;
const facts = items => `<div class="mock-facts">${items.map(([k, v]) => `<span><small>${esc(k)}</small>${v}</span>`).join('')}</div>`;

/** HomePage「接着完成」→ FinancePayables 结算 → FinanceSettlements.SettlementSubmitDialog */
function settlementSubmit(e) {
  const total = e.quantity * e.unitPrice;
  const main = queue(`<button type="button" class="mock-row" data-t="queue" data-if="!queueEmpty&!submitted"><span><b>${esc(e.contract)} · 待结算</b><small>${esc(e.supplier)} · ${e.quantity} ${esc(e.unit)}</small></span><em>待结算</em></button>`,
    [['SO-018 · 待确认', '示例客户 · 报价', '今天'], ['QC-007 · 待检验', e.product, '明天']]) + `
<section data-screen="finance" data-if="screen!=home">${financeHead('settleCount')}
 <div class="mock-card">
  <div class="mock-thead"><span>结算 / 合同</span><span>结算金额</span><span>状态</span></div>
  <p class="mock-empty" data-if="!submitted">还没有结算</p>
  <button type="button" class="mock-row mock-settle" data-t="result" data-if="submitted" data-selected="opened"><span><b>${esc(e.settlement)}</b><small>${esc(e.contract)} · ${esc(e.supplier)} · 实收 ${e.quantity} ${esc(e.unit)}</small></span><span class="mock-num">${money(total)}</span><em class="mock-pill">待财务复核</em></button>
 </div>
 <div class="mock-detail" data-settle-detail data-if="opened"><b>${esc(e.settlement)} · 待财务复核</b><span>来源合同 ${esc(e.contract)} · ${esc(e.supplier)}</span><span>实收 ${e.quantity} ${esc(e.unit)} × ${money(e.unitPrice)} = ${money(total)} CNY</span><span>下一位：财务复核确认</span></div>
</section>`;
  const body = `<div class="mock-banner" data-if="blocked"><b data-blocked-text data-text="blocked"></b></div>
  <div class="mock-field"><label>来源合同 <i>*</i></label><div class="mock-select is-disabled">${esc(e.contract)} · ${esc(e.supplier)}</div></div>
  ${facts([['合同数量', `${e.contractQuantity} ${esc(e.unit)}`], ['合同单价', `${money(e.unitPrice)} CNY`], ['合同金额', `${money(e.contractQuantity * e.unitPrice)} CNY`]])}
  <div class="mock-field"><label>实际收货记录 <i>*</i></label>
   <button type="button" role="checkbox" class="mock-check" data-t="receipt" data-checked="receipt" data-disabled="receiptBlocked"><span class="box"></span><span>${esc(e.receiptDate)} · ${esc(e.location)} · 实收 ${e.quantity} ${esc(e.unit)}<em data-text="receiptSuffix"></em></span></button></div>
  ${facts([['本次实收', '<b data-qty data-text="qtyText"></b>'], ['结算金额', '<b data-total data-text="totalText"></b>']])}
  <button type="button" role="checkbox" class="mock-check" data-t="final" data-checked="final"><span class="box"></span><span>最终结算</span></button>
  <div class="mock-field"><label>争议 / 未确认扣款</label><span class="mock-btn sm">添加争议 / 扣款</span></div>
  <div class="mock-field"><label>结算说明</label><textarea rows="2" aria-label="结算说明（演练）" data-t="note" data-note data-input="note"></textarea></div>`;
  return shell(main, dialog('提交结算', body, '<span class="mock-btn">取消</span><button type="button" class="mock-btn primary" data-t="submit">提交复核</button>'));
}

/** HomePage「接着完成」→ FinancePayables 结算详情（SettlementDetail）→ SettlementConfirmDialog */
function settlementConfirm(e) {
  const total = e.quantity * e.unitPrice, suggested = e.prepaid * e.quantity / e.contractQuantity;
  const main = queue(`<button type="button" class="mock-row" data-t="queue" data-if="!queueEmpty&!opened"><span><b>${esc(e.settlement)} · 待财务复核</b><small>${esc(e.supplier)} · ${esc(e.contract)} · CNY ${money(total)}</small></span><em>待复核</em></button>`,
    [['AR-012 · 待核销', '示例客户 · 到账', '今天'], ['PAY-004 · 待登记付款', e.supplier, '明天']]) + `
<section data-screen="finance" data-if="screen!=home">${financeHead('pendingCount')}
 <div class="mock-split">
  <div class="mock-card mock-list">
   <button type="button" class="mock-row is-selected" tabindex="-1"><span><b>${esc(e.settlement)}</b><small>${esc(e.contract)} · ${esc(e.supplier)}</small></span><em class="mock-pill" data-on="confirmed" data-text="stateText"></em></button>
  </div>
  <div class="mock-detail mock-detail-full" data-settle-detail>
   <b class="mock-detail-h">${esc(e.settlement)} <em class="mock-pill" data-on="confirmed" data-text="stateText"></em></b>
   <span class="mock-note">${esc(e.submitter)} · 提交于 ${esc(e.submittedAt)}</span>
   ${facts([['来源合同', esc(e.contract)], ['供应商', esc(e.supplier)], ['实收结算数量', `${e.quantity} ${esc(e.unit)} × ${money(e.unitPrice)} CNY`], ['结算金额', `${money(total)} CNY`]])}
   <div data-if="!confirmed">${facts([['建议预付抵扣', `${money(suggested)} CNY · 合同剩余可抵扣 ${money(e.prepaid)} CNY`], ['结算说明', esc(e.note)]])}</div>
   <div data-if="confirmed">${facts([['预付抵扣', `<b data-total>${money(suggested)} CNY</b>`], ['抵扣后应付', `<b>${money(total - suggested)} CNY</b>`], ['待关联票额', `${money(total)} CNY`]])}<div class="mock-banner ok"><b>财务已确认</b><span data-text="reviewNote"></span></div></div>
   <div class="mock-actions">
    <button type="button" class="mock-btn primary" data-t="confirm" data-if="!confirmed" data-disabled="ownSubmission">确认结算</button>
    <button type="button" class="mock-btn" data-t="return" data-if="!confirmed" data-disabled="ownSubmission">退回结算</button>
    <button type="button" class="mock-btn primary" data-t="bill" data-if="confirmed">按结算登记票据</button>
    <span class="mock-btn">查看合同</span>
   </div>
   <span class="mock-note" data-if="ownSubmission">不能复核本人提交的结算</span>
   <div class="mock-sub"><small>对应收货记录</small><span>${esc(e.receiptDate)} · ${esc(e.location)} · 实收 ${e.quantity} ${esc(e.unit)}</span></div>
  </div>
 </div>
</section>`;
  const body = `${facts([['实收结算数量', `${e.quantity} ${esc(e.unit)} × ${money(e.unitPrice)} CNY`], ['结算金额', `${money(total)} CNY`], ['建议预付抵扣', `${money(suggested)} CNY（按结算数量比例）`], ['合同剩余可抵扣', `${money(e.prepaid)} CNY`]])}
  <div class="mock-field"><label>本次预付抵扣 <i>*</i></label><div class="mock-select" data-t="applied"><span data-text="appliedText"></span></div></div>
  <div class="mock-field" data-if="adjusting"><label>调整原因 <i>*</i></label><div class="mock-select"></div></div>
  <div class="mock-field"><label>复核意见</label><textarea rows="2" aria-label="复核意见（演练）" data-t="note" data-note data-input="reviewNote"></textarea></div>`;
  return shell(main, dialog('确认结算', body, '<span class="mock-btn">取消</span><button type="button" class="mock-btn primary" data-t="submit">确认结算</button>', `${e.settlement} · ${e.contract}`));
}

export const lessonMocks = { settlementSubmit, settlementConfirm };
