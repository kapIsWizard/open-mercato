import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { E } from '@/.mercato/generated/entities.ids.generated'
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

const rawBodySchema = z.object({}).passthrough()
const deleteActionSchema = z.object({
  body: rawBodySchema.optional().default({}),
  query: z.object({
    id: z.string().uuid().optional(),
  }).passthrough(),
})

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['purchasing.comments.view'] },
  POST: { requireAuth: true, requireFeatures: ['purchasing.comments.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['purchasing.comments.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['purchasing.comments.manage'] },
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
  indexer: { entityType: E.purchasing.purchasing_comment },
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
})

export const { GET, POST, PUT, DELETE } = crud

const commentListItemSchema = z.object({
  id: z.string().uuid(),
  request_id: z.string().uuid(),
  request_item_id: z.string().uuid().nullable().optional(),
  body: z.string(),
  author_user_id: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
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
