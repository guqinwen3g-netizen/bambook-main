# Bambook Code Wiki

> 面向维护者与 Agent 的代码知识入口。**当前架构以本页第 1–8 节为准**（2026-10-31 按源码核对）；第 9 节是带日期的实现记录。2026-08 编写的 Electron/Manager、Prisma 197 模型、旧 ReAct Agent 与 `/mcp/run` 章节已退役，移至 [`docs/archive/2026-08-CODE_WIKI-旧架构.md`](archive/2026-08-CODE_WIKI-旧架构.md)，不能作为当前实现依据。
>
> 每条结论分开标明：**已确认规则**（用户定案或有效需求）、**当前实现**（源码锚点）、**已验证范围**（谁在什么环境走通了什么）、**未完成**。没有写明已验证的，就只是源码中存在。业务规则依据见 [`docs/README.md`](README.md) 指向的有效决策；方向与进度只看 [`docs/GO-LIVE.md`](GO-LIVE.md)。

## 1. 运行入口

| 层 | 当前实现 | 源码锚点 |
|---|---|---|
| 前端（唯一） | Mist Atelier；Web 与 Electron 共用同一入口 | `dev-ui-preview/mist-atelier/app/main.tsx` → `ReferenceApp.tsx` |
| 页面注册 | `view` 即页面身份；模块页按三张映射懒加载 | `app/pageRegistry.tsx`（`MODULE_VIEWS`、`buildPages`）；`moduleMap.ts` 只是迁移期模块清单，其中 `entry` 列不代表当前文件 |
| 导航与访问 | 路由、页面可见性、公司管理分区 | `app/nav.tsx`、`app/routeAccess.ts`、`app/runtime/accountAccess.ts` |
| 组件与样式 | Mist 组件库与令牌 | `components/mist/`、`styles/mist/`；规范见 `docs/mist-atelier/`、`.qoder/skills/bambook-ui/SKILL.md` |
| API | `/api/mist/*`：工作区、类型化命令、审批、文件、助手、MCP | `server/src/mist/route.ts`；端点清单见 [`server/src/mist/README.md`](../server/src/mist/README.md) |
| 本地开发 | `npm run dev:mist`：本地 API 8082 + 前端 3001，数据在 `server/private/mist-local/`（不入库） | `server/src/mist/local.ts`、`standalone.ts` |
| 员工手册 | `/manual/`（应用顶栏与账号页「使用手册」） | `scripts/manual-site.ts`，见第 7 节 |

## 2. 一条业务命令怎么走

1. 页面调用 `runtime/workspace.tsx` 发送 `POST /api/mist/workspaces/:id/commands`，请求体 `{requestId, expectedRevision, command:{type,payload}}`。只有类型化命令，没有整份状态覆盖。
2. `server/src/mist/repository.ts#execute` → `executeInternal`：重新加载账号与成员资格 → 校验命令权限 `mistCommandPermission`（`server/src/shared/mistWorkspace.ts`）→ 行级范围 `scopedTargetViolation`（写前）→ 应用 `applyMistCommand`（同文件，分派到各 `server/src/shared/mist*.ts` 领域模块）→ `scopedWriteViolation`（写后差异）→ 状态与回执同事务提交。
3. **幂等重试**：相同 `requestId` + 相同输入只回放原回执；同编号换输入报冲突。网络重试必须沿用原编号。
4. **并发**：`expectedRevision` 过期时，仅当中间修订都留有 `mist-revision:<n>` 标记且写入位置不重叠才在最新状态上重跑；同记录写入、`decide/confirm/issue/release/document` 类命令一律 `REVISION_CONFLICT`。细节见 `server/src/mist/README.md`。
5. **预演**：`repository.preview` 走同一事务和同一套校验后整笔回滚，返回业务事件说明；生成文件的命令不支持预演。
6. **结果回主线**：命令写入的审计、待办与通知由领域模块产生；前端首页「接着完成」由 `runtime/workQueue.ts#mistWorkQueue` / `mistMyWork` 从状态派生，审批由 `runtime/reviews.tsx` 与 `pages/ApprovalsPage.tsx` 展示。待办不是手工勾选：例如内部交付任务由实际点收派生完成，`task.complete` 拒绝手工改完成。

