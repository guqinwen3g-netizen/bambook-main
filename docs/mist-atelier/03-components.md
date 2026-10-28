# 03 · 组件

- **完整 API（每个导出的 Props）**：[`api/components.md`](./api/components.md)（自动生成）
- **活的示例**：参考应用 `?view=design-system` → 「组件」Tab；每个页面模板的源码 `dev-ui-preview/mist-atelier/app/pages/*.tsx`
- 引入方式（一律从 barrel 引入，不要深路径）：

```tsx
import { Button, Card, CardHeader, DataTable, Pill, useToast, type Column } from '../components/mist'; // 相对路径按文件位置调整
```

## 通用约定
- `tone`：只有 `'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'ai'`（见 01 原则 §4/§5）。
- 图标：`lucide-react` 组件直接作为 `icon` prop 传入（`icon={Plus}`），不要自己包 `<Plus size=…/>`；独立图标用 `<Icon icon={X} size="sm" />`。
- 变体用 props，不要加 className 改样式。确实需要排版微调只用 `className="mist-row" / "mist-grid" + "mist-col-n" / "mist-spacer" / "mist-muted" / "mist-section"` 这些工具类。
- 所有浮层（Dialog / Drawer / Dropdown / CommandPalette / Toast）自动 portal 到最近的 `MistRoot`，深色自动生效。
- `Checkbox` / `Switch` 的原生输入定位在各自标签内，并与可见控件命中区一致；不能让隐藏输入脱离内部滚动容器，导致键盘焦点或点击把整页滚出画面。
- Dialog/Drawer/CommandPalette 打开后管理焦点、Tab 循环，最上层处理 Esc，关闭后回到触发器。Dropdown 使用方向键/Home/End 导航，Esc 返回触发器，Tab 接续真实下一控件；在模态浮层内的 portal 菜单保留所属关系，不误关宿主。

## 选型速查：旧写法 → Mist 组件

| 场景 | 旧代码里常见的样子 | 用这个 |
|---|---|---|
| 页面标题区 | `<PageHeader>`（ui/）/ 自写 h1 + 按钮 | `PageHeader eyebrow title description actions` |
| 页面容器 | `div.p-6.max-w-…` | `MistPage`（表单/设置 `width="narrow"`，看板 `width="wide"`） |
| 主操作 | `bds-btn primary`、`bg-blue-600` | `Button variant="primary"`（一屏一个） |
| 次操作 / 文字操作 | `bds-btn ghost`、`text-blue-500 hover:underline` | `Button`（默认）/ `Button variant="quiet"` / `TextLink` |
| 图标按钮 | `<button><X/></button>` | `IconButton icon={X} label="关闭"`（label 必填，用于无障碍） |
| 白色卡片 | `bg-white rounded-xl shadow border` | `Card` + `CardHeader title sub tools` + `CardBody` / `CardFooter` |
| 状态标签 | 彩色 `span` | `Pill tone="ok"` |
| 可点筛选标签 | 自写 chip | `Chip` |
| 统计卡 | 自写数字卡 | `StatGrid` + `StatCard icon label value unit delta foot spark onClick` |
| 阶段计数筛选 | 自写 tab + 数字 | `Pipeline value onChange items` |
| 数据表 | `<table>`、`divide-y` | `DataTable columns rows rowKey selectedKey onRowClick onRowDoubleClick loading empty footer` |
| 搜索 + 筛选 | 自写 input + select | `Toolbar` 包 `SearchField` + `Dropdown`，右侧 `Segmented` 视图切换 |
| Tab | 自写 tab | `Tabs`（页面级）/ `Segmented`（区块内 2–4 选项） |
| 键值信息 | `grid` + label | `KeyValue`（竖排列表）/ `Facts`（2 列小网格） |
| 图片 / 款式缩略 | `img.rounded` | `Thumb`（列表）/ `ObjectStage`（大图预览）/ `ObjectCell`（表格首列：图 + 名称 + 编号） |
| 编号 | `font-mono text-xs` | `Mono` |
| 进度 | 自写 bar | `Meter`（数值）/ `StageProgress`（第 n/5 阶段） |
| 连续调节 | 浏览器默认 range | `Slider value min max step onChange`，填充轨道与短刻度标记，保留原生键盘/触摸操作 |
| QC 偏差 | 细轨道 + 圆球 | `MeasurementTable`，复用滑杆轨道高度与短刻度，填充从标准中心向实测位置延伸；公差区间与偏差方向独立保留，仅展示事实。面料通用测量使用 `unit=""`，原单位保留在项目名；与独立 `fabricMeasurements` 同时回读 |
| 阶段流转 | 自写 steps | `Stepper`（横向，详情页顶部）/ `FlowSteps`（单据履约）/ `VerticalSteps`（向导侧栏） |
| 动态 / 日志 | 自写列表 | `Timeline events` |
| 待办 | 自写列表 | `TaskList`（首页）/ `Checklist`（出运准备等） |
| 关联单据 | 自写链接列表 | `RelatedList` |
| 版本切换 | 自写按钮组 | `VersionPicker` |
| 单据汇总 | 自写数字条 | `SummaryBar` / `SummaryNumbers` |
| 看板 | 自写列 | `Kanban columns itemKey renderCard onMove onOpen` |
| 表单 | `label + input` 各写各的 | `FormGrid` + `Field label required hint error full` + `TextInput / TextArea / Select / Checkbox / Switch / ChoiceCards / UploadZone`，长表单分 `FormSection` |
| 设置项 | 自写行 | `SettingRow title description control` |
| 提示条 | `bds-alert`、黄色 div | `Banner tone icon title actions` |
| AI 建议 | 紫色 div | `Banner tone="ai" icon={Sparkles}` + `Button variant="ai"`，或 `AIBrief` |
| 空状态 | 自写 | `EmptyState icon title description action` |
| 加载 | spinner | `DataTable loading` / `Skeleton` |
| 确认删除 | `window.confirm` | `Dialog` + `Button variant="danger"` |
| 侧边详情 / 编辑 | 自写抽屉 | `Drawer` |
| 成功提示 | `alert`、`bdsToast` | `const toast = useToast(); toast('已保存')`、`toast('失败', 'bad')` |
| 下拉菜单 | 自写 popover | `Dropdown` |
| 头像 | dicebear img | `Avatar name` / `AvatarStack` |
| 分页 | 自写 | `Pagination page pages onChange` |
| 快捷键提示 | — | `Kbd` |

