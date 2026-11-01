# 软件完善缺口清单（2026-11-02 排查）

来源：四路只读排查（开发报价订单 / 市场客户 / 采购库存物流 / 财务 AI 管理），共 260 条，按工作包归组；每条均有源码证据。原始清单在本机私有目录 `audit-*.md`。

优先级：**P0** 上线前必须（安全与正确性）；**P1** 核心业务闭环；**P2** 完整度与效率；**P3** 平台运营。工作量按条目累加（小=1、中=3、大=8 点），只用于比较大小。

| 包 | 名称 | 条数 | 工作量点 | 说明 |
|---|---|---|---|---|
| P0-1 | 安全：权限码判定与审批分级 | 17 | 23 | 把只做了界面标签、没有服务端判定的权限码补上判定；高风险写入和付款审批按金额与风险分级。 |
| P0-2 | 账号、登录与会话 | 9 | 13 | 首次登录强制改密、邀请邮件开通、“保持登录”真正生效、平台身份不再发公司请求、错误提示中文化。 |
| P0-3 | 命令目录与后端一致 | 13 | 13 | Agent 和 MCP 看到的命令与后端真实可用的一一对应：补漏、删去永远失败的、补权限映射。 |
| P0-4 | 演示数据隔离 | 3 | 3 | 正式公司里不出现任何演示种子或示例邮件。 |
| P1-1 | 面料分段委外（工序链） | 12 | 61 | 开发打样和大货都支持“织厂织坯 → 染厂染整（→ 后整理）”：坯布单指定收货染厂、发坯与回交、投入产出与损耗、单位换算、分段成本。与“成品采购多厂比样”并存，建案时选择。 |
| P1-2 | 邮件与业务打通 | 20 | 39 | 往来邮件能挂到供应商、采购、报价、询价；提交与跟进写进客户档案；从客户、报价、询价页直接用智能邮箱发信；本地附件、模板、批量、彻底删除。 |
| P1-3 | 单据与文件生成 | 12 | 26 | 系统按业务数据生成 PI/销售合同、CI、装箱单、订舱委托、报关单草稿、提单补料；单据模板可配；画册与报表可导出 PDF/Excel。 |
| P1-4 | QC 闭环 | 11 | 37 | 返样、来料、生产节点自动生成 QC 任务；两套 QC 合并为一套；不合格后的返工、让步接收、降级、索赔；AQL 抽样与面料四分制。 |
| P1-5 | 库存、批次与仓储 | 12 | 33 | 缸号、色号、卷号、码单贯穿收货到出运；多仓与调拨、盘点、预留、部分移位；出运自动出库；其他入库；库龄与库存金额。 |
| P1-6 | 财务与结算 | 25 | 68 | 一笔到账核销多票、跨币种核销与汇兑损益、预收冲抵、尾差与坏账、红冲与贷项、期末结账、凭证导出、供应商对账与付款计划、信用证不符点、退税期限提醒、退货扣款。 |
| P1-7 | 报价与订单 | 19 | 49 | 报价按条目和数量部分接受与转单、还价出新版本、到期提醒；订单拆分合并；变更与取消联动采购、生产、出运；订单内看成本毛利。 |
| P1-8 | 定价与成本 | 6 | 19 | 内部估算器接通、定价试算挂报价并带回、多币种试算、参考成本结构化录入与引用。 |
| P2-1 | 采购执行 | 6 | 10 | 超交容差、短交结案、合同变更单、批准后补传回签件、提交成功反馈与只读原因。 |
| P2-2 | 样品与开发 | 17 | 47 | 样品数量与单位按实物登记（小数米、色位、套）；寻样可改可撤、逐条候选、转索样或建档；寄样签收与客户意见、报废与退厂、样品费、客户索样单；面料员工默认面料页签；辅料开发与辅料订单。 |
| P2-3 | 货运与报关 | 10 | 14 | 柜号封条、船名航次、ETD/ETA、截关；订舱变更记录；唛头；到港与签收跟踪；无需报关的快件；改单与退关；货代报关行可选。 |
| P2-4 | 客户、供应商与询价 | 22 | 43 | 客户列表与筛选导出、客户停用与合并；跟进与商机可改可重开、多关联、商机漏斗；联系人删除；供应商看应付与询价、评分维度、证书扫描件；询价可改可撤、开发期可询价。 |
| P2-5 | 市场、季节与档案 | 12 | 23 | 季节与展会进日历、可删除；线索池与负责人；活动复盘；推广邮件发送；产品档案多供应商与价格历史、筛选；归档确认。 |
| P2-6 | 日历、待办与开户引导 | 9 | 15 | 日程删除、月视图、参与人与提醒；手工待办与改期转派；新公司开户引导；空公司不出周报。 |
| P2-7 | 风险、索赔与合规 | 5 | 7 | 风险可挂客户、供应商、信用证；制裁与出口管制筛查；索赔提交确认、来源发票按订单过滤。 |
| P2-8 | AI 与 Agent | 7 | 27 | 小竹能办理写入（经确认）、对话可保存、可引用更多记录；平台 API 服务与个人订阅；员工自助 Agent 连接；长值守 Agent。 |
| P2-9 | 人事与公司管理 | 5 | 5 | 离职直达交接、合同到期提醒、台账未核对项走查；人事范围待定。 |
| P2-10 | 数据中心、报表与工具 | 5 | 7 | 数据中心导入导出与质量规则、跳转修正；更多报表；纺织常用换算工具。 |
| P3-1 | 平台运营 | 2 | 4 | 操作成功反馈；公司用量、账单、续费提醒、退租导出。 |
| | **合计** | **259** | **586** | |

## 各包明细

### P0-1 安全：权限码判定与审批分级

- `fin53` **AI**（安全·中）ai:write:low/medium/high 三码无判定点：Agent 提议确认只看 ai:chat，任何能聊天的人都能确认高风险写入提议（如付款、核销）。  
  建议：生产必须补：按被提议命令的风险等级要求对应 ai:write:* 码  
  证据：SV/shared/mistAgentProposals.ts:27；SV/auth/__tests__/danglingScopeConsumption.test.ts:109-111
- `fin23` **应付**（F/B·中）付款审批不分金额档和新供应商：任何配置的付款审批主管都能批任意金额。权限码 vouchers:approve:pay_lt5 / pay_gt5 / pay_new_supplier 只是 UI 标签。  
  建议：在 payable.request.submit 按金额与是否首次付款计算所需审批人，decide 时校验对应码  
  证据：SV/shared/mistPayables.ts:738,815-819；SV/auth/__tests__/danglingScopeConsumption.test.ts:124-126
- `fin70` **公司管理**（安全·小）users:read 无判定点：后台读账号走 requireRole，岗位矩阵里的“查看账号”权限无效。  
  建议：生产必须补：GET /admin/users 用 users:read 判定，便于给 HR 只读权限  
  证据：SV/auth/__tests__/danglingScopeConsumption.test.ts:104；SV/admin/route.ts:260
- `fin74` **公司管理**（安全·小）customs:admin 无判定点：单证模板、签章配置任何有单证写权限的人都能改。  
  建议：生产必须补：模板与签章配置写入用 customs:admin  
  证据：SV/auth/__tests__/danglingScopeConsumption.test.ts:114
- `fin75` **公司管理**（安全·小）quotations:convert 无判定点：报价转订单只需 orders:write。  
  建议：转单同时要求 quotations:convert  
  证据：SV/shared/mistMarket.ts:101；SV/auth/__tests__/danglingScopeConsumption.test.ts:108
- `fin72` **公司管理**（安全·小）audit:export 无判定点；审计日志页也没有导出按钮。  
  建议：加审计导出并用 audit:export 判定  
  证据：SV/auth/__tests__/danglingScopeConsumption.test.ts:106；FE/pages/modules/AdminAccounts.tsx:293-322
- `fin76` **公司管理**（安全·小）sensitive:tax_base 无掩码实现：退税计税金额、专票税额对所有能看报关的人可见。  
  建议：退税计税金额按此码掩码  
  证据：SV/auth/__tests__/danglingScopeConsumption.test.ts:100
- `fin60` **数据中心**（安全·小）knowledge:admin 无判定点，数据中心没有任何管理操作的门禁；若以后加导出/清理必须接上。  
  建议：加导出时用 knowledge:admin 或新码判定  
  证据：SV/auth/__tests__/danglingScopeConsumption.test.ts:105
- `fin78` **公司管理**（安全·小）moq:capsule_exemption:write、knowledge:approve 无判定点；前者为胶囊豁免写入，属业务例外，生产应补。  
  建议：moq 豁免写入用该码判定  
  证据：SV/auth/__tests__/danglingScopeConsumption.test.ts:107,122
- `fin71` **公司管理**（安全·小）settings:account 登记在公司管理员授权清单，但没有任何页面或接口按它判定。  
  建议：确定用途（公司资料编辑）并接上，或从矩阵删除  
  证据：SV/auth/__tests__/danglingScopeConsumption.test.ts:99
- `fin73` **公司管理**（安全·小）dashboard:read 无判定点（首页用 cockpit:read，全景看板未按此码把关）。  
  建议：全景看板与团队页改用 dashboard:read 判定  
  证据：SV/auth/__tests__/danglingScopeConsumption.test.ts:103
- `fin33` **退税**（安全·小）退税命令用 invoices:write / invoices:reconcile；tax:read/tax:write/tax:approve 三码登记为“无模块”，实际退税模块已存在，岗位矩阵里的退税权限是装饰。  
  建议：退税申报/核准改用 tax:write、tax:approve，读取用 tax:read  
  证据：SV/shared/mistExportRebate.ts:76-79；SV/auth/__tests__/danglingScopeConsumption.test.ts:93-97
- `fin28` **结汇**（安全·小）锁汇、结汇用 vouchers:write 把关；fx:lock 权限码登记为“锁汇功能未实现”，与实际不符，岗位矩阵里给谁 fx:lock 都无效。  
  建议：锁汇改用 fx:lock 判定（锁汇是对银行的承诺，应单独授权），更新豁免表  
  证据：SV/shared/mistWorkspace.ts:816（finance.fx.* → voucher）；SV/auth/__tests__/danglingScopeConsumption.test.ts:98
- `fin77` **公司管理**（安全·小）订单变更/取消/出运放行等 approve 码按设计只作 UI 标签（审批走 approvals 内核），无需补判定，但岗位编辑器应提示“该权限不控制审批人”，避免管理员误以为勾了就能审批。  
  建议：在权限编辑器为 ui-label-only 码加说明  
  证据：SV/auth/__tests__/danglingScopeConsumption.test.ts:117-122；FE/pages/modules/JobPermissionEditor.tsx
- `fin45` **索赔**（安全·小）aftersales:approve 已被前端用于判定（PlatformPages.tsx:103），需确认服务端 claim.decide 同样校验；悬空测试已不再列 aftersales，说明已接通，建议补服务端测试。  
  建议：补服务端拒绝无 aftersales:approve 的测试  
  证据：FE/pages/modules/PlatformPages.tsx:103
- `mar30` **关系**（前后端·小）归档前"还有在手业务"的拦截只在前端；后端 relation.status 不检查，也不写操作记录。智能体或接口可直接归档。  
  建议：后端加同样校验并记 history  
  证据：srv/shared/mistMarket.ts:350；app/pages/modules/RelationsPage.tsx:196