## 3. 权限、岗位与行级范围

- **权限点**：`server/src/_shared/rolePermissionMatrix.ts#PERMISSION_SCOPES`。命令到权限点的映射在 `mistWorkspace.ts#mistCommandPermission`；财务细分见 `mistFinancePermissions.ts`。
- **岗位配置界面**：`app/runtime/jobPermissions.ts`（`JOB_AREAS`：按模块配 读/写/审批）+ `pages/modules/JobPermissionEditor.tsx`；成员与小组在 `pages/WorkspaceMembers.tsx`、`pages/TeamScopesSection.tsx`（`teamScope.save`）。
- **行级范围**：`server/src/shared/mistDataScope.ts`。读投影按小组/指定人裁剪；写入用写前目标检查 + 写后差异检查。跨组交接（如内部面料、内部交付）只开放该记录的最小投影（`scopedFabricAccess` 等），不公开隐藏来源订单的商业信息。
- **审批**：不能审批本人提交的单据；审批权限与额度见 `pages/modules/AdminApprovalAuthorities.tsx` 及各领域 `decide` 命令。
- **已确认规则**：教学与验证不在共享环境变更账号权限；岗位示例只在本地演示公司演示。

## 4. 业务真源索引（按业务链）

页面路径相对 `dev-ui-preview/mist-atelier/app/pages/`，规则路径相对 `server/src/shared/`。测试与源码同名 `*.test.ts`。

| 业务阶段 | 页面 | 规则真源 |
|---|---|---|
| 首页待办、审批、通知 | `HomePage.tsx`、`ApprovalsPage.tsx`、`NotificationsPage.tsx` | `mistReview.ts`、`mistTeam.ts`；派生在 `app/runtime/workQueue.ts` |
| 客户、联系人、CRM | `CustomerPage.tsx`、`CustomerRelations.tsx` | `mistMarket.ts`、`mistCrm.ts`、`mistRelationHold.ts` |
| 供应商与收款账户 | `modules/SuppliersPage.tsx` | `mistMarket.ts`、`mistSupplierStatus.ts` |
| 开发、轮次、样品 | `DevListPage.tsx`、`DevDetailPage.tsx`、`DevRounds.tsx`、`modules/SamplesPage.tsx` | `mistDevelopmentDomain.ts`、`mistDevelopmentRounds.ts`、`mistDevelopmentSamples.ts`、`mistDevelopmentBilling.ts`、`mistSampleSending.ts` |
| 寻样与询价 | `modules/SourcingRequests.tsx` | `mistSourcing.ts` |
| 报价 | `modules/QuotationsPage.tsx`、`QuotationCostingPage.tsx` | `mistMarket.ts`、`mistQuotationCosting.ts`、`mistQuotationDocument.ts`、`mistQuotationLineConversion.ts`、`mistQuotationMarginFloor.ts` |
| 订单、变更、取消、定金 | `OrderDetailPage.tsx`、`OrderTermination.tsx`、`OrderLineFulfillment.tsx` | `mistOrderGovernance.ts`、`mistOrderChangeImpact.ts`、`mistOrderClosure.ts`、`mistOrderFunding.ts`、`mistTradeTerms.ts` |
| 采购合同、收货、退货 | `modules/ProcurementPage.tsx` | `mistFulfillment.ts`（`fulfillment.procurement.*`）、`mistProcurementCurrency.ts`、`mistPurchaseDocument.ts` |
| 结算、票据、付款 | `FinancePayables.tsx`、`FinanceSettlements.tsx`、`FinancePayments.tsx`、`PayableDialog.tsx` | `mistPayables.ts`、`mistAccounts.ts` |
| 产前样、放行、生产 | `ProductionPage.tsx`、`productionGate.ts`、`ProductionSampleNotes.tsx` | `mistProductionSamples.ts`、`mistProductionIntake.ts`、`mistProductionQuantity.ts`、`mistFulfillment.ts`（`fulfillment.production.*`） |
| QC | `modules/QcWorkbenchPage.tsx` | `mistFulfillment.ts`（`fulfillment.qc.*`） |
| 内部面料、发料、回交、内部交付 | `InternalFabricPanel.tsx`、`MaterialDeliveryPanel.tsx`、`InternalDeliveryPanel.tsx`、`modules/InventoryPage.tsx` | `mistInternalFabric.ts`、`mistInternalDelivery.ts` |
| 库存、隔离、退供、报废 | `modules/InventoryPage.tsx` | `mistFulfillment.ts`（`fulfillment.inventory.*`）、`mistPayables.ts`（处置财务核对） |
| 装箱、单据、报关、出运 | `modules/ShipmentsPage.tsx`、`PackingAssortmentDialog.tsx`、`modules/DocumentCenterPage.tsx`、`modules/CustomsPage.tsx` | `mistFulfillment.ts`（`shipments/documents/customs`）、`mistPackingBreakdown.ts`、`mistCustomsDeclaration.ts` |
| 信用证与交单 | `modules/LetterOfCredits.tsx` | `mistLetterOfCredit.ts` |
| 应收、收汇、结汇、汇率 | `FinancePage.tsx`、`FinanceWorkspace.tsx`、`modules/InvoicePage.tsx` | `mistWorkspace.ts`（`finance.*`）、`mistFxRates.ts`、`mistCustomerStatement.ts`、`mistOpeningBalance.ts` |
| 出口退税 | `modules/RebatePanel.tsx` | `mistExportRebate.ts` |
| 成本与利润 | `modules/CostPage.tsx`、`OrderActualCostPanel.tsx`、`modules/PricingPage.tsx` | `mistOrderCost.ts`、`mistPricingParams.ts`、`mistPlatform.ts` |
| 索赔与追偿 | `modules/ClaimCoordination.tsx`、`ClaimRepairWork.tsx`、`ClaimReplacementWork.tsx` | `mistClaimReview.ts`、`mistClaimCoordination.ts`、`mistClaimInventory.ts`、`mistClaimReplacement.ts`、`mistClaimRecoveryReceipts.ts`、`mistCreditDocuments.ts` |
| 邮箱 | `modules/EmailsPage.tsx` | `mistEmail.ts`；服务端收发 `server/src/mist/mail/` |
| 公司、成员、交接 | `SettingsPage.tsx`、`WorkspaceMembers.tsx`、`MemberHandover.tsx` | `mistCompanyIdentity.ts`、`mistTeamScope.ts`、`mistHandover.ts` |

