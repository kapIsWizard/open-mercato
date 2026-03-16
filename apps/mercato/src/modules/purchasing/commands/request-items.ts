import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { PurchasingRequestItem } from '../data/entities'
import {
  purchasingRequestItemCreateSchema,
  purchasingRequestItemDeleteSchema,
  purchasingRequestItemUpdateSchema,
} from '../data/validators'
import {
  applyScopedInput,
  createRequestItemRecord,
  recomputeRequestStatus,
  requireRequestInScope,
  requireRequestItemInScope,
  requireScope,
  serializePurchasingRequestItemSnapshot,
} from './shared'
import { normalizeItemStatusForStorage, normalizeItemStatusForView } from '../lib/statuses'

const itemCrudEvents: CrudEventsConfig<PurchasingRequestItem> = {
  module: 'purchasing',
  entity: 'request_item',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

const itemCrudIndexer: CrudIndexerConfig<PurchasingRequestItem> = {
  entityType: E.purchasing.purchasing_request_item,
}

const createItemCommand: CommandHandler<Record<string, unknown>, PurchasingRequestItem> = {
  id: 'purchasing.request-items.create',
  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    const parsed = purchasingRequestItemCreateSchema.parse(applyScopedInput(rawInput, scope))
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await requireRequestInScope(em, scope, parsed.requestId)
    const lineNo = await em.count(PurchasingRequestItem, {
      requestId: parsed.requestId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    }) + 1
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const item = await createRequestItemRecord(dataEngine, em, scope, parsed.requestId, lineNo, parsed)
    await recomputeRequestStatus(em, request)
    await em.flush()
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: item,
      identifiers: {
        id: item.id,
        tenantId: item.tenantId ?? null,
        organizationId: item.organizationId ?? null,
      },
      events: itemCrudEvents,
      indexer: itemCrudIndexer,
    })
    return item
  },
  captureAfter: async (_input, result) => serializePurchasingRequestItemSnapshot(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('purchasing.audit.items.create', 'Create purchasing request item'),
      resourceKind: 'purchasing.request_item',
      resourceId: result.id,
      parentResourceKind: 'purchasing.request',
      parentResourceId: result.requestId,
      tenantId: result.tenantId ?? null,
      organizationId: result.organizationId ?? null,
      snapshotAfter: serializePurchasingRequestItemSnapshot(result),
    }
  },
}

