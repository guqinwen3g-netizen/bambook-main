// 由 scripts/gen-mist-command-catalog.mjs 生成，请勿手改。
export const MIST_COMMAND_CATALOG: ReadonlyArray<{ type: string; payload: string; source: string }> = [
 {
  "type": "agent.proposal.confirm",
  "payload": "{ id: string }",
  "source": "server/src/shared/mistAgentProposals.ts"
 },
 {
  "type": "agent.proposal.create",
  "payload": "{ command: AgentProposalCommandBody; summary: string[] }",
  "source": "server/src/shared/mistAgentProposals.ts"
 },
 {
  "type": "agent.proposal.reject",
  "payload": "{ id: string; note?: string }",
  "source": "server/src/shared/mistAgentProposals.ts"
 },
 {
  "type": "calendar.save",
  "payload": "{ id?: string; title: string; date: string; time: string; note: string; target?: MistTarget }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "contact.delete",
  "payload": "{ id: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "contact.save",
  "payload": "{ id?: string; customerId: string; name: string; role: string; email: string; phone: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "cost.expense.payable",
  "payload": "{ id: string; supplierId: string; invoiceNo?: string; due: string; taxAmount?: number | string; note?: string }",
  "source": "server/src/shared/mistOrderCost.ts"
 },
 {
  "type": "cost.expense.register",
  "payload": "{ category: string; vendor?: string; ref?: string; date: string; currency: string; amount: number | string; note?: string; scope: 'shipment' | 'orders'; shipmentId?: string; orderIds?: string[]; basis: string; manual?: Array<{ orderId: string; amount: number | string }> }",
  "source": "server/src/shared/mistOrderCost.ts"
 },
 {
  "type": "cost.expense.void",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistOrderCost.ts"
 },
 {
  "type": "crm.followUp.save",
  "payload": "{ customerId: string; method: CrmFollowUpMethod; content: string; at: string; nextDate: string; link: CrmLink | null; collection?: { level: CrmCollectionLevel; promisedDate?: string; promisedAmount?: string } }",
  "source": "server/src/shared/mistCrm.ts"
 },
 {
  "type": "crm.opportunity.save",
  "payload": "{ id?: string; input: CrmOpportunityInput }",
  "source": "server/src/shared/mistCrm.ts"
 },
 {
  "type": "crm.opportunity.stage",
  "payload": "{ id: string; stage: CrmStage; note: string }",
  "source": "server/src/shared/mistCrm.ts"
 },
 {
  "type": "customer.update",
  "payload": "{ id: string; patch: Partial<Omit<MistCustomer, 'id' | 'owner'>> }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.archive",
  "payload": "{ devId: string; versionId: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.billing.issue",
  "payload": "{ devId: string; chargeIds: string[]; number: string; due: string; fileIds: string[] }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.billing.request",
  "payload": "{ devId: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.billing.withdraw",
  "payload": "{ devId: string; reason: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.charge.add",
  "payload": "{ devId: string; versionIds: string[]; description: string; amount: number; currency: string; evidence: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.charge.void",
  "payload": "{ devId: string; chargeId: string; reason: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.close",
  "payload": "{ devId: string; kind: 'archived' | 'cancelled'; reason: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.confirm",
  "payload": "{ devId: string; versionId: string; result: MistConfirmation['result']; confirmer: string; organization: string; confirmedAt: string; basis: string; originalText: string; sampleIds?: string[] }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.expense.add",
  "payload": "{ devId: string; versionId?: string; amount: number; currency: string; description: string; date: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.fee.recordMaking",
  "payload": "{ devId: string; sampleId: string; amount: number; currency: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.move",
  "payload": "{ devId: string; stage: number }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.notice.generate",
  "payload": "{ devId: string; versionId: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.qc.decide",
  "payload": "{ devId: string; versionId: string; decision: 'rework' | 'abandon'; note: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.recordQc",
  "payload": "{ devId: string; versionId: string; qc: MistQc; domain?:DevelopmentDomain }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.recordSample",
  "payload": "{ devId: string; versionId: string; sample: string; quantity: number; returnedAt: string; form?:string; unit?:string; location?:string; color?:string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.revise",
  "payload": "{ devId: string; versionId: string; note: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.round.create",
  "payload": "{ devId: string; factories: string[]; requirements: string; fileIds?: string[]; referenceVersionIds?: string[]; targetDate: string; /** QC 不通过后“重新打样”：记录来源版本的处理决定 */ resampleFromVersionId?: string; /** 逐厂差异要求、样品形态、数量和单位、要求日期；缺省按开发案计划样品与本轮目标日期 */ factoryTasks?: Array<Partial<FactoryTaskInput> & { factory: string }> }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.round.updateRequirements",
  "payload": "{ devId: string; roundId: string; requirements: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.sample.dispatch",
  "payload": "{ devId: string; versionId: string; sampleId: string; quantity: number; purpose?:SampleSendPurpose;recipient: string; trackingNo?: string; fee?: MistSampleFee | null; note?: string; sourceLocation?: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.sample.dispatchFee",
  "payload": "{ devId: string; versionId: string; dispatchId: string; fee: MistSampleFee }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.saveConfirmationDraft",
  "payload": "{ devId: string; versionId: string; draft: Omit<MistConfirmation, 'id' | 'recordedAt' | 'recordedBy'> }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.saveDraft",
  "payload": "{ draftId?: string; values: DevelopmentValues; fileIds: string[] }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.submit",
  "payload": "{ draftId?: string; values: DevelopmentValues; fileIds: string[] }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.update",
  "payload": "{ devId: string; patch: Partial<DevelopmentValues> }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.version.addSampleForm",
  "payload": "{ devId: string; versionId: string; form: string; quantity: number; unit: string; location?: string; color?: string; note?: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.version.recordMinor",
  "payload": "{ devId: string; versionId: string; change: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "development.version.syncRequirements",
  "payload": "{ devId: string; versionId: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "email.account.save",
  "payload": "{ id?: string; input: EmailAccountInput }",
  "source": "server/src/shared/mistEmail.ts"
 },
 {
  "type": "email.draft.delete",
  "payload": "{ id: string }",
  "source": "server/src/shared/mistEmail.ts"
 },
 {
  "type": "email.draft.save",
  "payload": "{ id?: string; input: EmailDraftInput }",
  "source": "server/src/shared/mistEmail.ts"
 },
 {
  "type": "email.flag",
  "payload": "{ id: string; flag: 'read' | 'starred' | 'important'; value: boolean }",
  "source": "server/src/shared/mistEmail.ts"
 },
 {
  "type": "email.followUp",
  "payload": "{ id: string; owner: string; due: string; note: string }",
  "source": "server/src/shared/mistEmail.ts"
 },
 {
  "type": "email.link",
  "payload": "{ id: string; link: EmailLink }",
  "source": "server/src/shared/mistEmail.ts"
 },
 {
  "type": "email.move",
  "payload": "{ id: string; folder: 'inbox' | 'archive' | 'trash' | 'restore' }",
  "source": "server/src/shared/mistEmail.ts"
 },
 {
  "type": "email.server.account",
  "payload": "{ id: string; connection?: EmailConnection; credentialSet?: boolean; lastError?: EmailProblem | null; syncStartedAt?: string | null }",
  "source": "server/src/shared/mistEmail.ts"
 },
 {
  "type": "email.server.send.begin",
  "payload": "{ mode: 'new'; requestKey: string; draftId?: string; input: EmailDraftInput; forwardOfId?: string; messageId: string }",
  "source": "server/src/shared/mistEmail.ts"
 },
 {
  "type": "email.server.send.finish",
  "payload": "{ id: string; outcome: 'accepted' | 'failed' | 'unknown' | 'verified' | 'not_found'; code: string; message: string; response?: string; accepted?: string[]; rejected?: Array<{ address: string; reply: string }>; foundIn?: EmailMessageFolder[] }",
  "source": "server/src/shared/mistEmail.ts"
 },
 {
  "type": "email.server.sync",
  "payload": "{ accountId: string; source?: number; at: string; folders: EmailFolderSync[]; messages: EmailSyncedMessage[]; files: StoredFile[]; lastError: EmailProblem | null }",
  "source": "server/src/shared/mistEmail.ts"
 },
 {
  "type": "email.submitExtraction",
  "payload": "{ id: string; link: EmailLink }",
  "source": "server/src/shared/mistEmail.ts"
 },
 {
  "type": "email.unlink",
  "payload": "{ id: string; link: EmailLink }",
  "source": "server/src/shared/mistEmail.ts"
 },
 {
  "type": "fabric.answer",
  "payload": "{ id: string; answer: string; fileIds: string[] }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "fabric.confirm",
  "payload": "{ id: string; approved: boolean; note: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "fabric.create",
  "payload": "{ name: string; request: string; ownerId: string; due: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "files.add",
  "payload": "{ file: MistFile }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.acceptSuggestions",
  "payload": "{ receiptIds: string[] }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.account.assign",
  "payload": "{ kind: 'receipt' | 'payment'; id: string; accountId: string | null; reason?: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.account.close",
  "payload": "{ id: string; date: string; reason: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.account.reopen",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.account.save",
  "payload": "{ id?: string; name: string; bankName: string; accountNo: string; currency: string; openingDate: string; openingBalance: number }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.allocation.reverse",
  "payload": "{ allocationId: string; reason: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.developmentInvoice.issue",
  "payload": "{ devId: string; requestId: string; due: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.fx.allocate",
  "payload": "{ id: string; receipts: Array<{ receiptId: string; amount: number }> }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.fx.lock",
  "payload": "{ date: string; bankName: string; currency: string; amount: number; rate: string; localCurrency: string; settleBy: string; ref: string; note?: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.fx.reverse",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.fx.settle",
  "payload": "{ date: string; fromAccountId: string; toAccountId: string; amount: number; localAmount: number; ref: string; note?: string; lockId?: string; receipts?: Array<{ receiptId: string; amount: number }> }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.importReceipts",
  "payload": "{ accountId?: string; receipts: Array<{ date: string; payer: string; amount: number; currency: string; ref: string }> }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.payment.reverse",
  "payload": "{ paymentId: string; reason: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.payment.save",
  "payload": "{ date: string; payee: string; amount: number; currency: string; ref: string; accountId?: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.receivable.confirm",
  "payload": "{ invoiceId: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.receivable.reject",
  "payload": "{ invoiceId: string; reason: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.reconcile",
  "payload": "{ receiptId: string; invoiceId: string; amount?: number; payerBasis?:string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "finance.statement.generate",
  "payload": "{ customerId: string }",
  "source": "server/src/shared/mistCustomerStatement.ts"
 },
 {
  "type": "fulfillment.claimInventory.receive",
  "payload": "{goodsId:string;quantity:number;unit:string;warehouseId:string;location:string;batchNumber:string;ownership:'Owned'|'Transferred';ownershipDate:string;ownershipEvidence:string;receivedAt:string;basis:string;fileIds:string[]}",
  "source": "server/src/shared/mistClaimInventory.ts"
 },
 {
  "type": "fulfillment.claimInventory.repair.dispatch",
  "payload": "{goodsId:string;receivedEventId:string;supplierId:string;warehouseId:string;location:string;date:string;recipient:string;reference:string;basis:string;fileIds:string[]}",
  "source": "server/src/shared/mistClaimInventory.ts"
 },
 {
  "type": "fulfillment.claimInventory.repair.handback",
  "payload": "{goodsId:string;repairId:string;date:string;recipient:string;reference:string;basis:string;fileIds:string[]}",
  "source": "server/src/shared/mistClaimInventory.ts"
 },
 {
  "type": "fulfillment.claimInventory.repair.qc",
  "payload": "{goodsId:string;repairId:string;result:'pass'|'fail';checkedAt:string;basis:string;fileIds:string[]}",
  "source": "server/src/shared/mistClaimInventory.ts"
 },
 {
  "type": "fulfillment.claimInventory.repair.record",
  "payload": "{goodsId:string;receivedEventId:string;supplierId:string;technician:string;completedAt:string;basis:string;fileIds:string[]}",
  "source": "server/src/shared/mistClaimInventory.ts"
 },
 {
  "type": "fulfillment.claimInventory.repair.return",
  "payload": "{goodsId:string;dispatchId:string;date:string;recipient:string;reference:string;basis:string;fileIds:string[]}",
  "source": "server/src/shared/mistClaimInventory.ts"
 },
 {
  "type": "fulfillment.claimInventory.scrap",
  "payload": "{goodsId:string;receivedEventId:string;basis:string;fileIds:string[]}",
  "source": "server/src/shared/mistClaimInventory.ts"
 },
 {
  "type": "fulfillment.claimInventory.warehouse.save",
  "payload": "{id?:string;code:string;name:string;address:string;active:boolean;supplierId?:string;custodian?:'company'|'supplier'}",
  "source": "server/src/shared/mistClaimInventory.ts"
 },
 {
  "type": "fulfillment.customs.classify.save",
  "payload": "{ id?: string; family: CustomsFamily; hsCode: string; declaredName: string; brandType: string; preference: string; elements: string[]; legalUnit?: string; secondUnit?: string; styles: string[]; colors?:string[]; note?: string }",
  "source": "server/src/shared/mistCustomsDeclaration.ts"
 },
 {
  "type": "fulfillment.customs.classify.void",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistCustomsDeclaration.ts"
 },
 {
  "type": "fulfillment.customs.item.adjust",
  "payload": "{ id: string; no: number; declaredName: string; elements: string; legalQty: number; secondQty?: number | null; reason: string }",
  "source": "server/src/shared/mistCustomsDeclaration.ts"
 },
 {
  "type": "fulfillment.customs.items",
  "payload": "{ id: string }",
  "source": "server/src/shared/mistCustomsDeclaration.ts"
 },
 {
  "type": "fulfillment.customs.reviewReplacement",
  "payload": "{id:string;orderId:string;unitPrice:number;originalDeclarationNo:string;returnReference:string;taxHandling:string;basis:string;fileIds:string[]}",
  "source": "server/src/shared/mistClaimReplacement.ts"
 },
 {
  "type": "fulfillment.customs.save",
  "payload": "{ id?: string; shipmentId: string; declarationNo: string; broker: string; hsCode: string; origin: string; tradeMode: string; declaredAt: string; clearedAt: string; evidence: string; fileIds: string[]; note: string; status: FulfillmentCustoms['status']; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.documents.archiveExternal",
  "payload": "{ id: string; issuer: string; at: string; evidence: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.documents.issue",
  "payload": "{ id: string; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.documents.save",
  "payload": "{ id?: string; baseDocumentId?: string; shipmentId: string; orderId: string; type: FulfillmentDocument['type']; number: string; title: string; dueDate: string; content: string; fileIds: string[]; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.documents.void",
  "payload": "{ id: string; reason: string; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.inventory.move",
  "payload": "{ id: string; targetProductionId?: string; kind: 'issue' | 'return' | 'move'; quantity: number; location: string; person: string; note: string; issueId?: string; sourceLocation?: string; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.inventory.quarantine.dispose",
  "payload": "{ returnId: string; decision: 'release' | 'supplierReturn' | 'scrap'; evidence: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.inventory.quarantine.noRecovery",
  "payload": "{ returnId: string; evidence: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.inventory.quarantine.noRecovery.revoke",
  "payload": "{ returnId: string; reason: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.inventory.quarantine.request",
  "payload": "{ returnId: string; due: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.inventory.shipment.correct",
  "payload": "{ issueId: string; shipmentId: string; evidence: string; reason: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.inventory.shipment.link",
  "payload": "{ issueId: string; shipmentId: string; evidence: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.inventory.shipment.unlink",
  "payload": "{ issueId: string; reason: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.materials.confirm",
  "payload": "{ kind: 'issue' | 'direct'; id: string; evidence: string; acceptedQuantity?: number; rejectedQuantity?: number; expectedReceivingRevision?: number }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.materials.deliver",
  "payload": "{ id: string; targetProductionId: string; quantity: number; rejected: number; location: string; date: string; evidence: string; fileIds: string[] }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.materials.issue",
  "payload": "{ id: string; targetProductionId: string; quantity: number; location: string; person: string; note: string; sourceLocation?: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.procurement.confirm",
  "payload": "{ id: string; at: string; evidence: string; confirmedDue: string; fileIds: string[] }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.procurement.decide",
  "payload": "{ id: string; decision: 'approved' | 'rejected'; note: string; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.procurement.document",
  "payload": "{ id: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.procurement.receive",
  "payload": "{ id: string; targetProductionId?: string; quantity: number; rejected: number; destination: 'warehouse' | 'supplier'; location: string; date: string; evidence: string; fileIds: string[]; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.procurement.rejectReceived",
  "payload": "{ receiptId: string; quantity: number; location: string; evidence: string; sourceLocation?: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.procurement.return",
  "payload": "{ receiptId: string; quantity: number; disposition: 'replace' | 'noReplace'; date: string; evidence: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.procurement.return.reverse",
  "payload": "{ receiptId: string; returnId: string; reason: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.procurement.save",
  "payload": "PurchaseInput",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.procurement.send",
  "payload": "{ id: string; at: string; evidence: string; fileIds: string[] }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.procurement.submit",
  "payload": "{ id: string; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.production.acceptCompletion",
  "payload": "{ productionId: string; note: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.production.complete",
  "payload": "{ productionId: string; quantity: number; sizeQuantities: FulfillmentSizeQuantity[]; date: string; evidence: string; fileIds: string[] }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.production.hold",
  "payload": "{ productionId: string; category: FulfillmentProductionHold['category']; reason: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.production.intake.decide",
  "payload": "{ id: string; decision: 'approved' | 'rejected'; note: string }",
  "source": "server/src/shared/mistProductionIntake.ts"
 },
 {
  "type": "fulfillment.production.plan",
  "payload": "{ productionId: string; sizes: FulfillmentSizeQuantity[] }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.production.release",
  "payload": "{ productionId: string; note: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.production.resume",
  "payload": "{ productionId: string; note: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.qc.claim",
  "payload": "{ id: string; domain: 'garment' | 'fabric'; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.qc.confirm",
  "payload": "{ id: string; result: 'approved' | 'rejected'; note: string; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.qc.continue",
  "payload": "{ id: string; note: string; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.qc.report",
  "payload": "{ id: string; location?: string; domain: 'garment' | 'fabric'; result: MistQc['result']; report: string; opinion: string; measurements: NonNullable<MistQc['measurements']>; fileIds: string[]; reviewedAt: string; sizeChecks?: NonNullable<FulfillmentQcReport['sizeChecks']>; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.qc.request",
  "payload": "{ source: Exclude<FulfillmentSource, { kind: 'manual'; }>; domain: 'garment' | 'fabric'; kind: 'sample' | 'production'; factory: string; location: string; contact: string; due: string; sampleId?: string; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.samples.create",
  "payload": "SampleInput",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.samples.edit",
  "payload": "{ id: string; location: string; note: string; fileIds: string[]; name?: string; form?: string; size?: string; color?: string; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.samples.move",
  "payload": "{ id: string; kind: 'lend' | 'return' | 'send' | 'move'; sendPurpose?:SampleSendPurpose; quantity: number; person: string; location: string; note: string; loanId?: string; expectedReturn?: string; sourceLocation?: string; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.samples.sync",
  "payload": "Record<string",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.shipments.cancel",
  "payload": "{ id: string; reason: string; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.shipments.depart",
  "payload": "{ id: string; at: string; evidence: string; fileIds: string[]; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.shipments.pack",
  "payload": "{ id: string; lines: Array<Omit<FulfillmentPacking, 'id' | 'shipmentId'>>; packingDetailVersion?:2; packingColorVersion?:1; supplementEvidence?:string; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.shipments.ready",
  "payload": "{ id: string; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.shipments.save",
  "payload": "ShipmentInput",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.shipments.sent",
  "payload": "{ id: string; at: string; }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.shipments.sourceTerms",
  "payload": "FulfillmentShippingTerms",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "fulfillment.shipments.updateTransport",
  "payload": "{ id: string; booking: string; plannedDate: string; note: string }",
  "source": "server/src/shared/mistFulfillment.ts"
 },
 {
  "type": "funding.assign",
  "payload": "{id?:string;receiptId:string;customerId:string;orderId?:string|null;amount:number;note:string}",
  "source": "server/src/shared/mistOrderFunding.ts"
 },
 {
  "type": "funding.release",
  "payload": "{id:string;note:string}",
  "source": "server/src/shared/mistOrderFunding.ts"
 },
 {
  "type": "fxrate.period.save",
  "payload": "{ month: string; currency: string; rate: string; source: string }",
  "source": "server/src/shared/mistFxRates.ts"
 },
 {
  "type": "fxrate.period.void",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistFxRates.ts"
 },
 {
  "type": "fxrate.reval.post",
  "payload": "{ month: string; note?: string }",
  "source": "server/src/shared/mistFxRates.ts"
 },
 {
  "type": "fxrate.reval.void",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistFxRates.ts"
 },
 {
  "type": "handover.account",
  "payload": "{ fromUserId: string; toUserId: string; reason: string }",
  "source": "server/src/shared/mistHandover.ts"
 },
 {
  "type": "handover.customer",
  "payload": "{ customerId: string; toUserId: string; reason: string; orderIds?: string[]; opportunityIds?: string[] }",
  "source": "server/src/shared/mistHandover.ts"
 },
 {
  "type": "lc.amend",
  "payload": "{ id: string; date: string; changes: Partial<Record<LcAmendField, unknown>>; note?: string }",
  "source": "server/src/shared/mistLetterOfCredit.ts"
 },
 {
  "type": "lc.cancel",
  "payload": "{ id: string; date: string; reason: string }",
  "source": "server/src/shared/mistLetterOfCredit.ts"
 },
 {
  "type": "lc.files",
  "payload": "{ id: string; fileIds: string[] }",
  "source": "server/src/shared/mistLetterOfCredit.ts"
 },
 {
  "type": "lc.present",
  "payload": "{ id: string; shipmentId: string; shipmentDate: string; presentedAt: string; amount: string | number; documents: string; discrepancies?: string }",
  "source": "server/src/shared/mistLetterOfCredit.ts"
 },
 {
  "type": "lc.presentation.result",
  "payload": "{ id: string; presentationId: string; result: Exclude<LcPresentationResult, 'pending'>; date: string; note?: string; discrepancies?: string; honouredAmount?: string | number }",
  "source": "server/src/shared/mistLetterOfCredit.ts"
 },
 {
  "type": "lc.save",
  "payload": "{ input: LcInput }",
  "source": "server/src/shared/mistLetterOfCredit.ts"
 },
 {
  "type": "market.attachment.set",
  "payload": "{kind:'product'|'supplier'|'relation'|'season'|'trend'|'show'|'campaign'|'lead'|'showLead'|'quotation'|'lookbook';id:string;fileIds:string[]}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.campaign.save",
  "payload": "{id?:string;input:Omit<Input<MarketCampaign>,'code'>}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.campaign.status",
  "payload": "{id:string;status:MarketCampaign['status']}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.contact.delete",
  "payload": "{kind:'customer'|'supplier'|'relation';parentId:string;id:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.contact.save",
  "payload": "{kind:'customer'|'supplier'|'relation';parentId:string;id?:string;name:string;role:string;email:string;phone:string;primary:boolean}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.customer.create",
  "payload": "{input:Omit<MistCustomer,'id'|'code'|'owner'>&{code?:string}}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.customer.update",
  "payload": "{id:string;patch:Partial<Omit<MistCustomer,'id'|'code'|'owner'>>}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.import",
  "payload": "{kind:MistImportKind;rows:MistImportRow[]}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.lead.convertToCrm",
  "payload": "{id:string;customerId?:string;opportunity?:{title:string;domain:'garment'|'fabric';amount:string;currency:string;expectedDate:string}|null}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.lead.save",
  "payload": "{id?:string;input:Omit<Input<MarketLead>,'convertedAt'>}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.lead.transition",
  "payload": "{id:string;status:MarketLead['status'];customerId?:string;actualValue?:string;note:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.lookbook.save",
  "payload": "{id?:string;input:Omit<Input<MarketLookbook>,'preparedAt'|'snapshots'>}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.lookbook.status",
  "payload": "{id:string;status:MarketLookbook['status']}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.marginFloor.set",
  "payload": "{family:'fabric'|'garment';minMarginPercent:string;effectiveFrom:string;reason:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.product.fromVersion",
  "payload": "{devId:string;versionId:string;sku:string;name?:string;supplierId?:string;supplierCode?:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.product.save",
  "payload": "{id?:string;input:Input<MarketProduct>}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.product.status",
  "payload": "{id:string;status:MarketProduct['status']}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.quotation.convert",
  "payload": "{id:string;type:'garment'|'fabric';due:string;ownerId:string;/** BB-QUO-5 本次转单的条目；缺省为全部未处理条目（兼容旧调用）。 */lineIds?:string[]}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.quotation.costing.save",
  "payload": "{quotationId:string;lineId:string;expectedTarget:string;input:QuoteCostInput;applyPrice:boolean;historyReference?:QuoteHistoryReference}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.quotation.decide",
  "payload": "{id:string;decision:'approved'|'rejected';note:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.quotation.document",
  "payload": "{id:string;draft:boolean}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.quotation.feedback.add",
  "payload": "{quotationId:string;expectedTarget:string;input:QuoteFeedbackInput}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.quotation.save",
  "payload": "{id?:string;input:Omit<Input<MarketQuotation>,'documents'|'code'|'total'|'deliveryEvidence'|'responseEvidence'|'approval'|'convertedOrderId'|'lines'|'revision'|'rootId'|'previousId'|'costingSnapshots'|'feedback'>&{lines:Array<Omit<MarketQuoteLine,'id'|'amount'>>;/** 仅新建时：基于此报价建立新版本（续期或改价）。 */previousId?:string}}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.quotation.skipLines",
  "payload": "{id:string;lineIds:string[];reason:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.quotation.status",
  "payload": "{id:string;status:MarketQuotation['status'];evidence:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.quotation.submit",
  "payload": "{id:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.relation.hold",
  "payload": "{id:string;frozen:boolean;reason:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.relation.linkSupplier",
  "payload": "{id:string;supplierId:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.relation.save",
  "payload": "{id?:string;input:Omit<Input<MarketRelation>,'contacts'|'hold'|'holdHistory'|'mergedRelationIds'>}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.relation.status",
  "payload": "{id:string;status:MarketRelation['status']}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.season.review",
  "payload": "{id:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.season.save",
  "payload": "{id?:string;input:Input<MarketSeason>&{status:MarketSeason['status']}}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.show.save",
  "payload": "{id?:string;input:Input<MarketShow>&{status:MarketShow['status']}}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.showLead.save",
  "payload": "Extract<MarketCommand",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.showLead.transition",
  "payload": "Extract<MarketCommand",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.supplier.bank.save",
  "payload": "{supplierId:string;currency:string;accountName:string;bankName:string;accountNo:string;swift?:string;verification:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.supplier.certificate.delete",
  "payload": "{supplierId:string;id:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.supplier.certificate.save",
  "payload": "{supplierId:string;id?:string;name:string;number:string;issuer:string;validUntil:string;fileIds:string[]}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.supplier.rate",
  "payload": "{supplierId:string;grade:SupplierRating['grade'];period:string;note:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.supplier.save",
  "payload": "{id?:string;input:Pick<MarketSupplier,'name'|'type'>&Partial<Omit<Input<MarketSupplier>,'name'|'type'|'contacts'|'blockReason'|'statusFrom'|'statusHistory'|'certificates'|'ratings'|'handlers'>>&{/** 各业务组经手人账号 ID；省略的组保持不变，空字符串表示清除。 */handlerIds?:Partial<Record<MistBusinessGroup,string>>}}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.supplier.status",
  "payload": "{id:string;status:MarketSupplier['status'];reason:string;effectiveDate?:string}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "market.trend.save",
  "payload": "{id?:string;input:Input<MarketTrend>}",
  "source": "server/src/shared/mistMarket.ts"
 },
 {
  "type": "member.groups.set",
  "payload": "{ userId: string; groups: Array<'fabric' | 'garment'> }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "notification.read",
  "payload": "{ id: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "notification.readAll",
  "payload": "Record<string",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "opening.payable.import",
  "payload": "{ rows: MistImportRow[] }",
  "source": "server/src/shared/mistOpeningBalance.ts"
 },
 {
  "type": "opening.receivable.import",
  "payload": "{ rows: MistImportRow[] }",
  "source": "server/src/shared/mistOpeningBalance.ts"
 },
 {
  "type": "opening.receivable.void",
  "payload": "{ invoiceId: string; reason: string }",
  "source": "server/src/shared/mistOpeningBalance.ts"
 },
 {
  "type": "order.checklist",
  "payload": "{ orderId: string; itemId: string; done: boolean }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "order.create",
  "payload": "MistOrderInput",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "order.fabric.allocate",
  "payload": "{ orderId: string; lineId: string; fabricOrderId: string; fabricLineId: string; metres: string; expectedRevision: number }",
  "source": "server/src/shared/mistInternalFabric.ts"
 },
 {
  "type": "order.fabric.cancel",
  "payload": "{ id: string; expectedRevision: number }",
  "source": "server/src/shared/mistInternalFabric.ts"
 },
 {
  "type": "order.fabric.shortClose",
  "payload": "{ id:string; expectedRevision:number; reason:string }",
  "source": "server/src/shared/mistInternalFabric.ts"
 },
 {
  "type": "order.files.add",
  "payload": "{ orderId: string; fileIds: string[] }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "order.governance.closeLine",
  "payload": "{orderId:string;lineId:string;reason:string}",
  "source": "server/src/shared/mistOrderGovernance.ts"
 },
 {
  "type": "order.governance.decide",
  "payload": "{id:string;decision:'approved'|'rejected';note:string}",
  "source": "server/src/shared/mistOrderGovernance.ts"
 },
 {
  "type": "order.governance.discardChange",
  "payload": "{orderId:string}",
  "source": "server/src/shared/mistOrderGovernance.ts"
 },
 {
  "type": "order.governance.requestCancel",
  "payload": "{orderId:string;reason:string}",
  "source": "server/src/shared/mistOrderGovernance.ts"
 },
 {
  "type": "order.governance.requestOverShip",
  "payload": "{orderId:string;lineId:string;quantity:number;reason:string}",
  "source": "server/src/shared/mistOrderGovernance.ts"
 },
 {
  "type": "order.governance.saveDraft",
  "payload": "{orderId:string;input:OrderGovernanceInput;orderPatch?:Partial<Pick<MistOrder,'season'|'currency'|'due'|'ownerId'>>;lines?:OrderGovernanceLine[];reason?:string}",
  "source": "server/src/shared/mistOrderGovernance.ts"
 },
 {
  "type": "order.governance.submit",
  "payload": "{orderId:string}",
  "source": "server/src/shared/mistOrderGovernance.ts"
 },
 {
  "type": "order.governance.void",
  "payload": "{orderId:string;reason:string}",
  "source": "server/src/shared/mistOrderGovernance.ts"
 },
 {
  "type": "order.handoff",
  "payload": "{ orderId: string; note?: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "order.internal.cancel",
  "payload": "{id:string;expectedRevision:number;reason:string}",
  "source": "server/src/shared/mistInternalDelivery.ts"
 },
 {
  "type": "order.internal.receive",
  "payload": "{id:string;accepted:number;rejected:number;expectedRevision:number;evidence:string}",
  "source": "server/src/shared/mistInternalDelivery.ts"
 },
 {
  "type": "order.internal.returnRejected",
  "payload": "{id:string;quantity:number;date:string;expectedRevision:number;evidence:string}",
  "source": "server/src/shared/mistInternalDelivery.ts"
 },
 {
  "type": "order.internal.reverseCheck",
  "payload": "{id:string;checkId:string;expectedRevision:number;reason:string}",
  "source": "server/src/shared/mistInternalDelivery.ts"
 },
 {
  "type": "order.internal.send",
  "payload": "{orderId:string;productionId:string;source:{kind:'receipt'|'stockIssue';id:string};quantity:number;receiverId:string;location:string;date:string;evidence:string;expectedRevision:number}",
  "source": "server/src/shared/mistInternalDelivery.ts"
 },
 {
  "type": "order.update",
  "payload": "{ orderId: string; due?: string; season?: string; ownerId?: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "payable.allocation.reverse",
  "payload": "{ allocationId: string; reason: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.bill.classify",
  "payload": "{id:string;invoiceType:SupplierInvoiceType;fileIds:string[];reason:string}",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.bill.link",
  "payload": "{ id: string; links: Array<{ purchaseId: string; settlementId: string }> }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.bill.register",
  "payload": "{ invoiceType?:SupplierInvoiceType; supplierId: string; invoiceNo: string; invoiceDate: string; currency: string; amount: number; taxAmount: number; taxRate?: string; lines: Array<{ purchaseId: string; amount: number; settlementId?: string; awaitingSettlement?: boolean }>; due: string; dueBasis: string; fileIds?: string[]; note?: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.bill.void",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.deduction.register",
  "payload": "{ recoveryId: string; billId: string; amount: number; reference: string; note?: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.deduction.reverse",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.disposal.reverse",
  "payload": "{returnId:string;reviewId:string;reason:string}",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.disposal.review",
  "payload": "{returnId:string;evidence:string}",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.payment.allocate",
  "payload": "{ supplierPaymentId: string; allocations: AllocationInput }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.payment.backfill",
  "payload": "{ planId: string; date: string; amount: number; reference: string; billId?: string; note?: string; fileIds?: string[] }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.payment.plan",
  "payload": "{ supplierPaymentId: string; planId: string | null; note?: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.payment.register",
  "payload": "{ requestId?: string; supplierId?: string; date: string; amount: number; currency?: string; reference: string; fileIds?: string[]; note?: string; allocations?: AllocationInput }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.payment.reverse",
  "payload": "{ supplierPaymentId: string; reason: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.plan.cancel",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.plan.register",
  "payload": "{ purchaseId: string; stage?: PaymentPlanStage; amount: number; trigger: string; basis: string; due?: string; note?: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.prepayment.refund",
  "payload": "{ purchaseId: string; amount: number; date: string; reference: string; reason: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.prepayment.reverse",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.prepayment.transfer",
  "payload": "{ purchaseId: string; targetPurchaseId: string; amount: number; reason: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.purchase.cancel",
  "payload": "{ purchaseId: string; reason: string; prepayment?: 'refund' | 'transfer'; targetPurchaseId?: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.request.cancel",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.request.decide",
  "payload": "{ id: string; decision: 'approved' | 'rejected'; note: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.request.submit",
  "payload": "{ purpose: 'prepayment'; planId: string; amount: number; reason: string; fileIds?: string[] }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.settlement.cancel",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.settlement.confirm",
  "payload": "{ id: string; prepaymentApplied: number; adjustReason?: string; note?: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.settlement.return",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.settlement.reverse",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "payable.settlement.submit",
  "payload": "{ purchaseId: string; receiptIds: string[]; final?: boolean; disputes?: SettlementDispute[]; note?: string; fileIds?: string[] }",
  "source": "server/src/shared/mistPayables.ts"
 },
 {
  "type": "platform.assistant.saveDraft",
  "payload": "{title:string;content:string;orderId:string}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.bom.save",
  "payload": "{id?:string;orderId:string;description:string;currency:string;lines:PlatformBomLine[];labor:number;overhead:number}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.bom.transition",
  "payload": "{id:string;state:'Confirmed'|'Archived'}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.claim.attachFiles",
  "payload": "{id:string;fileIds:string[]}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.claim.cancel",
  "payload": "{id:string;reason:string}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.claim.close",
  "payload": "{id:string}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.claim.create",
  "payload": "{orderId:string;invoiceId:string;problem:string;fileIds:string[]}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.claim.decide",
  "payload": "{id:string;decision:'approved'|'rejected';note:string}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.claim.disposition",
  "payload": "PlatformClaimDispositionInput",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.claim.execute",
  "payload": "{id:string;warehouseId?:string}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.claim.notify",
  "payload": "{ id: string; supplierId: string; factoryChannel: string; note: string }",
  "source": "server/src/shared/mistClaimCoordination.ts"
 },
 {
  "type": "platform.claim.recovery.agree",
  "payload": "{ id: string; agreed: number; method: ClaimRecoveryMethod; note: string }",
  "source": "server/src/shared/mistClaimCoordination.ts"
 },
 {
  "type": "platform.claim.recovery.method",
  "payload": "{ id: string; method: 'payment'; reason: string }",
  "source": "server/src/shared/mistClaimCoordination.ts"
 },
 {
  "type": "platform.claim.recovery.open",
  "payload": "{ claimId: string; supplierId: string; currency: string; requested: number; basis: string }",
  "source": "server/src/shared/mistClaimCoordination.ts"
 },
 {
  "type": "platform.claim.recovery.receipt.allocate",
  "payload": "{id:string;amount:number;receiptId:string;payerBasis?:string;reference?:string;date?:string}",
  "source": "server/src/shared/mistClaimCoordination.ts"
 },
 {
  "type": "platform.claim.recovery.settle",
  "payload": "{ id: string; amount: number; reference?: string; date?: string; receiptId?:string; payerBasis?:string }",
  "source": "server/src/shared/mistClaimCoordination.ts"
 },
 {
  "type": "platform.claim.recovery.settlement.reverse",
  "payload": "{id:string;settlementId:string;reason:string}",
  "source": "server/src/shared/mistClaimCoordination.ts"
 },
 {
  "type": "platform.claim.recovery.waive",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistClaimCoordination.ts"
 },
 {
  "type": "platform.claim.replacement.createOrder",
  "payload": "{id:string;due:string;incoterm:string;deliveryPlace:string;confirmationFileIds:string[]}",
  "source": "server/src/shared/mistClaimReplacement.ts"
 },
 {
  "type": "platform.claim.submit",
  "payload": "{id:string}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.claim.updateDraft",
  "payload": "PlatformClaimDispositionInput",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.claim.verify",
  "payload": "{ id: string; result: ClaimVerifyResult; scope: string; affectedQuantity: number; unit: string; goodsLocation: ClaimGoodsLocation; mitigation: string; factoryResponse: string; safety: boolean; fileIds: string[] }",
  "source": "server/src/shared/mistClaimCoordination.ts"
 },
 {
  "type": "platform.credit.apply",
  "payload": "{creditId:string;invoiceId:string;amount:number}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.credit.issue",
  "payload": "{creditId:string;versionId:string;correctsPrintId?:string;reason?:string}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.credit.refund",
  "payload": "{creditId:string;amount:number;date:string;reference:string}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.employee.save",
  "payload": "{id?:string;name:string;department:string;position:string;contact:string;startDate:string;note:string;active:boolean}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.goods.transition",
  "payload": "{id:string;state:PlatformClaimGoods['state'];basis:string;fileIds:string[]}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.invoice.issue",
  "payload": "{id:string}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.invoice.save",
  "payload": "{id?:string;orderId:string;due:string;amount:number;note:string}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.pricing.save",
  "payload": "{orderId:string;purchaseCostCny:number;refundRate:number;exchangeRate:number;profitMargin:number;commissionRate:number;basis:string;deviationReason?:string}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.pricingParams.set",
  "payload": "{family:'garment'|'fabric';profitMargin:number|string;commissionRate:number|string;effectiveFrom:string;reason:string}",
  "source": "server/src/shared/mistPlatform.ts"
 },
 {
  "type": "platform.risk.decide",
  "payload": "{ id: string; escalationId: string; decision: 'approved' | 'rejected'; note: string }",
  "source": "server/src/shared/mistRisk.ts"
 },
 {
  "type": "platform.risk.escalate",
  "payload": "{ id: string; action: RiskRequestAction; reason: string }",
  "source": "server/src/shared/mistRisk.ts"
 },
 {
  "type": "platform.risk.plan",
  "payload": "{ id: string; plan: string; planDue?: string }",
  "source": "server/src/shared/mistRisk.ts"
 },
 {
  "type": "platform.risk.save",
  "payload": "{ orderId?: string; title: string; level: RiskRecord['level']; basis: string; owner: string; type?: RiskType; source?: { kind: RiskSourceKind; id: string }; signalKey?: string }",
  "source": "server/src/shared/mistRisk.ts"
 },
 {
  "type": "platform.risk.transition",
  "payload": "{ id: string; state: 'Acknowledged' | 'Resolved'; resolution: string }",
  "source": "server/src/shared/mistRisk.ts"
 },
 {
  "type": "platform.risk.withdraw",
  "payload": "{ id: string; escalationId: string; reason?: string }",
  "source": "server/src/shared/mistRisk.ts"
 },
 {
  "type": "production.move",
  "payload": "{ id: string; col: MistProduction['col']; note?: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "production.update",
  "payload": "{ id: string; pct: number; risk?: string; note?: string; startDate?: string; due?: string }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "rebate.claim.approve",
  "payload": "{ id: string; date: string; amount: number; ref: string; reason?: string }",
  "source": "server/src/shared/mistExportRebate.ts"
 },
 {
  "type": "rebate.claim.file",
  "payload": "{ customsId: string; billIds: string[]; filedAt: string; batchRef: string; fileIds?: string[]; note?: string }",
  "source": "server/src/shared/mistExportRebate.ts"
 },
 {
  "type": "rebate.claim.receive",
  "payload": "{ id: string; receiptId: string; amount: number; settle?: boolean; reason?: string }",
  "source": "server/src/shared/mistExportRebate.ts"
 },
 {
  "type": "rebate.claim.reverseReceipt",
  "payload": "{ id: string; entryId: string; reason: string }",
  "source": "server/src/shared/mistExportRebate.ts"
 },
 {
  "type": "rebate.claim.withdraw",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistExportRebate.ts"
 },
 {
  "type": "rebate.rate.save",
  "payload": "{ hsCode: string; rate: string; effectiveFrom: string; basis: string }",
  "source": "server/src/shared/mistExportRebate.ts"
 },
 {
  "type": "rebate.rate.void",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistExportRebate.ts"
 },
 {
  "type": "rfq.award",
  "payload": "{ id: string; quoteId: string; reason?: string }",
  "source": "server/src/shared/mistSourcing.ts"
 },
 {
  "type": "rfq.cancel",
  "payload": "{ id: string; reason: string }",
  "source": "server/src/shared/mistSourcing.ts"
 },
 {
  "type": "rfq.invite",
  "payload": "{ id: string; supplierIds: string[] }",
  "source": "server/src/shared/mistSourcing.ts"
 },
 {
  "type": "rfq.quote",
  "payload": "{ id: string; supplierId: string; declined?: boolean; declineReason?: string; price?: string | number; currency?: string; moq?: string | number; promisedDue?: string; terms?: string; validUntil?: string; note?: string; fileIds?: string[] }",
  "source": "server/src/shared/mistSourcing.ts"
 },
 {
  "type": "rfq.save",
  "payload": "{ input: RfqInput }",
  "source": "server/src/shared/mistSourcing.ts"
 },
 {
  "type": "settings.update",
  "payload": "Partial<Omit<MistSettings",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "sourcing.purchase.transfer",
  "payload": "{ purchaseId: string; supplierId: string; price: string | number; currency: string; due: string; terms?: string; reason: string }",
  "source": "server/src/shared/mistSourcing.ts"
 },
 {
  "type": "task.complete",
  "payload": "{ id: string; done: boolean }",
  "source": "server/src/shared/mistWorkspace.ts"
 },
 {
  "type": "team.nudge",
  "payload": "{ assigneeId: string; title: string; due: string; note?: string; target: MistTarget }",
  "source": "server/src/shared/mistTeam.ts"
 },
 {
  "type": "team.weekly.archive",
  "payload": "{ weekStart: string }",
  "source": "server/src/shared/mistTeam.ts"
 },
 {
  "type": "teamScope.save",
  "payload": "TeamScopeInput",
  "source": "server/src/shared/mistTeamScope.ts"
 }
];