命令全集以生成目录 `server/src/mist/agentCommandCatalog.ts` 为准（由 `scripts/gen-mist-command-catalog.mjs` 从上述 `server/src/shared/*.ts` 生成，当前 308 条）。

## 5. 跨模块交接（主线）

报价批准 → 正式报价单发出 → 客户接受 → 需求方认可开发样 → 转订单 → 补齐条款、选择条目履约模式（成衣全包 / 自供料加工 / 内部业务）→ 主管批准 → 交接后勤 → 采购合同审批、发出、供应商确认 →（定金到账归属）→ 收货 / 内部发料点收 → 产前样确认 → 放行开产 → 生产 QC → 完工 → 装箱、单据、报关 → 离港 → 应收确认 → 收汇核销 → 结汇 → 退税；采购侧：收货 → 结算 → 财务复核 → 票据 → 余款付款 → 短交 / 最终结算。

- 交接靠状态派生的待办推动，不靠消息：例如订单批准后首页出现「待交接后勤」（`workQueue.ts` 的 `order-handoff` 提醒，已有出运的订单不再提醒）。
- 各环节的岗位、开始条件、完成标准和退回路径写在员工 SOP（课程 `sop` 字段与 `wiki/pages/`），覆盖情况见第 7 节矩阵。

## 6. AI 与 Agent 能力边界（2026-10-31）

