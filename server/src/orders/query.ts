import {orderQuantityDto} from '../shared/orderQuantityWriteGuard';
import { PrismaClient, Prisma } from '@prisma/client';
import { andOrderScope, loadOrderQueryReadAccess, assertOrderReadAccessUnchanged, type OrderQueryReadContext } from './orderQueryReadAccess';
import { businessError } from '../shared/errorCodes';

export type StructuredOrderQueryInput = Record<string, unknown>;

export async function queryOrders(prisma: PrismaClient, input: StructuredOrderQueryInput = {}, context: OrderQueryReadContext = {}) {
  const access = await loadOrderQueryReadAccess(prisma, context);
  const normalized = normalizeOrderQuery(input);
  const where = andOrderScope(buildOrderQueryWhere(normalized), access.orderWhere);
  const orderBy = orderQueryOrderBy(normalized.sort);

  if (normalized.aggregate === 'count') {
    let count = await prisma.order.count({ where });
    if (access.actor) {
      const current = await loadOrderQueryReadAccess(prisma,context);
      assertOrderReadAccessUnchanged(access,current);
      count = await prisma.order.count({where:andOrderScope(buildOrderQueryWhere(normalized),current.orderWhere)});
      assertOrderReadAccessUnchanged(current,await loadOrderQueryReadAccess(prisma,context));
    }
    return {
      dataSource: 'bambook-data-center',
      entity: 'Order',
      aggregate: 'count',
      count,
      filters: normalized.filters,
      sort: normalized.sort,
    };
  }

  const [orders, initialTotal] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
      orderBy,
      take: normalized.limit,
      skip: normalized.offset,
    }),
    prisma.order.count({ where }),
  ]);

  let total = initialTotal;
  if (access.actor) {
    const current = await loadOrderQueryReadAccess(prisma,context);
    assertOrderReadAccessUnchanged(access,current);
    const visible = orders.length ? await prisma.order.findMany({
      where:andOrderScope({deletedAt:null,id:{in:orders.map(order=>order.id)}},current.orderWhere),select:{id:true},
    }) : [];
    if (visible.length !== orders.length) throw businessError('FORBIDDEN','读取期间订单归属发生变化，请重新查询。');
    total = await prisma.order.count({where:andOrderScope(buildOrderQueryWhere(normalized),current.orderWhere)});
    assertOrderReadAccessUnchanged(current,await loadOrderQueryReadAccess(prisma,context));
  }

  return {
    dataSource: 'bambook-data-center',
    entity: 'Order',
    aggregate: normalized.aggregate,
    query: normalized.query,
    filters: normalized.filters,
    sort: normalized.sort,
    total,
    count: orders.length,
    limit: normalized.limit,
    offset: normalized.offset,
    hasMore: normalized.offset + orders.length < total,
    items: orders.map(order => formatOrder(order)),
  };
}

export async function getOrder(prisma: PrismaClient, input: StructuredOrderQueryInput = {}) {
  const id = cleanText(input.id);
  const poNumber = cleanText(input.poNumber || input.po);
  const where = id
    ? { deletedAt: null, OR: [{ id }, { poNumber: id }] }
    : poNumber
      ? { poNumber, deletedAt: null }
      : null;
  if (!where) return { dataSource: 'bambook-data-center', found: false, reason: 'MISSING_ORDER_IDENTIFIER', input };
  const order = await prisma.order.findFirst({
    where: where as any,
    include: { lines: { orderBy: { lineNumber: 'asc' } } },
  });
  return order
    ? { dataSource: 'bambook-data-center', found: true, item: formatOrder(order, true) }
    : { dataSource: 'bambook-data-center', found: false, input };
}

export function describeOrderSchema() {
  return {
    entity: 'Order',
    sourceOfTruth: 'Bambook backend database',
    purpose: '让 Agent 像订单页面一样按订单号、客户、供应商、交期、状态、发票、样品和生产字段做只读查询。',
    tools: {
      query: { id: 'orders.query', useWhen: '需要 count/list/detail 模式、筛选、排序和分页读取订单。' },
      get: { id: 'orders.get', useWhen: '已有订单 id 或 PO，需要读取单条订单与订单行。' },
    },
    fields: [
      'id', 'poNumber', 'customer', 'customerCode', 'status', 'product', 'type',
      'dueDate', 'clientDate', 'productionDate', 'shipmentDate', 'invoiceNumber',
      'deliveryTerms', 'deliveryPlace', 'contractDeliveryDate', 'expectedArrivalDate', 'agreedArrivalDate',
      'supplierInvoiceNumber', 'millName', 'billToName', 'consigneeName',
      'paymentTerms', 'salesCurrency', 'purchaseCurrency', 'sampleSentDate',
      'fabricSampleSentDate', 'productionBatch', 'fabricCode', 'fabricContent',
      'lines.materialCode', 'lines.millQuality', 'lines.description', 'lines.deliveryDate',
    ],
    aggregateModes: ['count', 'list', 'detail'],
    writableNow: false,
  };
}

