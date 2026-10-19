# 开发服务器访问（所有 agent 通用）

适用范围：腾讯云开发服务器 `bambook-dev`（`124.222.56.61`，`https://bambook-dev.sylway.cloud`，库 `panda_hub_dev`）。**不适用**于 Mac mini 与 `jiangsupanda.com` 正式环境，也不涉及真实资金——这些仍须用户单独授权。

## 原则

- 2026-10-19 用户定案：开发发布由本机直接上传，GitHub 只保存源码版本，不再自动验证或部署。专用受限密钥、主机指纹、构建包和回执只存本机私有目录；不读取或转发私钥。
- 仓库运维通道保留为维护和恢复手段；日常发布不经过 Actions。
- 任何 agent 只要能向本仓库推送（GitHub 连接的 contents 写权限），就能通过下面的运维通道在开发服务器上执行命令。
- 不在仓库、日志、PR 或聊天中写入密码、私钥、令牌。通道会对输出做基础脱敏，但请不要主动打印密钥文件。

## 仓库 secrets（一次性配置，已由用户完成）

| Secret | 用途 | 服务器账号 |
| --- | --- | --- |
| `BAMBOOK_DEV_OPS_SSH_KEY` | 运维通道，通用 bash（可 `sudo`） | `bambook-ops` |
| `BAMBOOK_DEV_SSH_KEY` | 部署流程 `Bambook development delivery`（受限：只接受 check / receive / activate） | `bambook-deploy` |
| `BAMBOOK_DEV_KNOWN_HOSTS` | 固定服务器主机公钥，防中间人 | — |

公钥指纹（用于核对 / 撤销，非机密）：

- ops：`SHA256:uMB1iBUjfnch7WsiC56QncJFo1QuHcc3lItr64UFR10`（`/home/bambook-ops/.ssh/authorized_keys`）
- deploy：`SHA256:vbUfOu1LeOY4INq8vtZ1A2Ac9sEfgAiC0EgfWDXprdg`（`/home/bambook-deploy/.ssh/authorized_keys`，forced command `/usr/local/libexec/bambook-dev-receiver.py`）

## 运维通道用法

工作流：`.github/workflows/bambook-dev-ops.yml`（在 `ops-channel` 分支上生效；main 上的副本改动后要同步到 `ops-channel` 才起作用）。

1. 在 `ops-channel` 分支上更新 `ops/request.sh`，内容是要在服务器上以 `bambook-ops` 执行的 bash 脚本（需要 root 时用 `sudo`）。用 GitHub MCP `push_files` / `create_or_update_file` 提交即可，记下返回的提交 SHA。
2. 等约 30–90 秒（排队串行执行，单次最长 15 分钟）。不要固定休眠：先做别的，再按 SHA 查结果。
3. 读取 `ops-channel` 分支上的 `ops/results/<提交SHA>.md`，里面有请求 SHA、请求脚本 `request-sha256`、退出码、耗时、Actions 运行链接和脱敏后的输出。以 `results/<SHA>.md` 为准；`last-result.md` 可能已是别的请求。
   - 工作流按触发提交本身读取请求（不读分支最新），读不到或脚本为空直接失败，回执写 `exit: not run`，不会报成功。
   - GitHub 同一并发组只保留最新一个排队运行：连续快速推送时，中间的请求可能被取消、没有结果文件。没有结果且已有更新请求的结果时，重新提交。
4. 只接受仓库所有者账号推送触发；分支上不放其他代码，不要合入 main。

常用片段：

```bash
sudo systemctl status bambook-dev bambook-dev-mist --no-pager | head -30
sudo journalctl -u bambook-dev-mist -n 200 --no-pager   # Mist 工作空间 API
sudo journalctl -u bambook-dev -n 200 --no-pager        # 主 API
ls -la /srv/bambook-dev/current /srv/bambook-dev/releases
curl -fsS http://127.0.0.1:8081/api/health   # 本机端口：8080 nginx、8081/8082 node，以实际为准
sudo -u postgres psql panda_hub_dev -c 'select count(*) from ...'
sudo cat /srv/bambook-dev/shared/test-accounts.txt   # 7 个测试账号（仅开发环境）
```

服务：`bambook-dev`（主 API）、`bambook-dev-mist`（Mist 工作空间 API）；前面是 nginx。以 `systemctl list-units 'bambook*'` 与 `ss -ltnp` 为准。

## 本机直接部署（默认）

入口为 `scripts/deploy/direct-dev.py`，使用当前已提交且干净的源码，不依赖 GitHub runner、云端检查状态或 GitHub 到服务器的网络。

- `npm run dev:deploy:check`：检查直连和受限发布身份。
- `npm run dev:deploy:verify`：本机完整验证，将成功回执留在私有目录。
- `npm run dev:deploy`：匹配同一源码树及 Node 版本的本机验证回执可复用，否则先完整验证；随后重新构建同源前端、只打包已提交的运行源码和前端产物，直接上传并激活。

本机配置默认在 `$CODEX_HOME/private/bambook-dev-direct/config.json`（未设置 CODEX_HOME 时用 `~/.codex`）。包含开发主机、受限用户、私钥路径和固定主机指纹文件路径；私钥必须仅当前用户可读。此配置、密钥、验证日志、部署包和回执均不入库。程序只允许开发主机与 `bambook-deploy`，SSH 强制校验主机指纹，服务器密钥只能执行 check / receive / activate，不能开启任意 shell、转发或修改数据库。

部署包保留在同一私有目录的 releases 下。重试同一版本复用原包并核对摘要；不能用不同内容覆盖已接收的相同提交。服务器仍先准备依赖再切换版本，验证两套 API 的数据库健康，失败恢复上一版。客户端再读取公开 `mist-version.json`，确认版本和已提交状态后才报告部署成功。

每次提交仍正常推送 GitHub。`.github/workflows/mist.yml` 和 `bambook-dev-deploy.yml` 仅保留显式手动触发，供故障诊断或应急；没有 push / pull_request / workflow_run 自动发布链。正式环境不适用本命令。

## 撤销 / 轮换

在运维通道执行：删除对应 `authorized_keys` 行（或 `sudo userdel -r bambook-ops`、`sudo rm /etc/sudoers.d/90-bambook-ops`），再在 GitHub 仓库 Settings → Secrets and variables → Actions 中更新或删除对应 secret。用户的腾讯云控制台始终可以独立登录和重置，不依赖这些钥匙。