| 能力 | 当前实现 | 已验证范围 | 未完成 |
|---|---|---|---|
| 平台 AI「小竹 · 业务问答」 | `assistant` 页平台分区（`modules/PlatformPages.tsx#AssistantPage`）；`POST /workspaces/:id/assistant`，只读，需 owner 与 `ai:chat`；模型配置见 `server/src/mist/README.md` | 未在本页登记员工可用的实测结果；2026-10-13 实测模型端点因订阅到期报错（已改为明确错误） | 模型可用性须按部署环境核对，不能写成员工当前可用 |
| 桌面工作助手（本机 Agent） | `assistant?section=work`（`modules/WorkAssistantPage.tsx`），仅 Electron 桌面端；运行在 `electron/assistant/`（`host.ts`、`harness.ts`、`bambookTools.ts`），页面用本人会话续签短期委托（`useAssistantDelegation.ts`） | — | 员工上手教学待能力验收后补 |
| 外部 MCP / 本地 Agent API | `POST /api/mist/mcp`（`server/src/mist/agentMcp.ts`）；8 个工具 `bambook_workspaces/query/get/related/commands/preview/execute/audit`（`bambook_audit` 随 #574 合入）；24 类读取对象（`agentRead.ts`）；契约见 [`work-assistant-plan.md` §14](mist-atelier/work-assistant-plan.md) | 实施 Agent 用官方 MCP 客户端 2.4.0 在独立本地演示走通“采购结算提交 → 财务提议 → 本人确认 → 读取结果”，并经委托走通报价→订单、订单→生产/QC、付款链（本地演示种子）。不代表所有客户端或业务已验收 | 长期 API Key、无人值守账号、自助连接与续签、更多实际客户端 |
| 委托身份 | `POST /api/mist/agent/delegations`（`agentDelegation.ts`）：本人会话签发 2 小时委托；`read` 只读，`operate` 上限 = 账号现有权限（`AGENT_OPERATE_CEILING`），不超出账号 | 同上 | — |
| 敏感操作人工确认 | `agentMcp.ts#agentCommandSensitivity`：资金/账务、人员权限、收款账户、对外发送及 confirm/approve/decide/void/reverse/cancel… 类动词 → 先预演，再记为 Agent 提议；`email.server.*`、`agent.*` 禁止 Agent 直接调用 | 同上 | — |
| Agent 提议 | `server/src/shared/mistAgentProposals.ts`；首页显示“Agent 提议 · 待确认”，`pages/AgentProposalDialog.tsx` 由本人确认或拒绝 | 同上 | — |
| Agent 审计 | 落盘：`server/src/mist/agentAudit.ts` + `repository.ts#executeInternal`，与原请求同事务写内部审计回执 `mist-revision:agent-audit:<requestId>`，脱敏。查询（#574）：`agentAuditRead.ts` 按本人/公司审计权限及当前岗位、行级范围裁剪；REST `GET /workspaces/:id/agent-audits[/:requestId]`；MCP 第 8 个工具 `bambook_audit`；账号页「Agent操作记录」`pages/AgentAuditHistory.tsx` | 实施 Agent 在独立本地真实界面切财务/业务员核验本人、公司记录、原始填写与原单回程 | #574 合入时尚未部署发布；未发布前不写成员工可用。不覆盖所有普通人工写入；历史不倒填 |
| 长值守 Agent | — | — | 长期运行循环未交付 |
| 文件类操作 | 须上传原件的票据（如增值税专票）Agent 不能上传，预演即被拒 | 同上 | — |

## 7. 员工教学体系

- **课程源**：`wiki/lessons/*.json`（步骤、问答、失败恢复、SOP、链路位置、下一课）+ `wiki/assets/lessons/<capture>/`（真实界面帧与 `capture.json` 目标框）。采集脚本 `scripts/manual-capture.mjs` 在独立本地 Mist 演示种子上用正确岗位实际操作；不直接改数据库制造状态。
- **播放器**：`scripts/manual-lesson.mjs`（聚光、推近、光标与输入、暂停/上一步/下一步/重播、热点练习——练习是预设动作，不提交业务）。站点 `scripts/wiki-build.mjs`、`scripts/manual-site.ts`（开发 `/manual/`，构建 `dist/manual/`）。
- **登记与核验**：`scripts/manual-catalog.mjs#readLessonCatalog` 校验结构与素材，计算内容摘要 `contentSha256`；采集提交号（`capture.json#provenance`）、播放核验与员工验收（课程 `verification`）分别登记，内容变化后自动变为需复核。`npm run wiki:check -- --strict-lessons` 只守结构，不代表教学通过。
- **播放核验**：`scripts/manual-playback-check.mjs <课程ID> [--register]` 在本机 `/manual/` 用真实 Chromium 核验画面、热点、演示、练习、键盘、链接与搜索、窄屏与深色、图片失败重载；`--register` 仅在全部通过且源码已提交时写回 `verification.playback`。采集脚本 `manual-capture.mjs` 在应用源码与提交一致时写 `capture.json#provenance`。
- **覆盖矩阵**：`wiki/matrix/coverage.json`（业务任务 × 岗位 × 业务模式 × 页面 × 命令 × 课程 × 文字章节）+ `scripts/manual-coverage.mjs` 校验页面与命令仍存在、课程全部登记，并按证据推导教学状态（待实现 / 未核对 / 待录制 / 播放待验 / 员工待验 / 变更后待复核 / 已验证），生成 [`docs/manual-coverage.md`](manual-coverage.md)。改业务后运行 `npm run manual:coverage`。
- **素材禁令**：不使用青屿公司、小组、业务库及其旧截图/GIF，不使用 Panda 真实业务资料；素材不得含密钥、真实客户或资金资料、本机私有路径及开发账号选择器。

