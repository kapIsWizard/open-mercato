import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CustomerCompanyProfile, CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { GET as getCustomerCompanies } from '@open-mercato/core/modules/customers/api/companies/route'
import { guardPurchasingAccess } from '../../lib/apiAccess'
import { canAccessPurchasingModule } from '../../lib/roleAccess'

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
}).passthrough()

const companyItemSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  taxId: z.string().nullable(),
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

const coreCompaniesResponseSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    display_name: z.string().optional(),
    primary_email: z.string().nullable().optional(),
    primary_phone: z.string().nullable().optional(),
  })).default([]),
  total: z.number().optional(),
  totalPages: z.number().optional(),
  page: z.number().optional(),
  pageSize: z.number().optional(),
})

export const metadata = {
  GET: { requireAuth: true },
}

function isMissingCustomerTaxIdColumnError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('tax_id') && (message.includes('does not exist') || message.includes('column'))
}

function normalizeTaxIdSearch(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const digits = value.replace(/\D/g, '')
  return digits.length > 0 ? digits : null
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
  })
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid query' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const search = parsed.data.search?.trim()
  const normalizedTaxIdSearch = normalizeTaxIdSearch(search)
  const customersUrl = new URL(request.url)
  customersUrl.pathname = '/api/customers/companies'
  customersUrl.searchParams.set('page', String(parsed.data.page))
  customersUrl.searchParams.set('pageSize', String(parsed.data.pageSize))
  if (search) customersUrl.searchParams.set('search', search)
  else customersUrl.searchParams.delete('search')

  const delegatedRequest = new Request(customersUrl.toString(), {
    method: 'GET',
    headers: request.headers,
  })
  const delegatedResponse = await getCustomerCompanies(delegatedRequest)
  if (!delegatedResponse.ok) {
    const body = await delegatedResponse.text()
    return new Response(body || JSON.stringify({ error: 'Failed to load companies' }), {
      status: delegatedResponse.status,
      headers: { 'content-type': delegatedResponse.headers.get('content-type') ?? 'application/json' },
    })
  }

  const delegatedPayloadRaw = await delegatedResponse.json().catch(() => null)
  const delegatedPayload = coreCompaniesResponseSchema.safeParse(delegatedPayloadRaw)
  const baseItems = delegatedPayload.success ? delegatedPayload.data.items : []

  let taxIdMatchIds: string[] = []
  if (search) {
    try {
      const matchingProfiles = await em.find(
        CustomerCompanyProfile,
        {
          tenantId: auth.tenantId,
          organizationId: auth.orgId,
          taxId: { $ilike: `%${normalizedTaxIdSearch ?? search}%` },
        },
        { populate: ['entity'] },
      )
      taxIdMatchIds = matchingProfiles
        .map((profile) => {
          if (!profile.entity) return null
          return typeof profile.entity === 'string' ? profile.entity : profile.entity.id
        })
        .filter((value): value is string => Boolean(value))
    } catch (error) {
      if (!isMissingCustomerTaxIdColumnError(error)) throw error
      taxIdMatchIds = []
    }
  }

  let taxIdMatchedEntities: Array<{
    id: string
    displayName: string
    primaryEmail?: string | null
    primaryPhone?: string | null
  }> = []
  if (taxIdMatchIds.length) {
    taxIdMatchedEntities = await findWithDecryption(
      em,
      CustomerEntity,
      {
        id: { $in: taxIdMatchIds } as never,
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
        kind: 'company',
        deletedAt: null,
      } as FilterQuery<CustomerEntity>,
      {
        fields: ['id', 'displayName', 'primaryEmail', 'primaryPhone'],
        orderBy: { displayName: 'asc' },
      },
      { tenantId: auth.tenantId, organizationId: auth.orgId },
    )
  }

  const mergedItems = [
    ...baseItems.map((item) => ({
      id: item.id,
      displayName: item.display_name ?? '',
      primaryEmail: item.primary_email ?? null,
      primaryPhone: item.primary_phone ?? null,
    })),
    ...taxIdMatchedEntities.map((item) => ({
      id: item.id,
      displayName: item.displayName,
      primaryEmail: item.primaryEmail ?? null,
      primaryPhone: item.primaryPhone ?? null,
    })),
  ].filter((item, index, array) => item.displayName && array.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, parsed.data.pageSize)

  let profiles: CustomerCompanyProfile[] = []
  if (mergedItems.length) {
    try {
      profiles = await em.find(
        CustomerCompanyProfile,
        {
          tenantId: auth.tenantId,
          organizationId: auth.orgId,
          entity: { $in: mergedItems.map((item) => item.id) } as never,
        },
        { populate: ['entity'] },
      )
    } catch (error) {
      if (!isMissingCustomerTaxIdColumnError(error)) throw error
      profiles = []
    }
  }
  const taxIdByEntityId = new Map<string, string | null>(
    profiles.map((profile) => {
      const entityId = typeof profile.entity === 'string' ? profile.entity : profile.entity.id
      return [entityId, profile.taxId ?? null]
    }),
  )

  return new Response(JSON.stringify({
    items: mergedItems.map((item) => ({
      id: item.id,
      displayName: item.displayName,
      taxId: taxIdByEntityId.get(item.id) ?? null,
      primaryEmail: item.primaryEmail,
      primaryPhone: item.primaryPhone,
    })),
    total: mergedItems.length,
    totalPages: 1,
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
