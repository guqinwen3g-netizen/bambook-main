import { uiText, ui } from '../../../../../services/interfaceLanguage';
/** Quote-entry professional costing; internal, manual and auditable, not AI prediction. */
import React from "react";
import {isServiceSupplier} from "../../../../../server/src/shared/mistSupplierStatus";
import { ArrowLeft, Download } from "lucide-react";
import { FormFooter,
  Banner,
  Button,
  Card,
  CardHeader,
  Checkbox,
  DataTable,
  EmptyState,
  Facts,
  Field,
  FormGrid,
  FormSection,
  KeyValue,
  MistPage,
  Mono,
  PageHeader,
  Select,
  TextArea,
  TextInput,
  VerticalSteps,
} from "../../../../../components/mist";
import {
  calculateQuoteCosting,
  quotationCostingTarget,
  QUOTE_COST_KINDS,
  type QuoteCostComponent,
  type QuoteCostInput,
  type QuoteCostSnapshot,
  type QuoteCostResult,
} from "../../../../../server/src/shared/mistQuotationCosting";
import {
  freezeQuotationHistoryEvidence,
  type QuoteHistoryReference,
} from "../../../../../server/src/shared/mistQuotationHistoryEvidence";
import {
  QuotationHistoryEvidencePicker,
  FrozenHistoryEvidence,
} from "./QuotationCostEvidence";
import { QuotationCostAdvisor } from "./QuotationCostAdvisor";
import { DraftFiles } from "./fulfillmentKit";
import { useMistWorkspace } from "../../runtime/workspace";
import { useMistSession } from "../../runtime/auth";
import { useNav } from "../../nav";
import { useRouteDraft, useRouteScope } from "./useRouteDraft";
import { downloadModuleCsv } from "./ModuleWorkbench";
import { shortWhen } from "./pageKit";
import { OptionInput } from '../OptionInput';
import { CHARGE_UNITS, UNITS } from '../../runtime/tradeOptions';
const kinds: Record<QuoteCostComponent["kind"], string> = {
  yarn: "纱线 / 原料",
  weaving: "织造",
  dyeing: "染整",
  finishing: "后整理",
  fabric: "面料",
  trimming: "辅料",
  cmt: "CMT 加工",
  packaging: "包装",
  freight: "运费",
  insurance: "保险",
  bank: "银行费用",
  commission: "佣金",
  other: "其他",
};
const blankComponent = (): QuoteCostComponent => ({
  kind: "other",
  description: "",
  quantity: "1",
  unit: "",
  lossPercent: "0",
  unitPrice: "",
  basis: "",
  outsideSupplierPrice: false,
});
function AllocationSummary({
  allocation,
  unit,
  currency,
}: {
  allocation: QuoteCostResult["allocation"];
  unit: string;
  currency: string;
}) {
  if (!allocation) return null;
  return (
    <Banner title={uiText("本报价行整笔费用分摊")}>{uiText("整笔合计 ")}{allocation.total} {currency}{uiText(" ÷ 本行报价数量")}{uiText(" ")}
      {allocation.quantity} {uiText(unit)}{uiText(" ＝ 单位分摊 ")}{allocation.unitCost} {currency}/
      {uiText(unit)}</Banner>
  );
}
function componentEvidence(
  x: QuoteCostResult["components"][number],
  input: QuoteCostInput,
) {
  return (
    (x.scope === "per_line" ? "本行整笔：" : "每" + input.unit + "：") +
    x.quantity +
    " " +
    x.unit +
    " × " +
    x.unitPrice +
    " " +
    input.currency +
    (x.scope === "per_line"
      ? " = " +
        x.lineAmount +
        " " +
        input.currency +
        "；按本行 " +
        input.allocationQuantity +
        " " +
        input.unit +
        " 分摊"
      : "；损耗 " + x.lossPercent + "%") +
    "；单位计入 " +
    x.amount +
    " " +
    input.currency +
    "/" +
    input.unit +
    "；" +
    x.basis
  );
}
function Snapshot({ r }: { r: QuoteCostSnapshot }) {
  const { go } = useNav();
  return (
    <Card data-cost-snapshot={r.id}>
      <CardHeader title={uiText("核算记录")} sub={shortWhen(r.createdAt) + " · " + r.actor} />
      <div className="mist-card-body mist-col">
        <Facts
          items={[
            {
              label: "原报价条目",
              value: r.target.line.style + " · " + r.target.line.name,
            },
            {
              label: "来源路径",
              value:
                r.input.mode === "supplier" ? "供应商成品报价" : "专业逐项拆解",
            },
            { label: "本次适用规格", value: r.input.sourceSpecification },
            {
              label: "币种 / 单位",
              value: r.input.currency + " / " + r.input.unit,
            },
            {
              label: "单位参考成本",
              value: r.result.cost + " " + r.input.currency,
            },
            {
              label: "建议报价",
              value: r.result.suggestedQuotePrice + " " + r.input.currency,
            },
            {
              label: "人工拟报价",
              value: r.input.proposedPrice + " " + r.input.currency,
            },
            {
              label: "是否写入报价",
              value: r.appliedPrice
                ? "已人工选择写入"
                : "仅保存依据，不改拟报价",
            },
          ]}
        />
        <KeyValue
          items={[
            { label: "来源条件", value: r.input.sourceTerms },
            {
              label: "本次适用数量",
              value: r.target.line.qty + " " + r.target.line.unit,
            },
            {
              label: "供应商成品基价",
              value:
                r.input.mode === "supplier"
                  ? r.input.supplierPrice +
                    " " +
                    r.input.currency +
                    "/" +
                    r.input.unit
                  : "逐项拆解，不加成品基价",
            },
            {
              label: "来源日期 / 有效期",
              value:
                r.input.sourceDate +
                " / " +
                (r.input.sourceValidUntil || "未记录"),
            },
            { label: "成本依据", value: r.input.basis },
            {
              label: "定价策略",
              value:
                (r.input.method === "markup"
                  ? "成本加成率"
                  : "目标销售毛利率") +
                " " +
                r.input.targetPercent +
                "% · " +
                r.input.strategyBasis,
            },
            {
              label: "供应商",
              value: r.supplier
                ? r.supplier.code + " · " + r.supplier.name
                : "拆解路径，无成品报价基数",
            },
            {
              label: "报价条款快照",
              value: r.target.deliveryTerms + " / " + r.target.paymentTerms,
            },
            {
              label: "凭据附件",
              value:
                r.files.map((f) => f.name).join("；") ||
                "没有选取附件，依据为人工登记",
            },
          ]}
        />
        <AllocationSummary
          allocation={r.result.allocation}
          unit={uiText(r.input.unit)}
          currency={r.input.currency}
        />
        {r.historyEvidence && (
          <FrozenHistoryEvidence evidence={r.historyEvidence} />
        )}
        {r.supplier && (
          <Button onClick={() => go("suppliers", r.supplier!.id)}>{uiText("来源供应商")}</Button>
        )}
        {r.result.components.length > 0 && (
          <DataTable
            ariaLabel={uiText("冻结成本拆解")}
            rows={r.result.components.map((x, i) => ({ ...x, id: String(i) }))}
            rowKey={(x) => x.id}
            columns={[
              {
                key: "name",
                header: "项目 / 依据",
                width: "minmax(170px,1fr)",
                render: (x) => (
                  <span className="mist-col">
                    <span>
                      {kinds[x.kind]} · {x.description}
                    </span>
                    <small className="mist-note">
                      {componentEvidence(x, r.input)}
                    </small>
                  </span>
                ),
              },
              {
                key: "amount",
                header: "单位计入",
                align: "right",
                width: "130px",
                render: (x) => x.amount + " " + r.input.currency,
              },
            ]}
          />
        )}
      </div>
    </Card>
  );
}
export function QuotationCostingPage() {
  const w = useMistWorkspace(),
    session = useMistSession(),
    { route, go } = useNav(),
    scope = useRouteScope();
  const q = w.state?.market.quotations.find((x) => x.id === route.id),
    line = q?.lines.find(
      (l) => l.id === route.section?.slice("costing:".length),
    );
  const snapshots = q?.costingSnapshots || [],
    lineSnapshots = snapshots.filter((s) => s.lineId === line?.id),
    latest = lineSnapshots.at(-1);
  const initial = (): QuoteCostInput => ({
    mode: "supplier",
    allocationQuantity: line?.qty || "",
    currency: q?.currency || "",
    unit: line?.unit || "",
    sourceSpecification: line?.specification || "",
    supplierId: "",
    supplierPrice: "",
    sourceDate: "",
    sourceValidUntil: "",
    sourceTerms: "",
    basis: "",
    fileIds: [],
    components: [],
    method: "markup",
    targetPercent: "",
    strategyBasis: "",
    proposedPrice: line?.price || "",
  });
  const [input, setInput] = useRouteDraft(initial),
    [step, setStep] = useRouteDraft(0),
    [editing, setEditing] = useRouteDraft(!latest),
    [origin, setOrigin] = useRouteDraft(() =>
      q && line ? quotationCostingTarget(q, line) : "",
    ),
    [applyPrice, setApplyPrice] = useRouteDraft(false),
    [failure, setFailure] = useRouteDraft(""),
    [busy, setBusy] = useRouteDraft(false);
  const [historyReference, setHistoryReference] = useRouteDraft<
    QuoteHistoryReference | undefined
  >(undefined);
  const lock = React.useRef(false);
  const key = session.user?.id + ":" + w.workspace?.id,
    activeKey = React.useRef(key);
  activeKey.current = key;
  const can = session.hasPermission("quotations:write"),
    frozen =
      q?.status !== "Draft" ||
      q?.approval?.status === "pending" ||
      !!q?.convertedOrderId,
    disabled =
      busy ||
      w.saving ||
      w.loading ||
      !!w.pending ||
      !can ||
      frozen ||
      !!w.error;
  const patch = (field: keyof QuoteCostInput, value: any) => {
    setInput((x) => ({ ...x, [field]: value }));
    setFailure("");
  };
  const patchRow = (index: number, patch: Partial<QuoteCostComponent>) =>
    setInput((x) => ({
      ...x,
      components: x.components.map((r, i) =>
        i === index ? { ...r, ...patch } : r,
      ),
    }));
  let calculation: ReturnType<typeof calculateQuoteCosting> | null = null,
    problem = "";
  try {
    calculation = calculateQuoteCosting(input);
  } catch (e) {
    problem = e instanceof Error ? e.message : "待补齐核算输入";
  }
  const back = () => go("quotations", q?.id || route.id, { detail: "full" });
  const begin = () => {
    if (!q || !line || disabled) return;
    setInput(
      latest
        ? {
            ...JSON.parse(JSON.stringify(latest.input)),
            allocationQuantity: line.qty,
            components: latest.input.components.map((r) => ({
              ...r,
              ...(r.scope === "per_line" ? { lineOnlyConfirmed: false } : {}),
            })),
          }
        : initial(),
    );
    setOrigin(quotationCostingTarget(q, line));
    setStep(0);
    setApplyPrice(false);
    setHistoryReference(undefined);
    setFailure("");
    setEditing(true);
  };
  const save = async () => {
    if (disabled || lock.current || !q || !line || !scope.isCurrent()) return;
    if (!calculation) {
      setFailure(problem);
      return;
    }
    if (origin !== quotationCostingTarget(q, line)) {
      setFailure("报价条目或商业条件已变化，请重新载入后核算");
      return;
    }
    const startedKey = key;
    lock.current = true;
    setBusy(true);
    setFailure("");
    try {
      const r = await w.run({
        type: "market.quotation.costing.save",
        payload: {
          quotationId: q.id,
          lineId: line.id,
          expectedTarget: origin,
          input: calculation.input,
          applyPrice,
          ...(historyReference ? { historyReference } : {}),
        },
      });
      if (
        !r.result.snapshotId ||
        r.result.id !== q.id ||
        r.result.lineId !== line.id
      )
        throw Error("回执缺少准确核算快照，请核对原请求");
      if (scope.isCurrent() && activeKey.current === startedKey)
        setEditing(false);
    } catch (e) {
      if (scope.isCurrent() && activeKey.current === startedKey)
        setFailure(e instanceof Error ? e.message : "核算未保存");
    } finally {
      if (scope.isCurrent() && activeKey.current === startedKey) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  const recover = async () => {
    if (busy || w.saving || lock.current || !scope.isCurrent()) return;
    const startedKey = key;
    lock.current = true;
    setBusy(true);
    setFailure("");
    try {
      const r = await w.recover();
      if (!r) throw Error("原请求仍待核对，请稍后重试");
      if (
        !r.result.snapshotId ||
        r.result.id !== q?.id ||
        r.result.lineId !== line?.id
      )
        throw Error("原请求回执不属于当前报价条目，请返回原业务核对");
      if (scope.isCurrent() && activeKey.current === startedKey)
        setEditing(false);
    } catch (e) {
      if (scope.isCurrent() && activeKey.current === startedKey)
        setFailure(e instanceof Error ? e.message : "核对未完成");
    } finally {
      if (scope.isCurrent() && activeKey.current === startedKey) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  if (q && route.section === "cost-history")
    return (
      <MistPage>
        <Button icon={ArrowLeft} onClick={back}>{uiText("返回报价")}</Button>
        <PageHeader
          title={uiText("报价核算历史")}
          eyebrow={<Mono>{q.code}</Mono>}
        />
        <Banner title={uiText("历史只读")}>{uiText("新条目与新版本需重新核算，不能把旧单价、规格或策略自动沿用。")}</Banner>
        {snapshots.length ? (
          <div className="mist-col">
            {[...snapshots].reverse().map((r) => (
              <Snapshot key={r.id} r={r} />
            ))}
          </div>
        ) : (
          <EmptyState title={uiText("本报价尚无核算历史")} />
        )}
      </MistPage>
    );
  if (!q || !line)
    return (
      <MistPage>
        <PageHeader title={uiText("报价条目核算")} />
        {w.error && (
          <Banner
            tone="bad"
            title={uiText("读取失败")}
            actions={
              <Button
                onClick={() =>
                  void w.refresh().catch((e) => {
                    if (scope.isCurrent()) setFailure(e.message);
                  })
                }
              >{uiText("重试读取")}</Button>
            }
          >
            {w.error}
          </Banner>
        )}
        {failure && (
          <Banner tone="bad" title={uiText("重试未完成")}>
            {failure}
          </Banner>
        )}
        <EmptyState
          title={uiText(w.loading ? "正在读取准确条目" : "未找到指定报价条目")}
          description={uiText(w.error || "不猜配其他产品或报价行。")}
          action={<Button onClick={back}>{uiText("返回报价")}</Button>}
        />
      </MistPage>
    );
  const inputField = (
    field: keyof QuoteCostInput,
    label: string,
    required = true,
    hint?: string,
  ) => (
    <Field label={uiText(label)} required={required} hint={uiText(hint)}>
      <TextInput
        aria-label={uiText(label)}
        type={field === 'sourceDate' || field === 'sourceValidUntil' ? 'date' : 'text'}
        value={String(input[field])}
        disabled={disabled}
        // 服务端要求成本币种、计价单位与本报价行一致，不换算，因此只读展示。
        readOnly={field === 'currency' || field === 'unit'}
        onChange={(e) => patch(field, e.target.value)}
      />
    </Field>
  );
  return (
    <MistPage>
      <Button icon={ArrowLeft} onClick={back}>{uiText("返回报价")}</Button>
      <PageHeader description={ui`${line.name} · ${line.qty} ${line.unit} · ${q.currency}`}
        title={uiText("报价条目核算")}
        eyebrow={<Mono>{uiText(q.code + " · " + line.style)}</Mono>}
        actions={
          !editing && can && !frozen ? (
            <Button onClick={begin}>{uiText("新建核算")}</Button>
          ) : undefined
        }
      />
      {w.error && (
        <Banner
          tone="bad"
          title={uiText("读取失败")}
          actions={
            <Button
              onClick={() =>
                void w.refresh().catch((e) => {
                  if (scope.isCurrent()) setFailure(e.message);
                })
              }
            >{uiText("重试读取")}</Button>
          }
        >
          {w.error}
        </Banner>
      )}
      {failure && (
        <Banner tone="bad" title={uiText("核算未完成")}>
          {failure}
        </Banner>
      )}
      {w.pending && !w.saving && (
        <Banner
          tone="warn"
          title={uiText("上次提交结果待核对")}
          actions={
            <Button disabled={busy} onClick={() => void recover()}>{uiText("核对原请求")}</Button>
          }
        >{uiText("核对原请求，不重新保存或写入报价。")}</Banner>
      )}
      {(!can || frozen) && (
        <Banner title={uiText(can ? "本版本只读" : "没有报价写权限")}>{uiText("审批中、已发送或已转单的报价不能改核算；需要改价时从报价主线建立适用新版本。")}</Banner>
      )}
      {editing && can && !frozen ? (
        <div className="mist-wizard">
          <VerticalSteps
            current={String(step)}
            onSelect={(v) => {
              if (Number(v) <= step) setStep(Number(v));
            }}
            steps={[
              { id: "0", label: "成本来源与拆解" },
              { id: "1", label: "本次报价策略" },
              { id: "2", label: "核对并冻结" },
            ]}
          />
          <Card>
            {step === 0 ? (
              <>
                <FormSection title={uiText("成本来源")}>
                  <FormGrid>
                    <Field label={uiText("核算路径")}>
                      <Select
                        aria-label={uiText("核算路径")}
                        disabled={disabled}
                        value={input.mode}
                        onChange={(e) =>
                          setInput((x) => ({
                            ...x,
                            mode: e.target.value as QuoteCostInput["mode"],
                            supplierId: "",
                            supplierPrice: "",
                            components: [],
                          }))
                        }
                        options={[
                          {
                            value: "supplier",
                            label: "供应商报价",
                          },
                          {
                            value: "breakdown",
                            label: "分项核算",
                          },
                        ]}
                      />
                    </Field>
                    {inputField("currency", "成本币种")}
                    {inputField("unit", "成本计价单位")}
                    {inputField("sourceSpecification", "适用规格")}
                    {inputField("sourceDate", "来源日期")}
                    {inputField("sourceValidUntil", "来源有效期", false)}
                    {input.mode === "supplier" && (
                      <>
                        <Field label={uiText("来源供应商")} required>
                          <Select
                            aria-label={uiText("来源供应商")}
                            disabled={disabled}
                            value={input.supplierId}
                            onChange={(e) =>
                              patch("supplierId", e.target.value)
                            }
                            options={[
                              { value: "", label: "选择准确供应商" },
                              ...(w.state?.market.suppliers || []).filter(s=>!isServiceSupplier(s)).map((s) => ({
                                value: s.id,
                                label: s.code + " · " + s.name,
                              })),
                            ]}
                          />
                        </Field>
                        {inputField("supplierPrice", "供应商成品单价")}
                      </>
                    )}
                    <Field label={uiText("来源交付与费用包含条件")} full required>
                      <TextArea
                        aria-label={uiText("来源交付与费用包含条件")}
                        value={input.sourceTerms}
                        disabled={disabled}
                        onChange={(e) => patch("sourceTerms", e.target.value)}
                      />
                    </Field>
                    <Field label={uiText("成本来源依据")} full required>
                      <TextArea
                        aria-label={uiText("成本来源依据")}
                        disabled={disabled}
                        value={input.basis}
                        onChange={(e) => patch("basis", e.target.value)}
                      />
                    </Field>
                    <div
                      className="mist-field"
                      data-full
                      role="group"
                      aria-label={uiText("来源凭据附件")}
                    >
                      <span className="mist-field-label">{uiText("来源凭据附件")}</span>
                      <DraftFiles
                        ids={input.fileIds}
                        disabled={disabled}
                        onChange={(ids) => patch("fileIds", ids)}
                      />
                    </div>
                  </FormGrid>
                </FormSection>
                <CardHeader
                  title={
                    uiText(input.mode === "supplier"
                      ? "未包含的额外费用"
                      : "成本明细")
                  }
                  tools={
                    <Button
                      disabled={disabled || input.components.length >= 100}
                      onClick={() =>
                        patch("components", [
                          ...input.components,
                          blankComponent(),
                        ])
                      }
                    >{uiText("增加成本项")}</Button>
                  }
                />
                {input.components.some((r) => r.scope === "per_line") && (
                  <Banner title={uiText("分摊数量绑定准确报价行")}>{uiText("当前 ")}{line.qty} {uiText(line.unit)}{uiText("，仅本行，不使用整份报价数量或将同一费用再次分给其他行。报价数量变化须重新核算；税费、MOQ、可否退还及费用范围仍须人工写入依据，不自动认定。")}</Banner>
                )}
                {input.components.map((r, i) => (
                  <FormSection key={i} title={ui`第${i + 1}项成本`}>
                    <FormGrid>
                      <Field label={uiText("费用计入范围")} required>
                        <Select
                          aria-label={ui`成本${i + 1}计入范围`}
                          disabled={disabled}
                          value={r.scope || "per_unit"}
                          options={[
                            { value: "per_unit", label: "每个报价计价单位" },
                            {
                              value: "per_line",
                              label: "仅本报价行的整笔费用",
                            },
                          ]}
                          onChange={(e) =>
                            patchRow(i, {
                              scope: e.target
                                .value as QuoteCostComponent["scope"],
                              lineOnlyConfirmed: false,
                            })
                          }
                        />
                      </Field>
                      <Field label={uiText("类型")}>
                        <Select
                          aria-label={ui`成本${i + 1}类型`}
                          disabled={disabled}
                          value={r.kind}
                          options={QUOTE_COST_KINDS.filter(
                            (k) =>
                              input.mode === "breakdown" ||
                              [
                                "packaging",
                                "freight",
                                "insurance",
                                "bank",
                                "commission",
                                "other",
                              ].includes(k),
                          ).map((value) => ({ value, label: kinds[value] }))}
                          onChange={(e) =>
                            patchRow(i, {
                              kind: e.target
                                .value as QuoteCostComponent["kind"],
                            })
                          }
                        />
                      </Field>
                      {(
                        [
                          "description",
                          "quantity",
                          "unit",
                          "lossPercent",
                          "unitPrice",
                          "basis",
                        ] as const
                      ).map((field, j) => (
                        <Field
                          key={field}
                          hint={
                            uiText(r.scope === "per_line" && field === "lossPercent"
                              ? "整笔费用不再加损耗，明确填0；材料损耗使用按单位路径。"
                              : undefined)
                          }
                          label={
                            uiText([
                              "项目名称",
                              r.scope === "per_line"
                                ? "整笔计费数量"
                                : "每单位耗用量",
                              r.scope === "per_line" ? "计费单位" : "耗用单位",
                              "损耗率 %",
                              "原币单价",
                              "项目依据",
                            ][j])
                          }
                          required
                        >
                          {field === "unit" ? (
                            <OptionInput
                              ariaLabel={ui`成本${i + 1}单位`}
                              options={r.scope === "per_line" ? CHARGE_UNITS : UNITS}
                              value={r[field]}
                              disabled={disabled}
                              onChange={(value) => patchRow(i, { [field]: value })}
                            />
                          ) : (
                          <TextInput
                            aria-label={ui`成本${i + 1}${["名称", "用量", "单位", "损耗", "单价", "依据"][j]}`}
                            value={r[field]}
                            disabled={disabled}
                            onChange={(e) =>
                              patchRow(i, { [field]: e.target.value })
                            }
                          />
                          )}
                        </Field>
                      ))}
                      {r.scope === "per_line" && (
                        <Checkbox
                          label={ui`已确认第${i + 1}项整笔费用仅归属本报价行，未重复计入其他行`}
                          disabled={disabled}
                          checked={r.lineOnlyConfirmed === true}
                          onChange={(value) =>
                            patchRow(i, { lineOnlyConfirmed: value })
                          }
                        />
                      )}
                      {input.mode === "supplier" && (
                        <Checkbox
                          label={ui`已确认第${i + 1}项不包含在供应商成品价中`}
                          disabled={disabled}
                          checked={r.outsideSupplierPrice}
                          onChange={(value) =>
                            patchRow(i, { outsideSupplierPrice: value })
                          }
                        />
                      )}
                    </FormGrid>
                    <div className="mist-card-body">
                      <Button
                        disabled={disabled}
                        onClick={() =>
                          patch(
                            "components",
                            input.components.filter((_, n) => n !== i),
                          )
                        }
                      >{uiText("移除此成本项")}</Button>
                    </div>
                  </FormSection>
                ))}
              </>
            ) : step === 1 ? (
              <FormSection
                title={uiText("本次交易的人工报价策略")}
              >
                <FormGrid>
                  <Field label={uiText("利润计算方式")}>
                    <Select
                      aria-label={uiText("利润计算方式")}
                      value={input.method}
                      disabled={disabled}
                      options={[
                        {
                          value: "markup",
                          label: "成本加成率：成本 × (1＋比例)",
                        },
                        {
                          value: "margin",
                          label: "销售毛利目标：成本 ÷ (1－比例)",
                        },
                      ]}
                      onChange={(e) => patch("method", e.target.value)}
                    />
                  </Field>
                  {inputField("targetPercent", "目标百分比")}
                  {inputField("proposedPrice", "人工拟报价")}
                  <Field
                    label={uiText("本次报价策略依据")}
                    full
                    required
                  >
                    <TextArea
                      aria-label={uiText("本次报价策略依据")}
                      disabled={disabled}
                      value={input.strategyBasis}
                      onChange={(e) => patch("strategyBasis", e.target.value)}
                    />
                  </Field>
                </FormGrid>
                <QuotationCostAdvisor
                  workspaceId={w.workspace?.id || ""}
                  revision={w.workspace?.revision ?? 0}
                  sessionKey={session.sessionKey}
                  quotationId={q.id}
                  lineId={line.id}
                  expectedTarget={quotationCostingTarget(q, line)}
                  input={input}
                  historyReference={historyReference}
                  permitted={
                    session.hasPermission("ai:chat") &&
                    session.hasPermission("quotations:read")
                  }
                  disabled={disabled}
                  onAdopt={(method, targetPercent, strategyBasis) =>
                    setInput((x) => ({
                      ...x,
                      method,
                      targetPercent,
                      strategyBasis,
                    }))
                  }
                />
                <QuotationHistoryEvidencePicker
                  state={w.state!}
                  quote={q}
                  line={line}
                  value={historyReference}
                  disabled={disabled}
                  onChange={setHistoryReference}
                />
              </FormSection>
            ) : (
              <>
                <CardHeader title={uiText("核对本次核算与写入范围")} />
                <div className="mist-card-body mist-col">
                  <Facts
                    items={[
                      {
                        label: "单位参考成本",
                        value: calculation?.result.cost + " " + input.currency,
                      },
                      {
                        label: "建议报价",
                        value:
                          calculation?.result.suggestedQuotePrice +
                          " " +
                          input.currency,
                      },
                      {
                        label: "人工拟报价",
                        value: input.proposedPrice + " " + input.currency,
                      },
                      {
                        label: "预计单位价差",
                        value:
                          calculation?.result.unitDifference +
                          " " +
                          input.currency,
                      },
                      {
                        label: "拟报价毛利参考",
                        value:
                          calculation?.result.marginPercent === null
                            ? "无有效售价"
                            : calculation?.result.marginPercent + "%",
                      },
                    ]}
                  />
                  <KeyValue
                    items={[
                      {
                        label: "来源路径 / 基价",
                        value:
                          input.mode === "supplier"
                            ? "供应商成品报价 " +
                              input.supplierPrice +
                              " " +
                              input.currency
                            : "逐项专业拆解，无成品基价",
                      },
                      { label: "来源条件", value: input.sourceTerms },
                      {
                        label: "来源日期 / 有效期",
                        value:
                          input.sourceDate +
                          " / " +
                          (input.sourceValidUntil || "未记录"),
                      },
                      {
                        label: "成本项复核",
                        value:
                          calculation?.result.components
                            .map(
                              (x) =>
                                x.description +
                                "：" +
                                componentEvidence(x, input),
                            )
                            .join("；") || "没有额外成本项",
                      },
                      { label: "成本依据", value: input.basis },
                      { label: "本次策略", value: input.strategyBasis },
                      {
                        label: "适用规格 / 单位",
                        value: input.sourceSpecification + " / " + input.unit,
                      },
                    ]}
                  />
                  <AllocationSummary
                    allocation={calculation?.result.allocation}
                    unit={uiText(input.unit)}
                    currency={input.currency}
                  />
                  {historyReference && (
                    <Banner title={uiText("本次同时冻结人工历史依据")}>{uiText("来源报价 / 条目：")}{historyReference.quotationId} /{uiText(" ")}
                      {historyReference.lineId}{uiText("；采用理由：")}{historyReference.reason}{uiText("。不自动采用历史价格。")}</Banner>
                  )}
                  <Checkbox
                    label={uiText("我确认将人工拟报价写入这条报价行")}
                    checked={applyPrice}
                    disabled={disabled}
                    onChange={setApplyPrice}
                  />
                  <Banner tone="warn" title={uiText("待业务审批")} />
                </div>
              </>
            )}
            <FormFooter>
              <span className="mist-note">{uiText("第")}{uiText(step + 1)}{uiText("/3步")}</span>
              <span className="mist-spacer" />
              {step > 0 && (
                <Button disabled={disabled} onClick={() => setStep(step - 1)}>{uiText("上一步")}</Button>
              )}
              {step < 2 ? (
                <Button
                  variant="primary"
                  disabled={disabled}
                  onClick={() => {
                    if (step === 0) {
                      try {
                        calculateQuoteCosting({
                          ...input,
                          targetPercent: "0",
                          strategyBasis: "仅校验成本来源，未记录策略",
                        });
                      } catch (e) {
                        setFailure(
                          e instanceof Error ? e.message : "请补齐本步来源",
                        );
                        return;
                      }
                    }
                    if (step === 1) {
                      try {
                        freezeQuotationHistoryEvidence(
                          w.state!,
                          q,
                          line,
                          historyReference,
                        );
                      } catch (e) {
                        setFailure(
                          e instanceof Error ? e.message : "请核对历史依据",
                        );
                        return;
                      }
                    }
                    if (step === 1 && !calculation) {
                      setFailure(problem);
                      return;
                    }
                    setFailure("");
                    setStep(step + 1);
                  }}
                >{uiText("下一步")}</Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={disabled || !calculation}
                  loading={busy}
                  onClick={() => void save()}
                >{uiText("保存核算")}</Button>
              )}
            </FormFooter>
          </Card>
        </div>
      ) : lineSnapshots.length ? (
        <div className="mist-col">
          {[...lineSnapshots].reverse().map((r) => (
            <Snapshot key={r.id} r={r} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={uiText("本条目尚无专业核算快照")}
        />
      )}
      {lineSnapshots.length > 0 && (
        <Button
          icon={Download}
          onClick={() =>
            downloadModuleCsv(
              "报价条目核算.csv",
              [
                "快照",
                "模型",
                "日期",
                "成本",
                "币种",
                "单位",
                "建议报价",
                "人工拟报价",
                "写入售价",
                "成本依据",
                "策略依据",
                "人工历史依据冻结原文",
                "本行整笔费用分摊",
                "成本项冻结原文",
              ],
              lineSnapshots.map((r) => [
                r.id,
                r.modelVersion,
                r.createdAt,
                r.result.cost,
                r.input.currency,
                r.input.unit,
                r.result.suggestedQuotePrice,
                r.input.proposedPrice,
                r.appliedPrice ? "是" : "否",
                r.input.basis,
                r.input.strategyBasis,
                r.historyEvidence
                  ? JSON.stringify(r.historyEvidence)
                  : "未选历史依据",
                r.result.allocation
                  ? JSON.stringify(r.result.allocation)
                  : "没有整笔分摊",
                JSON.stringify(r.result.components),
              ]),
            )
          }
        >{uiText("导出本条目核算")}</Button>
      )}
    </MistPage>
  );
}