## 8. 本地开发与验证

- 启动：`npm run dev:mist`；切换本地演示岗位 `POST /api/mist/session {profileId}`（仅本地模式）。PDF 生成需要 `BAMBOOK_PDF_BROWSER_PATH` 指向可用 Chromium（写在不入库的 `server/.env.local`）。
- 检查：`npm test`（前端）、`cd server && npm run test:mist`、`npx tsc -p tsconfig.mist.json --noEmit`、`npx tsc -p server/tsconfig.json --noEmit`、`npm run mist:check`；何时跑全量见 `AGENTS.md`。教学相关：`npx vitest run scripts/manual-*.test.ts`、`npm run wiki:check`、`npm run manual:coverage`。
- 部署：开发环境由实施 Agent 统一发布（`npm run dev:deploy`），正式环境须单独授权。

## 9. 实现记录（带日期，按源码复核后使用）

### 当前 MCP 与员工教学入口（2026-10-31）

- Mist标准MCP以 `docs/mist-atelier/work-assistant-plan.md` 第14节和 `server/src/mist/agentMcp.ts` 为准，旧Agent运行时和历史白名单不是当前接口口径。当前7个工具、308条类型化命令目录、24类显式读取对象；预演和执行共用账号权限、行级范围与业务门禁，敏感动作进入本人提议确认。
- 员工从顶栏或账号页「使用手册」打开 `/manual/`。真实界面引导课是 `wiki/lessons/*.json` 与对应采集帧，现有三组27课；`wiki/pages/` 六篇参考说明单列。课程素材齐全、播放器核验、业务流程核验和员工认可分别记录，不互相代替。
- `scripts/manual-catalog.mjs` 校验结构、坐标、素材与交接引用，并给课程内容摘要。`wiki:check --strict-lessons` 只守结构；课程播放/员工验收及实际采集版本保持独立声明。当前未记录的27课采集软件版本仍为未知。构建输出 `manual-version.json`，实际采集提交与素材Git变更不混用。
- `scripts/manual-site.ts` 在开发按需提供独立页面，生产把同一快照输出到 `dist/manual/`，不把图片导入业务主脚本。播放器只初始化可见课程，离开后停止动画；图片按课程摘要分版本目录，等待实际加载后播放，失败提供重载，不展示虚假的完成。
- MCP外部互通：官方客户端2.4.0已在独立本地HTTP和真实Mist界面完成结算提交→财务提议→本人确认→MCP读回。执行必填稳定`requestId`，重试不换编号；敏感提议复用原说明回放，确认后不再次执行。协议只协商已实现版本，认证GET无SSE时回405；具体契约与未覆盖客户端见工作助手方案第14节。
- Agent审计基础：`agentAudit.ts` 生成脱敏原命令及实际字段差异，`repository.ts` 与原请求同事务追加独立内部审计回执。`mist-revision:agent-audit:<原请求编号>` 沿用旧版已保护的服务端编号空间，普通业务回执不增私有字段，回退也不附带泄漏。普通委托办理及本人确认/拒绝保留来源会话；失败/预演/幂等重放不重复。公开回执防御性剥离 `__agentAudit`，内部编号禁止公开读取或占用；旧记录不补造，查询不能直接返回内部JSON。
- 未完成：长期API Key/无人值守账号、自助连接/续签与更多实际客户端、Agent审计的当前权限裁剪/查询/页面、后续生产到退税的界面课程、视频导出与员工上手验收。以上缺口由当前接手Agent继续推进，不默认等待其他会话。

