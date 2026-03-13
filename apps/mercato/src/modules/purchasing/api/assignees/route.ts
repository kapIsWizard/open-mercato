import { z } from 'zod'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { z as zod } from 'zod'

const querySchema = z.object({
  q: z.string().optional(),
}).passthrough()

const optionSchema = zod.object({
  value: zod.string(),
  label: zod.string(),
})

const optionsResponseSchema = zod.object({
  items: zod.array(optionSchema),
})

const errorSchema = zod.object({
  error: zod.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['purchasing.requests.view'] },
}

export async function GET(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({ q: searchParams.get('q') ?? undefined })
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid query' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const q = parsed.data.q?.trim() ?? ''
  const like = q.length > 0 ? `%${escapeLikePattern(q)}%` : null

  const users = await findWithDecryption(
    em,
    User,
    {
      tenantId: auth.tenantId,
      deletedAt: null,
      ...(like ? {
        $or: [
          { email: { $ilike: like } },
          { name: { $ilike: like } },
        ],
      } : {}),
    } as Record<string, unknown>,
    {
      fields: ['id', 'email', 'name'],
      limit: 50,
      orderBy: { name: 'asc', email: 'asc' },
    },
    { tenantId: auth.tenantId, organizationId: auth.orgId ?? null },
  )

  const items = users.map((user) => ({
    value: String(user.id),
    label:
      typeof user.name === 'string' && user.name.trim().length > 0
        ? `${user.name.trim()} (${typeof user.email === 'string' ? user.email : String(user.id)})`
        : typeof user.email === 'string' && user.email.length > 0
          ? `${humanizePurchasingEmail(user.email)} (${user.email})`
          : String(user.id),
  }))

  return new Response(JSON.stringify({ items }), {
    headers: { 'content-type': 'application/json' },
  })
}

function humanizePurchasingEmail(email: string): string {
  const localPart = email.split('@')[0] ?? email
  const tokens = localPart
    .split(/[._-]+/)
    .filter((token) => token.trim().length > 0)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
  return tokens.join(' ')
}

const assigneesGetDoc: OpenApiMethodDoc = {
  summary: 'List purchasing assignees',
  description: 'Returns assignable users for purchasing requests filtered by the optional `q` query parameter.',
  tags: ['Purchasing'],
  query: querySchema,
  responses: [
    { status: 200, description: 'Assignable users.', schema: optionsResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid query', schema: errorSchema },
    { status: 401, description: 'Authentication required', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Purchasing',
  summary: 'Purchasing assignee options',
  methods: {
    GET: assigneesGetDoc,
  },
}
