/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { PurchasingRequest, PurchasingRequestItem } from '../../data/entities'
import {
  purchasingRequestCreateSchema,
  purchasingRequestDeleteSchema,
  purchasingRequestListSchema,
  purchasingRequestUpdateSchema,
} from '../../data/validators'
import {
  createPurchasingCrudOpenApi,
  createPurchasingPagedListResponseSchema,
  purchasingOkSchema,
} from '../../openapi'
import { isOpenItemStatus, resolveItemStatusFilterValues, resolveRequestStatusFilterValues } from '../../lib/statuses'

const rawBodySchema = z.object({}).passthrough()
const deleteActionSchema = z.object({
  body: rawBodySchema.optional().default({}),
  query: z.object({
    id: z.string().uuid().optional(),
  }).passthrough(),
})

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['purchasing.requests.view'] },
  POST: { requireAuth: true, requireFeatures: ['purchasing.requests.create'] },
  PUT: { requireAuth: true, requireFeatures: ['purchasing.requests.update'] },
  DELETE: { requireAuth: true, requireFeatures: ['purchasing.requests.update'] },
}

export const metadata = routeMetadata

const NO_MATCH_UUID = '00000000-0000-0000-0000-000000000000'

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: PurchasingRequest,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.purchasing.purchasing_request },
  list: {
    schema: purchasingRequestListSchema,
    entityId: E.purchasing.purchasing_request,
    fields: [
      'id',
      'request_number',
      'customer_nip',
      'customer_name',
      'customer_company_id',
      'source_channel',
      'form_variant',
      'request_status',
      'sales_owner_user_id',
      'purchasing_owner_user_id',
      'customer_order_number',
      'request_text',
      'attachments_count',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      requestNumber: 'request_number',
      customerName: 'customer_name',
      requestStatus: 'request_status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: z.infer<typeof purchasingRequestListSchema>, ctx) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.requestStatus) {
        const statuses = resolveRequestStatusFilterValues(query.requestStatus)
        filters.request_status = statuses.length > 1 ? { $in: statuses } : { $eq: statuses[0] }
      }
      if (query.customerNip) filters.customer_nip = { $ilike: `%${escapeLikePattern(query.customerNip)}%` }
      if (query.purchasingOwnerUserId) filters.purchasing_owner_user_id = { $eq: query.purchasingOwnerUserId }
      if (query.salesOwnerUserId) filters.sales_owner_user_id = { $eq: query.salesOwnerUserId }
      if (query.search) {
        const like = `%${escapeLikePattern(query.search)}%`
        const em = (ctx.container.resolve('em') as EntityManager).fork()
        const searchItemMatches = await em.find(PurchasingRequestItem, {
          tenantId: ctx.auth?.tenantId ?? null,
          organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
          deletedAt: null,
          $or: [
            { sku: { $ilike: like } },
            { referenceNumber: { $ilike: like } },
            { productName: { $ilike: like } },
            { purchasingNote: { $ilike: like } },
          ],
        } as any, { fields: ['requestId'] })
        const searchRequestIds = Array.from(new Set(searchItemMatches.map((item) => item.requestId)))
        filters.$or = [
          { request_number: { $ilike: like } },
          { customer_name: { $ilike: like } },
          { customer_nip: { $ilike: like } },
          { request_text: { $ilike: like } },
          ...(searchRequestIds.length > 0 ? [{ id: { $in: searchRequestIds } }] : []),
        ]
      }
      if (query.createdFrom || query.createdTo) {
        const range: Record<string, Date> = {}
        if (query.createdFrom) {
          const date = new Date(query.createdFrom)
          if (!Number.isNaN(date.getTime())) range.$gte = date
        }
        if (query.createdTo) {
          const date = new Date(query.createdTo)
          if (!Number.isNaN(date.getTime())) range.$lte = date
        }
        if (Object.keys(range).length) filters.created_at = range
      }
      if (query.itemStatus || query.sku || query.referenceNumber) {
        const em = (ctx.container.resolve('em') as EntityManager).fork()
        const itemWhere: Record<string, unknown> = {
          tenantId: ctx.auth?.tenantId ?? null,
          organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
          deletedAt: null,
        }
        if (query.itemStatus) {
          const itemStatuses = resolveItemStatusFilterValues(query.itemStatus)
          itemWhere.itemStatus = itemStatuses.length > 1 ? { $in: itemStatuses } : itemStatuses[0]
        }
        if (query.sku) itemWhere.sku = { $ilike: `%${escapeLikePattern(query.sku)}%` }
        if (query.referenceNumber) itemWhere.referenceNumber = { $ilike: `%${escapeLikePattern(query.referenceNumber)}%` }
        const items = await em.find(PurchasingRequestItem, itemWhere as any, { fields: ['requestId'] })
        const requestIds = Array.from(new Set(items.map((item) => item.requestId)))
        filters.id = { $in: requestIds.length > 0 ? requestIds : [NO_MATCH_UUID] }
      }
      return filters
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items = Array.isArray(payload.items) ? payload.items as Array<Record<string, unknown>> : []
      if (!items.length) return
      const ids = items.map((item) => String(item.id)).filter(Boolean)
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const requestItems = await em.find(PurchasingRequestItem, {
        requestId: { $in: ids },
        tenantId: ctx.auth?.tenantId ?? null,
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
        deletedAt: null,
      } as any)
      const summary = new Map<string, { itemsCount: number; openItemsCount: number }>()
      const requestAttachments = await em.find(Attachment, {
        entityId: E.purchasing.purchasing_request,
        recordId: { $in: ids },
        tenantId: ctx.auth?.tenantId ?? null,
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      } as any, { fields: ['recordId'] })
      const attachmentCounts = new Map<string, number>()
      for (const item of requestItems) {
        const entry = summary.get(item.requestId) ?? { itemsCount: 0, openItemsCount: 0 }
        entry.itemsCount += 1
        if (isOpenItemStatus(item.itemStatus)) entry.openItemsCount += 1
        summary.set(item.requestId, entry)
      }
      for (const attachment of requestAttachments) {
        const current = attachmentCounts.get(attachment.recordId) ?? 0
        attachmentCounts.set(attachment.recordId, current + 1)
      }
      for (const item of items) {
        const entry = summary.get(String(item.id))
        item.itemsCount = entry?.itemsCount ?? 0
        item.openItemsCount = entry?.openItemsCount ?? 0
        const attachmentsCount = attachmentCounts.get(String(item.id)) ?? 0
        item.attachmentsCount = attachmentsCount
        item.attachments_count = attachmentsCount
      }
    },
  },
  actions: {
    create: {
      commandId: 'purchasing.requests.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'purchasing.requests.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'purchasing.requests.delete',
      schema: deleteActionSchema,
      mapInput: ({ parsed }) => ({
        id: parsed.body.id ?? parsed.query.id,
      }),
      response: () => ({ ok: true }),
    },
  },
})

export const { GET, POST, PUT, DELETE } = crud

const requestListItemSchema = z.object({
  id: z.string().uuid(),
  request_number: z.string(),
  customer_nip: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  request_status: z.string(),
  sales_owner_user_id: z.string().nullable().optional(),
  purchasing_owner_user_id: z.string().nullable().optional(),
  customer_order_number: z.string().nullable().optional(),
  request_text: z.string().nullable().optional(),
  attachments_count: z.number().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough()

export const openApi = createPurchasingCrudOpenApi({
  resourceName: 'Purchasing Request',
  pluralName: 'Purchasing Requests',
  querySchema: purchasingRequestListSchema,
  listResponseSchema: createPurchasingPagedListResponseSchema(requestListItemSchema),
  create: {
    schema: purchasingRequestCreateSchema,
    description: 'Creates a purchasing request together with its initial request items.',
  },
  update: {
    schema: purchasingRequestUpdateSchema,
    responseSchema: purchasingOkSchema,
    description: 'Updates purchasing request metadata and assignment.',
  },
  del: {
    schema: purchasingRequestDeleteSchema,
    responseSchema: purchasingOkSchema,
    description: 'Soft-deletes a purchasing request.',
  },
})