### 发布边界核验：采购币种与扣费月末归属（2026-10-31）

- 采购表单及 typed API 共用 `server/src/shared/mistProcurementCurrency.ts`。当前产品规则对明确标记为中国大陆的供应商要求 CNY；未知国家不猜测，境外和港澳台不据此限制。`mistFulfillment.ts` 在保存草稿、提交及批准时重新检查当前供应商；退回仍可执行。询价定标和换供应商通过同一保存命令校验，失败不改变原合同。历史已批准合同不自动换币或重定价。回归入口：`mistProcurementCurrency.test.ts`、`mistSourcing.test.ts`。
- 银行扣费及其冲回按北京时间业务日期参与月末应收余额，不能直接截 UTC 字符串，也不能用当前已冲回状态改写历史月末。真源为 `mistFxRates.ts#fxRevaluationPreview`，回归覆盖月末 16:00 UTC、显式 +08:00 和跨年边界，见 `mistFxReval.test.ts`。
- `ApprovalsPage.tsx` 的窄屏详情须从传入记录路由初始化打开状态；外壳会在审批记录路由变化时重新挂载页面。`runtime/reviews.test.tsx` 按同样挂载方式验证打开、关闭及重新打开，不以桌面预览代替手机详情可达性。
- 本轮验收仅覆盖发布变更、相关链路及独立本地演示；没有访问共享公司业务数据，不表示全系统人工验收或员工手册全部完成。新版教学现有27课、164步、191张图；旧35模块/6章检查不统计这些课程，不能据此判定新版覆盖率。

### 当前实现导航：内部供料与退料财务（2026-10-30）

本节面向维护者及 Agent；员工操作说明见 [`wiki/pages/`](../wiki/pages/)。操作手册描述岗位任务和界面，技术 Wiki 记录调用链、权限、状态约束、测试与已知缺口；两者随业务改动分别更新，不把模拟走查日志放入员工正文。下文未提到的历史章节须重新核验，不代表当前实现。

**教学源限制（2026-10-30 最新）**：用户已禁止继续使用青屿小组/库，历史实测仅作历史证据，不代表继续操作许可；旧库截图/GIF 已从员工版撤下。当前 `wiki/lessons/*.json` 的27课使用独立本地Mist演示种子的真实界面帧，播放器不连接业务后端；热点及预设输入/选择效果、问答和SOP用于学习。采集和业务验证仍须采用合适的已授权场景，不能自动恢复被禁用的青屿库。

#### 内部面料分配与交接

- 当前页面入口为 `dev-ui-preview/mist-atelier/app/main.tsx` → `ReferenceApp.tsx`；分配与点收界面分别在 `pages/InternalFabricPanel.tsx`、`pages/MaterialDeliveryPanel.tsx`，库存入口在 `pages/modules/InventoryPage.tsx`，开产核对在 `pages/productionGate.ts`。
- 业务真源在 `server/src/shared/mistInternalFabric.ts`。成衣订单条目使用有效分配指向面料订单；仓库发料记录与接收点收保留独立历史，旧分配版本的交接不得用于新版本的发料限额或短结判断。
- 行级范围按 `server/src/shared/mistDataScope.ts` 与 `server/src/mist/repository.ts` 执行。指定接收人通过响应中的 `scopedFabricAccess` 获取目标条目的最小候选、门禁和交接摘要；隐藏来源订单的商业信息不因此公开。接收动作在服务端重新核对身份、来源、状态和写入范围。生产页展示该条目的服务端门禁摘要，放行仍以服务端校验为准。
- 针对性回归入口：`server/src/mist/materialCandidateRepository.test.ts`、`server/src/shared/mistMaterialCrossGroup.test.ts`、`server/src/shared/mistMaterialShortClose.test.ts`、`dev-ui-preview/mist-atelier/app/pages/productionGate.test.ts`。
- **产前样跨组门禁（2026-10-30）**：`productionSampleRequirements` 比对产前样与当前物料计划；接收人看不到面料来源时，不能在裁剪状态里重新计算指纹并据此声称“未登记”。`scopedFabricAccess` 在接收人具有订单读写、生产/产品/QC 读取权限时，按该接收人的订单条目和生产分支返回最小样品门禁状态；来源商业资料和报告正文不包含在摘要中，任务与样品 ID 只在相应行可见时返回。开产仍以服务端完整状态核验，物料计划修改后旧样品不能用于放行。青屿模拟通过报告、需求方采用及业务接续后，原生产页回读产前样已确认；此为 M 码样品的模拟评审，不代表生产已放行或全部实物已检验。

