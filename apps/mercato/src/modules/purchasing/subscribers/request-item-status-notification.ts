import type { EntityManager } from '@mikro-orm/postgresql'
import { PurchasingRequest, PurchasingRequestItem } from '../data/entities'
import { notificationTypes } from '../notifications'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { normalizeItemStatusForView } from '../lib/statuses'

export const metadata = {
  event: 'purchasing.request_item.status_changed',
  persistent: true,
  id: 'purchasing:request-item-status-notification',
}

type Payload = {
  requestItemId: string
  requestId: string
  previousStatus?: string | null
  status: string
  sku?: string | null
  productName?: string | null
  tenantId: string
  organizationId?: string | null
}

const NOTIFIABLE_STATUSES = new Set(['cancelled', 'in_stock', 'purchase_price_changed'])

export default async function handle(payload: Payload, ctx: { resolve: <T = unknown>(name: string) => T }) {
  const normalizedStatus = normalizeItemStatusForView(payload.status)
  if (!NOTIFIABLE_STATUSES.has(normalizedStatus)) return

  const em = (ctx.resolve('em') as EntityManager).fork()
  const request = await em.findOne(PurchasingRequest, {
    id: payload.requestId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId ?? null,
    deletedAt: null,
  })
  if (!request?.salesOwnerUserId) return

  const item = await em.findOne(PurchasingRequestItem, {
    id: payload.requestItemId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId ?? null,
    deletedAt: null,
  })
  const typeDef = notificationTypes.find((entry) => entry.type === 'purchasing.request_item.status_changed')
  if (!typeDef) return

  const notificationService = resolveNotificationService(ctx)
  const notificationInput = buildNotificationFromType(typeDef, {
    recipientUserId: request.salesOwnerUserId,
    sourceEntityType: 'purchasing:request',
    sourceEntityId: request.id,
    linkHref: `/backend/purchasing/requests/${request.id}`,
    bodyVariables: {
      requestNumber: request.requestNumber,
      productName: item?.productName ?? payload.productName ?? '',
      sku: item?.sku ?? payload.sku ?? '',
      status: normalizedStatus,
    },
    groupKey: `request-item-status:${payload.requestItemId}:${normalizedStatus}`,
  })

  await notificationService.create(notificationInput, {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId ?? null,
  })
}