- `fin84` **平台**（缺环节·中）平台人员进入客户公司协助（支持模式）后无显式的“客户授权”与时限记录（待实测 exitingSupport 流程）。  
  建议：支持模式需客户管理员授权并记录时限  
  证据：FE/ReferenceApp.tsx:151-154

### P0-2 账号、登录与会话

- `fin1` **登录**（安全·小）公司管理员给员工新建账号时设了初始密码，员工用它登录后不会被要求改密，初始密码会一直有效（管理员知道这个密码）。重置密码会要求改，新建账号不会。  
  建议：公司内新建（含 :365 重新启用分支）时在 metadata 写 forceChangePassword:true，前端 ReferenceApp.tsx:351 已会拦截  
  证据：SV/admin/route.ts:376（create 不写 metadata.forceChangePassword）；对比 SV/admin/route.ts:456,470（重置时写 true）、SV/platform/route.ts:214、SV/auth/tokenHelpers.ts:73
- `fin2` **登录**（安全·小）平台开户时选“设置初始密码”，公司负责人首次登录也不要求改密；邀请方式才要求。  
  建议：两种方式都置 true，或至少 password 模式置 true  
  证据：SV/platform/route.ts:214 `forceChangePassword: deliveryMode !== 'password'`
- `fin3` **登录**（交互·小）强制改密页文案写“管理员为你重置了密码”，若补上首次登录改密，新员工会看到错误原因。  
  建议：按场景区分“首次登录”与“管理员重置”两套文案  
  证据：FE/pages/ChangePassword.tsx:48
- `fin79` **公司管理**（缺环节·中）管理员建好账号后，没有“发送邀请邮件让员工自己设密码”的选项（平台开户有），只能把初始密码口头转交。  
  建议：公司内建账号增加“邮件邀请”方式，复用 accountAccess 邀请链接  
  证据：FE/pages/modules/AdminAccounts.tsx:77,152；对比 FE/pages/SaasAdminPage.tsx:70
- `fin4` **登录**（交互·中）“保持登录”只决定浏览器里的令牌放 localStorage 还是 sessionStorage；服务器 cookie 始终 7 天，令牌也固定 7 天。不勾选时关浏览器后 cookie 仍在，勾选时 7 天后仍会掉线，员工感到“勾不勾都一样”。  
  建议：后端按 remember 设置会话 cookie（不设 maxAge）或长期 cookie，并加滑动续期；前端启动时先用 cookie 调 /auth/me 恢复会话（待实测确认“重开需登录”的具体原因）  
  证据：FE/runtime/auth.tsx:154-156；services/authService.ts:381-382（两处都写）；SV/auth/route.ts:34,204-209；SV/auth/service.ts:57
- `fin5` **登录**（前后端·小）平台账号登录后控制台出现 404 /api/mist/session：会话探测对所有身份都发，远端模式靠 404 识别。  
  建议：远端部署时跳过本地会话探测（按构建配置或 publicEntry 判断），避免无意义 404  
  证据：FE/runtime/auth.tsx:225-227,245
- `fin6` **登录**（前后端·小）平台账号登录后控制台出现 403 /api/hr/teams/mine：小组查询没有排除平台身份。  
  建议：在 useOrganizationContext 里对 platformOnly（platformRole==='platform_admin' 且无 roleIds）直接返回空，不发请求  
  证据：FE/runtime/organizationContext.ts:23-25；FE/ReferenceApp.tsx:150,155
- `fin7` **注册**（断链·小）公司员工登录页的“找回密码”跳到 platform-recovery 路由，名字和用途混用（公司员工与平台人员同一入口），待实测员工邮箱是否能收到重置链接。  
  建议：路由改名为通用 account-recovery，并在页面区分公司/平台入口说明  
  证据：FE/pages/LoginPage.tsx:94；FE/ReferenceApp.tsx:339
- `fin8` **公司管理·账号**（交互·小）新建账号缺字段或邮箱重复时返回英文“displayName, email, password are required.”“Email already in use.”，员工看不懂。  
  建议：改为中文并说明哪个字段缺失、重复邮箱属于哪种状态  
  证据：SV/admin/route.ts:309,321

### P0-3 命令目录与后端一致

- `ord13` **开发·收费**（前后端·小）命令目录里有“development.billing.request”，但后端一调用就报错；Agent 会看到一个永远失败的命令  
  建议：删掉类型声明并重新生成目录，或在目录中标注“已停用”  
  证据：BE/mistWorkspace.ts:347、:1184-1185；agentCommandCatalog.ts（含该条）
- `ord43` **生产进度**（前后端·拆成两条声明或修生成脚本后重新生成）“登记线下在制 / 登记实际进度”用的 fulfillment.production.intake、observe 两个命令不在命令目录里，Agent 无从调用  
  建议：'b'` 联合类型  
  证据：BE/mistProductionIntake.ts:25；agentCommandCatalog.ts（缺）；生成脚本不解析 `'a' \
- `sup58` **生产(跨模块)**（前后端·小）生产在制登记 fulfillment.production.intake / fulfillment.production.observe 已实现，但命令目录缺失（目录只有 intake.decide）  
  建议：修正目录生成器对“类型字面量联合”的解析  
  证据：SH/mistProductionIntake.ts:25；命令目录仅 :771 有 fulfillment.production.intake.decide
- `sup38` **QC**（前后端·小）QC 转交、改期命令前端在用、后端已实现，但命令目录里没有，Agent/MCP 不知道可以调用  
  建议：重新运行 scripts/gen-mist-command-catalog.mjs 并检查生成器为何漏掉带注释的联合成员  
  证据：SH/mistFulfillment.ts:471、:475、:1231-1265；FE/QcWorkbenchPage.tsx:146-147；命令目录无 fulfillment.qc.transfer / fulfillment.qc.reschedule
- `fin42` **索赔**（前后端·小）platform.goods.transition 在命令目录中，但服务端对有来源的货物一律拒绝、对历史货物也拒绝，实际不可用，却仍暴露给 Agent。  
  建议：从 Agent 命令目录移除或标为只读历史  
  证据：SV/shared/mistPlatform.ts:207
- `fin17` **发票**（前后端·小）命令目录有 platform.invoice.save / platform.invoice.issue（独立开票草稿与签发），前端没有任何入口调用；页面只读展示“历史草稿”。  
  建议：确认业务口径：废弃则从命令目录和 Agent 可用命令移除；保留则补界面  
  证据：SV/mist/agentCommandCatalog.ts（platform.invoice.*）；SV/shared/mistPlatform.ts:155-156；FE/pages/modules/InvoicePage.tsx:40,140
- `fin18` **发票**（前后端·小）finance.developmentInvoice.issue 在命令目录和权限映射里有，前端未调用；开发费发票实际走 development.billing.issue。  
  建议：删除重复命令或在目录注明“仅 Agent 用”  
  证据：SV/shared/mistWorkspace.ts:814；FE 全目录无该字符串
- `ord29` **报价管理**（前后端·小）事件文字表里有“记录报价交付”“记录客户报价答复”（market.quotation.send / respond），但没有这两个命令  
  建议：删除遗留标签，避免历史记录误导  
  证据：BE/mistWorkspace.ts:1550-1551
- `fin52` **AI**（前后端·小）agent.task.cancel 命令在目录中，前端停止任务走 REST 而非该命令，两条路径需确认校验一致；权限映射返回 null（任何人可调）。  
  建议：服务端处理中校验“任务所有者或可控制人”，补测试  
  证据：SV/shared/mistWorkspace.ts（mistCommandPermission：agent.task.cancel → null）；FE/pages/AgentTasks.tsx:77
- `fin38` **风险**（前后端·小）platform.risk.decide 在命令目录里，但前端只经审批中心审批，风险页无直接决定入口（由审批页办理，属设计）；需确认 Agent 调此命令时与审批页走同一校验。  
  建议：写测试覆盖 Agent 直接调用 decide 与审批页一致  
  证据：SV/shared/mistPlatform.ts:162；FE/pages/modules/RisksPage.tsx:208
- `fin24` **应付**（前后端·小）payable.request.decide（审批付款申请）前端不直接调用，依赖统一审批页；命令目录与页面入口不一一对应，财务员工在应付详情里看不到“去审批”的直达。  
  建议：在付款申请详情加“到审批中心”跳转（同风险页做法 RisksPage.tsx:208）  
  证据：FE 全目录无 'payable.request.decide'；FE/pages/ApprovalsPage.tsx:21
- `mar33` **关系**（前后端·小）在手业务交接命令用 `as any` 绕过类型，handover.customer 不在前端命令类型里，改动后编译器发现不了参数错。  
  建议：把 HandoverCommand 并入 MistCommand 联合类型  
  证据：app/pages/modules/RelationsPage.tsx:118；srv/shared/mistHandover.ts:17
- `fin80` **公司管理**（前后端·小）公司管理的账号、岗位、部门、审批资格、Agent 身份都走 REST，不在 Mist 命令目录，Agent/MCP 无法读写，台账标“未找到写入命令”；属设计但需在 Agent 文档写明。  
  建议：在 MCP 工具说明中列出不可经 Agent 办理的管理事项  
  证据：docs/manual-coverage.md:75-83,276

### P0-4 演示数据隔离

- `ord50` **全部模块**（占位·小）新建公司默认是空数据，但服务端仍保留整套演示种子（演示订单、开发案、寻样单写死文字“已按要求找到并确认面料”）  
  建议：确认演示种子只在演示账号可用，正式环境禁用  
  证据：BE/mistWorkspace.ts:727-782；server/src/mist/repository.ts:578
- `mar15` **邮箱**（占位·小）示例邮箱/示例邮件/示例附件（不能发信、不能下载）会出现在公司数据里，正式公司如残留演示数据员工会误以为是真邮件。  
  建议：正式公司禁止创建示例账号，或提供一键清除  
  证据：app/pages/modules/EmailsPage.tsx:44、:403、:421、:429-430；app/pages/modules/MailReviewPanel.tsx:50
- `sup60` **全模块**（占位·—）演示数据文件 SH/mistDemoSeed.ts、SH/mistDemoInternalFabric.ts 存在，但运行代码未引用（只在测试中使用），未发现演示数据混入正式页面  
  建议：保持现状  
  证据：grep 结果：非测试文件无引用

### P1-1 面料分段委外（工序链）

- `ord1` **开发·面料开发**（业务·大）一轮里勾的几家工厂全被当成“同时比样”的候选，各出一个版本；没法表达“A 织厂织坯 → B 染厂染整”这种先后工序  
  建议：轮次内区分“比样候选”和“分段工序”两种模式，分段模式下按工序链建一个版本，并记录坯布从上道交到下道  
  证据：BE/mistWorkspace.ts:119（MistRound.factories）、:658-662（createRound 逐厂建版本）
- `ord2` **开发·面料开发**（业务·大）同类问题：面料大货订单每个条目只允许一个工厂分支，织厂、染厂分段委外无法在系统里表达  
  建议：生产分支支持“工序链”（织造→染整→后整），上道完工自动成为下道来料  
  证据：BE/mistFulfillment.ts:1561、:1566
- `sup1` **采购**（缺环节·中）坯布采购单的“交货地点”只能手写，不能选另一家供应商（染厂）作为收货方，系统不知道坯布去了哪家染厂  
  建议：增加“收货方 = 供应商ID / 我方仓库”结构化字段，自由文本只作补充地址  
  证据：SH/mistFulfillment.ts:161、:1501；FE/ProcurementPage.tsx:116（field('destination','主要交付地点') 自由文本）