#### 隔离处置与无补偿财务核对

- 隔离退料从库存批次送复检，报告和处置保留来源；仓库实物退供/报废不自动改写原采购结算或形成退款。库存交互见 `pages/modules/InventoryPage.tsx`，财务界面见 `pages/FinancePayables.tsx`，规则与响应投影见 `server/src/shared/mistPayables.ts`。
- 已实现路径为负责人记录不追偿决定，具有相应权限的另一财务人员核对无补偿并可撤回；参考货值不是新付款或自动损失凭证。供应商补偿、退款、红字发票等其他分支不能据此假定已实现或已验收。
- 模拟实页证据：2026-10-30 青屿公司的两笔各 2 米退供、报废及无补偿核对；4 米重新采购后跨组点收。该证据覆盖这些具体分支，不代表全部场景验收。测试入口为 `server/src/mist/financialDisposalRepository.test.ts` 和 `server/src/shared/mistFinancialDisposalReview.test.ts`。

#### 采购结算、供应商票据与付款

- 员工实际步骤见 `wiki/pages/70-采购结算票据与付款.md`；业务入口在 `pages/FinancePayables.tsx`，账户归属与流水入口在 `pages/FinancePage.tsx`，结算、票据、付款申请及分配规则见 `server/src/shared/mistPayables.ts`，公司银行账户处理见 `server/src/shared/mistAccounts.ts`。
- 结算由业务提交、财务复核；按结算登记应付后，业务申请付款、主管审批、财务登记实际付款及票据分配。付款流水未归属账户时不计入银行账户余额，须按实际凭据归属；`登记实付`记录已发生付款，不连接银行发起转账。
- 青屿模拟仅验证本次收货 4 米、单价 16 元的完整结算及模拟普通发票、付款审批、实付分配与模拟账户归属；原采购结算与其他租户保持不变。其他税种、争议扣款、冲回和真实银行凭据不属于此次验收。
- 青屿内部样衣加工另按实收 2 件×35 CNY 完成结算、模拟到票与成衣主管审批，再由财务登记模拟付款和账户归属；原有应付记录逐条保持。实际核算明细含加工 70 CNY、内部面料 64 CNY，共 134 CNY，没有把预算当作收入。

#### 内部成品交付：服务端基础与未覆盖部分（2026-10-30）

