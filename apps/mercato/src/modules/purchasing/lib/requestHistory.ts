import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import { normalizeItemStatusForView, normalizeRequestStatusForView } from './statuses'

export type PurchasingHistoryEntry = {
  id: string
  occurredAt: string
  kind: 'status' | 'action' | 'comment'
  action: string
  actor: { id: string | null; label: string }
  source: 'action_log'
  metadata?: {
    targetType?: 'request' | 'item' | 'comment'
    targetLabel?: string | null
    statusFrom?: string | null
    statusTo?: string | null
    commandId?: string | null
  }
}

function readRequestStatus(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const candidate = snapshot as Record<string, unknown>
  if (typeof candidate.requestStatus === 'string') return normalizeRequestStatusForView(candidate.requestStatus)
  return null
}

function readItemStatus(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const candidate = snapshot as Record<string, unknown>
  if (typeof candidate.itemStatus === 'string') return normalizeItemStatusForView(candidate.itemStatus)
  return null
}

function readTargetLabel(log: ActionLog): { targetType: 'request' | 'item' | 'comment'; targetLabel: string | null } {
  if (log.resourceKind === 'purchasing.request_item') {
    const after = log.snapshotAfter as Record<string, unknown> | null
    const before = log.snapshotBefore as Record<string, unknown> | null
    return {
      targetType: 'item',
      targetLabel:
        (typeof after?.productName === 'string' ? after.productName : null)
        ?? (typeof before?.productName === 'string' ? before.productName : null)
        ?? null,
    }
  }
  if (log.resourceKind === 'purchasing.comment') {
    return {
      targetType: 'comment',
      targetLabel: null,
    }
  }
  return {
    targetType: 'request',
    targetLabel: 'Request',
  }
}

function detectStatusChange(log: ActionLog): { statusFrom: string | null; statusTo: string | null } | null {
  const requestBefore = readRequestStatus(log.snapshotBefore)
  const requestAfter = readRequestStatus(log.snapshotAfter)
  if (requestBefore !== requestAfter && (requestBefore !== null || requestAfter !== null)) {
    return { statusFrom: requestBefore, statusTo: requestAfter }
  }

  const itemBefore = readItemStatus(log.snapshotBefore)
  const itemAfter = readItemStatus(log.snapshotAfter)
  if (itemBefore !== itemAfter && (itemBefore !== null || itemAfter !== null)) {
    return { statusFrom: itemBefore, statusTo: itemAfter }
  }

  return null
}

export function normalizeActionLogToPurchasingHistoryEntry(
  log: ActionLog,
  displayUsers?: Record<string, string>,
): PurchasingHistoryEntry {
  const actorLabel = log.actorUserId
    ? (displayUsers?.[log.actorUserId] ?? log.actorUserId)
    : 'system'
  const statusChange = detectStatusChange(log)
  const target = readTargetLabel(log)

  if (statusChange) {
    return {
      id: log.id,
      occurredAt: log.createdAt.toISOString(),
      kind: 'status',
      action: target.targetLabel ?? (target.targetType === 'item' ? 'Request item' : 'Request'),
      actor: { id: log.actorUserId, label: actorLabel },
      source: 'action_log',
      metadata: {
        commandId: log.commandId ?? null,
        targetType: target.targetType,
        targetLabel: target.targetLabel,
        statusFrom: statusChange.statusFrom,
        statusTo: statusChange.statusTo,
      },
    }
  }

  if (log.resourceKind === 'purchasing.comment') {
    const after = log.snapshotAfter as Record<string, unknown> | null
    const before = log.snapshotBefore as Record<string, unknown> | null
    const body =
      (typeof after?.body === 'string' ? after.body : null)
      ?? (typeof before?.body === 'string' ? before.body : null)
      ?? log.actionLabel
      ?? log.commandId
      ?? 'Comment'
    return {
      id: log.id,
      occurredAt: log.createdAt.toISOString(),
      kind: 'comment',
      action: body,
      actor: { id: log.actorUserId, label: actorLabel },
      source: 'action_log',
      metadata: {
        commandId: log.commandId ?? null,
        targetType: 'comment',
      },
    }
  }

  return {
    id: log.id,
    occurredAt: log.createdAt.toISOString(),
    kind: 'action',
    action: log.actionLabel ?? log.commandId,
    actor: { id: log.actorUserId, label: actorLabel },
    source: 'action_log',
    metadata: {
      commandId: log.commandId ?? null,
      targetType: target.targetType,
      targetLabel: target.targetLabel,
    },
  }
}

export function buildPurchasingHistoryEntries(input: {
  actionLogs: ActionLog[]
  displayUsers?: Record<string, string>
}): PurchasingHistoryEntry[] {
  return input.actionLogs
    .map((entry) => normalizeActionLogToPurchasingHistoryEntry(entry, input.displayUsers))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
}
