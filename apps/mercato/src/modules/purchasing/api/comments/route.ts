import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { PurchasingComment } from '../../data/entities'
import {
  purchasingCommentCreateSchema,
  purchasingCommentDeleteSchema,
  purchasingCommentListSchema,
  purchasingCommentUpdateSchema,
} from '../../data/validators'
import {
  createPurchasingCrudOpenApi,
  createPurchasingPagedListResponseSchema,
  purchasingOkSchema,
} from '../../openapi'
import { guardPurchasingAccess } from '../../lib/apiAccess'
import { canAccessPurchasingModule, canManagePurchasingComments } from '../../lib/roleAccess'

const rawBodySchema = z.object({}).passthrough()
const deleteActionSchema = z.object({
  body: rawBodySchema.optional().default({}),
  query: z.object({
    id: z.string().uuid().optional(),
  }).passthrough(),
})

const routeMetadata = {
  GET: { requireAuth: true },
  POST: { requireAuth: true },
  PUT: { requireAuth: true },
  DELETE: { requireAuth: true },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: PurchasingComment,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: purchasingCommentListSchema,
    entityId: E.purchasing.purchasing_comment,
    fields: [
      'id',
      'request_id',
      'request_item_id',
      'body',
      'author_user_id',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: z.infer<typeof purchasingCommentListSchema>) => {
      const filters: Record<string, unknown> = {}
      if (query.requestId) filters.request_id = { $eq: query.requestId }
      if (query.requestItemId) filters.request_item_id = { $eq: query.requestItemId }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'purchasing.comments.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'purchasing.comments.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'purchasing.comments.delete',
      schema: deleteActionSchema,
      mapInput: ({ parsed }) => ({
        id: parsed.body.id ?? parsed.query.id,
      }),
      response: () => ({ ok: true }),
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items = Array.isArray(payload.items) ? payload.items : []
      if (!items.length) return
      const authorIds = Array.from(
        new Set(
          items
            .map((item: unknown) => {
              if (!item || typeof item !== 'object') return null
              const record = item as Record<string, unknown>
              if (typeof record.author_user_id === 'string' && record.author_user_id.trim().length > 0) return record.author_user_id
              if (typeof record.authorUserId === 'string' && record.authorUserId.trim().length > 0) return record.authorUserId
              return null
            })
            .filter((value: string | null): value is string => Boolean(value)),
        ),
      )
      if (!authorIds.length) return
      const em = ctx.container.resolve('em') as EntityManager
      const users = await em.find(User, { id: { $in: authorIds as string[] } })
      const commentIds = items
        .map((item: unknown) => {
          if (!item || typeof item !== 'object') return null
          const record = item as Record<string, unknown>
          if (typeof record.id === 'string' && record.id.trim().length > 0) return record.id
          return null
        })
        .filter((value: string | null): value is string => Boolean(value))
      const userMap = new Map(
        users.map((user) => [
          user.id,
          {
            name: user.name ?? null,
            email: user.email ?? null,
          },
        ]),
      )
      const attachments = commentIds.length > 0
        ? await em.find(Attachment, {
            entityId: E.purchasing.purchasing_comment,
            recordId: { $in: commentIds },
            tenantId: ctx.auth?.tenantId ?? null,
            organizationId: ctx.auth?.orgId ?? null,
          })
        : []
      const attachmentsByCommentId = new Map<string, Array<{
        id: string
        fileName: string
        mimeType: string | null
        url: string
        createdAt: string
      }>>()
      for (const attachment of attachments) {
        const current = attachmentsByCommentId.get(attachment.recordId) ?? []
        current.push({
          id: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType ?? null,
          url: attachment.url,
          createdAt: attachment.createdAt.toISOString(),
        })
        attachmentsByCommentId.set(attachment.recordId, current)
      }
      items.forEach((item: unknown) => {
        if (!item || typeof item !== 'object') return
        const record = item as Record<string, unknown>
        const authorId =
          typeof record.author_user_id === 'string'
            ? record.author_user_id
            : typeof record.authorUserId === 'string'
              ? record.authorUserId
              : null
        if (!authorId) return
        const author = userMap.get(authorId)
        record.author_name = author?.name ?? null
        record.author_email = author?.email ?? null
        record.authorName = author?.name ?? null
        record.authorEmail = author?.email ?? null
        const commentId = typeof record.id === 'string' ? record.id : null
        const commentAttachments = commentId ? attachmentsByCommentId.get(commentId) ?? [] : []
        record.attachments = commentAttachments
      })
    },
  },
})

const { GET: crudGET, POST: crudPOST, PUT: crudPUT, DELETE: crudDELETE } = crud

export async function GET(request: Request) {
  const denied = await guardPurchasingAccess(request, canAccessPurchasingModule)
  if (denied) return denied
  return crudGET(request)
}

export async function POST(request: Request) {
  const denied = await guardPurchasingAccess(request, canManagePurchasingComments)
  if (denied) return denied
  return crudPOST(request)
}

export async function PUT(request: Request) {
  const denied = await guardPurchasingAccess(request, canManagePurchasingComments)
  if (denied) return denied
  return crudPUT(request)
}

export async function DELETE(request: Request) {
  const denied = await guardPurchasingAccess(request, canManagePurchasingComments)
  if (denied) return denied
  return crudDELETE(request)
}

const commentListItemSchema = z.object({
  id: z.string().uuid(),
  request_id: z.string().uuid(),
  request_item_id: z.string().uuid().nullable().optional(),
  body: z.string(),
  author_user_id: z.string().nullable().optional(),
  author_name: z.string().nullable().optional(),
  author_email: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  attachments: z.array(z.object({
    id: z.string().uuid(),
    fileName: z.string(),
    mimeType: z.string().nullable().optional(),
    url: z.string(),
    createdAt: z.string(),
  })).optional(),
}).passthrough()

export const openApi = createPurchasingCrudOpenApi({
  resourceName: 'Purchasing Comment',
  pluralName: 'Purchasing Comments',
  querySchema: purchasingCommentListSchema,
  listResponseSchema: createPurchasingPagedListResponseSchema(commentListItemSchema),
  create: {
    schema: purchasingCommentCreateSchema,
    description: 'Adds a comment to a purchasing request or request item.',
  },
  update: {
    schema: purchasingCommentUpdateSchema,
    responseSchema: purchasingOkSchema,
    description: 'Updates an existing purchasing comment.',
  },
  del: {
    schema: purchasingCommentDeleteSchema,
    responseSchema: purchasingOkSchema,
    description: 'Soft-deletes a purchasing comment.',
  },
})