## 常见组合（直接复制）

### 卡片 + 表格
```tsx
<Card>
  <CardHeader title="条目" tools={<TextLink onClick={…}>全部订单</TextLink>} />
  <DataTable ariaLabel="条目" columns={columns} rows={rows} rowKey={r => r.id}
    onRowClick={r => open(r)} loading={loading}
    empty={<EmptyState icon={SearchX} title="没有符合条件的记录" description="试试清除筛选" />}
    footer={<span>{rows.length} 条</span>} />
</Card>
```

### 列定义
```tsx
const columns: Column<Order>[] = [
  { key: 'obj', header: '订单', width: 'minmax(220px,2fr)', sortValue: o => o.id,
    render: o => <ObjectCell thumb={<Thumb src={o.img} />} name={<Mono>{o.id}</Mono>} meta={`${o.customer} · ${o.season}`} /> },
  { key: 'amt', header: '金额', width: '110px', align: 'right', sortValue: o => o.amount,
    render: o => <><b className="mist-cell-strong">{fmt(o.amount)}</b><span className="mist-cell-sub">{o.currency}</span></> },
  { key: 'state', header: '状态', width: '110px', render: o => <Pill tone={o.tone}>{o.state}</Pill> },
];
```

### 危险操作确认
全页表单使用 `FormFooter`，操作栏独立于主内容滚动区；页面内的详情卡自然展开，共用主页面滚动，不另设纵向滚动条。`Dialog` 与 `Drawer` 的正文可以滚动，标题和操作栏独立占位。

```tsx
<Dialog open={open} onClose={() => setOpen(false)} tone="bad" icon={Trash2} title="删除这个开发案？" description="删除后无法恢复。"
  footer={<><Button onClick={() => setOpen(false)}>取消</Button><Button variant="danger" onClick={doDelete}>删除</Button></>} />
```

### 加载失败
```tsx
<Banner tone="bad" icon={AlertTriangle} title="数据加载失败" actions={<Button size="sm" icon={RefreshCw} onClick={retry}>重试</Button>}>
  {error.message}
</Banner>
```

## 业务状态 → tone 对照（全站统一）

| 业务状态 | tone |
|---|---|
| 已完成 / 已通过 / 已核销 / 已出运 / 已签收 / 已留档 | `ok` |
| 待确认 / 待评审 / 待复验 / 临近交期 / 部分完成 | `warn` |
| 逾期 / 不通过 / 未认领 / 风险高 / 失败 / 缺资料 | `bad` |
| 进行中 / 生产中 / 当前阶段 | `accent` |
| AI 建议 / AI 匹配 | `ai` |
| 草稿 / 未开始 / 已取消 / 其它 | `neutral` |

把各模块已有的状态枚举映射成上表，写成一个 `xxxTone(status): Tone` 函数放在模块目录里，不要散落在 JSX 里。


### 个人头像（2026-10-28）

`Avatar` 的 `identityKey` 使用账号 ID，缺少 ID 时才按姓名回退；`AvatarDirectory` 只提供当前公司/会话已有的成员资料，重名不做姓名匹配。默认首字使用稳定配色，`+N` 保留中性色。已有照片和旧 DiceBear 身份继续渲染，编辑草稿通过显式 `src` 覆盖目录。

`AvatarStack` 只有一名超出显示上限时直接展示该成员；两名及以上才使用 `+N`。小组重叠头像使用独立的主题框色，浅色为白、深色为深底，不继承菜单的透明度；展开侧栏、收起侧栏与选择菜单共用。

