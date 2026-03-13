import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { PurchasingComment, PurchasingRequest } from '../data/entities'
import {
  purchasingRequestCreateSchema,
  purchasingRequestDeleteSchema,
  purchasingRequestUpdateSchema,
} from '../data/validators'
import {
  applyScopedInput,
  buildRequestNumber,
  createRequestItemRecord,
  deleteScopedAttachments,
  requestIdentifiers,
  requireRequestInScope,
  requireScope,
  recomputeRequestStatus,
  resolveScope,
  softDeleteRequestChildren,
} from './shared'
import { normalizeRequestStatusForStorage } from '../lib/statuses'

const requestCrudEvents: CrudEventsConfig<PurchasingRequest> = {
  module: 'purchasing',
  entity: 'request',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

const requestCrudIndexer: CrudIndexerConfig<PurchasingRequest> = {
  entityType: E.purchasing.purchasing_request,
}

const createRequestCommand: CommandHandler<Record<string, unknown>, PurchasingRequest> = {
  id: 'purchasing.requests.create',
  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    const parsed = purchasingRequestCreateSchema.parse(applyScopedInput(rawInput, scope))
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const request = await dataEngine.createOrmEntity({
      entity: PurchasingRequest,
      data: {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        requestNumber: buildRequestNumber(),
        customerNip: parsed.customerNip ?? null,
        customerName: parsed.customerName ?? null,
        customerCompanyId: parsed.customerCompanyId ?? null,
        sourceChannel: parsed.sourceChannel,
        formVariant: parsed.formVariant,
        requestStatus: parsed.purchasingOwnerUserId ? 'assigned' : 'unassigned',
        salesOwnerUserId: parsed.salesOwnerUserId ?? (ctx.auth?.sub ?? null),
        purchasingOwnerUserId: parsed.purchasingOwnerUserId ?? null,
        customerOrderNumber: parsed.customerOrderNumber ?? null,
        requestText: parsed.requestText ?? null,
        attachmentsCount: 0,
      },
    })
    for (const [index, item] of parsed.items.entries()) {
      await createRequestItemRecord(dataEngine, scope, request.id, index + 1, item)
    }
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: request,
      identifiers: requestIdentifiers(request),
      events: requestCrudEvents,
      indexer: requestCrudIndexer,
    })
    return request
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('purchasing.audit.requests.create', 'Create purchasing request'),
      resourceKind: 'purchasing.request',
      resourceId: result.id,
      tenantId: result.tenantId ?? null,
      organizationId: result.organizationId ?? null,
    }
  },
}

const updateRequestCommand: CommandHandler<Record<string, unknown>, PurchasingRequest> = {
  id: 'purchasing.requests.update',
  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    const parsed = purchasingRequestUpdateSchema.parse(applyScopedInput(rawInput, scope))
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const request = await dataEngine.updateOrmEntity({
      entity: PurchasingRequest,
      where: {
        id: parsed.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as FilterQuery<PurchasingRequest>,
      apply: (entity) => {
        if (parsed.customerNip !== undefined) entity.customerNip = parsed.customerNip ?? null
        if (parsed.customerName !== undefined) entity.customerName = parsed.customerName ?? null
        if (parsed.customerCompanyId !== undefined) entity.customerCompanyId = parsed.customerCompanyId ?? null
        if (parsed.sourceChannel !== undefined) entity.sourceChannel = parsed.sourceChannel
        if (parsed.formVariant !== undefined) entity.formVariant = parsed.formVariant
        if (parsed.salesOwnerUserId !== undefined) entity.salesOwnerUserId = parsed.salesOwnerUserId ?? null
        if (parsed.purchasingOwnerUserId !== undefined) entity.purchasingOwnerUserId = parsed.purchasingOwnerUserId ?? null
        if (parsed.customerOrderNumber !== undefined) entity.customerOrderNumber = parsed.customerOrderNumber ?? null
        if (parsed.requestText !== undefined) entity.requestText = parsed.requestText ?? null
        if (parsed.requestStatus !== undefined) entity.requestStatus = normalizeRequestStatusForStorage(parsed.requestStatus)
        entity.updatedAt = new Date()
      },
    })
    if (!request) throw new CrudHttpError(404, { error: 'Purchasing request not found' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    if (parsed.requestStatus === undefined) {
      const scopedRequest = await requireRequestInScope(em, scope, request.id)
      await recomputeRequestStatus(em, scopedRequest)
      await em.flush()
    }
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: request,
      identifiers: requestIdentifiers(request),
      events: requestCrudEvents,
      indexer: requestCrudIndexer,
    })
    return request
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('purchasing.audit.requests.update', 'Update purchasing request'),
      resourceKind: 'purchasing.request',
      resourceId: result.id,
      tenantId: result.tenantId ?? null,
      organizationId: result.organizationId ?? null,
    }
  },
}

const deleteRequestCommand: CommandHandler<Record<string, unknown>, PurchasingRequest> = {
  id: 'purchasing.requests.delete',
  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    const parsed = purchasingRequestDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const request = await requireRequestInScope(em, scope, parsed.id)
    const requestComments = await em.find(
      PurchasingComment,
      {
        requestId: request.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as FilterQuery<PurchasingComment>,
      { fields: ['id'] },
    )
    const now = new Date()
    await deleteScopedAttachments(em, scope, E.purchasing.purchasing_request, [request.id])
    await deleteScopedAttachments(
      em,
      scope,
      E.purchasing.purchasing_comment,
      requestComments.map((comment) => comment.id),
    )
    request.deletedAt = now
    request.updatedAt = now
    await softDeleteRequestChildren(em, request.id, scope)
    await em.nativeUpdate(
      PurchasingComment,
      {
        requestId: request.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as FilterQuery<PurchasingComment>,
      { deletedAt: now, updatedAt: now },
    )
    await em.flush()
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: request,
      identifiers: requestIdentifiers(request),
      events: requestCrudEvents,
      indexer: requestCrudIndexer,
    })
    return request
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('purchasing.audit.requests.delete', 'Delete purchasing request'),
      resourceKind: 'purchasing.request',
      resourceId: result.id,
      tenantId: result.tenantId ?? null,
      organizationId: result.organizationId ?? null,
    }
  },
}

registerCommand(createRequestCommand)
registerCommand(updateRequestCommand)
registerCommand(deleteRequestCommand)
