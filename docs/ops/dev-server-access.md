# SaaS 服务器访问（历史运维标识仍为 dev）

适用范围：腾讯云开发服务器 `bambook-dev`（`124.222.56.61`，`https://bambook-dev.sylway.cloud`，库 `panda_hub_dev`）。**不适用**于 Mac mini 与 `jiangsupanda.com` 正式环境，也不涉及真实资金——这些仍须用户单独授权。

当前服务按正式 SaaS 基础设施保护，测试和真实生产租户可能共存。域名、脚本、服务名中的 dev 只是历史技术标识，不授权重置数据库、批量替换账号或覆盖真实租户文件。任何数据写入必须核对目标租户，并保留可恢复备份。详见 GO-LIVE.md 最新裁决。

## 对外入口（2026-10-26）

| 用途 | 域名 | 范围 |
| --- | --- | --- |
| 公司用户 | `bambook.sylway.cloud` | 公司登录与业务 |
| 平台管理 | `bambook-admin.sylway.cloud` | 平台登录、公司管理与服务运营 |
| 客户查单 | `bambook-customer.sylway.cloud` | 预留，尚不发布门户 |
| 供应商 | `bambook-supplier.sylway.cloud` | 预留，尚不发布门户 |

公司与平台入口分别使用独立的主机 Cookie；主机名由反向代理传给应用，不能用客户端 `X-Forwarded-Host` 改变入口。平台管理员选择公司后，可管理该公司的账号、组织人事与设置，不成为公司成员，权限不依赖公司的角色配置；停止公司服务不会取消平台管理权限。公司设置在 `/api/platform/companies/:id/settings` 投影读取并以版本/请求编号保存，修改记录实际平台人员。平台域名不承接公司业务执行 API；平台模型配置仍在返回平台后维护。邀请/找回邮件配置 `BAMBOOK_PUBLIC_URL` 与 `BAMBOOK_PLATFORM_PUBLIC_URL`；两者分别指向公司和平台地址。源码锚点：`server/src/shared/bambookPublicOrigins.ts`、`auth/publicEntryHostGuard.ts`、`auth/tokenHelpers.ts`、`platform/companySettings.ts`。旧 dev 域名保留为公司兼容入口和发布校验地址。

入口变更先备份 DNS、Nginx、cloudflared 与应用配置；先验证候选配置，再启用明确主机名的隧道路由和 DNS。保持 TLS 校验、原上传限制与代理头缓冲；不将预留门户转发到现有公司应用。配置及回执留在本机私有目录，不把隧道身份、密钥或服务器配置包提交到仓库。

2026-10-26 已启用公司/平台两条 DNS 及隧道路由，部署代码 `6fb0dbf`；两个预留门户无 DNS 记录。平台根路径使用明确的公网 HTTPS 登录地址跳转，避免反向代理内部协议/端口泄漏。两入口健康、严格 TLS 与跨入口 API 拒绝已验证，两入口已实际浏览器登录。初期公司域名连接失败后来恢复，手机流量及独立运营商也曾出现失败，不能据固定解析成功就断言仅本机代理故障；根因未确认。不关闭 TLS 校验、不更改用户网络规则来掩盖问题。

新域名验收需分别核对权威/递归DNS、证书、目标网络的TLS连接、页面和登录。网页缓存与DNS缓存分开判断：握手前失败不能由网页缓存大小解释；仅有单节点HTTP200或指定IP成功不能代表用户网络可用。诊断保留私有时间戳和节点结果，避免在缺少证据时把DNS缓存或边缘传播推断写成已确认根因。

2026-10-27 用户要求现有公司域名使用现有服务器直连：公司入口已改为直接 HTTPS，平台及旧兼容入口仍走原隧道。直连入口转发至原公司主机路由，保留平台接口隔离、上传限制和代理缓冲；HTTP 仅供证书验证及跳转 HTTPS。证书由 Certbot 定时续期，续期成功后校验并重载 Nginx。公司旧 DNS 记录和原 Nginx 配置保留在私有备份，旧隧道仍可回退；DNS 变动及不同网络缓存期间可能暂时走旧路径。公司直连不再经过 Cloudflare 的代理防护，后续改入口需核对同等安全防护及跨入口限制，不能通过改 DNS 单独重建该入口。不得把证书密钥、备份或服务器私有配置入库。

