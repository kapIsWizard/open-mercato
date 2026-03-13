import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'purchasing.request_item.status_changed',
    module: 'purchasing',
    titleKey: 'purchasing.notifications.requestItemStatusChanged.title',
    bodyKey: 'purchasing.notifications.requestItemStatusChanged.body',
    icon: 'package',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/purchasing/requests/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    primaryActionId: 'view',
    linkHref: '/backend/purchasing/requests/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes

