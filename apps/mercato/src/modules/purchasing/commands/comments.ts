import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { PurchasingComment } from '../data/entities'
import {
  purchasingCommentCreateSchema,
  purchasingCommentDeleteSchema,
  purchasingCommentUpdateSchema,
} from '../data/validators'
import {
  applyScopedInput,
  deleteScopedAttachments,
  requireRequestInScope,
  requireRequestItemInScope,
  requireScope,
} from './shared'

function serializePurchasingCommentSnapshot(comment: PurchasingComment) {
  return {
    id: comment.id,
    tenantId: comment.tenantId ?? null,
    organizationId: comment.organizationId ?? null,
    requestId: comment.requestId,
    requestItemId: comment.requestItemId ?? null,
    body: comment.body,
    authorUserId: comment.authorUserId ?? null,
  }
}

function canMutateComment(comment: PurchasingComment, ctx: { auth?: { sub?: string | null; roles?: string[] | null } | null }) {
  const currentUserId = typeof ctx.auth?.sub === 'string' ? ctx.auth.sub : null
  const roleNames = Array.isArray(ctx.auth?.roles)
    ? ctx.auth.roles.filter((role): role is string => typeof role === 'string' && role.trim().length > 0)
    : []
  if (roleNames.includes('admin') || roleNames.includes('superadmin')) return true
  return Boolean(currentUserId && comment.authorUserId && comment.authorUserId === currentUserId)
}

const commentCrudEvents: CrudEventsConfig<PurchasingComment> = {
  module: 'purchasing',
  entity: 'comment',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

const commentCrudIndexer: CrudIndexerConfig<PurchasingComment> = {
  entityType: E.purchasing.purchasing_comment,
}

const createCommentCommand: CommandHandler<Record<string, unknown>, PurchasingComment> = {
  id: 'purchasing.comments.create',
  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    const parsed = purchasingCommentCreateSchema.parse(applyScopedInput(rawInput, scope))
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await requireRequestInScope(em, scope, parsed.requestId)
    if (parsed.requestItemId) {
      const item = await requireRequestItemInScope(em, scope, parsed.requestItemId)
      if (item.requestId !== parsed.requestId) {
        throw new CrudHttpError(400, { error: 'Comment item does not belong to the request' })
      }
    }
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const comment = await dataEngine.createOrmEntity({
      entity: PurchasingComment,
      data: {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        requestId: parsed.requestId,
        requestItemId: parsed.requestItemId ?? null,
        body: parsed.body,
        authorUserId: parsed.authorUserId ?? (ctx.auth?.sub ?? null),
      },
    })
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: comment,
      identifiers: {
        id: comment.id,
        tenantId: comment.tenantId ?? null,
        organizationId: comment.organizationId ?? null,
      },
      events: commentCrudEvents,
      indexer: commentCrudIndexer,
    })
    return comment
  },
  captureAfter: async (_input, result) => serializePurchasingCommentSnapshot(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('purchasing.audit.comments.create', 'Create purchasing comment'),
      resourceKind: 'purchasing.comment',
      resourceId: result.id,
      parentResourceKind: 'purchasing.request',
      parentResourceId: result.requestId,
      tenantId: result.tenantId ?? null,
      organizationId: result.organizationId ?? null,
      snapshotAfter: serializePurchasingCommentSnapshot(result),
    }
  },
}

const updateCommentCommand: CommandHandler<Record<string, unknown>, PurchasingComment> = {
  id: 'purchasing.comments.update',
  async prepare(rawInput, ctx) {
    const scope = requireScope(ctx)
    const parsed = purchasingCommentUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const comment = await em.findOne(PurchasingComment, {
      id: parsed.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<PurchasingComment>)
    if (!comment) throw new CrudHttpError(404, { error: 'Purchasing comment not found' })
    if (!canMutateComment(comment, ctx)) throw new CrudHttpError(403, { error: 'You can only edit your own comments' })
    return {
      before: serializePurchasingCommentSnapshot(comment),
    }
  },
  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    const parsed = purchasingCommentUpdateSchema.parse(rawInput)
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const comment = await dataEngine.updateOrmEntity({
      entity: PurchasingComment,
      where: {
        id: parsed.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as FilterQuery<PurchasingComment>,
      apply: (entity) => {
        if (parsed.body !== undefined) entity.body = parsed.body
        if (parsed.requestItemId !== undefined) entity.requestItemId = parsed.requestItemId ?? null
        entity.updatedAt = new Date()
      },
    })
    if (!comment) throw new CrudHttpError(404, { error: 'Purchasing comment not found' })
    if (!canMutateComment(comment, ctx)) throw new CrudHttpError(403, { error: 'You can only edit your own comments' })
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: comment,
      identifiers: {
        id: comment.id,
        tenantId: comment.tenantId ?? null,
        organizationId: comment.organizationId ?? null,
      },
      events: commentCrudEvents,
      indexer: commentCrudIndexer,
    })
    return comment
  },
  captureAfter: async (_input, result) => serializePurchasingCommentSnapshot(result),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('purchasing.audit.comments.update', 'Update purchasing comment'),
      resourceKind: 'purchasing.comment',
      resourceId: result.id,
      parentResourceKind: 'purchasing.request',
      parentResourceId: result.requestId,
      tenantId: result.tenantId ?? null,
      organizationId: result.organizationId ?? null,
      snapshotBefore: snapshots.before ?? null,
      snapshotAfter: snapshots.after ?? serializePurchasingCommentSnapshot(result),
    }
  },
}

const deleteCommentCommand: CommandHandler<Record<string, unknown>, PurchasingComment> = {
  id: 'purchasing.comments.delete',
  async prepare(rawInput, ctx) {
    const scope = requireScope(ctx)
    const parsed = purchasingCommentDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const comment = await em.findOne(PurchasingComment, {
      id: parsed.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<PurchasingComment>)
    if (!comment) throw new CrudHttpError(404, { error: 'Purchasing comment not found' })
    if (!canMutateComment(comment, ctx)) throw new CrudHttpError(403, { error: 'You can only edit your own comments' })
    return {
      before: serializePurchasingCommentSnapshot(comment),
    }
  },
  async execute(rawInput, ctx) {
    const scope = requireScope(ctx)
    const parsed = purchasingCommentDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const comment = await em.findOne(PurchasingComment, {
      id: parsed.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<PurchasingComment>)
    if (!comment) throw new CrudHttpError(404, { error: 'Purchasing comment not found' })
    if (!canMutateComment(comment, ctx)) throw new CrudHttpError(403, { error: 'You can only edit your own comments' })
    await deleteScopedAttachments(em, scope, E.purchasing.purchasing_comment, [comment.id])
    comment.deletedAt = new Date()
    comment.updatedAt = new Date()
    await em.flush()
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: comment,
      identifiers: {
        id: comment.id,
        tenantId: comment.tenantId ?? null,
        organizationId: comment.organizationId ?? null,
      },
      events: commentCrudEvents,
      indexer: commentCrudIndexer,
    })
    return comment
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('purchasing.audit.comments.delete', 'Delete purchasing comment'),
      resourceKind: 'purchasing.comment',
      resourceId: result.id,
      parentResourceKind: 'purchasing.request',
      parentResourceId: result.requestId,
      tenantId: result.tenantId ?? null,
      organizationId: result.organizationId ?? null,
      snapshotBefore: snapshots.before ?? null,
    }
  },
}

registerCommand(createCommentCommand)
registerCommand(updateCommentCommand)
registerCommand(deleteCommentCommand)