function normalizeOrderQuery(input: StructuredOrderQueryInput) {
  const filters = input && typeof input.filters === 'object' && input.filters ? input.filters as Record<string, unknown> : {};
  const sort = input && typeof input.sort === 'object' && input.sort ? input.sort as Record<string, unknown> : {};
  return {
    aggregate: cleanText(input.aggregate) === 'count' ? 'count' : cleanText(input.aggregate) === 'detail' ? 'detail' : 'list',
    query: cleanText(input.query),
    filters: {
      statuses: arrayOfText(filters.statuses || filters.status),
      customer: cleanText(filters.customer),
      supplier: cleanText(filters.supplier || filters.millName),
      poNumber: cleanText(filters.poNumber || filters.po),
      dueDateFrom: cleanDate(filters.dueDateFrom),
      dueDateTo: cleanDate(filters.dueDateTo),
      createdAtFrom: cleanDate(filters.createdAtFrom || filters.createdFrom),
      createdAtTo: cleanDate(filters.createdAtTo || filters.createdTo),
      missingFields: arrayOfText(filters.missingFields),
      fieldFilters: normalizeFieldFilters(filters.fieldFilters),
    },
    sort: {
      field: cleanText(sort.field) || 'updatedAt',
      direction: cleanText(sort.direction).toLowerCase() === 'asc' ? 'asc' : 'desc',
    },
    limit: numberInput(input.limit, cleanText(input.aggregate) === 'detail' ? 1 : 20, 1, 200),
    offset: numberInput(input.offset, 0, 0, 1_000_000),
  };
}

function buildOrderQueryWhere(input: ReturnType<typeof normalizeOrderQuery>) {
  const and: any[] = [{ deletedAt: null }];
  const textContains = (value: string) => ({ contains: value, mode: 'insensitive' as const });

  if (input.query) {
    and.push({
      OR: [
        { id: input.query },
        { poNumber: textContains(input.query) },
        { customer: textContains(input.query) },
        { customerCode: textContains(input.query) },
        { product: textContains(input.query) },
        { millName: textContains(input.query) },
        { billToName: textContains(input.query) },
        { consigneeName: textContains(input.query) },
        { invoiceNumber: textContains(input.query) },
        { supplierInvoiceNumber: textContains(input.query) },
        { fabricCode: textContains(input.query) },
        { fabricContent: textContains(input.query) },
        { lines: { some: { materialCode: textContains(input.query) } } },
        { lines: { some: { millQuality: textContains(input.query) } } },
        { lines: { some: { description: textContains(input.query) } } },
      ],
    });
  }
  if (input.filters.poNumber) and.push({ poNumber: textContains(input.filters.poNumber) });
  if (input.filters.customer) {
    and.push({
      OR: [
        { customer: textContains(input.filters.customer) },
        { billToName: textContains(input.filters.customer) },
        { customerCode: textContains(input.filters.customer) },
      ],
    });
  }
  if (input.filters.supplier) {
    and.push({
      OR: [
        { millName: textContains(input.filters.supplier) },
        { millRelationId: textContains(input.filters.supplier) },
        { lines: { some: { millQuality: textContains(input.filters.supplier) } } },
      ],
    });
  }
  if (input.filters.statuses.length) {
    and.push({ OR: input.filters.statuses.map(status => ({ status: textContains(status) })) });
  }
  if (input.filters.dueDateFrom) and.push({ dueDate: { gte: input.filters.dueDateFrom } });
  if (input.filters.dueDateTo) and.push({ dueDate: { lte: input.filters.dueDateTo } });
  if (input.filters.createdAtFrom) {
    const ts = Date.parse(input.filters.createdAtFrom);
    if (Number.isFinite(ts)) and.push({ createdAt: { gte: BigInt(ts) } });
  }
  if (input.filters.createdAtTo) {
    const ts = Date.parse(input.filters.createdAtTo);
    if (Number.isFinite(ts)) and.push({ createdAt: { lte: BigInt(ts) } });
  }
  for (const field of input.filters.missingFields) {
    const mapped = ORDER_QUERY_FIELDS[field] || field;
    if (ORDER_QUERY_FIELDS[field] || SAFE_ORDER_FIELDS.has(mapped)) {
      and.push({ OR: [{ [mapped]: null }, { [mapped]: '' }] });
    }
  }
  for (const filter of input.filters.fieldFilters) {
    const where = orderFieldFilterWhere(filter);
    if (where) and.push(where);
  }
  return and.length === 1 ? and[0] : { AND: and };
}

function orderFieldFilterWhere(filter: { path: string; operator: string; value: unknown }) {
  const mapped = ORDER_QUERY_FIELDS[filter.path] || filter.path;
  if (!SAFE_ORDER_FIELDS.has(mapped)) return null;
  const value = cleanText(filter.value);
  if (!value) return null;
  if (filter.operator === 'equals') return { [mapped]: { equals: value, mode: 'insensitive' as const } };
  if (filter.operator === 'missing') return { OR: [{ [mapped]: null }, { [mapped]: '' }] };
  return { [mapped]: { contains: value, mode: 'insensitive' as const } };
}

