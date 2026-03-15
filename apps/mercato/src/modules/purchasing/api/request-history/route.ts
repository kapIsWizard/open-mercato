import { z } from 'zod'
import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import { loadAuditLogDisplayMaps } from '@open-mercato/core/modules/audit_logs/api/audit-logs/display'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { PurchasingRequest } from '../../data/entities'
import { buildPurchasingHistoryEntries } from '../../lib/requestHistory'
import { guardPurchasingAccess } from '../../lib/apiAccess'
import { canAccessPurchasingModule } from '../../lib/roleAccess'

export const metadata = {
  GET: { requireAuth: true },
}

const querySchema = z.object({
  requestId: z.string().uuid(),
  limit: z.coerce.number().min(1).max(100).default(100),
  before: z.string().optional(),
  after: z.string().optional(),
})

export async function GET(req: Request) {
  try {
    const denied = await guardPurchasingAccess(req, canAccessPurchasingModule)
    if (denied) return denied
    const url = new URL(req.url)
    const query = querySchema.parse(Object.fromEntries(url.searchParams))
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId || !auth.orgId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const request = await em.findOne(PurchasingRequest, {
      id: query.requestId,
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      deletedAt: null,
    })
    if (!request) {
      throw new CrudHttpError(404, { error: 'Purchasing request not found' })
    }

    const actionLogService = container.resolve('actionLogService') as ActionLogService
    const logs = await actionLogService.list({
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      resourceKind: 'purchasing.request',
      resourceId: query.requestId,
      includeRelated: true,
      limit: query.limit,
      before: query.before ? new Date(query.before) : undefined,
      after: query.after ? new Date(query.after) : undefined,
    })

    const displayMaps = await loadAuditLogDisplayMaps(em, {
      userIds: logs.map((entry) => entry.actorUserId).filter((value): value is string => Boolean(value)),
      tenantIds: [],
      organizationIds: [],
    })

    return NextResponse.json({
      items: buildPurchasingHistoryEntries({
        actionLogs: logs,
        displayUsers: displayMaps.users,
      }),
    })
  } catch (error) {
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    console.error('purchasing.request-history.get failed', error)
    return NextResponse.json({ error: 'Failed to load purchasing history.' }, { status: 400 })
  }
}

const historyActorSchema = z.object({
  id: z.string().uuid().nullable(),
  label: z.string(),
})

const historyEntrySchema = z.object({
  id: z.string(),
  occurredAt: z.string().datetime(),
  kind: z.enum(['status', 'action', 'comment']),
  action: z.string(),
  actor: historyActorSchema,
  source: z.literal('action_log'),
  metadata: z.object({
    targetType: z.enum(['request', 'item', 'comment']).optional(),
    targetLabel: z.string().nullable().optional(),
    statusFrom: z.string().nullable().optional(),
    statusTo: z.string().nullable().optional(),
    commandId: z.string().nullable().optional(),
  }).optional(),
})

const responseSchema = z.object({
  items: z.array(historyEntrySchema),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Purchasing',
  summary: 'Get purchasing request activity history',
  methods: {
    GET: {
      summary: 'List history entries for a purchasing request',
      query: querySchema,
      responses: [
        { status: 200, description: 'History entries', schema: responseSchema },
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Request not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