const updateItemCommand: CommandHandler<Record<string, unknown>, PurchasingRequestItem> = {
  id: 'purchasing.request-items.update',
  async prepare(rawInput, ctx) {
    const scope = requireScope(ctx)
    const parsed = purchasingRequestItemUpdateSchema.parse(applyScopedInput(rawInput, scope))
    const em = (ctx.container.resolve('em') as EntityManager)
    const item = await requireRequestItemInScope(em, scope, parsed.id)
    return {
      before: serializePurchasingRequestItemSnapshot(item),
    }
  },
  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    const parsed = purchasingRequestItemUpdateSchema.parse(applyScopedInput(rawInput, scope))
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const previous = await requireRequestItemInScope(em, scope, parsed.id)
    const previousStatus = previous.itemStatus
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const item = await dataEngine.updateOrmEntity({
      entity: PurchasingRequestItem,
      where: {
        id: parsed.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as FilterQuery<PurchasingRequestItem>,
      apply: (entity) => {
        if (parsed.catalogProductId !== undefined) entity.catalogProductId = parsed.catalogProductId ?? null
        if (parsed.sku !== undefined) entity.sku = parsed.sku ?? null
        if (parsed.referenceNumber !== undefined) entity.referenceNumber = parsed.referenceNumber ?? null
        if (parsed.productName !== undefined) entity.productName = parsed.productName
        if (parsed.quantity !== undefined) entity.quantity = parsed.quantity
        if (parsed.itemStatus !== undefined) entity.itemStatus = normalizeItemStatusForStorage(parsed.itemStatus)
        if (parsed.deliveryDueAt !== undefined) entity.deliveryDueAt = parsed.deliveryDueAt ? new Date(parsed.deliveryDueAt) : null
        if (parsed.supplierOrderNumber !== undefined) entity.supplierOrderNumber = parsed.supplierOrderNumber ?? null
        if (parsed.purchasingNote !== undefined) entity.purchasingNote = parsed.purchasingNote ?? null
        entity.updatedAt = new Date()
      },
    })
    if (!item) throw new CrudHttpError(404, { error: 'Purchasing request item not found' })
    const request = await requireRequestInScope(em, scope, item.requestId)
    await recomputeRequestStatus(em, request)
    await em.flush()
    if (parsed.itemStatus !== undefined && parsed.itemStatus !== previousStatus) {
      try {
        const eventBus = ctx.container.resolve('eventBus') as { emitEvent?: (eventId: string, payload: Record<string, unknown>, options?: { persistent?: boolean }) => Promise<void> }
        await eventBus?.emitEvent?.('purchasing.request_item.status_changed', {
          id: item.id,
          requestItemId: item.id,
          requestId: item.requestId,
          previousStatus,
          status: normalizeItemStatusForView(item.itemStatus),
          sku: item.sku ?? null,
          referenceNumber: item.referenceNumber ?? null,
          productName: item.productName,
          tenantId: item.tenantId ?? null,
          organizationId: item.organizationId ?? null,
        }, { persistent: true })
      } catch (error) {
        console.error('[purchasing.request-items.update] failed to emit status change event', error)
      }
    }
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: item,
      identifiers: {
        id: item.id,
        tenantId: item.tenantId ?? null,
        organizationId: item.organizationId ?? null,
      },
      events: itemCrudEvents,
      indexer: itemCrudIndexer,
    })
    return item
  },
  captureAfter: async (_input, result) => serializePurchasingRequestItemSnapshot(result),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('purchasing.audit.items.update', 'Update purchasing request item'),
      resourceKind: 'purchasing.request_item',
      resourceId: result.id,
      parentResourceKind: 'purchasing.request',
      parentResourceId: result.requestId,
      tenantId: result.tenantId ?? null,
      organizationId: result.organizationId ?? null,
      snapshotBefore: snapshots.before ?? null,
      snapshotAfter: snapshots.after ?? serializePurchasingRequestItemSnapshot(result),
    }
  },
}

const deleteItemCommand: CommandHandler<Record<string, unknown>, PurchasingRequestItem> = {
  id: 'purchasing.request-items.delete',
  async prepare(rawInput, ctx) {
    const scope = requireScope(ctx)
    const parsed = purchasingRequestItemDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const item = await requireRequestItemInScope(em, scope, parsed.id)
    return {
      before: serializePurchasingRequestItemSnapshot(item),
    }
  },
  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    const parsed = purchasingRequestItemDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const item = await requireRequestItemInScope(em, scope, parsed.id)
    item.deletedAt = new Date()
    item.updatedAt = new Date()
    const request = await requireRequestInScope(em, scope, item.requestId)
    await recomputeRequestStatus(em, request)
    await em.flush()
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: item,
      identifiers: {
        id: item.id,
        tenantId: item.tenantId ?? null,
        organizationId: item.organizationId ?? null,
      },
      events: itemCrudEvents,
      indexer: itemCrudIndexer,
    })
    return item
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('purchasing.audit.items.delete', 'Delete purchasing request item'),
      resourceKind: 'purchasing.request_item',
      resourceId: result.id,
      parentResourceKind: 'purchasing.request',
      parentResourceId: result.requestId,
      tenantId: result.tenantId ?? null,
      organizationId: result.organizationId ?? null,
      snapshotBefore: snapshots.before ?? null,
    }
  },
}

registerCommand(createItemCommand)
registerCommand(updateItemCommand)
registerCommand(deleteItemCommand)
