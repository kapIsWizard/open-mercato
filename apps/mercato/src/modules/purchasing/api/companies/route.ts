import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
}).passthrough()

const companyItemSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  primaryEmail: z.string().nullable(),
  primaryPhone: z.string().nullable(),
})

const responseSchema = z.object({
  items: z.array(companyItemSchema),
  total: z.number(),
  totalPages: z.number(),
  page: z.number(),
  pageSize: z.number(),
})

const errorSchema = z.object({
  error: z.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchasing.requests.view'] },
}

export async function GET(request: Request) {
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
  })
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid query' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const where: FilterQuery<CustomerEntity> = {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    kind: 'company',
    deletedAt: null,
  }
  const search = parsed.data.search?.trim()
  if (search) {
    where.displayName = { $ilike: `%${escapeLikePattern(search)}%` }
  }

  const [items, total] = await Promise.all([
    findWithDecryption(
      em,
      CustomerEntity,
      where,
      {
        fields: ['id', 'displayName', 'primaryEmail', 'primaryPhone'],
        limit: parsed.data.pageSize,
        offset: (parsed.data.page - 1) * parsed.data.pageSize,
        orderBy: { displayName: 'asc' },
      },
      {
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
      },
    ),
    em.count(CustomerEntity, where),
  ])

  return new Response(JSON.stringify({
    items: items.map((item) => ({
      id: item.id,
      displayName: item.displayName,
      primaryEmail: item.primaryEmail ?? null,
      primaryPhone: item.primaryPhone ?? null,
    })),
    total,
    totalPages: total === 0 ? 1 : Math.ceil(total / parsed.data.pageSize),
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  }), {
    headers: { 'content-type': 'application/json' },
  })
}

const companiesGetDoc: OpenApiMethodDoc = {
  summary: 'List customer companies for purchasing',
  description: 'Returns native Open Mercato companies that can be linked to a purchasing request.',
  tags: ['Purchasing'],
  query: querySchema,
  responses: [
    { status: 200, description: 'Purchasing company candidates.', schema: responseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid query', schema: errorSchema },
    { status: 401, description: 'Authentication required', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Purchasing',
  summary: 'Purchasing companies',
  methods: {
    GET: companiesGetDoc,
  },
}