- `sup2` **采购**（断链·中）坯布采购单和染整加工单之间没有关联字段，看染整单时不知道用的是哪张坯布单的布，反之亦然  
  建议：加工单增加“投入物料来源采购单”多选关联，并双向显示  
  证据：SH/mistFulfillment.ts:144-188（FulfillmentPurchase 无 sourcePurchaseId / inputPurchaseIds）
- `sup3` **采购**（缺环节·大）面料加工单不能“发坯布给染厂”：发料/直送加工方的逻辑写死只认成衣加工分支  
  建议：把物料交接目标泛化为“任一已接单加工分支”，面料业务同样适用  
  证据：SH/mistInternalFabric.ts:288-291（materialDeliveryRequired 只对 internalSupply 或 garment+material 为真）、:297、:322（“请选择已接单的成衣加工分支”）、:334
- `sup4` **采购**（缺环节·中）面料坯布单登记收货时选“供应商直送加工方”，只记成一条去向为 supplier 的收货，没有指定染厂加工单，也不形成染厂的待点收  
  建议：直送时必须选接收加工单并生成待点收记录  
  证据：FE/ProcurementPage.tsx:137（面料无 targetProductionId 选项）；SH/mistFulfillment.ts:1593-1596
- `sup5` **采购**（缺环节·中）染整/委外加工回交只能记“加工服务交付”，不能按成品入我方仓库；染好的布没法进库存  
  建议：加工回交允许选择“入我方仓库 / 直送下一道工序 / 直送客户”  
  证据：SH/mistFulfillment.ts:1590-1591（加工服务交付不能作为物料入库）；FE/ProcurementPage.tsx:137
- `sup6` **采购**（缺环节·大）加工单没有投入产出与损耗记录：发出多少米坯布、回交多少米成品、缩率/损耗多少都无处记  
  建议：加工单增加投入量、产出量、损耗率、余料退回，结算时按约定损耗核对  
  证据：SH/mistFulfillment.ts:198-215（FulfillmentReceipt 只有 quantity/rejected）；全仓库搜不到“投入产出”字段
- `sup7` **采购**（缺环节·大）面料一个订单条目只允许一个工厂分支，且数量必须等于整条，无法“织造厂 + 染厂 + 后整理厂”多段委外  
  建议：按工序建立加工链（同一条目多张前后衔接的加工单），只有最后一道工序生成可出运分支  
  证据：SH/mistFulfillment.ts:1561、:1563
- `sup8` **采购**（缺环节·中）采购单与订单条目计量单位必须相同，系统不换算；坯布按公斤买、成品按米卖的常见情况走不通  
  建议：采购单增加换算系数（kg↔m↔yd），结算按采购单位、履约按订单单位  
  证据：SH/mistFulfillment.ts:1562、:1431
- `sup26` **库存**（缺环节·中）发料/回交只有成衣内部供料能走“发料→点收→退回”闭环；面料加工、辅料直发无法挂到加工单，出库只写“接收方”自由文本  
  建议：普通出库也要选接收加工单或出运单  
  证据：FE/InventoryPage.tsx:108、:120；SH/mistInternalFabric.ts:288-291
- `ord41` **生产进度**（业务·中）生产单只能由采购审批通过时自动生成，生产页本身不能新建；面料看板列名“备货/加工/整理”太笼统，没有织造、染色、定型  
  建议：面料工序按真实工艺命名，并与第 2 条工序链一起做  
  证据：BE/mistFulfillment.ts:1569；FE/pages/ProductionPage.tsx 看板 stageTitles；BE/mistProductionIntake.ts OBSERVED_PRODUCTION_STAGES

### P1-2 邮件与业务打通

- `mar1` **邮箱**（断链·中）邮件只能关联客户/开发案/订单/发票，供应商、采购单、报价单、询价单都挂不上；跟工厂的往来邮件在系统里成了"未关联业务"。  
  建议：EmailLinkKind 增加 supplier / purchase / quotation / rfq，并补 emailLinkTarget 与 options  
  证据：srv/shared/mistEmail.ts:15；app/pages/modules/EmailsPage.tsx:372-375
- `mar2` **邮箱**（断链·小）"提交到业务对象"后，记录只写在邮件自己的处理记录里，客户档案"沟通动态"看不到；生成的待办也指回邮件而不是客户/订单。  
  建议：提交时同时给目标业务对象写一条事件，待办 target 指向业务对象并附邮件链接  
  证据：srv/shared/mistEmail.ts:326-328（log 写 entityType 'email'，见 :235）；app/pages/CustomerPage.tsx:49（动态只按客户/订单/开发/联系人 id 过滤）
- `mar3` **邮箱**（断链·小）邮件"生成跟进"只建待办和日历，不进客户的"跟进记录"；客户页跟进 Tab 里看不到这次邮件跟进。  
  建议：邮件已关联客户时，同时写一条 crm.followUps（method=email）  
  证据：srv/shared/mistEmail.ts:312-317；app/pages/CustomerRelations.tsx:46
- `mar4` **邮箱**（交互·小）"生成跟进"的负责人是手填文字，系统实际把待办派给当前登录人；写了"张三"，张三的工作台也不会出现。  
  建议：负责人改为成员下拉（按账号），后端按 ownerId 派单  
  证据：app/pages/modules/EmailsPage.tsx:625；srv/shared/mistEmail.ts:315（assigneeIds 取 context.actorId）
- `mar5` **邮箱**（断链·小）发件人是供应商联系人时，不会提示"建议关联"；写信时收件人联想也只列客户联系人。  
  建议：联系人匹配与联想扩展到供应商/关系智库联系人  
  证据：app/pages/modules/EmailsPage.tsx:72-77、:515
- `mar16` **CRM**（断链·小）客户页"写邮件"用 mailto 打开本机邮件程序，不走智能邮箱，发出的邮件不会留在系统里（已知）。  
  建议：改为打开智能邮箱写信并预填收件人与客户关联  
  证据：app/pages/CustomerPage.tsx:83、:92、:134
- `mar35` **供应商**（断链·小）供应商详情没有邮件入口和往来邮件列表（依赖第 1 条）。  
  建议：加"写邮件"（智能邮箱）与邮件面板  
  证据：app/pages/modules/SuppliersPage.tsx:228-236
- `mar6` **邮箱**（缺环节·中）邮件列表不能多选，批量已读、归档、删除、关联都要一封封点。  
  建议：列表加勾选与批量操作栏  
  证据：app/pages/modules/EmailsPage.tsx:277-290
- `mar7` **邮箱**（交互·小）"删除草稿"点了直接删，不可恢复，没有确认。  
  建议：加确认弹窗  
  证据：app/pages/modules/EmailsPage.tsx:312、:466
- `mar8` **邮箱**（交互·小）邮箱账号"断开"直接删除凭据，没有确认；断开后同步、发信立即失效。  
  建议：加确认，说明影响  
  证据：app/pages/modules/EmailsPage.tsx:612
- `mar9` **邮箱**（缺环节·中）已删除文件夹不能彻底删除/清空；邮箱账号只能断开，不能移除。  
  建议：增加 email.purge 与 email.account.remove（需管理权限）  
  证据：app/pages/modules/EmailsPage.tsx:384-385、:607-613；srv/shared/mistEmail.ts:80-92（无 purge / account.delete 命令）
- `mar10` **邮箱**（缺环节·小）写信附件只能从"公司文件"里挑，且只列前 30 个；不能从电脑直接上传。  
  建议：写信区加本地上传（复用 uploadFile）  
  证据：app/pages/modules/EmailsPage.tsx:524、:542
- `mar11` **邮箱**（缺环节·中）邮件模板写死 4 个（询价回复、样品寄出、PI、出货），公司不能自建模板；【】占位要手改，不会按关联订单自动带入。  
  建议：模板入公司设置；按 links 自动填充订单号/款号等  
  证据：app/pages/modules/EmailsPage.tsx:57-62、:516-520
- `mar12` **邮箱**（交互·小）复核抽屉的"分类""复核备注"、处理结果弹窗的"处理结果""处理说明"都没有 aria-label，标签带"*"，读屏/自动化按名字找不到。  
  建议：给控件加 aria-label  
  证据：app/pages/modules/MailReviewPanel.tsx:68、:74、:77
- `mar13` **邮箱**（交互·小）"生成跟进"的"说明"框，可见标签叫"说明"，aria-label 却是"跟进说明"，两者不一致（已知问题）。  
  建议：统一为同一名称  
  证据：app/pages/modules/EmailsPage.tsx:627
- `mar14` **邮箱**（交互·小）部分失败只提示"操作未完成，请重试 / 操作未保存，请重试"，非 Error 类型的异常不带原因。  
  建议：兜底文案带上错误码或"网络中断/无权限"等分类  
  证据：app/pages/modules/EmailsPage.tsx:149、:157、:569
- `ord24` **报价管理**（业务·中）发送报价只是“登记已发送”写一句文字，不能直接从系统邮件发出报价单  
  建议：生成报价单后可一键用智能邮箱发送，并自动登记发送记录  
  证据：FE/pages/modules/QuotationsPage.tsx:104-110、:270
- `mar43` **RFQ**（缺环节·中）系统不发询价函：邀请供应商只是登记，比价表不能导出发给领导。  
  建议：邀请时可经智能邮箱发询价函；比价表导出  
  证据：app/pages/modules/SourcingRequests.tsx:62-63、:117-126
- `fin55` **邮件**（缺环节·大）真实邮箱收发未接通；营销推广发送也禁用。  
  建议：接通服务端收发或在界面标“仅示例”  
  证据：docs/manual-coverage.md:59；FE/pages/modules/MarketingPage.tsx:73；命令 email.server.* 前端均未调用（agentCommandCatalog.ts）
- `fin56` **邮件**（交互·小）邮件“AI 整理”有同意确认，但整理失败时只显示通用失败文案（待实测具体原因是否透出）。  
  建议：区分模型未配置、额度用尽、邮件过大等原因  
  证据：FE/pages/modules/MailReviewPanel.tsx:52,64

### P1-3 单据与文件生成

- `sup53` **单据**（缺环节·中）系统不生成 CI 和装箱单：员工要手写“单据正文”并上传自己做好的文件才能签发，出运和装箱数据不会自动带入  
  建议：按出运、装箱、订单价格服务端生成 CI/PL PDF，与采购单生成方式一致  
  证据：FE/DocumentCenterPage.tsx:95（content 文本框）；SH/mistFulfillment.ts:2062-2063（必须上传文件）；server/src/mist 只有 purchasePrint/quotationPrint/creditPrint 等，无 CI/PL 模板
- `ord36` **订单详情**（业务·中）订单只能生成“装箱单草稿”，没有给客户的形式发票（PI）、销售合同、订单确认书  
  建议：增加 PI/销售合同模板，按批准快照生成  
  证据：FE/pages/OrderDetailPage.tsx:225；BE/mistFulfillment.ts 单据类型仅 CI/PL/BL/CO/OTHER
- `sup45` **货运**（缺环节·中）没有订舱委托书、出货通知、提货单等对货代的单据生成  
  建议：按出运数据生成订舱委托书  
  证据：FE/ShipmentsPage.tsx:313-322（流程无此环节）；server/src/mist 下只有采购/报价/对账等打印模板
- `sup49` **报关**（缺环节·中）系统只登记“已申报/已放行”事实，不生成报关单草稿、报关委托书、申报要素文件，商品项算好了也不能导出给报关行  
  建议：增加报关单草稿与委托书导出（Excel/PDF）  
  证据：FE/CustomsPage.tsx:3（页面注释说明不代替申报）；SH/mistCustomsDeclaration.ts:80（draftCustomsDeclaration 只在页面内显示）