账号头像工作台为姓名、图案、照片三种模式：姓名色板的十种色相均匀分布，图案保留原来的方向探索与动态能力；照片在同一页裁剪后显式保存。用户取消了人物编辑入口，先前已保存的人物身份仍能渲染，不能默默改写或抹除。图案的新v7色阶略深，v5/v6旧身份继续按原配色和图形生成；不得改变旧头像的视觉结果。姓名配色及图案身份沿 `avatarUrl` 保存，自动姓名配色按账号 ID 稳定生成。

姓名与图案探索共用十色底色，切换模式保留草稿颜色与探索位置；v8 图案将所选底色写入图像，旧身份继续按原样显示。图案来源与许可记录在 `public/avatars/dicebear/LICENSE.txt` 和图像元数据中，编辑界面不显示署名信息。

共享色板包含十种彩色及柔白、炭灰两种中性色；中性色使用独立的可读文字与图案配色，旧账号的自动颜色映射仍沿用原十色。姓名选择中的自动项单独一行，其余十二色等格排列。

v11 图案以选定的背景为基准，根据不同图案的主体、线条和层次分配协调配色：简单图案保留简洁，多层图案各层固定角色；已保存的旧版本保持原貌。

v12 明确五官与肤色的语义：眼睛与高光使用中性色，肖像的肤色和发色来自自然色板并独立于背景；整体换色不得再次覆盖这些部位。抽象图案继续沿用各自的配色结构。

v13 为眼眸、拟人这类单主体角色使用与背景不同色相的成对配色；保持中性五官，不将此规则应用到自然肤色或其他图案。

v14 装饰配色采用清爽的蓝、青、紫、粉，去除棕黄、灰褐主体；白底/深底角色也使用对应的清爽配色。人物自然肤色、发色及既有头像版本仍独立保留。

### 设备提示音（2026-10-28）

“我的账号 → 外观与语言”提供通知、操作反馈的独立开关和音量。用户选定轻铃作为通知及操作反馈声音，试听控件已撤除；经确认的公司命令使用完成音，明确失败使用较低的提示音，切页、普通点击和通知已读保持安静。设置只存在当前浏览器，不写公司资料。浏览器需先有用户交互才能播放。

通知声只针对当前账号可见的新未读通知，历史快照、切换公司、偏好变化不重播；同源多标签尽力去重，自己提交的命令不重复触发通知音。后台在可播放时最多每分钟检查一次，仍受浏览器后台调度限制；声音不替代可见通知，也不改变权限或数据。

### 公司开通与管理职责（2026-10-28）

平台开通表单将公司管理员与业务岗位分开。管理员负责本公司的账号、组织和系统设置，业务岗位可稍后配置，不自动授予总经理、财务或QC权力；显式选择总经理才配置该业务岗位。开通方式可选邮件邀请或设置初始密码，后者仅新账号可用，遵守同一密码规则，不改已有账号密码。邮箱只是登录标识与可选邀请地址，不决定权限或测试模式。

公司账号页按服务端 capability 提供首任总经理选项，仅用于新建独立账号并经 Mist `Dialog` 确认；不在编辑或注册审批中开放初始化例外。切换身份清除未提交的账号表单与确认状态。公司账号自动归入当前公司，不显示旧空间授权控件；无公司上下文的本机旧空间继续保留原授权方式。

首任经理确认时暂时收起编辑抽屉，只保留一个前景窗口，显示登录邮箱与任职部门；取消回原表单且保留已填内容，服务端拒绝回表单显示错误。

### 公司成员姓名

负责人/经手人共用 `runtime/members.ts`。库创建人同样从当前公司名册取姓名，名册优先于登录、业务组和历史单据快照；公司名册已无此人时，前端不得再按历史 ownerId 补回。本机旧空间继续兼容所有者显示。显示名修正不更换账号ID或单据负责人。

### 小组业务范围入口

人事小组详情对已有范围管理权限的公司账号显示真实条件摘要及手选/排除数量，使用当前获准的 `teamScopes` 与共享档案名称，不显示原始业务ID。配置入口为 `company-settings?id=<teamId>&section=teams`，`TeamScopesSection` 通过 `initialTeamId` 打开指定小组；之后允许手动切组，返回时通过 `hr?id=<selectedTeamId>&section=teams` 回到实际选中的小组详情。业务数据版本变化重新请求服务端匹配预览，保留尚未提交的条件和说明。

### 业务日期默认值

`runtime/businessClock.ts` 的 `businessNow()` 保留实际或所选公司固定时钟的瞬时值，`businessDate()` / `businessToday()` 使用与服务端相同的上海业务日投影；共用 `today` / `todayIso` 不截断UTC日期。日期字段的默认值和逾期判断与业务日一致；带时间字段继续保留原时刻，不改写已存事实或内部固定场景配置。