### 当前本地前端调试（2026-10-29 用户定案）

本轮界面调试以localhost:3008为准，界面变更提交/合入后仅同步本地；不为看效果自动发布公网前端。原有公网服务保持运行，云端后端仍按现有公司权限提供业务数据，不启第二套本机库。运行入口固定同源 `/api`，认证、业务和附件统一由Vite代理连接共享API。直接启动时使用 `MIST_SHARED_DEVELOPMENT=1 npx vite --config vite.mist.config.ts --host 127.0.0.1 --port 3008 --strictPort`；运行配置会固定客户端API前缀，不能仅用健康200代替实际登录验证。

托管工作树可能通过符号链接共享node_modules。开发服务器只额外允许其真实依赖目录，以加载字体等静态资源；不得把整个父仓库、私有目录或全盘加入Vite允许列表。公网入口拦截也可影响API，本地前端不等于离线后端；继续核对实际代理链路。

### 2026-10-29 公司入口临时回退

公司域名的境内公网直连出现云厂商拦截：外部 HTTP 被跳转至腾讯云“未完成备案”提示页，HTTPS 握手中止；服务器本机 HTTP 跳转、双 API、数据库与既有隧道均正常，无应用崩溃或自动重启。不能据前端“服务器不可达”直接重启后端或回滚业务代码。

为恢复原域名可用性，备份后仅将公司域名的 DNS 记录从直连 A 恢复为此前已保留、已校验的隧道 CNAME，启用原代理；平台域名、服务器、数据库、公司资料及账号权限不变。记录与回读回执仅存私有位置。现阶段公司域名临时经原 Cloudflare Tunnel，旧兼容入口继续可用；不关闭证书验证、不复制会话或改代理规则。新线路已通过固定边缘健康及原域名实际浏览器加载验证；不同客户端的旧路径缓存须分别核对，不能把权威记录更新等同所有客户端已刷新。

恢复境内直连前，须先由云厂商解除当前拦截，再从真实外网核对完整 HTTPS 与登录链路，不能只以服务器自测成功恢复直连 A。此次为可用性恢复，不构成国内直连性能验收。另恢复了已停止的本地3008预览进程，仅启现有共享 API 前端代理，未启第二套数据库或运行测试种子。

## 原则

- 2026-10-19 用户定案：开发发布由本机直接上传，GitHub 只保存源码版本，不再自动验证或部署。专用受限密钥、主机指纹、构建包和回执只存本机私有目录；不读取或转发私钥。
- 部署、维护、数据更新全部经本机 SSH/HTTPS 直连，不经过 Actions。
- GitHub 写权限不再是服务器运维通道。使用专用本机密钥，并核对租户和操作范围。
- 不在仓库、日志、PR 或聊天中写入密码、私钥、令牌。通道会对输出做基础脱敏，但请不要主动打印密钥文件。

## 本机直连运维（2026-10-19 用户授权）

2026-10-20 访问收口：本机只保留 GitHub 与腾讯云 SaaS 各一把有效 SSH 私钥，不按 Agent 或任务新增身份。服务器运维与受限部署账号共用同一把本机服务器公钥，分别保留运维与强制发布命令的限制；两个 `config.json` 的 `key` 指向同一文件，部署目录不另存私钥。仓库 `.env.local` 仅记录连接配置和密钥路径，权限 0600、由 Git 忽略；私钥本体仍置于仓库外私有目录，权限 0600、父目录 0700。GitHub 账号保存对应公钥供认证，工程、Release 和仓库 Actions 不存私钥或长期凭据。

2026-10-23 已核对并修复本机配置漂移：运维密钥原本有效，发布配置指向了另一把旧密钥。当前发布与运维配置共用已验证的固定私钥，服务器保留其他有效授权；发布账号仍受强制命令限制。连接诊断必须从对应 `config.json` 读取实际 `user` / `key`，分别验证账号，不按目录内文件名猜密钥，也不把某个账号拒绝等同于密钥整体失效。临时控制台会话关闭后，两种 SSH 连接均已重新验证。