- `sup54` **单据**（缺环节·中）提单只能归档外部原件，没有提单草稿（补料）核对、电放、正本份数、提单号字段  
  建议：增加提单补料与确认件流程  
  证据：SH/mistFulfillment.ts:2056、:2094-2103；SH/mistFulfillment.ts:365
- `sup55` **单据**（缺环节·小）单据类型只有 CI/PL/BL/CO/其他，没有保险单、检验证书、受益人证明、装船通知、汇票  
  建议：扩展类型并对接信用证交单清单  
  证据：SH/mistFulfillment.ts:365；FE/DocumentCenterPage.tsx:27
- `sup56` **单据**（占位·小）“抬头与模板”页签只是公司资料的只读展示，没有任何模板可选或可编辑  
  建议：要么提供模板管理，要么改名为“公司抬头”  
  证据：FE/DocumentCenterPage.tsx:133-141
- `sup57` **单据**（交互·小）签发 CI 的确认框没有任何说明，签发后会自动生成一笔待财务确认的应收，员工不知道这个后果  
  建议：确认框写明金额、币种、到期日和“将生成应收”  
  证据：FE/DocumentCenterPage.tsx:117（fields: []，无 description）；SH/mistFulfillment.ts:2069-2087
- `mar51` **营销**（占位·中）画册"导出画册 PDF""发送画册"禁用，原因"PDF 排版导出服务尚未接入""尚未接入外部发送服务"。  
  建议：接 PDF 生成；发送走智能邮箱附件  
  证据：app/pages/modules/MarketPages.tsx:148（ActionBar 两项）
- `fin61` **报表**（占位·小）“订单核算”页签导出按钮禁用。  
  建议：补订单核算导出  
  证据：FE/pages/modules/PlatformReports.tsx:205 `tab === 'actual'`
- `fin63` **报表**（缺环节·中）只能导出 CSV，无 Excel/PDF 和定时发送。  
  建议：先提供 xlsx 导出  
  证据：FE/pages/modules/PlatformReports.tsx:205
- `sup17` **采购**（交互·小）“生成采购单/加工合同”后不自动打开或下载文件，要自己往下找“合同文件”区块  
  建议：生成后直接打开预览或下载  
  证据：FE/ProcurementPage.tsx:202、:355

### P1-4 QC 闭环

- `sup30` **QC**（断链·中）开发案返样后显示“QC 中”，但 QC 工作台没有对应任务。核实结论：不是设计如此的完整闭环，而是缺自动建任务。返样只同步样品台账，不建 QC 任务；开发版本的 QC 结论在开发详情页直接录入，绕过工作台  
  建议：返样登记时自动生成“待认领”样品评审任务，开发页的录入改为跳转到该任务；状态改为“待 QC 认领”  
  证据：SH/mistDevelopmentCompare.ts:34（未录 QC 即显示 'QC 中'）；SH/mistWorkspace.ts:958-959（recordSample 只调用 samples.sync）；SH/mistWorkspace.ts:986-987（recordQc 直接写 version.qc，不建任务）；FE/DevDetailPage.tsx:109、:252
- `sup31` **QC**（前后端·大）QC 存在两套实现：工作台用 Mist 状态的 qcTasks，开发域另有基于数据库的 QC 评审请求服务，两边任务互不可见  
  建议：统一为一个 QC 任务源  
  证据：server/src/development/developmentSampleQualityService.ts:246-275；SH/mistFulfillment.ts:1192-1214
- `sup32` **QC**（缺环节·小）只有业务员能发起 QC，QC 自己不能建任务（例如巡检、尾期抽检）；按钮对 QC 是灰的  
  建议：允许 QC 主管在准确来源上自建任务  
  证据：FE/QcWorkbenchPage.tsx:115、:216
- `sup33` **QC**（缺环节·大）生产 QC 不通过后只有“追加复验”和“业务确认继续”，没有返工单、让步接收（需客户书面同意）、降级、向工厂索赔这些处理选项  
  建议：NOK 处理增加：返工（指定工厂和期限）、让步接收（附客户确认）、索赔（生成供应商扣款）  
  证据：SH/mistFulfillment.ts:1327-1332（reject 只置 blocked 并写 risk）；SH/mistFulfillment.ts:1350-1366
- `sup34` **QC**（缺环节·中）“有保留通过”没有让步接收记录：谁批准、客户是否同意、让步范围都不记录，只在恢复时填一段文字  
  建议：增加让步接收审批与客户确认附件  
  证据：SH/mistFulfillment.ts:1356-1358；FE/QcWorkbenchPage.tsx:148
- `sup35` **QC**（缺环节·中）没有抽样标准（AQL 等级、抽样数、允收/拒收数）和缺陷分类（致命/严重/轻微）  
  建议：报告增加 AQL 方案与缺陷明细  
  证据：SH/mistFulfillment.ts:129-143（报告只有测量点和尺码件数）
- `sup36` **QC**（缺环节·中）面料检验没有四分制验布（每卷疵点扣分）、色差、缩率、色牢度这些面料专用项  
  建议：面料 QC 报告增加验布记录与理化指标  
  证据：SH/mistFulfillment.ts:1286-1288（测量点通用）；FE/QcWorkbenchPage.tsx:319（面料单位为空）
- `sup37` **QC**（缺环节·中）没有来料检验类别（见第 14 条），QC 类别只有样品、生产、退料复检  
  建议：增加“来料检验”  
  证据：SH/mistFulfillment.ts:107；FE/QcWorkbenchPage.tsx:31
- `sup14` **采购**（缺环节·中）来料没有自动检验：收货后不生成来料检验（IQC）任务，只能人工“转为拒收”  
  建议：增加来料检验类别，入库先进待检状态，检验通过才可用  
  证据：SH/mistFulfillment.ts:107（QC 类别只有 sample/production/quarantine）；FE/ProcurementPage.tsx:345
- `sup39` **QC**（交互·小）“从来源发起QC”按钮对无权限的人是禁用状态，原因只放在 title 悬浮提示里，键盘和触屏用户看不到  
  建议：改为可见的说明文字  
  证据：FE/QcWorkbenchPage.tsx:216
- `sup40` **QC**（交互·小）认领任务等直接动作成功后无提示  
  建议：成功后提示  
  证据：FE/QcWorkbenchPage.tsx:124、:188

### P1-5 库存、批次与仓储

- `sup12` **采购**（缺环节·中）收货登记不能填批号/缸号/色号/卷数，入库库存也不带批号（批号只在客诉退货入库时有）  
  建议：收货增加缸号、色号、卷号明细（码单），并写入库存批次  
  证据：SH/mistFulfillment.ts:198-215、:1609（stock 未写 batchNumber）；SH/mistFulfillment.ts:239
- `sup13` **采购**（缺环节·小）收货入库不能选仓库，库存批次没有 warehouseId，只有手写“实际交接地点”  
  建议：入库必须选真实仓库与库位  
  证据：SH/mistFulfillment.ts:1609；FE/ProcurementPage.tsx:139
- `sup27` **库存**（缺环节·大）库存批次没有缸号、色号、卷号、码单明细，面料按缸发货和缸差追溯做不了  
  建议：库存批次下挂卷明细（卷号、米数、重量、缸号）  
  证据：SH/mistFulfillment.ts:219-248
- `sup20` **库存**（缺环节·中）没有盘点：不能做盘点单、盘盈盘亏调整  
  建议：增加盘点单与差异审批调整  
  证据：SH/mistFulfillment.ts:253（库存流水类型无 adjust/count）；全仓库无“盘点”业务代码
- `sup21` **库存**（缺环节·中）没有仓库间调拨：“移位”只改库位文字，不改仓库，也没有在途状态  
  建议：增加调拨单（出仓→在途→入仓）  
  证据：SH/mistFulfillment.ts:1709-1712；FE/InventoryPage.tsx:112
- `sup22` **库存**（交互·小）“登记移位”总是把该位置的全部数量一起移走，不能只移一部分  
  建议：允许填写移位数量  
  证据：SH/mistFulfillment.ts:1710（quantity = position.available）；FE/InventoryPage.tsx:119（move 不显示数量）
- `sup23` **库存**（缺环节·中）没有库存预留/释放：出运、发料都不占用库存，同一批布可能被两张单子同时打算使用  
  建议：增加按订单/加工单预留与释放  
  证据：SH/mistFulfillment.ts:236-237（locked 只用于隔离）；SH/mistFulfillment.ts:1014（“预留”只针对出运对完工数）
- `sup24` **库存**（断链·中）出运离港不扣库存：成品出货后库存仍显示可用，只能手工“登记出库”再“关联出运”  
  建议：离港时按装箱自动出库，或强制先关联出库  
  证据：SH/mistFulfillment.ts:1954-1978（depart 无库存流水）；SH/mistFulfillment.ts:1719
- `sup25` **库存**（缺环节·小）只能从采购收货或客诉退货入库，没有其他入库（客供料、样布、余料退回、生产退料）  
  建议：增加其他入库单（须填来源与依据）  
  证据：SH/mistFulfillment.ts:223（sourceKind 只有 purchase/claimReturn）
- `sup28` **库存**（缺环节·中）没有库龄、呆滞、库存金额  
  建议：增加入库日期统计与成本单价  
  证据：FE/InventoryPage.tsx:139-145（只有数量）
- `sup44` **货运**（缺环节·中）装箱只能一行一个箱号，不能“1-50 箱每箱 24 件”成段录入；面料没有码单（每卷卷号、米数、毛净重）  
  建议：支持箱号段与面料卷码单  
  证据：SH/mistFulfillment.ts:320-333；FE/ShipmentsPage.tsx:122、:134
- `sup29` **库存**（交互·小）发料、出库、报废等动作对话框只要求填依据，没有二次确认，也不提示“提交后不可撤销，只能按原出库退回”  
  建议：报废/退供应商增加确认步骤和后果说明  
  证据：FE/InventoryPage.tsx:107-128、:156

### P1-6 财务与结算

- `fin11` **财务**（缺环节·中）一笔到账只能逐张选发票核销，客户一次汇款付多张发票时要反复操作，没有“一次分配到多张发票”。  
  建议：核销面板改为多选发票+各自金额，一次提交多条 allocation  
  证据：FE/pages/FinancePage.tsx:123-125,128（单 invoiceId 的 finance.reconcile）
- `fin12` **财务**（缺环节·大）到账币种必须和发票币种一致，客户用别的币种付款（如 EUR 付 USD 票）无法核销。  
  建议：支持跨币种核销：登记核销汇率，分别减少到账余额与发票余额，差额记汇兑损益  
  证据：SV/shared/mistWorkspace.ts:1303,1326
- `fin13` **财务**（缺环节·中）核销与结汇不生成汇兑损益：发票确认日汇率与收款/结汇日汇率的差额没有落账，只在月末调汇卡片手工登记。  
  建议：核销时按发票记账汇率与到账汇率自动算已实现汇兑差，进月末调汇汇总  
  证据：FE/pages/FinanceBankAccounts.tsx:267-283；FE/pages/FinanceWorkspace.tsx:162-163
- `fin14` **财务**（缺环节·中）预收款（定金）只能“归属到订单/客户”，开票后需要再手工核销；没有“预收冲抵发票”的一步操作和预收余额台账。  
  建议：发票确认时提示该订单有预收余额并一键冲抵；财务页加客户预收余额表  
  证据：FE/pages/FinancePage.tsx:194,212-217（funding.assign 仅登记归属）
