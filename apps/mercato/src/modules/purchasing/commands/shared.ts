import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { clearAttachmentThumbnailCache } from '@open-mercato/core/modules/attachments/lib/thumbnailCache'
import { deletePartitionFile } from '@open-mercato/core/modules/attachments/lib/storage'
import { PurchasingRequest, PurchasingRequestItem } from '../data/entities'
import {
  deriveRequestStatusFromItems,
  normalizeItemStatusForStorage,
  normalizeItemStatusForView,
  normalizeRequestStatusForView,
} from '../lib/statuses'

export type Scope = {
  tenantId: string | null
  organizationId: string | null
}

export function resolveScope(ctx: { auth?: { tenantId?: string | null; orgId?: string | null } | null; selectedOrganizationId?: string | null }): Scope {
  return {
    tenantId: ctx.auth?.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
  }
}

export function requireScope(ctx: { auth?: { tenantId?: string | null; orgId?: string | null } | null; selectedOrganizationId?: string | null }): Scope {
  const scope = resolveScope(ctx)
  if (!scope.tenantId || !scope.organizationId) {
    throw new CrudHttpError(400, { error: 'Missing tenant or organization scope' })
  }
  return scope
}

export function applyScopedInput<T extends Record<string, unknown>>(input: T, scope: Scope): T & Scope {
  return {
    ...input,
    tenantId: (input.tenantId as string | null | undefined) ?? scope.tenantId,
    organizationId: (input.organizationId as string | null | undefined) ?? scope.organizationId,
  }
}

export function buildRequestNumber(date = new Date()): string {
  const stamp = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('')
  const time = [
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0'),
    String(date.getUTCSeconds()).padStart(2, '0'),
  ].join('')
  return `PR-${stamp}-${time}`
}

export async function requireRequestInScope(em: EntityManager, scope: Scope, id: string): Promise<PurchasingRequest> {
  const record = await em.findOne(PurchasingRequest, {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<PurchasingRequest>)
  if (!record) throw new CrudHttpError(404, { error: 'Purchasing request not found' })
  return record
}

export async function requireRequestItemInScope(em: EntityManager, scope: Scope, id: string): Promise<PurchasingRequestItem> {
  const record = await em.findOne(PurchasingRequestItem, {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<PurchasingRequestItem>)
  if (!record) throw new CrudHttpError(404, { error: 'Purchasing request item not found' })
  return record
}

export async function recomputeRequestStatus(em: EntityManager, request: PurchasingRequest): Promise<string> {
  const items = await em.find(PurchasingRequestItem, {
    requestId: request.id,
    tenantId: request.tenantId ?? null,
    organizationId: request.organizationId ?? null,
    deletedAt: null,
  } as FilterQuery<PurchasingRequestItem>)
  request.requestStatus = deriveRequestStatusFromItems(
    items.map((item) => item.itemStatus),
    Boolean(request.purchasingOwnerUserId),
  )
  return request.requestStatus
}

export function requestIdentifiers(request: PurchasingRequest) {
  return {
    id: request.id,
    tenantId: request.tenantId ?? null,
    organizationId: request.organizationId ?? null,
  }
}

export function serializePurchasingRequestSnapshot(request: PurchasingRequest) {
  return {
    id: request.id,
    tenantId: request.tenantId ?? null,
    organizationId: request.organizationId ?? null,
    requestNumber: request.requestNumber,
    customerNip: request.customerNip ?? null,
    customerName: request.customerName ?? null,
    customerCompanyId: request.customerCompanyId ?? null,
    requestStatus: normalizeRequestStatusForView(request.requestStatus),
    salesOwnerUserId: request.salesOwnerUserId ?? null,
    purchasingOwnerUserId: request.purchasingOwnerUserId ?? null,
    customerOrderNumber: request.customerOrderNumber ?? null,
    requestText: request.requestText ?? null,
  }
}

export function serializePurchasingRequestItemSnapshot(item: PurchasingRequestItem) {
  return {
    id: item.id,
    tenantId: item.tenantId ?? null,
    organizationId: item.organizationId ?? null,
    requestId: item.requestId,
    catalogProductId: item.catalogProductId ?? null,
    sku: item.sku ?? null,
    referenceNumber: item.referenceNumber ?? null,
    productName: item.productName,
    quantity: item.quantity,
    itemStatus: normalizeItemStatusForView(item.itemStatus),
    deliveryDueAt: item.deliveryDueAt?.toISOString() ?? null,
    supplierOrderNumber: item.supplierOrderNumber ?? null,
    purchasingNote: item.purchasingNote ?? null,
  }
}

export async function softDeleteRequestChildren(em: EntityManager, requestId: string, scope: Scope) {
  const now = new Date()
  await em.nativeUpdate(
    PurchasingRequestItem,
    {
      requestId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<PurchasingRequestItem>,
    { deletedAt: now, updatedAt: now },
  )
}

export async function createRequestItemRecord(
  dataEngine: DataEngine,
  scope: Scope,
  requestId: string,
  lineNo: number,
  input: {
    catalogProductId?: string | null
    sku?: string | null
    referenceNumber?: string | null
    productName: string
    quantity: number
    itemStatus?: string
    deliveryDueAt?: string | null
    supplierOrderNumber?: string | null
    purchasingNote?: string | null
  },
): Promise<PurchasingRequestItem> {
  return await dataEngine.createOrmEntity({
    entity: PurchasingRequestItem,
    data: {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      requestId,
      lineNo,
      catalogProductId: input.catalogProductId ?? null,
      sku: input.sku ?? null,
      referenceNumber: input.referenceNumber ?? null,
      productName: input.productName,
      quantity: input.quantity,
      itemStatus: normalizeItemStatusForStorage(input.itemStatus ?? null),
      deliveryDueAt: input.deliveryDueAt ? new Date(input.deliveryDueAt) : null,
      supplierOrderNumber: input.supplierOrderNumber ?? null,
      purchasingNote: input.purchasingNote ?? null,
    },
  })
}

export async function deleteScopedAttachments(
  em: EntityManager,
  scope: Scope,
  entityId: string,
  recordIds: string[],
): Promise<void> {
  const scopedRecordIds = Array.from(
    new Set(recordIds.map((value) => value.trim()).filter((value) => value.length > 0)),
  )
  if (!scopedRecordIds.length) return

  const attachments = await em.find(Attachment, {
    entityId,
    recordId: { $in: scopedRecordIds },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  } as FilterQuery<Attachment>)

  if (!attachments.length) return

  for (const attachment of attachments) {
    await clearAttachmentThumbnailCache(attachment.partitionCode, attachment.id).catch(() => null)
    if (attachment.storagePath) {
      await deletePartitionFile(attachment.partitionCode, attachment.storagePath, attachment.storageDriver).catch(() => null)
    }
    em.remove(attachment)
  }
}
