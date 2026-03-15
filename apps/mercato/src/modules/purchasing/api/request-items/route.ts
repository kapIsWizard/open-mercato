import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { PurchasingRequestItem } from '../../data/entities'
import {
  purchasingRequestItemCreateSchema,
  purchasingRequestItemDeleteSchema,
  purchasingRequestItemListSchema,
  purchasingRequestItemUpdateSchema,
} from '../../data/validators'
import { resolveItemStatusFilterValues } from '../../lib/statuses'
import {
  createPurchasingCrudOpenApi,
  createPurchasingPagedListResponseSchema,
  purchasingOkSchema,
} from '../../openapi'
import { guardPurchasingAccess } from '../../lib/apiAccess'
import { canAccessPurchasingModule, canManagePurchasingItems } from '../../lib/roleAccess'

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
    entity: PurchasingRequestItem,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.purchasing.purchasing_request_item },
  list: {
    schema: purchasingRequestItemListSchema,
    entityId: E.purchasing.purchasing_request_item,
    fields: [
      'id',
      'request_id',
      'line_no',
      'catalog_product_id',
      'sku',
      'reference_number',
      'product_name',
      'quantity',
      'item_status',
      'delivery_due_at',
      'supplier_order_number',
      'purchasing_note',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      lineNo: 'line_no',
      referenceNumber: 'reference_number',
      productName: 'product_name',
      itemStatus: 'item_status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: z.infer<typeof purchasingRequestItemListSchema>) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.requestId) filters.request_id = { $eq: query.requestId }
      if (query.itemStatus) {
        const statuses = resolveItemStatusFilterValues(query.itemStatus)
        filters.item_status = statuses.length > 1 ? { $in: statuses } : { $eq: statuses[0] }
      }
      if (query.sku) filters.sku = { $ilike: `%${escapeLikePattern(query.sku)}%` }
      if (query.referenceNumber) filters.reference_number = { $ilike: `%${escapeLikePattern(query.referenceNumber)}%` }
      if (query.search) {
        const like = `%${escapeLikePattern(query.search)}%`
        filters.$or = [
          { sku: { $ilike: like } },
          { reference_number: { $ilike: like } },
          { product_name: { $ilike: like } },
          { purchasing_note: { $ilike: like } },
        ]
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'purchasing.request-items.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'purchasing.request-items.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'purchasing.request-items.delete',
      schema: deleteActionSchema,
      mapInput: ({ parsed }) => ({
        id: parsed.body.id ?? parsed.query.id,
      }),
      response: () => ({ ok: true }),
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
  const denied = await guardPurchasingAccess(request, canManagePurchasingItems)
  if (denied) return denied
  return crudPOST(request)
}

export async function PUT(request: Request) {
  const denied = await guardPurchasingAccess(request, canManagePurchasingItems)
  if (denied) return denied
  return crudPUT(request)
}

export async function DELETE(request: Request) {
  const denied = await guardPurchasingAccess(request, canManagePurchasingItems)
  if (denied) return denied
  return crudDELETE(request)
}

const itemListItemSchema = z.object({
  id: z.string().uuid(),
  request_id: z.string().uuid(),
  line_no: z.number(),
  catalog_product_id: z.string().uuid().nullable().optional(),
  sku: z.string().nullable().optional(),
  reference_number: z.string().nullable().optional(),
  product_name: z.string(),
  quantity: z.number(),
  item_status: z.string(),
  delivery_due_at: z.string().nullable().optional(),
  supplier_order_number: z.string().nullable().optional(),
  purchasing_note: z.string().nullable().optional(),
}).passthrough()

export const openApi = createPurchasingCrudOpenApi({
  resourceName: 'Purchasing Request Item',
  pluralName: 'Purchasing Request Items',
  querySchema: purchasingRequestItemListSchema,
  listResponseSchema: createPurchasingPagedListResponseSchema(itemListItemSchema),
  create: {
    schema: purchasingRequestItemCreateSchema,
    description: 'Adds a new item to an existing purchasing request.',
  },
  update: {
    schema: purchasingRequestItemUpdateSchema,
    responseSchema: purchasingOkSchema,
    description: 'Updates purchasing request item operational fields.',
  },
  del: {
    schema: purchasingRequestItemDeleteSchema,
    responseSchema: purchasingOkSchema,
    description: 'Soft-deletes a purchasing request item.',
  },
})