- `fin15` **财务**（缺环节·中）客户少付小额（非银行扣费）只能用“银行扣费”且单票有上限，超出就只能走索赔贷项；没有“尾差核销/坏账核销”。权限码 invoices:approve:writeoff 已登记但无对应功能。  
  建议：增加“尾差/坏账核销”申请→审批→生效流程，接入 invoices:approve:writeoff  
  证据：FE/pages/modules/InvoicePage.tsx:106-113,161；SV/auth/__tests__/danglingScopeConsumption.test.ts:123
- `fin16` **发票**（缺环节·中）客户发票（CI 应收）开错后只能在无收款时作废重开；已收款或已部分收款的发票没有红冲/更正发票，只能借索赔贷项。贷项通知单只在索赔案件里产生。  
  建议：增加独立“应收更正/红冲”单（不依赖索赔），可冲减原票并保留原票  
  证据：SV/shared/mistFulfillment.ts:2105-2124；FE/pages/modules/PlatformPages.tsx:105-107
- `fin21` **财务**（缺环节·大）没有期末结账/关账：已过月份的到账、核销、付款仍可随时补登或冲回，报表数会变。  
  建议：增加按月结账：结账后该月日期的财务命令需反结账审批  
  证据：全仓库无 closePeriod/关账/锁账（检索 SV/shared、SV/mist、FE 为 0）
- `fin22` **财务**（缺环节·大）没有会计凭证与科目：财务模块只登记业务事实，“凭证”在 Mist 里指付款凭证，无法导出给金蝶/用友记账。  
  建议：至少提供按月的收付款、核销、结汇、退税明细导出（含建议科目），或对接一种财务软件导入格式  
  证据：FE/pages/FinancePage.tsx:178（付款凭证表）；FE/moduleMap.ts:21 备注“凭证列表=宽表”；全仓库 Mist 部分无科目/会计科目
- `fin26` **应付**（缺环节·中）没有供应商对账单（按供应商、期间列出票据、付款、扣款、余额），只有客户对账单。  
  建议：复用客户对账单生成逻辑，增加供应商对账单打印与导出  
  证据：FE/pages/modules/CustomerStatements.tsx；SV/shared/mistCustomerStatement.ts；检索“供应商对账单/supplierStatement”为 0
- `fin27` **应付**（缺环节·中）没有付款计划总览（未来 N 周应付到期、按供应商/币种汇总的资金需求）。  
  建议：加“付款日历/资金计划”视图  
  证据：FE/pages/FinancePayables.tsx（只有逐条计划）；FE/pages/FinanceWorkspace.tsx:43 只给总额
- `fin29` **信用证**（缺环节·中）银行判“存在不符点”后，没有“客户接受不符点/修改单据重新交单/改为托收”的后续处理，只能直接改结果为承付或拒付。  
  建议：增加不符点处理动作（申请客户接受、补正重交、转 D/P），记录各步时间  
  证据：SV/shared/mistLetterOfCredit.ts:13-14,168-180；FE/pages/modules/LetterOfCredits.tsx:84-86
- `fin30` **信用证**（断链·小）信用证“已承付”后，到账要财务另行到收款核销手工找；LC 详情看不到对应到账，也不能一键去核销。  
  建议：承付后在 LC 详情显示“待到账”并带链接到收款核销（预选同币种发票）  
  证据：SV/shared/mistLetterOfCredit.ts:7；FE/pages/modules/LetterOfCredits.tsx:141-176
- `fin31` **信用证**（缺环节·小）台账“信用证登记、改证与交单”状态为未核对，未经员工走查。  
  建议：安排财务/单证走查并录课  
  证据：docs/manual-coverage.md:235
- `fin32` **退税**（缺环节·中）没有退税申报期限提醒（出口后法定申报期）和单证缺失清单（报关单、专票、外汇核销等），只在申报时报错阻断。  
  建议：按出口日期计算截止日，进首页待办与风险预警；列出每单缺哪些单证  
  证据：FE/pages/modules/RebatePanel.tsx:59；SV/shared/mistExportRebate.ts:256；检索“申报期限/退税期限”为 0
- `fin34` **退税**（缺环节·小）台账“出口退税申报到账”未核对。  
  建议：安排走查  
  证据：docs/manual-coverage.md:239
- `fin62` **报表**（缺环节·中）无应付账龄、现金流（收付）、退税到账、汇兑损益、费用报表；销售额只按订单建单日，不能按出运日/开票日。  
  建议：补这几张财务常用报表与口径切换  
  证据：FE/pages/modules/PlatformReports.tsx:4,207
- `sup19` **采购**（缺环节·中）退换只记“补发/不补发”，没有退货单号、退货运费、扣款/索赔金额，无法给财务形成扣款依据  
  建议：退货登记增加扣款金额并推送到应付扣款  
  证据：FE/ProcurementPage.tsx:157-160；SH/mistFulfillment.ts:216
- `fin19` **发票**（交互·小）应收“确认应收”按钮点击即执行，无二次确认；确认后才能核销、会进入账龄与报表。  
  建议：加确认对话框，展示金额、客户、到期日  
  证据：FE/pages/modules/InvoicePage.tsx:139；FE/pages/FinanceDevBilling.tsx:12
- `fin20` **财务**（交互·小）“采纳小竹匹配建议”一键对多笔到账同时核销，无确认清单。  
  建议：先弹出将核销的到账↔发票对照表再确认  
  证据：FE/pages/FinancePage.tsx:175
- `fin25` **应付**（交互·小）“取消计划对应”点击即执行，无确认。  
  建议：加确认  
  证据：FE/pages/FinancePayables.tsx:316
- `fin35` **银行账户**（交互·小）账户表点行直接打开编辑（含期初余额），不是先看详情；无写权限时点了没有反应也没提示。  
  建议：点行先进详情，编辑按钮显式；无权限时显示只读详情  
  证据：FE/pages/FinanceWorkspace.tsx:140
- `fin36` **财务**（断链·小）收付款记录里的“付款冲回”实际只是跳到应付详情，按钮名与行为不符。  
  建议：改名“到应付办理冲回”或直接打开冲回对话框  
  证据：FE/pages/FinanceWorkspace.tsx:91
- `fin37` **报表/财务**（缺环节·小）台账“成本核算与订单利润”未核对。  
  建议：安排走查  
  证据：docs/manual-coverage.md:248
- `mar66` **首页**（交互·小）"应收待核销"统计没有排除已作废发票（关系智库那边排除了），两处数字可能对不上。  
  建议：统计时排除 voidedAt  
  证据：app/pages/HomePage.tsx:81、:90；对照 app/pages/modules/RelationsPage.tsx:40
- `mar26` **CRM**（前后端·小）后端跟进可关联"应收票据"并记催收，客户页"记录跟进"的关联下拉没有发票选项，只能去发票页做。  
  建议：客户页关联选项加入该客户未结发票  
  证据：srv/shared/mistCrm.ts:30、:87；app/pages/CustomerRelations.tsx:34-41

### P1-7 报价与订单

- `ord20` **报价管理**（业务·中）报价部分条目已转订单后，剩余条目想改价出新版本会被拒绝（“已转订单的报价不能再出新版本”）  
  建议：允许对未转条目出新版本，已转条目在新版本中锁定  
  证据：BE/mistMarket.ts:223；FE/pages/modules/QuotationsPage.tsx:239
- `ord21` **报价管理·客户还价**（断链·小）客户还价已能登记，但还价页没有“据此建新版本”按钮，要退回报价详情再手动改价重填  
  建议：在还价记录上提供“按还价建新版本”，预填还价单价与数量  
  证据：FE/pages/modules/QuotationFeedbackPage.tsx:169（自述不自动执行）、全文件无 revise 入口
- `ord22` **报价管理**（业务·中）客户接受只能整张报价“接受”，再用“标记条目不再转”处理没要的条目；没有按条目、按数量的部分接受  
  建议：接受时可逐条选择并改数量，未接受条目自动标记原因  
  证据：FE/pages/modules/QuotationsPage.tsx:271、:275；BE/mistMarket.ts:416
- `ord23` **报价→订单**（业务·中）转订单只能整条目整数量转，不能把一条报价拆到两张订单（如分两批交期），也不能把多张报价合成一张订单  
  建议：支持按数量部分转单与“并入已有草稿订单”  
  证据：BE/mistMarket.ts:418-426（按条目全量转、每次新建一单）
- `ord25` **报价管理**（业务·小）报价过了有效期要人工点“标记已失效”，到期前也没有提醒  
  建议：到期自动置失效或生成待办提醒  
  证据：FE/pages/modules/QuotationsPage.tsx:273；BE/mistMarket.ts:416
- `ord26` **报价·成本核算**（业务·中）核算的成本币种和单位必须与报价行完全一致，供应商人民币报价核 USD 报价时只能自己先换算  
  建议：允许录入原币与原单位，按报价汇率和换算系数折算并留痕  
  证据：FE/pages/modules/QuotationCostingPage.tsx:508-509；BE/mistMarket.ts:378
- `ord27` **报价→订单**（占位·小）报价转出的订单和条目图片固定写成“大衣”，面料订单也显示大衣图  
  建议：取来源产品/开发案主图，没有就用品类占位图  
  证据：BE/mistMarket.ts:425-426（img:'coat'）
- `ord28` **报价→订单**（前后端·小）报价转单生成的出运清单（5 项）和手工建单（8 项）不一致，转单订单缺“拟发范围确认、收货与贸易条款确认、收款条件核对”  
  建议：两处共用同一个默认清单函数  
  证据：BE/mistMarket.ts:425 vs BE/mistWorkspace.ts:750
- `ord30` **订单管理**（业务·大）没有订单拆分与合并：一张订单要拆成两单分别交期/分别出运，或两张小单合并下给同一工厂，都做不了  
  建议：增加拆单（按条目/数量）与合并（同客户同币种）并走变更审批  
  证据：全仓库无 split/merge 命令（agentCommandCatalog.ts 订单命令仅 order.*/order.governance.*）
- `ord31` **订单·变更审批**（业务·中）变更批准后只对“数量变化”给采购、生产发待办；改单价、改交期、新增条目不通知下游，出运也不会收到提醒  
  建议：交期、单价、条目增删也生成待办，并通知出运与发票负责人  
  证据：BE/mistOrderChangeImpact.ts createOrderChangeTasks（只比较 qty/breakdown，只发 purchase/production 待办）
- `ord32` **订单·变更审批**（业务·中）订单交期变更批准后，生产分支和采购的交期不跟着变，要人工逐个改  
  建议：批准后提示并可批量同步下游交期  
  证据：BE/mistOrderGovernance.ts:150-163（变更只改订单与条目）
- `ord33` **订单·取消**（业务·中）取消订单批准后只给采购、生产、出运各发一条“请处理”待办；采购单不自动暂停，也没有记录工厂已投料的取消损失与赔付  
  建议：取消时冻结未发出的采购与未开工的生产，并登记取消损失/向客户索赔  
  证据：BE/mistOrderGovernance.ts:303-310
- `ord34` **订单·取消**（交互·小）已有离港出运或已开票的订单不能取消，提示“请改用条目结案”，但没说明剩余未出运条目怎么处理  
  建议：提示中列出可结案的条目并给出入口  
  证据：BE/mistOrderGovernance.ts:259-263、:286
