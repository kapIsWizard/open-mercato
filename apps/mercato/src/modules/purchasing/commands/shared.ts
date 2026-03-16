import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { CustomerCompanyProfile, CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { clearAttachmentThumbnailCache } from '@open-mercato/core/modules/attachments/lib/thumbnailCache'
import { deletePartitionFile } from '@open-mercato/core/modules/attachments/lib/storage'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { normalizePolishTaxId } from '@open-mercato/shared/lib/pl/nip'
import { PurchasingRequest, PurchasingRequestItem } from '../data/entities'
import { createManualPurchasingCatalogProduct } from '../lib/catalogProducts'
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

type SyncedCustomerCompany = {
  customerCompanyId: string | null
  customerName: string | null
  customerNip: string | null
}

function isMissingCustomerTaxIdColumnError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('tax_id') && (message.includes('does not exist') || message.includes('column'))
}

function normalizeCustomerName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function compareCustomerNames(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizeCustomerName(left)?.toLocaleLowerCase() ?? null
  const normalizedRight = normalizeCustomerName(right)?.toLocaleLowerCase() ?? null
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

async function findCustomerCompanyById(
  em: EntityManager,
  scope: Scope,
  customerCompanyId: string,
): Promise<SyncedCustomerCompany | null> {
  const entity = await findWithDecryption(
    em,
    CustomerEntity,
    {
      id: customerCompanyId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      kind: 'company',
      deletedAt: null,
    } as FilterQuery<CustomerEntity>,
    { limit: 1 },
    scope,
  ).then((rows) => rows[0] ?? null)
  if (!entity) return null
  const profile = await findWithDecryption(
    em,
    CustomerCompanyProfile,
    {
      entity: entity.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<CustomerCompanyProfile>,
    { limit: 1 },
    scope,
  ).then((rows) => rows[0] ?? null)
  return {
    customerCompanyId: entity.id,
    customerName: entity.displayName ?? null,
    customerNip: profile?.taxId ?? null,
  }
}

async function findCustomerCompanyByTaxId(
  em: EntityManager,
  scope: Scope,
  customerNip: string,
): Promise<SyncedCustomerCompany | null> {
  const profile = await findWithDecryption(
    em,
    CustomerCompanyProfile,
    {
      taxId: customerNip,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<CustomerCompanyProfile>,
    { populate: ['entity'], limit: 1 },
    scope,
  ).then((rows) => rows[0] ?? null)
  if (!profile?.entity) return null
  const entity = typeof profile.entity === 'string'
    ? await findWithDecryption(
        em,
        CustomerEntity,
        {
          id: profile.entity,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          kind: 'company',
          deletedAt: null,
        } as FilterQuery<CustomerEntity>,
        { limit: 1 },
        scope,
      ).then((rows) => rows[0] ?? null)
    : profile.entity
  if (!entity || entity.deletedAt) return null
  return {
    customerCompanyId: entity.id,
    customerName: entity.displayName ?? null,
    customerNip: profile.taxId ?? null,
  }
}

async function findCustomerCompanyByName(
  em: EntityManager,
  scope: Scope,
  customerName: string,
): Promise<SyncedCustomerCompany | null> {
  const entity = await findWithDecryption(
    em,
    CustomerEntity,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      kind: 'company',
      deletedAt: null,
      displayName: { $ilike: escapeLikePattern(customerName) } as never,
    } as FilterQuery<CustomerEntity>,
    { limit: 1 },
    scope,
  ).then((rows) => rows[0] ?? null)
  if (!entity) return null
  const profile = await findWithDecryption(
    em,
    CustomerCompanyProfile,
    {
      entity: entity.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<CustomerCompanyProfile>,
    { limit: 1 },
    scope,
  ).then((rows) => rows[0] ?? null)
  return {
    customerCompanyId: entity.id,
    customerName: entity.displayName ?? null,
    customerNip: profile?.taxId ?? null,
  }
}

export async function resolveOrCreateCustomerCompany(
  ctx: CommandRuntimeContext,
  scope: Scope,
  input: {
    customerCompanyId?: string | null
    customerName?: string | null
    customerNip?: string | null
  },
): Promise<SyncedCustomerCompany> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const customerCompanyId = typeof input.customerCompanyId === 'string' && input.customerCompanyId.trim().length
    ? input.customerCompanyId.trim()
    : null
  const customerName = normalizeCustomerName(input.customerName)
  const customerNip = normalizePolishTaxId(input.customerNip)

  if (customerCompanyId) {
    const existing = await findCustomerCompanyById(em, scope, customerCompanyId)
    if (existing) return existing
  }

  if (customerNip) {
    try {
      const existingByTaxId = await findCustomerCompanyByTaxId(em, scope, customerNip)
      if (existingByTaxId && (!customerName || compareCustomerNames(existingByTaxId.customerName, customerName))) {
        return existingByTaxId
      }
    } catch (error) {
      if (!isMissingCustomerTaxIdColumnError(error)) throw error
    }
  }

  if (customerName) {
    const existingByName = await findCustomerCompanyByName(em, scope, customerName)
    if (existingByName && (!customerNip || existingByName.customerNip === customerNip)) {
      return existingByName
    }
  }

  if (!customerName && !customerNip) {
    return {
      customerCompanyId: null,
      customerName: null,
      customerNip: null,
    }
  }

  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  let result: { id?: string | null; entityId?: string | null } | null = null
  try {
    const executed = await commandBus.execute<
      Record<string, unknown>,
      { id?: string | null; entityId?: string | null }
    >('customers.companies.create', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        displayName: customerName ?? customerNip ?? 'Customer',
        legalName: customerName ?? undefined,
        taxId: customerNip ?? undefined,
      },
      ctx,
    })
    result = executed.result
  } catch (error) {
    if (!isMissingCustomerTaxIdColumnError(error)) throw error
    const executed = await commandBus.execute<
      Record<string, unknown>,
      { id?: string | null; entityId?: string | null }
    >('customers.companies.create', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        displayName: customerName ?? customerNip ?? 'Customer',
        legalName: customerName ?? undefined,
      },
      ctx,
    })
    result = executed.result
  }
  const createdCompanyId =
    typeof result?.id === 'string' && result.id.length > 0
      ? result.id
      : (typeof result?.entityId === 'string' && result.entityId.length > 0 ? result.entityId : null)

  return {
    customerCompanyId: createdCompanyId,
    customerName: customerName ?? customerNip ?? null,
    customerNip: customerNip ?? null,
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
  em: EntityManager,
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
  let catalogProductId = input.catalogProductId ?? null
  if (!catalogProductId) {
    const manualProduct = await createManualPurchasingCatalogProduct(em, {
      tenantId: String(scope.tenantId),
      organizationId: String(scope.organizationId),
    }, {
      productName: input.productName,
      sku: input.sku ?? null,
      referenceNumber: input.referenceNumber ?? null,
    })
    catalogProductId = manualProduct.id
  }
  return await dataEngine.createOrmEntity({
    entity: PurchasingRequestItem,
    data: {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      requestId,
      lineNo,
      catalogProductId,
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
