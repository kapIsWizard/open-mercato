import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  collectProductFilterOptions,
  listPurchasingCatalogProducts,
  type CatalogScope,
} from '../../lib/catalogProducts'
import { guardPurchasingAccess } from '../../lib/apiAccess'
import { canAccessPurchasingModule } from '../../lib/roleAccess'

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  supplier: z.string().optional(),
  group: z.string().optional(),
  availability: z.string().optional(),
}).passthrough()

const productItemSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().nullable(),
  title: z.string(),
  unit: z.string().nullable(),
  referenceNumber: z.string().nullable(),
  supplier: z.string().nullable(),
  group: z.string().nullable(),
  purchasingAvailability: z.string().nullable(),
  barcode: z.string().nullable(),
  stockQuantity: z.number().nullable(),
  availableQuantity: z.number().nullable(),
  reservedQuantity: z.number().nullable(),
  unitPriceNet: z.string().nullable(),
  unitPriceGross: z.string().nullable(),
})

const responseSchema = z.object({
  items: z.array(productItemSchema),
  total: z.number(),
  totalPages: z.number(),
  page: z.number(),
  pageSize: z.number(),
  filters: z.object({
    suppliers: z.array(z.string()),
    groups: z.array(z.string()),
    availabilities: z.array(z.string()),
  }),
})

const errorSchema = z.object({
  error: z.string(),
})

export const metadata = {
  GET: { requireAuth: true },
}

export async function GET(request: Request) {
  const denied = await guardPurchasingAccess(request, canAccessPurchasingModule)
  if (denied) return denied
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId || !auth.orgId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    supplier: url.searchParams.get('supplier') ?? undefined,
    group: url.searchParams.get('group') ?? undefined,
    availability: url.searchParams.get('availability') ?? undefined,
  })
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid query' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const scope: CatalogScope = {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const allRows = await listPurchasingCatalogProducts({
    em,
    scope,
    limit: 5000,
  })
  const filteredRows = allRows.filter((row) => {
    if (parsed.data.supplier && row.supplier !== parsed.data.supplier) return false
    if (parsed.data.group && row.group !== parsed.data.group) return false
    if (parsed.data.availability && row.purchasingAvailability !== parsed.data.availability) return false
    if (!parsed.data.search?.trim()) return true
    const searchTerm = parsed.data.search.trim().toLowerCase()
    const haystack = [
      row.title,
      row.sku ?? '',
      row.referenceNumber ?? '',
      row.supplier ?? '',
      row.group ?? '',
      row.barcode ?? '',
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(searchTerm)
  })
  const total = filteredRows.length
  const totalPages = total === 0 ? 1 : Math.ceil(total / parsed.data.pageSize)
  const offset = (parsed.data.page - 1) * parsed.data.pageSize
  const items = filteredRows.slice(offset, offset + parsed.data.pageSize)

  return new Response(JSON.stringify({
    items,
    total,
    totalPages,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    filters: collectProductFilterOptions(allRows),
  }), {
    headers: { 'content-type': 'application/json' },
  })
}

const productsGetDoc: OpenApiMethodDoc = {
  summary: 'List purchasing catalog products',
  description: 'Returns native Open Mercato catalog products for purchasing with optional metadata-based filters.',
  tags: ['Purchasing'],
  query: querySchema,
  responses: [
    { status: 200, description: 'Purchasing catalog products.', schema: responseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid query', schema: errorSchema },
    { status: 401, description: 'Authentication required', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Purchasing',
  summary: 'Purchasing catalog products',
  methods: {
    GET: productsGetDoc,
  },
}