- `ord35` **订单详情**（交互·小）“放弃变更草稿”按钮点了立即删除，没有二次确认  
  建议：加确认对话框，写明将丢弃的变更内容  
  证据：FE/pages/OrderDetailPage.tsx:237
- `ord37` **订单详情**（断链·小）订单详情看不到本单的实际成本与毛利；该面板只挂在报表中心  
  建议：在订单详情加“成本与利润”入口（按报表权限显示）  
  证据：FE/pages/modules/OrderActualCostPanel.tsx 仅被 FE/pages/modules/PlatformReports.tsx 引用
- `ord38` **订单详情**（断链·小）订单详情没有到“定价与利润”“成本与利润核算”“样品仓库（产前样/船样）”的入口，只能从对方页反查  
  建议：加关联入口，带 orderId 过滤  
  证据：FE/pages/OrderDetailPage.tsx 的跳转目标仅 claims/orders/payment-vouchers/procurement/production-board/shipments
- `ord39` **订单·跨组**（业务·大（待确认））没有明确的“跨组订单”模型（A 组接单、B 组生产/供料），只能用“内部用途订单 + 内部交付”变通；内部结算价、对内对账不清楚  
  建议：先与业务确认场景，再决定是否增加跨组协作单与内部结算  
  证据：FE/pages/InternalDeliveryPanel.tsx（只有交付/点收/拒收）；全仓库无“跨组”字样
- `ord40` **生产进度**（业务·中）“登记延期”只把延期原因写进风险文字，不改订单交期、不通知客户、不生成审批  
  建议：延期超过订单交期时生成订单变更待办并提醒业务员  
  证据：FE/pages/ProductionPage.tsx:98
- `ord42` **生产进度**（交互·小）看板拖动卡片直接改工序，没有确认，也不能写备注；误拖只能再拖回去且留下两条记录  
  建议：拖动后弹出确认并可填写备注  
  证据：FE/pages/ProductionPage.tsx:119

### P1-8 定价与成本

- `ord44` **定价与利润**（占位·大）“生成内部估算”“应用到报价”两个按钮永远不可用，页面写着“估算器尚未接入本公司”  
  建议：接入成本来源后启用；在此之前隐藏这张卡片  
  证据：FE/pages/modules/PricingPage.tsx:76
- `ord45` **定价与利润**（断链·中）定价试算只能挂订单，不能挂报价；算出的价格不能带回报价行  
  建议：允许以报价行为来源试算并写回拟报价  
  证据：FE/pages/modules/PricingPage.tsx:76；BE/mistPlatform.ts:159（payload 只有 orderId）
- `ord46` **定价与利润**（业务·小）试算只有“退税美元定价”，欧元、英镑等报价币种无法试算  
  建议：汇率与目标币种可选  
  证据：FE/pages/modules/PricingPage.tsx:76（标题与字段固定 USD）；BE/mistPlatform.ts:159
- `ord47` **成本与利润核算**（交互·损耗% \）参考成本的物料明细要在一个大文本框里按“物料 \  
  建议：单位 \  
  证据：数量 \
- `ord48` **成本与利润核算**（断链·中）参考成本只能挂订单，不能挂产品档案或报价；报价核算页也不能引用已确认的参考成本  
  建议：参考成本可挂产品/开发版本，报价核算可选用  
  证据：FE/pages/modules/PlatformPages.tsx:77（来源订单必选）；BE/mistPlatform.ts:157
- `ord49` **成本与利润核算**（占位·中）参考成本详情页自述“历史协议没有准确订单行、成品单位、父版本与报价冻结引用”，说明数据模型尚不完整  
  建议：补订单行与单位字段后去掉提示  
  证据：FE/pages/modules/PlatformPages.tsx:77（参考成本边界 Banner）

### P2-1 采购执行

- `sup9` **采购**（缺环节·中）没有超交容差：登记收货不校验是否超过合同数量，超收只在列表上红字提示，没有“接受超交/退回超交”的处理入口  
  建议：合同增加溢短装比例，超出须审批或强制拒收  
  证据：SH/mistFulfillment.ts:1583-1599（无上限校验）；FE/ProcurementPage.tsx:58、:285（“数量待核对”只提示）
- `sup10` **采购**（缺环节·小）短交不能结案：采购单只有“累计交付 = 合同数量”才算完成，供应商确认不补发后单子永远挂在“供应履约中”  
  建议：增加“短交结案”操作（填原因、审批），按实收结算并关闭  
  证据：FE/ProcurementPage.tsx:51；SH/mistFulfillment.ts:1648（noReplace 只记退换，不改合同状态）
- `sup11` **采购**（缺环节·中）已批准合同不能改：供应商回复交期不同只能报错“需先处理商业变更”，但系统里没有变更单/合同修订流程  
  建议：增加合同变更单（交期/数量/单价），走审批并保留版本  
  证据：SH/mistFulfillment.ts:1471；SH/mistFulfillment.ts:1482-1483（已提交只能退回）；全仓库无 procurement.amend 类命令
- `sup15` **采购**（交互·小）只读用户看到“只读查看”提示框，但正文是空字符串，不说明为什么只读、找谁开权限  
  建议：写明缺少的权限和申请方式  
  证据：FE/ProcurementPage.tsx:219（uiText("")）
- `sup16` **采购**（交互·小）“提交审批”“生成采购单”等直接按钮执行成功后没有任何提示，员工不确定是否已提交  
  建议：直接动作成功后统一提示并滚动到结果  
  证据：FE/ProcurementPage.tsx:105、:198、:202（act 只处理失败）；对比 FE/ModuleWorkbench.tsx:72 弹窗有 toast('已保存')
- `sup18` **采购**（交互·小）附件只能在草稿阶段上传，批准后的供应商回签件、送货单只能塞进“依据”文本  
  建议：发出、确认、收货表单增加附件上传  
  证据：FE/ProcurementPage.tsx:358；FE/ProcurementPage.tsx:133-134（send/confirm 的 fileIds 固定为 []）

### P2-2 样品与开发

- `ord3` **开发·返样登记**（业务·中）面料返样除“米样”外只能填整数“份”，单位框只读；0.5 米剪样、9 个色位的色卡、码样都登记不进去  
  建议：单位改为可选（米/码/份/张/个/色位），数量按单位决定是否允许小数，前后端共用一套规则  
  证据：FE/pages/DevDetailPage.tsx:296（单位 readOnly）、:104；BE/mistDevelopmentDomain.ts:18（validFabricSample 只认 米/份整数）
- `ord4` **开发·打样任务**（业务·小）同类：建轮时样品单位只有“米、份”两项，成衣只有“件、套、份”  
  建议：与第 3 条共用扩展后的单位表  
  证据：FE/runtime/tradeOptions.ts:107-111
- `ord5` **样品仓库**（业务·小）同类：仓库登记、流转非米样一律要整数；码、公斤等单位的面料样无法如实登记  
  建议：同第 3 条规则下沉到样品仓库  
  证据：BE/mistFulfillment.ts:884、:1161；FE/pages/modules/SamplesPage.tsx:154
- `ord6` **样品仓库**（业务·中）成衣样品必须一件一档、数量固定 1 件；一套 3 件或 3 件同款样衣要建 3 次，“套”不能用  
  建议：允许按套/多件建档，并保留逐件尺码明细  
  证据：BE/mistFulfillment.ts:883
- `ord8` **开发·打样任务**（交互·小）面料样数量输入框步长 0.1，但单位选“份”时只能整数，填了小数要到提交才被后端拒绝  
  建议：步长随单位变化，前端即时校验  
  证据：FE/pages/DevRounds.tsx:152-153
- `ord7` **开发·列表**（交互·小）面料部门员工打开“开发与寻样”默认停在“成衣开发”页签，每次都要手动切换  
  建议：按员工所在业务线（或上次使用的页签持久化到账号）决定默认页签  
  证据：FE/developmentEntry.ts:14-17；FE/ReferenceApp.tsx:212
- `ord9` **面料寻样**（业务·小）寻样任务建好后需求、日期、负责人全变只读，不能修改，也没有“取消寻样”；后端无对应命令  
  建议：增加编辑与取消命令（取消须写原因）  
  证据：FE/pages/DevListPage.tsx:132-135；BE/mistWorkspace.ts:1208-1221（只有 create/answer/confirm）
- `ord10` **面料寻样**（业务·中）寻样答复只是一段文字加附件；不能逐条记录候选面料（供应商、品号、价格、MOQ、交期），也不能比较  
  建议：答复改为候选列表，每条关联供应商与面料档案  
  证据：BE/mistWorkspace.ts:1214；BE/mistWorkspace.ts:139（MistFabric 只有 answer 字段）
- `ord11` **面料寻样**（断链·中）寻样确认后无法一键“向供应商索样”“建面料档案”或“转采购”，结果停在文字里  
  建议：至少提供“候选→供应商档案/面料档案/采购草稿”的跳转  
  证据：FE/pages/DevListPage.tsx:81、:129；FE/developmentEntry.ts:5（明确不与开发案互转）
- `ord14` **开发·寄样**（业务·中）寄样记录有运单号、寄样费，但没有“客户已签收”“签收日期”“客户对样品的意见”  
  建议：寄样记录增加签收与反馈字段，可从运单回填  
  证据：FE/pages/DevSampleForms.tsx:82-83、:108；BE/mistWorkspace.ts:1097
- `ord15` **样品仓库**（业务·小）仓库里“永久寄出”把“寄送去向”和“运单号”塞在同一个文本框，无法按运单查询；开发寄样却是分开的  
  建议：拆成去向、运单号、快递公司三个字段，与开发寄样统一  
  证据：FE/pages/modules/SamplesPage.tsx:172 vs FE/pages/DevSampleForms.tsx:108
- `ord16` **样品仓库**（业务·小）样品流水只有收、借、还、寄、移位，没有报废/销毁/退还工厂；用坏的样品只能“寄出”冒充  
  建议：增加报废与退回工厂流转，写明原因  
  证据：BE/mistFulfillment.ts:85（kind 枚举）
- `ord17` **样品仓库**（业务·中）仓库寄样没有寄样费、快递费登记；只有开发版本寄样能记费，订单产前样、船样寄客户的费用无处记录  
  建议：仓库寄出也可登记费用并归到订单或客户  
  证据：FE/pages/modules/SamplesPage.tsx:167-176；BE/mistWorkspace.ts:1093（只在 development.sample.dispatch）
- `ord18` **样品费**（业务·中）样品费向客户收取只在“收费开发案”里能做；客户索样、订单产前样另收费没有入口  
  建议：增加独立“样品费”收费单，可关联客户/订单并开票  
  证据：FE/pages/DevBilling.tsx:46-51；BE/mistWorkspace.ts:1134-1146
- `ord19` **样品仓库**（业务·中）没有“客户索样申请”环节：业务员要样品时无法提单、仓库无法据单出库  
  建议：增加索样申请→仓库出库→寄出的流程  
  证据：BE/mistFulfillment.ts:418-440（只有 create/sync/edit/move）
- `ord12` **产品档案（入口在开发/订单）**（占位·大）辅料档案的“辅料开发”“辅料订单”按钮置灰，提示尚未接入  
  建议：增加辅料开发域和辅料订单类型，或先允许辅料走成衣订单附属条目  
  证据：FE/pages/modules/ProductParts.tsx:101-102
- `mar55` **档案**（占位·大）辅料档案的"再次开发""复购下单"禁用，原因"辅料开发尚未接入""辅料订单尚未接入"。  
  建议：规划辅料开发/采购入口，或隐藏按钮  
  证据：app/pages/modules/ProductParts.tsx:101-102

### P2-3 货运与报关

- `sup41` **货运**（缺环节·中）出运单没有柜型柜号、封条号、船名航次、ETD/ETA、货代、截关/截港时间  
  建议：增加运输与集装箱字段，订舱号下挂柜明细  
  证据：SH/mistFulfillment.ts:288-319（只有 booking 一个字符串）；SH/mistFulfillment.ts:1915-1923
- `sup42` **货运**（缺环节·小）订舱变更没有记录：改订舱号只写一条审计文字，没有原订舱、变更原因、改船费用的结构化记录  
  建议：订舱改为历史列表，每次变更留记录与费用  
  证据：SH/mistFulfillment.ts:1918-1922
- `sup43` **货运**（缺环节·小）没有唛头（正唛/侧唛）维护，装箱单与箱贴无法带唛头  
  建议：出运/订单增加唛头模板  
  证据：全仓库搜“唛头”只在演示数据和公司历史出现（SH/mistWorkspace.ts:750、SH/mistMarket.ts:425），出运与装箱结构无此字段
- `sup46` **货运**（缺环节·小）离港后流程结束，没有到港、清关、签收（POD）跟踪  
  建议：增加 ETA、到港、客户签收记录  
  证据：SH/mistFulfillment.ts:310（state 止于 departed）；FE/ShipmentsPage.tsx:321
- `sup47` **货运**（交互·小）只有原发起业务员能取消出运，发起人离职或休假时其他人无法处理，也没有主管代办  
  建议：允许主管或交接后的负责人取消  
  证据：SH/mistFulfillment.ts:1983-1984；FE/ShipmentsPage.tsx:307
- `sup48` **货运**（交互·小）“完成单证准备”直接执行，成功无提示  
  建议：成功提示  
  证据：FE/ShipmentsPage.tsx:213、:235
- `sup50` **报关**（缺环节·小）已放行后不能改单、删单或退关，页面让员工“去海关办理改单后补附件说明”，但已放行记录不能加附件  
  建议：增加改单/退关记录，放行后仍可补附件  
  证据：FE/CustomsPage.tsx:230、:269（cleared 时 onAttach 为空）；SH/mistFulfillment.ts:2000-2001
- `sup51` **报关**（前后端·小）表头仍有单个“HS 编码”必填，但商品项已按款号分别归类，多 HS 的出运只能填一个，两处可能不一致  
  建议：表头 HS 由商品项汇总生成，去掉手填  
  证据：SH/mistFulfillment.ts:342、:2011；SH/mistCustomsDeclaration.ts:34-38
- `sup52` **报关**（断链·小）离港要求清关已完成，但空运/快递小件常走快件通道不需要正式报关单，系统没有“无需报关”选项  
  建议：增加报关方式（一般贸易/快件/市场采购）并按方式放行  
  证据：SH/mistFulfillment.ts:1958-1959
- `mar34` **关系**（断链·中）货代、报关行等"代理"类组织在关系智库登记后，出运、报关页面无法选用（无关联字段）。  
  建议：出运/报关的承运人、报关行改为从关系智库选择  
  证据：app/pages/modules/RelationsPage.tsx:79（说明此处登记货代）

### P2-4 客户、供应商与询价

- `mar17` **CRM**（缺环节·大）没有客户列表页：只能用下拉框挑客户，不能按国家、等级、客户经理、最近下单筛选排序，也不能导出客户清单。  
  建议：做客户列表（筛选/排序/分页/导出），详情沿用现页  
  证据：app/pages/CustomerPage.tsx:79；moduleMap.ts:43（规划为 list-table）
- `mar18` **CRM**（缺环节·中）客户不能停用/归档/合并；不再合作的客户一直留在所有下拉里。后端没有客户归档命令。  
  建议：新增客户停用（不删历史），下拉默认隐藏停用客户  
  证据：app/pages/CustomerPage.tsx:92（只有编辑）；srv/shared/mistMarket.ts:262-296（只有 create/update）
- `mar19` **CRM**（缺环节·小）跟进记录写错了不能改、不能删、不能作废。  
  建议：增加作废（保留原文与原因）  
  证据：srv/shared/mistCrm.ts:23-25（只有 followUp.save）
- `mar20` **CRM**（缺环节·小）商机标记"已下单/已流失"后不能重开；客户回头再谈只能新建商机，历史断开。  
  建议：增加"重新打开"（写阶段记录）  
  证据：srv/shared/mistCrm.ts:124
- `mar21` **CRM**（缺环节·小）一个商机在界面上只能关联 1 个开发案、1 个报价、1 个订单（编辑时下拉单选），实际一个商机常有多轮报价、多张订单。  
  建议：关联改多选  
  证据：app/pages/CustomerRelations.tsx:73-75（one() 只取首个）
- `mar22` **CRM**（缺环节·中）只有单个客户里的商机表，没有全公司商机漏斗/列表（按阶段、负责人、预计成交月汇总）。  
  建议：增加商机总览页  
  证据：app/pages/CustomerRelations.tsx:63-98
- `mar23` **CRM**（断链·小）商机里点"发起报价"跳到报价列表而不是新建报价，列表也不按该客户过滤。  
  建议：跳转时直接打开报价编辑器并带入客户；列表支持 customerId 过滤  
  证据：app/pages/CustomerRelations.tsx:94；app/pages/modules/MarketPages.tsx:175-182（仅 section=product: 才直接打开编辑器）；QuotationsPage.tsx 未读取 route.customerId
- `mar24` **CRM**（断链·小）客户页"开发与寻样"带了 customerId，但开发列表不读这个参数，显示的是全公司开发案。  
  建议：开发列表支持 customerId 过滤  
  证据：app/pages/CustomerPage.tsx:111；app/pages/DevListPage.tsx（全文无 customerId）
- `mar25` **CRM**（断链·小）客户"文件"Tab 只汇总开发案和动态附件，报价、订单、邮件附件、关系档案附件都不在。  
  建议：汇总范围扩到报价/订单/邮件/关系档案  
  证据：app/pages/CustomerPage.tsx:50
- `mar27` **CRM**（交互·小）客户页联系人抽屉（姓名*/职责/邮箱/电话）、编辑客户抽屉的文本框都没有 aria-label，只靠外层 label，"姓名*"带星号。  
  建议：加 aria-label  
  证据：app/pages/CustomerPage.tsx:133、:138
- `mar28` **CRM**（前后端·小）客户页编辑联系人时不能设"主联系人"（保存时沿用旧值），关系智库里却可以设；同一联系人两处行为不同。  
  建议：客户页联系人表单加"主联系人"勾选  
  证据：app/pages/CustomerPage.tsx:57；app/pages/modules/RelationsPage.tsx:103
- `mar29` **关系**（交互·小）"归档/恢复"点了直接执行，无确认；失败时没有页面提示（Promise 未捕获）。  
  建议：走确认弹窗（ModuleEditorDialog）并显示错误  
  证据：app/pages/modules/RelationsPage.tsx:135
- `mar31` **关系**（缺环节·小）关系档案和供应商的联系人只能加和改，不能删；后端 market.contact.delete 已支持 supplier/relation，前端没入口。  
  建议：联系人编辑里加删除（带确认）  
  证据：app/pages/modules/RelationsPage.tsx:101-105、:184；app/pages/modules/SuppliersPage.tsx:142-146、:274；srv/shared/mistMarket.ts:273-279
- `mar32` **关系**（缺环节·中）只能从客户档案"关联供应商身份"，不能从供应商一侧发起；误合并后不能拆分。  
  建议：支持反向关联与撤销合并  
  证据：srv/shared/mistMarket.ts:353；app/pages/modules/RelationsPage.tsx:204
- `mar36` **供应商**（断链·中）供应商详情看不到应付/付款记录、历史询价单；"询价比价"只能新建。  
  建议：增加应付余额、付款记录、询价历史区块  
  证据：app/pages/modules/SuppliersPage.tsx:159、:232、:261-271
- `mar37` **供应商**（缺环节·小）收款账户只能登记/替换，不能停用某个账户；币种写死 6 种，与其它页面币种清单不一致。  
  建议：加"停用账户"（需核实记录）；币种用 CURRENCIES  
  证据：app/pages/modules/SuppliersPage.tsx:117-125、:247-252
- `mar38` **供应商**（缺环节·小）认证登记不能上传证书扫描件（fileIds 只是原样带回），过期核查无凭证。  
  建议：认证表单加附件上传  
  证据：app/pages/modules/SuppliersPage.tsx:110-115
- `mar39` **供应商**（缺环节·中）评级只填等级和文字依据，系统已算出准交率、来料无退货率，却不进评级表；没有评分维度。  
  建议：评级弹窗预填本期准交/品质指标，按维度打分  
  证据：app/pages/modules/SuppliersPage.tsx:127-132、:38-47
- `mar40` **供应商**（缺环节·小）列表只有类型/提醒/状态筛选，不能按国家、评级筛选，不能点列头排序。  
  建议：加评级、国家筛选与列排序  
  证据：app/pages/modules/SuppliersPage.tsx:188-198
- `mar41` **RFQ**（缺环节·中）询价必须挂订单条目，开发打样阶段（还没订单）不能询价比价。  
  建议：允许来源为开发案/版本  
  证据：app/pages/modules/SourcingRequests.tsx:49
- `mar42` **RFQ**（缺环节·中）询价单发出后不能修改需求（数量/交期/截止日），取消后不能重开，定标后不能撤销。  
  建议：增加修改（留痕）与撤销定标（采购草稿未审批时）  
  证据：app/pages/modules/SourcingRequests.tsx:102-107；srv/shared/mistSourcing.ts:99-162（无 edit/reopen/unaward）
- `mar44` **RFQ**（交互·小）新建询价的"报价截止日"默认今天，不改就当天截止，列表立刻标红"已过截止"。  
  建议：默认今天+3 个工作日  
  证据：app/pages/modules/SourcingRequests.tsx:45

### P2-5 市场、季节与档案

- `mar45` **季节**（断链·小）季节里程碑、展会日期不进日历和首页"今日安排"。  
  建议：保存时同步生成日历事件（带 target）  
  证据：app/pages/modules/SeasonsPage.tsx:88、:104；app/pages/CalendarPage.tsx:46
- `mar46` **季节**（交互·小）"生成/更新回顾"点了直接覆盖上次快照，无确认，失败也无提示。  
  建议：加确认与错误提示  
  证据：app/pages/modules/SeasonsPage.tsx:153
- `mar47` **季节**（交互·里程碑改行编辑器；趋势复用 ProductLinks）里程碑要在多行文本框里按"名称  
  建议：app/pages/modules/SeasonsPage.tsx:88-89、:98-99；app/pages/modules/MarketPages.tsx:85-95（ProductLinks 已支持 trend）  
  证据：日期"手打；趋势关联面料要手输 SKU（顿号分隔），而营销页已有勾选式产品选择器。
- `mar48` **季节**（前后端·小）展会线索标"已流失"后，界面不再出现任何操作，无法恢复跟进；后端其实允许改回。  
  建议：已流失线索显示"恢复跟进"  
  证据：app/pages/modules/SeasonsPage.tsx:243-247；srv/shared/mistMarket.ts:367
- `mar49` **季节**（缺环节·小）季节、趋势、展会都不能删除或作废，录错只能改名。  
  建议：增加作废（无引用时）  
  证据：app/pages/modules/SeasonsPage.tsx:192、:218、:235
