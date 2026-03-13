import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'purchasing.request.created', label: 'Purchasing Request Created', entity: 'request', category: 'crud', clientBroadcast: true },
  { id: 'purchasing.request.updated', label: 'Purchasing Request Updated', entity: 'request', category: 'crud', clientBroadcast: true },
  { id: 'purchasing.request.assigned', label: 'Purchasing Request Assigned', entity: 'request', category: 'custom', clientBroadcast: true },
  { id: 'purchasing.request_item.created', label: 'Purchasing Request Item Created', entity: 'request_item', category: 'crud', clientBroadcast: true },
  { id: 'purchasing.request_item.updated', label: 'Purchasing Request Item Updated', entity: 'request_item', category: 'crud', clientBroadcast: true },
  { id: 'purchasing.request_item.status_changed', label: 'Purchasing Request Item Status Changed', entity: 'request_item', category: 'custom', clientBroadcast: true },
  { id: 'purchasing.comment.created', label: 'Purchasing Comment Created', entity: 'comment', category: 'crud', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'purchasing',
  events,
})

export const emitPurchasingEvent = eventsConfig.emit
export type PurchasingEventId = typeof events[number]['id']

export default eventsConfig