本机专用运维身份为 `bambook-ops`，支持 SSH 命令与 SCP 文件传输。配置及私钥只存于 `$CODEX_HOME/private/bambook-saas-ops/`，其中 `config.json` 记录主机、用户名、密钥路径和固定主机指纹路径。私钥权限必须是 0600，目录 0700；不得输出或提交私钥、访问令牌、租户业务快照和附件。

连接时使用明确的密钥和固定 known_hosts，启用 BatchMode、IdentitiesOnly、StrictHostKeyChecking。上传资料先进入服务器私有暂存目录，再调用业务 API 校验公司、岗位、版本和回执；不要直接写业务表来绕过业务约束。完成后清理暂存令牌，保留必要的私有备份与回执。

GitHub 的 deployment / ops 工作流均已停用，旧服务器授权及仓库 Actions Secrets 已撤销；仓库无 Deploy key。仓库负责源码、PR、接力文档和后续 Release；不能再通过修改 ops-channel 文件执行服务器操作。历史脚本和配置记录不构成使用该通道的授权。未来低频自动部署需另行设计，本轮不恢复 Actions 凭据或配置定时触发。

## 本机直接部署（默认）

> 2026-10-20 曾因本机到服务器上传仅约 7 KB/s 暂停直传；2026-10-21 网络打通（实测约 5.5 MB/s）后恢复为默认发布方式。

入口为 `scripts/deploy/direct-dev.py`，使用当前已提交且干净的源码，不依赖 GitHub runner、云端检查状态或 GitHub 到服务器的网络。

- `npm run dev:deploy:check`：检查直连和受限发布身份。
- `npm run dev:deploy:verify`：本机完整验证，将成功回执留在私有目录。
- `npm run dev:deploy:quick`：小改动用，跳过本机完整验证，其余步骤（同源构建、直传、服务器健康检查与回滚、公开版本核对）不变。
- `npm run dev:deploy`：匹配同一源码树及 Node 版本的本机验证回执可复用，否则先完整验证；随后重新构建同源前端、只打包已提交的运行源码和前端产物，直接上传并激活。

本机配置默认在 `$CODEX_HOME/private/bambook-dev-direct/config.json`（未设置 CODEX_HOME 时用 `~/.codex`）。包含开发主机、受限用户、私钥路径和固定主机指纹文件路径；私钥必须仅当前用户可读。此配置、密钥、验证日志、部署包和回执均不入库。程序只允许开发主机与 `bambook-deploy`，SSH 强制校验主机指纹，服务器密钥只能执行 check / receive / activate，不能开启任意 shell、转发或修改数据库。

部署包保留在同一私有目录的 releases 下。重试同一版本复用原包并核对摘要；不能用不同内容覆盖已接收的相同提交。服务器仍先准备依赖再切换版本，验证两套 API 的数据库健康，失败恢复上一版。客户端再读取公开 `mist-version.json`，确认版本和已提交状态后才报告部署成功。

每次提交仍正常推送 GitHub。`.github/workflows/mist.yml` 保留手动验证入口；`bambook-dev-deploy.yml` 虽保留历史定义，GitHub 实际工作流已停用且所需私钥已撤销，不是可用的应急发布通道。发布与运维只走本机 SSH，不能依据历史 YAML 恢复远端执行。正式环境不适用本命令。

## 撤销 / 轮换

轮换本机运维身份时，只处理对应公钥，先验证新身份可用再撤销旧公钥。不得删除其他管理员密钥。GitHub 已停用的运维工作流不得作为兜底重新开启。

2026-10-20 已按用户明确授权备份并撤销旧人员、旧本机和旧 GitHub Actions 公钥；只保留当前 Mac 的服务器身份。后续清理仍须先盘点、备份、确认可用新通道并复测撤销结果，不能因出现陌生备注就删除授权。备份和指纹回执仅存私有位置；数据库、邮件、会话签名等应用运行凭据不属于本次 SSH 清理范围。

## SaaS 迁移与隔离（2026-10-19）

公司是租户边界，岗位不能跨公司累加；旧无公司令牌在账号归属公司后须重新登录。公司停用、成员退出即时撤销访问。全局认证刷新、Mist 仓储和工作助手委托均保留公司上下文，组织及个人补充权限按公司读取。公司管理员不能管理平台级连接或修改别家公司角色。未租户化的旧规范化业务接口对公司会话返回 `TENANT_ROUTE_UNAVAILABLE`，日常业务使用 Mist 接口；不能据此宣称旧接口已支持 SaaS。

迁移顺序：备份并校验 → 新增表/列及应用数据库账号授权 → 部署兼容代码 → `migrate-company-tenancy.ts --dry-run` → 执行迁移 → 对比工作区业务状态指纹及岗位登录。迁移包含系统及自定义角色、组织、成员和个人补充授权，重复执行不重复建数据。迁移后不要回退到不认识公司角色的旧代码。

员工档案与在职事件的公司归属迁移见 `server/prisma/migrations/20261026143000_company_employment_ownership/migration.sql`。先盘点并备份这两张表，归属只能依据明确的岗位所属公司或唯一历史成员关系；存在多公司歧义时整段迁移回滚，不能猜选公司。档案按公司与账号唯一、工号按公司唯一；未归属公司的历史档案保留独立约束。运行入口为 `hr/companyEmploymentService.ts`：建档与入职记录同事务保存，调岗同步当前公司角色部门及小组，停职/离职只停止本公司访问，复职/返聘重核账号、公司与席位，其他公司资料不随之改动。普通账号“重新启用”不能绕过在职状态恢复。

跨公司 HTTP 回归位于 `server/src/auth/__tests__/companyIsolation.pg.test.ts`，使用 `MIST_PG_CONFLICT_TEST_URL` 指向独立验收 PostgreSQL 库；覆盖共用账号、伪造范围、读写、附件、审批、成员撤销、平台边界和组织权限。不得指向共享开发业务库运行该测试。

平台人员必须使用独立账号，不得有客户公司的 CompanyMember 或 UserRole；客户公司负责人不得为验证方便授予 platformRole。`grant-platform-admin.ts` 拒绝客户成员/岗位账号。平台账号凭据只留私有目录，不进入仓库、PR 或日志；角色互斥与平台/公司入口均由服务端复核。

## 账号邀请与找回邮件

平台自动邀请（企业负责人、平台人员）和平台账号找回复用主 API 的 `SMTP_*` / `RESEND_*` 发信服务；不能用客户公司的智能邮箱代替平台发信身份。还须在服务器私有环境配置 `BAMBOOK_PUBLIC_URL`（站点的 HTTPS 根地址），邮件链接只从该可信配置生成，不采用请求 Host。配置与凭据不得提交仓库。

未配置或发送未确认时，已创建的账号保留，界面提示后可重发邀请；不会回显临时密码、访问链接或降级为控制台“已发送”。邀请链接有效期 48 小时，找回链接 30 分钟，均为单次使用，重发使旧链接失效。验证器两步验证已按用户要求退役；重设密码后仍撤销旧会话。平台人员可重发其人员邀请，企业成员邀请须同时通过当前公司成员边界。账号密码找回接口仅适用于独立平台身份。

更新 `/etc/bambook-dev/backend.env` 时须保留原 uid/gid 和权限（开发基线为 `root:bambook-deploy`、`0640`）。原子替换临时文件必须在 rename 前设置相同元数据；不可改成仅 root 可读，否则受限发布程序会在激活前拒绝。修改后以服务账号检查可读性，不输出文件内容；回执和配置备份仍只留私有目录。

## 平台 AI 提供方（平台设置 › 平台 AI 模型）

平台管理员在页面上维护的 OpenAI 兼容 API 服务与调用顺序，保存在服务器私有文件 `platform-api-providers.json`，与平台 ChatGPT 套餐凭据同一目录（`BAMBOOK_AI_SUBSCRIPTION_DIR`，未设置时为 `server/private/ai-subscriptions`）；目录 0700、文件 0600，含 API Key，不入库、不回传浏览器。该目录须在发布间持久保留并纳入私有备份；若未设置环境变量，请先设到发布目录之外，否则新版本激活后配置会丢失。调用顺序：页面设定的 ChatGPT 套餐与 API 服务在前，`ARK_*` / `BAMBOOK_LLM_BACKUP*` 等环境变量提供方始终在最后兜底。增删改与排序写入平台操作记录（不含 Key）。