- `server/src/shared/mistInternalDelivery.ts` 维护内部成品交付、指定接收账号逐笔点收、点收冲正、实际拒收退回及未接收交付撤回。`mistWorkspace.ts` 接入 `order.internal.*`，内部成品完工后使用「待内部交付」，由实际点收派生「待内部接收 / 部分内部交付 / 内部交付完成」；已有内部面料分配仍沿原交接路径。#554 为服务端基础；后续本地页面代码已接入，尚未部署或完成真实界面验收，不作为已验收员工功能宣传。
- 工厂回交和最终需求方点收是独立事实。交付必须引用准确生产分支的供应商直接回交或普通成品出库；要求最终完工和当前有效生产 QC。四位小数数量使用整数精度校验；未实际退回的拒收货仍占用来源，记录实际退回后才可再次交付。交付不自动增减库存或改写采购、票据、付款、外贸出运；仓库实物退库仍须在库存独立办理。
- 批准约定里的内部接收负责人为自由文字，保留作约定；本次接收账号必须从当前在用公司成员明确选择，不按名字推断身份。发起人须有订单写入及订单、生产、采购读取权，成品出库来源另须库存读取权。**本轮纠正 #554 的权限缺口**：内部交付操作须同时有 `orders:read`、`orders:write`；点收和冲正还须准确指定接收人身份，只有读取权仍为只读。创建交付时由 `repository.ts` 重载接收人在本公司的有效岗位、个人授权和部门资格，缺少办理权限时拒绝创建任务。跨组只投影该交付记录，不因点收开放隐藏来源订单、生产或商业账务。
- `mistDataScope.ts#scopedWriteViolation` 仅为准确指定交付的点收历史及准确来源订单的派生状态/色彩提供受限写入例外；数量、接收身份、来源、合同及其他隐藏记录仍受保护。`repository.ts` 刷新当前成员资格、执行行级范围和幂等回执校验。每次命令均通过 `assertInternalDeliveryIntegrity` 保护在用交付来源、实际完工和订单数量，禁止同一分支内部交付与有效外贸出运重复占用；冲正及撤回保留审计，不删除原记录。
- Mist 页面为 `pages/InternalDeliveryPanel.tsx`：订单详情提供内部交付记录和独立分步登记表；`orders?section=internal-deliveries` 处理本账号被指定的接收，携带准确交付 ID 打开详情。实际导航目标使用已登记的 `orders`，不能发出未登记的 `orders/list` 页面。点收/更正/退回保留原请求版本及失败输入，切换账号、工作区或交付记录关闭旧表单；选择来源保留地点和原始依据，避免同日同量记录无法辨认。
- 交付待收任务由实际点收派生完成，拒收未退部分交回当前订单负责人跟进。`HomePage` 对这些任务只提供打开业务记录，`task.complete` 也拒绝手工改完成状态，不能绕过实物点收。`orderLineTrack.ts` 按实际内部接收显示末阶段，内部已交付不继续计入在途或提醒外贸出运；外部订单保留出运口径。
- 针对性入口：`server/src/shared/mistInternalDelivery.test.ts`、`server/src/mist/internalDeliveryRepository.test.ts`、`pages/InternalDeliveryPanel.test.tsx` 及相关订单/首页测试，完全使用独立内存资料，不读取任何公司库或备份。仍待实际分岗验收、视觉验看及教学素材；若接收人员离职或需要交付后换人，不能冒用原账号，应先补明确的接收改派规则与留痕流程。
- `CostPage` 与 `OrderActualCostPanel` 对无销售收入的内部订单仍展示毛利及出口退税。当前 134 CNY 成本数字有来源，但内部预算/成本与外部销售利润的展示和汇总边界需一并核对，不能用改文案掩盖不适用的口径。

#### 生产跟进与教学素材

- 青屿内部样衣在 2026-10-30 实页验证放行、进度更新、工序拖动、最终完工 2 件及 M/L 各 1 件模拟生产 QC；加工合同实收回交 2 件。生产百分比、最终完工、生产 QC 和加工回交是独立事实，不以更新进度替代最终点数或检验。
- 员工学习入口为应用顶栏及账号页的「使用手册」→ `/manual/`；标准构建输出 `dist/manual/`，独立打开并按需加载图片，不占业务首屏脚本。离线版为 `wiki/site/index.html`。旧 `wiki/pages/55-开产跟进与完工-SOP.md` 等六篇仅作待完善参考，青屿来源的十段旧 GIF 已撤下，不能沿历史记录重新加入员工交付。`manual-media.mjs` 的主动播放与静态封面工具保留，但不代表当前已有合格业务动画。
- 当前27课包括报价到订单10课、成品采购4课、采购结算与付款13课，共164步/191张WebP，均有对应采集清单。播放器提供聚光、推近、光标和输入展示、可控播放、热点练习和岗位SOP；练习使用预设动作，不提交业务或验证自由填表。后续定金、产前样、生产/QC、出运、收汇及结汇/退税课程、视频导出及员工上手验收尚待完成。
- `scripts/manual-catalog.mjs` 校验课程/采集/图片/交接引用，并将实际采集版本、素材Git变更与播放/员工验收声明分开；当前缺失的采集版本保持未知。核验内容摘要漂移后显示需复核。`wiki-check --strict-lessons` 守结构而不自动判定培训通过；旧Markdown35模块/6章统计单列。构建生成 `manual-version.json`，只发布引用图片及无个人资料的元数据，图片URL携带内容摘要。

> 上述记录中“青屿”相关内容是 2026-10-30 前的历史模拟证据。用户已禁止继续使用青屿公司、小组、业务库及旧素材，这些记录不构成继续访问或复用素材的许可。
