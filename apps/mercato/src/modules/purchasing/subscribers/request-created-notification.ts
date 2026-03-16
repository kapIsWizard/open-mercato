import type { EntityManager } from '@mikro-orm/postgresql'
import { buildNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { PurchasingRequest } from '../data/entities'
import { notificationTypes } from '../notifications'

export const metadata = {
  event: 'purchasing.request.created',
  persistent: true,
  id: 'purchasing:request-created-notification',
}

type Payload = {
  id: string
  tenantId: string
  organizationId?: string | null
}

export default async function handle(payload: Payload, ctx: { resolve: <T = unknown>(name: string) => T }) {
  const em = (ctx.resolve('em') as EntityManager).fork()
  const request = await em.findOne(PurchasingRequest, {
    id: payload.id,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId ?? null,
    deletedAt: null,
  })
  if (!request) return

  const recipientUserId = request.purchasingOwnerUserId ?? request.salesOwnerUserId ?? null
  if (!recipientUserId) return

  const typeDef = notificationTypes.find((entry) => entry.type === 'purchasing.request.created')
  if (!typeDef) return

  const notificationService = resolveNotificationService(ctx)
  const notificationInput = buildNotificationFromType(typeDef, {
    recipientUserId,
    sourceEntityType: 'purchasing:request',
    sourceEntityId: request.id,
    linkHref: `/backend/purchasing/requests/${request.id}`,
    bodyVariables: {
      requestNumber: request.requestNumber,
      customerName: request.customerName ?? '',
      customerNip: request.customerNip ?? '',
    },
    groupKey: `purchasing-request-created:${request.id}:${recipientUserId}`,
  })

  await notificationService.create(notificationInput, {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId ?? null,
  })
}
