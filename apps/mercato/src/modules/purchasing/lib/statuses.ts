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

export const requestStatusViewValues = requestStatusStorageValues
export const itemStatusViewValues = itemStatusStorageValues

export type RequestStatusView = (typeof requestStatusViewValues)[number]
export type ItemStatusView = (typeof itemStatusViewValues)[number]

const requestStatusStorageSet = new Set<string>(requestStatusStorageValues)
const itemStatusStorageSet = new Set<string>(itemStatusStorageValues)

const legacyRequestStatusMap: Record<string, RequestStatusView> = {
  sent_to_purchasing: 'unassigned',
  sent_to_supplier: 'in_progress',
  waiting_for_supplier: 'in_progress',
  alternative_needed: 'in_progress',
  quoted: 'in_progress',
  ordered: 'partially_ordered',
  in_transit: 'partially_ordered',
  delivered: 'completed',
}

const legacyItemStatusMap: Record<string, ItemStatusView> = {
  sent_to_purchasing: 'to_order',
  sent_to_supplier: 'to_order',
  waiting_for_supplier: 'to_order',
  alternative_needed: 'to_order',
  quoted: 'to_order',
  delivered: 'in_stock',
}

export function normalizeRequestStatusForView(status?: string | null): RequestStatusView {
  if (!status) return 'unassigned'
  if (requestStatusStorageSet.has(status)) return status as RequestStatusView
  return legacyRequestStatusMap[status] ?? 'unassigned'
}

export function normalizeRequestStatusForStorage(status?: string | null): string {
  return normalizeRequestStatusForView(status)
}

export function normalizeItemStatusForView(status?: string | null): ItemStatusView {
  if (!status) return 'to_order'
  if (itemStatusStorageSet.has(status)) return status as ItemStatusView
  return legacyItemStatusMap[status] ?? 'to_order'
}

export function normalizeItemStatusForStorage(status?: string | null): string {
  return normalizeItemStatusForView(status)
}

export function resolveRequestStatusFilterValues(status?: string | null): string[] {
  if (!status) return []
  const normalized = normalizeRequestStatusForView(status)
  const legacy = Object.entries(legacyRequestStatusMap)
    .filter(([, value]) => value === normalized)
    .map(([key]) => key)
  return [normalized, ...legacy]
}

export function resolveItemStatusFilterValues(status?: string | null): string[] {
  if (!status) return []
  const normalized = normalizeItemStatusForView(status)
  const legacy = Object.entries(legacyItemStatusMap)
    .filter(([, value]) => value === normalized)
    .map(([key]) => key)
  return [normalized, ...legacy]
}

export function isOpenItemStatus(status?: string | null): boolean {
  const normalized = normalizeItemStatusForView(status)
  return normalized !== 'in_stock' && normalized !== 'cancelled'
}

export function deriveRequestStatusFromItems(itemStatuses: Array<string | null | undefined>, hasOwner: boolean): string {
  const normalized = itemStatuses.map((status) => normalizeItemStatusForView(status))
  if (normalized.length === 0) return hasOwner ? 'assigned' : 'unassigned'
  if (normalized.every((status) => status === 'cancelled')) return 'cancelled'
  if (normalized.every((status) => status === 'in_stock' || status === 'cancelled')) return 'completed'
  if (normalized.some((status) => status === 'ordered' || status === 'in_transit')) return 'partially_ordered'
  if (normalized.some((status) => status === 'purchase_price_changed')) return 'in_progress'
  return hasOwner ? 'assigned' : 'unassigned'
}

export function resolveRequestStatusVariant(status?: string | null): 'default' | 'destructive' | 'secondary' | 'outline' {
  const normalized = normalizeRequestStatusForView(status)
  if (normalized === 'completed') return 'default'
  if (normalized === 'cancelled') return 'destructive'
  if (normalized === 'in_progress' || normalized === 'partially_ordered') return 'secondary'
  return 'outline'
}

export function resolveRequestStatusClassName(status?: string | null): string {
  const normalized = normalizeRequestStatusForView(status)
  if (normalized === 'completed') return 'border-emerald-200 bg-emerald-100 text-emerald-900'
  if (normalized === 'cancelled') return 'border-rose-200 bg-rose-100 text-rose-900'
  if (normalized === 'in_progress') return 'border-amber-200 bg-amber-100 text-amber-950'
  if (normalized === 'partially_ordered') return 'border-sky-200 bg-sky-100 text-sky-950'
  if (normalized === 'assigned') return 'border-violet-200 bg-violet-100 text-violet-950'
  return 'border-slate-200 bg-slate-100 text-slate-900'
}

export function resolveItemStatusVariant(status?: string | null): 'default' | 'destructive' | 'secondary' | 'outline' {
  const normalized = normalizeItemStatusForView(status)
  if (normalized === 'in_stock') return 'default'
  if (normalized === 'cancelled') return 'destructive'
  if (
    normalized === 'ordered'
    || normalized === 'in_transit'
    || normalized === 'purchase_price_changed'
  ) {
    return 'secondary'
  }
  return 'outline'
}

export function resolveItemStatusClassName(status?: string | null): string {
  const normalized = normalizeItemStatusForView(status)
  if (normalized === 'in_stock') return 'border-emerald-200 bg-emerald-100 text-emerald-900'
  if (normalized === 'cancelled') return 'border-rose-200 bg-rose-100 text-rose-900'
  if (normalized === 'ordered') return 'border-sky-200 bg-sky-100 text-sky-950'
  if (normalized === 'in_transit') return 'border-indigo-200 bg-indigo-100 text-indigo-950'
  if (normalized === 'purchase_price_changed') return 'border-orange-200 bg-orange-100 text-orange-950'
  return 'border-amber-200 bg-amber-100 text-amber-950'
}
