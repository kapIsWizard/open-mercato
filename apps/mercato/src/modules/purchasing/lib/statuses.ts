export const requestStatusViewValues = [
  'sent_to_purchasing',
  'assigned',
  'sent_to_supplier',
  'waiting_for_supplier',
  'alternative_needed',
  'quoted',
  'ordered',
  'in_transit',
  'delivered',
  'cancelled',
] as const

export const itemStatusViewValues = [
  'sent_to_purchasing',
  'sent_to_supplier',
  'waiting_for_supplier',
  'alternative_needed',
  'quoted',
  'ordered',
  'in_transit',
  'delivered',
  'cancelled',
  'purchase_price_changed',
] as const

export const requestStatusStorageValues = [
  'unassigned',
  'assigned',
  'in_progress',
  'partially_ordered',
  'completed',
  'cancelled',
] as const

export const itemStatusStorageValues = [
  'to_order',
  'ordered',
  'in_transit',
  'in_stock',
  'cancelled',
  'purchase_price_changed',
] as const

export type RequestStatusView = (typeof requestStatusViewValues)[number]
export type ItemStatusView = (typeof itemStatusViewValues)[number]

const requestStatusStorageSet = new Set<string>(requestStatusStorageValues)
const requestStatusViewSet = new Set<string>(requestStatusViewValues)
const itemStatusStorageSet = new Set<string>(itemStatusStorageValues)
const itemStatusViewSet = new Set<string>(itemStatusViewValues)

export function normalizeRequestStatusForView(status?: string | null): RequestStatusView {
  if (!status) return 'sent_to_purchasing'
  if (requestStatusViewSet.has(status)) return status as RequestStatusView
  switch (status) {
    case 'unassigned':
      return 'sent_to_purchasing'
    case 'assigned':
      return 'assigned'
    case 'in_progress':
      return 'waiting_for_supplier'
    case 'partially_ordered':
      return 'ordered'
    case 'completed':
      return 'delivered'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'sent_to_purchasing'
  }
}

export function normalizeRequestStatusForStorage(status?: string | null): string {
  if (!status) return 'unassigned'
  if (requestStatusStorageSet.has(status)) return status
  switch (status) {
    case 'sent_to_purchasing':
      return 'unassigned'
    case 'assigned':
      return 'assigned'
    case 'sent_to_supplier':
    case 'waiting_for_supplier':
    case 'alternative_needed':
    case 'quoted':
      return 'in_progress'
    case 'ordered':
    case 'in_transit':
      return 'partially_ordered'
    case 'delivered':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'unassigned'
  }
}

export function normalizeItemStatusForView(status?: string | null): ItemStatusView {
  if (!status) return 'sent_to_purchasing'
  if (itemStatusViewSet.has(status)) return status as ItemStatusView
  switch (status) {
    case 'to_order':
      return 'sent_to_purchasing'
    case 'ordered':
      return 'ordered'
    case 'in_transit':
      return 'in_transit'
    case 'in_stock':
      return 'delivered'
    case 'cancelled':
      return 'cancelled'
    case 'purchase_price_changed':
      return 'purchase_price_changed'
    default:
      return 'sent_to_purchasing'
  }
}

export function normalizeItemStatusForStorage(status?: string | null): string {
  if (!status) return 'to_order'
  if (itemStatusStorageSet.has(status)) return status
  switch (status) {
    case 'sent_to_purchasing':
      return 'to_order'
    case 'sent_to_supplier':
      return 'sent_to_supplier'
    case 'waiting_for_supplier':
      return 'waiting_for_supplier'
    case 'alternative_needed':
      return 'alternative_needed'
    case 'quoted':
      return 'quoted'
    case 'ordered':
      return 'ordered'
    case 'in_transit':
      return 'in_transit'
    case 'delivered':
      return 'delivered'
    case 'cancelled':
      return 'cancelled'
    case 'purchase_price_changed':
      return 'purchase_price_changed'
    default:
      return 'to_order'
  }
}

export function resolveRequestStatusFilterValues(status?: string | null): string[] {
  if (!status) return []
  const normalized = normalizeRequestStatusForView(status)
  switch (normalized) {
    case 'sent_to_purchasing':
      return ['sent_to_purchasing', 'unassigned']
    case 'assigned':
      return ['assigned']
    case 'sent_to_supplier':
      return ['sent_to_supplier', 'in_progress']
    case 'waiting_for_supplier':
      return ['waiting_for_supplier', 'in_progress']
    case 'alternative_needed':
      return ['alternative_needed', 'in_progress']
    case 'quoted':
      return ['quoted', 'in_progress']
    case 'ordered':
      return ['ordered', 'partially_ordered']
    case 'in_transit':
      return ['in_transit', 'partially_ordered']
    case 'delivered':
      return ['delivered', 'completed']
    case 'cancelled':
      return ['cancelled']
    default:
      return [normalizeRequestStatusForStorage(status)]
  }
}

export function resolveItemStatusFilterValues(status?: string | null): string[] {
  if (!status) return []
  const normalized = normalizeItemStatusForView(status)
  switch (normalized) {
    case 'sent_to_purchasing':
      return ['sent_to_purchasing', 'to_order']
    case 'delivered':
      return ['delivered', 'in_stock']
    default:
      return [normalizeItemStatusForStorage(status)]
  }
}

export function isOpenItemStatus(status?: string | null): boolean {
  const normalized = normalizeItemStatusForView(status)
  return normalized !== 'delivered' && normalized !== 'cancelled'
}

export function deriveRequestStatusFromItems(itemStatuses: Array<string | null | undefined>, hasOwner: boolean): string {
  const normalized = itemStatuses.map((status) => normalizeItemStatusForView(status))
  if (normalized.length === 0) return hasOwner ? 'assigned' : 'unassigned'
  if (normalized.every((status) => status === 'cancelled')) return 'cancelled'
  if (normalized.every((status) => status === 'delivered' || status === 'cancelled')) return 'completed'
  if (normalized.some((status) => status === 'in_transit')) return 'partially_ordered'
  if (normalized.some((status) => status === 'ordered')) return 'partially_ordered'
  if (normalized.some((status) => status === 'purchase_price_changed' || status === 'quoted')) return 'in_progress'
  if (normalized.some((status) => (
    status === 'sent_to_supplier'
    || status === 'waiting_for_supplier'
    || status === 'alternative_needed'
  ))) {
    return 'in_progress'
  }
  return hasOwner ? 'assigned' : 'unassigned'
}

export function resolveRequestStatusVariant(status?: string | null): 'default' | 'destructive' | 'secondary' | 'outline' {
  const normalized = normalizeRequestStatusForView(status)
  if (normalized === 'delivered') return 'default'
  if (normalized === 'cancelled') return 'destructive'
  if (normalized === 'ordered' || normalized === 'in_transit' || normalized === 'quoted') return 'secondary'
  return 'outline'
}

export function resolveItemStatusVariant(status?: string | null): 'default' | 'destructive' | 'secondary' | 'outline' {
  const normalized = normalizeItemStatusForView(status)
  if (normalized === 'delivered') return 'default'
  if (normalized === 'cancelled') return 'destructive'
  if (
    normalized === 'quoted'
    || normalized === 'ordered'
    || normalized === 'in_transit'
    || normalized === 'purchase_price_changed'
  ) {
    return 'secondary'
  }
  return 'outline'
}