- `mar50` **营销**（占位·大）"发送推广邮件"禁用，原因"尚未接入外部推广发送服务"。  
  建议：接智能邮箱批量发送（含退订/频率控制）或删掉按钮  
  证据：app/pages/modules/MarketingPage.tsx:73
- `mar52` **营销**（交互·小）画册"归档"在操作栏点了直接执行，且归档后不可修改、不可恢复，无确认。  
  建议：加确认；或允许恢复  
  证据：app/pages/modules/MarketPages.tsx:148（rowActions 归档）；srv/shared/mistMarket.ts:435
- `mar53` **营销**（缺环节·中）没有全部线索池：线索只能进到某个活动/展会里看，不能跨活动按逾期、负责人、国家筛。线索也没有负责人字段。  
  建议：增加线索总表与负责人  
  证据：app/pages/modules/MarketPages.tsx:116-142；app/pages/modules/SeasonsPage.tsx:132
- `mar54` **营销**（缺环节·小）活动结束没有投入产出复盘（费用 vs 已转 CRM 线索、转化商机金额）。  
  建议：详情加 ROI 区块（原币）  
  证据：app/pages/modules/MarketingPage.tsx:75-79
- `mar56` **档案**（缺环节·中）一个档案只能挂一家供应商，面料常有多家工厂可供；没有成本/报价历史。  
  建议：支持多供应商与价格历史  
  证据：app/pages/modules/MarketPages.tsx:106（supplierId 单值）
- `mar57` **档案**（缺环节·小）列表只有类别切换和搜索，不能按供应商、季节、状态（使用中/已归档）筛选，归档档案混在一起。  
  建议：加筛选  
  证据：app/pages/modules/MarketPages.tsx:109
- `mar58` **档案**（交互·小）"归档/恢复"无确认直接执行。  
  建议：加确认（低风险，可后做）  
  证据：app/pages/modules/MarketPages.tsx:109（rowActions）

### P2-6 日历、待办与开户引导

- `mar59` **日历**（缺环节·小）日程不能删除；后端只有 calendar.save，命令目录也没有删除。  
  建议：增加 calendar.delete（带确认）  
  证据：app/pages/CalendarPage.tsx:87-99；srv/shared/mistWorkspace.ts:1524-1528
- `mar60` **日历**（缺环节·中）只有周视图，没有月视图；没有参与人、提醒、重复日程；所有日程全公司共享，没有"只看我的"。  
  建议：补月视图与归属人/参与人  
  证据：app/pages/CalendarPage.tsx:76-85；moduleMap.ts:20（规划了月视图）
- `mar61` **日历**（断链·小）日程只能关联开发案和订单，不能关联客户、供应商、报价、出运、邮件。  
  建议：扩大可关联对象  
  证据：app/pages/CalendarPage.tsx:50-53
- `mar62` **日历**（断链·小）客户"下次跟进日"只生成待办，不进日历；邮件跟进却会同时进日历，两处行为不一致。  
  建议：统一：跟进待办同时写日历  
  证据：srv/shared/mistCrm.ts:100；srv/shared/mistEmail.ts:316
- `mar63` **日历**（交互·小）日程表单（日程名称*/日期*/时间*/关联业务/安排说明）都没有 aria-label。  
  建议：加 aria-label  
  证据：app/pages/CalendarPage.tsx:92-96
- `mar64` **首页**（缺环节·中）不能手工新建待办；"管理任务"只能勾完成/重开，不能改期、转派、加备注。后端没有 task.save。  
  建议：增加个人待办新建/改期/转派命令  
  证据：app/pages/HomePage.tsx:122、:133-134；srv/shared/mistWorkspace.ts:1523
- `mar65` **首页**（交互·小）右上"新建"按钮只能新建开发案，名字看不出来。  
  建议：改名"新建开发案"或做成新建菜单  
  证据：app/pages/HomePage.tsx:105
- `fin9` **首页**（缺环节·中）新开通公司的总经理首次进入“我的工作”，只看到“生成上周团队周报”，没有开户引导（填公司资料、建部门、建账号、设岗位、接邮箱、登记银行账户、导入期初）。  
  建议：新增“开户清单”卡：按公司资料完整度、部门数、账号数、岗位、邮箱、银行账户、期初应收应付逐项判断，完成项自动消失  
  证据：FE/runtime/workQueue.ts:277-280；FE/pages/HomePage.tsx 全文无引导分支；仓库内无 onboarding/开户向导代码
- `fin10` **首页**（交互·小）新公司当周没有任何业务数据也会出现“生成上周团队周报”待办，生成出来是空表。  
  建议：公司开通不足一周或上周无成员活动时不推周报待办  
  证据：FE/runtime/workQueue.ts:278

### P2-7 风险、索赔与合规

- `fin39` **风险**（缺环节·小）新登记风险只能选“来源订单”，不能对客户、供应商、信用证直接登记（预警可以来自这些对象，手工登记不行）。  
  建议：登记表单加来源类型选择（客户/供应商/LC/出运）  
  证据：FE/pages/modules/RisksPage.tsx:88,93
- `fin40` **风险**（缺环节·中）合规缺项：无客户/供应商制裁名单、出口管制筛查记录，无年度合规检查清单。  
  建议：至少支持“合规筛查记录”登记与到期复查提醒  
  证据：RisksPage.tsx 类型仅 credit/compliance/quality/delivery（:82）
- `fin41` **索赔**（交互·小）案件“提交”点击即执行，无确认；“关闭已结清案件”行操作也直接执行。  
  建议：加确认对话框  
  证据：FE/pages/modules/PlatformPages.tsx:104（platform.claim.submit）、:110（platform.claim.close 行操作）
- `fin43` **索赔**（缺环节·小）索赔登记的“来源发票”可选全部有效发票，不按所选订单过滤，容易选错。  
  建议：发票下拉按订单过滤  
  证据：FE/pages/modules/PlatformPages.tsx:110
- `fin44` **索赔**（缺环节·小）台账“售后索赔登记判定追偿”未核对；追偿扣款链路（索赔→应付扣款）已有但未走查。  
  建议：安排财务+QC 走查  
  证据：docs/manual-coverage.md:249；FE/pages/FinanceCloseout.tsx:46-76

### P2-8 AI 与 Agent

- `fin46` **AI**（占位·大）工作助手页明确写“业务写入、邮件与文档能力尚未开放”。  
  建议：按路线图开放或在菜单标“只读预览”  
  证据：FE/pages/modules/WorkAssistantPage.tsx:344,363
- `fin47` **AI**（占位·中）AI 订阅面板：“服务器尚未开放个人订阅连接”；平台 AI 服务：“当前服务器版本尚不支持 API 服务”。  
  建议：服务端补齐后移除提示；未开放时隐藏入口  
  证据：FE/pages/modules/AiSubscriptionPanel.tsx:64；FE/pages/modules/PlatformAiProviders.tsx:134
- `fin48` **AI**（缺环节·大）长值守 Agent 与无人值守账号未交付。  
  建议：按台账交付  
  证据：docs/manual-coverage.md:275
- `fin49` **AI**（缺环节·中）小竹业务问答只能引用订单、发票、风险三类记录，不能引用客户、采购、出运、开发案。  
  建议：扩展引用对象  
  证据：FE/pages/modules/PlatformPages.tsx:140,170
- `fin50` **AI**（交互·小）小竹对话只存在内存，切换页面或刷新后对话消失；草稿列表有保存。  
  建议：按会话存 sessionStorage 或服务端  
  证据：FE/runtime/assistantConversation.tsx:16
- `fin51` **AI**（缺环节·小）台账“小竹业务问答”未核对（模型可用性随部署环境）。  
  建议：生产环境走查  
  证据：docs/manual-coverage.md:269
- `fin54` **AI**（缺环节·中）员工自助创建 Agent 连接因签发问题回退，发布前不可用。  
  建议：修复后发布并复验  
  证据：docs/manual-coverage.md:274

### P2-9 人事与公司管理

- `fin66` **人事**（缺环节·小）按 2026-10-15 决定不含考勤、请假、薪资、绩效、培训；对“100% 完善”属范围外，需业务方确认是否维持。  
  建议：产品确认范围  
  证据：FE/pages/modules/HrOrganization.tsx:2
- `fin67` **人事**（断链·小）员工档案办理离职时只提示“请先完成业务交接”，不能从这里直接打开成员交接；交接在公司管理“数据访问”分区。  
  建议：在提示里加“去办理交接”按钮，交接未完成时阻止离职或二次确认  
  证据：FE/pages/modules/EmployeeFile.tsx:106；FE/pages/MemberHandover.tsx
- `fin68` **人事**（缺环节·小）台账“员工离岗移交”未核对。  
  建议：安排走查  
  证据：docs/manual-coverage.md:72
- `fin69` **人事**（缺环节·小）合同到期没有提醒（字段有“合同到期”）。  
  建议：到期前 30 天进管理员待办  
  证据：FE/pages/modules/EmployeeFile.tsx（合同到期字段）
- `fin81` **公司管理**（缺环节·小）台账“主管催办与周报归档”“跨组转交采购”“供应商评级”未核对。  
  建议：安排走查  
  证据：docs/manual-coverage.md:57,99,258

### P2-10 数据中心、报表与工具

- `fin57` **数据中心**（缺环节·中）只显示记录数、三类关联问题（订单条目/发票/核销）和最近 30 条事件，没有导入导出、备份、数据质量规则配置；页面自己写明“不代表未实现模块已通过验收”。  
  建议：增加按对象导出、更多完整性检查（采购无合同、出运无 CI、到账无归属等）  
  证据：FE/pages/modules/PlatformPages.tsx:122-123
- `fin58` **数据中心**（交互·小）三张表都缺 ariaLabel，读屏无法区分。  
  建议：补 ariaLabel  
  证据：FE/pages/modules/PlatformPages.tsx:123（DataTable 无 ariaLabel）
- `fin59` **数据中心**（断链·小）“客户”一行跳到关系智库（relations），而不是客户关系管理（crm）。  
  建议：改为 crm  
  证据：FE/pages/modules/PlatformPages.tsx:123 `view:'relations'`
- `fin64` **业务工具**（交互·小）长度换算的两个下拉框没有可访问名称（Field 包着但 Select 无 aria-label），原始长度输入同样依赖 label 包裹；属轻微。  
  建议：补 aria-label  
  证据：FE/pages/modules/PlatformPages.tsx:124
- `fin65` **业务工具**（缺环节·小）只有长度换算、装箱体积、克重换算；缺纺织常用的“支数/旦尼尔换算、汇率换算、退税后成本试算入口”。  
  建议：补纱支/旦尼尔与汇率换算  
  证据：FE/pages/modules/PlatformPages.tsx:124；FE/pages/modules/BusinessCalculators.tsx

### P3-1 平台运营

- `fin82` **平台**（交互·小）平台人员停用有确认框；公司开通、席位、方案调整成功后无明确成功提示（待实测）。  
  建议：成功后 toast 并刷新列表  
  证据：FE/pages/SaasAdminPage.tsx:43-60；FE/pages/PlatformSettingsPage.tsx:39
- `fin83` **平台**（缺环节·中）平台没有公司用量/账单、到期续费提醒、公司数据导出（退租）功能。  
  建议：至少补席位用量与服务到期提醒  
  证据：FE/pages/SaasAdminPage.tsx 全文；FE/pages/PlatformSettingsPage.tsx:33-37
