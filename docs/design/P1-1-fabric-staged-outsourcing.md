# P1-1 面料分段委外（工序链）· Mist 实现设计

> 用户 2026-11-02 定案：面料开发与大货两种模式都要支持——①**分段委外**：澄川向织厂买坯布，坯布送染厂（再到后整理厂），末道出成品；②**成品采购**：直接向面料厂买成品，多家并行打样比样（现有做法）。
> 本设计沿用旧 MES 层已拍板的 DR-047（`docs/design/04-模块设计/03-订单与生产/ProductionBoard-生产看板/面料工序级委外链.md`）三条原则，落在 Mist 共享工作区（server/src/shared），不复用旧 MES 表。

## 1. 原则（沿用 DR-047）

1. **工序链是计划与核算层，采购单是执行与应付层。** 每道工序对应一张采购单：首道“坯布”是 `material` 采购，后续“染整/后整理/涂层”是 `processing` 委外加工单。应付、对账、付款继续走采购域，工序链不生成应付。
2. **按产出量计费**（染厂惯例）：加工费 = 产出量 × 单价；未完工按投入量预估并标注“预估”。
3. **损耗**：每道工序损耗率 = (投入 − 产出) ÷ 投入；订单累计损耗 = (首道投入 − 末道产出) ÷ 首道投入。

## 2. 数据模型（Mist 状态）

```ts
// 面料条目的履约方式（与成衣 GarmentFulfillmentMode 对称）
type FabricFulfillmentMode = 'finished' | 'staged';   // 成品采购 | 分段委外

type FabricStageRole = 'greige' | 'dyeing' | 'finishing' | 'coating';
type FabricStage = {
  id: string; seq: number; role: FabricStageRole;
  supplierId: string;                 // 承接工厂（类型须匹配：greige→织造，dyeing→染整 …）
  purchaseId?: string;                // 对应采购单（greige=material，其余=processing）
  inputFromStageId?: string;          // 上道工序（greige 为空）
  inputUnit: Unit; outputUnit: Unit;  // 坯布可按公斤/米，成品按米/码
  conversion?: { factor: number; basis: string }; // 投入→产出单位换算（如 0.72 kg/m），必须有依据
  plannedInput: Decimal; plannedOutput: Decimal; plannedLossPercent: Decimal;
  actual?: { input: Decimal; output: Decimal; lossPercent: Decimal; at: string; actor: string; evidenceFileIds: string[] };
  unitPrice?: Money;                  // 加工费单价（按产出量）
};
// 挂在面料订单条目上
type MistOrderLine = … & { fabricMode?: FabricFulfillmentMode; stages?: FabricStage[] };
```

- **开发打样**：`MistRound` 增加 `mode: 'parallel' | 'staged'`。`staged` 时，勾选的工厂按工序角色排序成一条链，**只生成一个版本**（末道工厂出样），版本上带 `stages`，中间工序记录“坯样已送下道”（交接）而不是返样比样。`parallel` 保持现状。
- **向后兼容**：没有 `fabricMode` / `mode` 的旧数据一律视为 `finished` / `parallel`，行为不变。

## 3. 命令（新增或扩展）

| 命令 | 作用 |
|---|---|
| `order.fabric.stages.save` | 业务员为面料条目设置分段方式、工序、承接工厂、计划投入产出与换算（订单审批前可改，审批后走变更） |
| 扩展 `fulfillment.procurement.save` | 采购单可指定 `stageId`；`destination` 增加结构化 `deliverTo: { kind:'warehouse' } \| { kind:'supplier', supplierId, stageId }`，文本地址保留为补充 |
| 扩展 `fulfillment.procurement.receive` | `deliverTo=supplier` 时生成下道工序的“待点收”（复用 `MaterialDeliveryLink`，把目标从成衣分支泛化为任意 processing 工序） |
| `fulfillment.stage.handover` | 下道工厂点收上道来料（合格、拒收、差异），即现有 `materials.confirm` 泛化 |
| `fulfillment.stage.complete` | 登记本道实际投入、产出、损耗与凭证；末道完工后成品可入仓或直发 |
| 扩展 `fulfillment.procurement.receive`（末道） | processing 末道回交允许入我方仓库（当前 :1590 禁止） |

需要放开的限制：`mistInternalFabric.ts:288-337` 的成衣限定；`mistFulfillment.ts:1561-1566` 面料条目只允许一个工厂分支（改为：`staged` 条目允许每道工序一个分支，数量按各自工序单位）；采购单与订单条目必须同单位（`staged` 时按工序单位与换算校验）。

## 4. 成本

- **订单实际核算**（`mistOrderCost.ts`）：按工序分组显示“坯布 / 染整 / 后整理 / 其他”，并单列**损耗成本** =（实际首道投入 − 理论投入）× 坯布单价。
- **报价核算**（`mistQuotationCosting.ts` 分项路径）：成本项可选“工序顺序 + 承接工厂”，并支持**链式损耗**：由成品数量与各道损耗率反推坯布用量（坯布用量 = 成品 ÷ Π(1 − 损耗率)）。

## 5. 界面

- 开发建案第 3 步：选择“分段委外 / 成品比样”；分段时按工序选厂（织厂、染厂、后整理厂），显示链路预览。
- 订单条目：工序链卡片（每道工序：工厂、采购单、计划/实际投入产出、损耗、状态），可从这里一键生成该道工序的采购单。
- 采购单：显示“上道来料”“交给下道”；坯布单的收货可直接选“直送染厂（某工序）”。
- 下道工厂点收、本道完工登记：对话框，带凭证上传。
- 订单核算：分工序成本与损耗。

## 6. 测试要点

坯布 3,800 米（或 2,736 公斤，0.72 kg/m 换算）→ 染厂投入 3,800 米、产出 3,610 米（损耗 5%）→ 成品入仓 3,610 米；订单核算显示坯布 157,700 + 染整 3,610×13.80 + 损耗成本；旧订单（无 fabricMode）行为不变；并行比样开发不受影响；权限：只有订单负责人可设工序，染厂点收由跟单/QC 登记。