服务器直连不到 `chatgpt.com` / `api.openai.com`。平台 ChatGPT 套餐（登录、令牌刷新、模型调用）及 OpenAI API 服务经出站代理访问：服务器本机 `sing-box.service` 提供 mixed 入站 `127.0.0.1:7890`，`backend.env` 设 `BAMBOOK_AI_HTTPS_PROXY=http://127.0.0.1:7890`。代码只对 `*.openai.com`、`*.chatgpt.com` 走代理（`server/src/ai/outboundProxy.ts`），国内模型接口仍直连；未设置该变量时行为不变。Node 内置 fetch 不读取 `HTTPS_PROXY`，不要用它代替。

## 每日备份（cron.daily）

`/etc/cron.daily/bambook-dev-backup`（root）每天写入 `/var/backups/bambook-dev`（目录 0700、文件 0600），各保留 7 天：

- `panda_hub_dev-YYYYMMDD.dump`：`pg_dump -Fc` 整库，可用 `pg_restore` 恢复。
- `bambook-files-YYYYMMDD.tar.gz`（2026-10-21 起）：`/srv/bambook-dev/shared` 下的 `mist-files`、`private-files`、`uploads` 与 `ai-subscriptions`（平台 ChatGPT 套餐凭据与 API 服务 Key）；打包时有文件正在写入不视为失败。

备份与服务同盘，尚无异地副本。修改脚本前先把原脚本复制到 `shared/private-backups`，保持 `root:root 755`。

## 产品图去背景模型

产品图透明派生使用 IS-Net general-use Q8 ONNX 权重（上游 DIS / IS-Net 为 Apache-2.0；量化权重沿用同许可），文件 44,436,071 bytes，SHA-256 为 `feed6f32a5e707ca7e939576b2d891b23fb9eb4114749657a5efc64e8651e43a`。模型只保存在本机和服务器私有模型目录，不进入公开仓库或部署包。BiRefNet 通用 Swin-Tiny 的边缘质量已验收，但在当前 4GB 共享主机上超出服务资源边界，只保留为未来独立推理主机候选，不在当前服务启用。

主 API 的 `backend.env` 只配置 `BAMBOOK_IMAGE_CUTOUT_QUEUE`、`BAMBOOK_BACKGROUND_REMOVAL_MODEL_TYPE=isnet` 与版本；模型路径和摘要放在仅 worker 读取的 `cutout.env`。systemd path unit 监听队列并按需启动 oneshot worker，`MemoryMax=768M`、`MemorySwapMax=512M`、低 CPU 权重、串行处理，完成后退出释放内存。加载失败、摘要不符、输出前景范围异常或推理失败时保留普通预览，不能阻断原图上传，也不能用颜色阈值强行生成破损边缘。推理只在服务器本地进行，原图不发送外部模型服务；透明派生生成后与附件一同保存和清理。

## 大文件上传与当前隧道配置

2026-10-19 实测：应用本机上传正常，外部入口的 QUIC 隧道在传输中途断开，Nginx 只收到部分请求体。保留私有配置备份后，将当前隧道的 `protocol` 固定为 `http2`；原 2.5MB 请求在服务器公网入口和本机分别复测为 201，返回同一回执而未新增副本。TLS、认证和私有附件权限保持。相关官方参数见 [Cloudflare Tunnel run parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)。

大批量资料可由本机 SCP 直传到服务器 0700 暂存目录，再用指定租户会话调用本机业务 API，保留版本号和幂等请求 ID。不得绕过接口直接改写业务 JSON。校验文件哈希、引用和原数据后，保留无凭据的私有回执备份，移除暂存令牌。

## 静态模块与 PDF 预览

`/assets/` 必须给 `.mjs` 返回 JavaScript MIME。系统默认 `mime.types` 可能只有 `.js`，此时 PDF.js module worker 会因 `application/octet-stream` 被浏览器拒绝。资产 location 先 `include /etc/nginx/mime.types;` 保留 CSS/字体等类型，再加 `types { application/javascript mjs; }`；基线在 `scripts/deploy/bootstrap-dev-server.sh`。变更前保存私有备份，`nginx -t` 通过才 reload，并同时核对 worker 和 CSS 的公开 Content-Type。

`components/mist/filePreview.tsx` 的 worker 地址附加模块版本查询参数，避免已缓存的错误 MIME 响应；模块加载失败不应被误报为 PDF 原件损坏。