function orderQueryOrderBy(sort: { field: string; direction: string }) {
  const direction = sort.direction === 'asc' ? 'asc' : 'desc';
  const field = ORDER_SORT_FIELDS.has(sort.field) ? sort.field : 'updatedAt';
  return { [field]: direction };
}

function formatOrder(order: any, full = false) {
  const base = serializeBigInts({
    id: order.id,
    poNumber: order.poNumber,
    customer: order.customer,
    customerCode: order.customerCode,
    product: order.product,
    type: order.type,
    quantity: orderQuantityDto(order).quantity,
    unit: orderQuantityDto(order).unit,
    quantitySummary: orderQuantityDto(order).quantitySummary,
    status: order.status,
    dueDate: order.dueDate,
    clientDate: order.clientDate,
    productionDate: order.productionDate,
    deliveryTerms: order.deliveryTerms,
    deliveryPlace: order.deliveryPlace,
    contractDeliveryDate: order.contractDeliveryDate,
    expectedArrivalDate: order.expectedArrivalDate,
    agreedArrivalDate: order.agreedArrivalDate,
    shipmentDate: order.shipmentDate,
    invoiceNumber: order.invoiceNumber,
    supplierInvoiceNumber: order.supplierInvoiceNumber,
    millName: order.millName,
    billToName: order.billToName,
    consigneeName: order.consigneeName,
    paymentTerms: order.paymentTerms,
    salesCurrency: order.salesCurrency,
    purchaseCurrency: order.purchaseCurrency,
    updatedAt: order.updatedAt,
    importedAt: order.importedAt,
  });
  if (!full) {
    return {
      ...base,
      lines: Array.isArray(order.lines) ? order.lines.slice(0, 5).map(formatOrderLine) : [],
    };
  }
  return serializeBigInts({ ...order, lines: Array.isArray(order.lines) ? order.lines.map(formatOrderLine) : [] });
}

function formatOrderLine(line: any) {
  return serializeBigInts({
    id: line.id,
    lineNumber: line.lineNumber,
    itemNo: line.itemNo,
    materialCode: line.materialCode,
    millQuality: line.millQuality,
    description: line.description,
    cloth: line.cloth,
    width: line.width,
    weight: line.weight,
    category: line.category,
    deliveryDate: line.deliveryDate,
    exMillDate: line.exMillDate,
    quantity: line.quantity.toString(),
    unit: line.unit,
    unitPrice: line.unitPrice,
    netValue: line.netValue,
    status: line.status,
    productionBatch: line.productionBatch,
    shippingDate: line.shippingDate,
    shippingMethod: line.shippingMethod,
    invoiceNumber: line.invoiceNumber,
    invoiceDate: line.invoiceDate,
    shipmentQuantity: line.shipmentQuantity,
    shipmentAmount: line.shipmentAmount,
    actualPaymentDate: line.actualPaymentDate,
    actualPaymentAmount: line.actualPaymentAmount,
    specialInstructions: line.specialInstructions,
    notes: line.notes,
    via: line.via,
    styleNo: line.styleNo,
    colorName: line.colorName,
    sizeBreakdown: line.sizeBreakdown,
    productionSteps: line.productionSteps,
    bomItems: line.bomItems,
    garmentSampleStages: line.garmentSampleStages,
    fieldSources: line.fieldSources,
  });
}

function normalizeFieldFilters(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => item && typeof item === 'object' ? item as Record<string, unknown> : null)
    .filter(Boolean)
    .map(item => ({
      path: cleanText(item!.path),
      operator: cleanText(item!.operator) || 'contains',
      value: item!.value,
    }))
    .filter(item => item.path)
    .slice(0, 20);
}

function arrayOfText(value: unknown) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.map(cleanText).filter(Boolean).slice(0, 20);
}

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function cleanDate(value: unknown) {
  const text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function numberInput(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}

function serializeBigInts<T>(value: T): T {
  if (typeof value === 'bigint') return Number(value) as T;
  if (Prisma.Decimal.isDecimal(value)) return Number(value) as T;
  if (Array.isArray(value)) return value.map(serializeBigInts) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = serializeBigInts(item);
    return out as T;
  }
  return value;
}

const ORDER_QUERY_FIELDS: Record<string, string> = {
  po: 'poNumber',
  customerName: 'customer',
  supplier: 'millName',
  supplierInvoice: 'supplierInvoiceNumber',
  invoice: 'invoiceNumber',
  exmill: 'clientDate',
};

const SAFE_ORDER_FIELDS = new Set([
  'id', 'poNumber', 'customer', 'customerCode', 'product', 'type', 'status',
  'dueDate', 'clientDate', 'productionDate', 'shipmentDate', 'invoiceNumber',
  'supplierInvoiceNumber', 'millName', 'billToName', 'consigneeName',
  'paymentTerms', 'salesCurrency', 'purchaseCurrency', 'fabricCode',
  'fabricContent', 'productionBatch', 'sampleSentDate', 'fabricSampleSentDate',
]);

const ORDER_SORT_FIELDS = new Set(['updatedAt', 'importedAt', 'dueDate', 'clientDate', 'customer', 'status', 'poNumber']);
