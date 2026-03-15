"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { DetailTabsLayout } from '@open-mercato/core/modules/customers/components/detail/DetailTabsLayout'
import { formatDateTime, formatRelativeTime } from '@open-mercato/shared/lib/time'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AttachmentsSection, LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  canAccessPurchasingModule,
  canManagePurchasingComments,
  canManagePurchasingItems,
  canManagePurchasingRequest,
  canViewPurchasingOperationalItems,
} from '../../../../lib/roleAccess'
import {
  isOpenItemStatus,
  resolveItemStatusClassName,
  resolveRequestStatusClassName,
  itemStatusViewValues,
  normalizeItemStatusForView,
  normalizeRequestStatusForView,
  requestStatusViewValues,
  resolveItemStatusVariant,
  resolveRequestStatusVariant,
} from '../../../../lib/statuses'
import {
  clearFieldError,
  FieldError,
  FieldLabel,
  FormErrorNotice,
  resolvePurchasingFormError,
  selectClassName,
  type PurchasingFormErrors,
  validateCommentForm,
  validateRequestDetailForm,
  validateRequestItemForm,
} from '../../../../lib/requestFormUtils'

type RequestRecord = {
  id: string
  requestNumber: string
  customerNip: string | null
  customerName: string | null
  requestStatus: string
  sourceChannel: string | null
  formVariant: string | null
  purchasingOwnerUserId: string | null
  requestText: string | null
  customerOrderNumber: string | null
  attachmentsCount: number
}

type RequestItemRecord = {
  id: string
  catalogProductId: string | null
  catalogQuery: string
  sku: string | null
  referenceNumber: string | null
  productName: string
  quantity: number
  itemStatus: string
  supplierOrderNumber: string | null
  purchasingNote: string | null
}

type CommentRecord = {
  id: string
  body: string
  authorUserId: string | null
  authorName: string | null
  authorEmail: string | null
  createdAt: string | null
}

type HistoryRecord = {
  id: string
  occurredAt: string
  kind: 'status' | 'action' | 'comment'
  action: string
  actor: {
    id: string | null
    label: string
  }
  metadata?: {
    targetType?: 'request' | 'item' | 'comment'
    targetLabel?: string | null
    statusFrom?: string | null
    statusTo?: string | null
    commandId?: string | null
  }
}

type AssigneeOption = {
  value: string
  label: string
}

type FeatureCheckResponse = {
  ok?: boolean
  granted?: string[]
  roles?: string[]
}

type PurchasingPermissions = {
  canUpdateRequests: boolean
  canViewItems: boolean
  canOpenOperationalItems: boolean
  canManageItems: boolean
  canManageComments: boolean
  canViewAttachments: boolean
  canManageAttachments: boolean
}

type DetailTabId = 'items' | 'comments' | 'attachments' | 'history'
type ItemSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export default function PurchasingRequestDetailPage({ params }: { params?: { id?: string } }) {
  const id = params?.id ?? null
  const t = useT()
  const router = useRouter()
  const { runMutation } = useGuardedMutation<{ resourceType: string; resourceId: string | null }>({
    contextId: `purchasing.requests.detail.${id ?? 'unknown'}`,
  })
  const [record, setRecord] = React.useState<RequestRecord | null>(null)
  const [items, setItems] = React.useState<RequestItemRecord[]>([])
  const [comments, setComments] = React.useState<CommentRecord[]>([])
  const [assignees, setAssignees] = React.useState<AssigneeOption[]>([])
  const [history, setHistory] = React.useState<HistoryRecord[]>([])
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [commentBody, setCommentBody] = React.useState('')
  const [activeTab, setActiveTab] = React.useState<DetailTabId>('items')
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [requestFieldErrors, setRequestFieldErrors] = React.useState<PurchasingFormErrors>({})
  const [requestFormError, setRequestFormError] = React.useState<string | null>(null)
  const [itemFieldErrors, setItemFieldErrors] = React.useState<Record<string, PurchasingFormErrors>>({})
  const [commentFieldErrors, setCommentFieldErrors] = React.useState<PurchasingFormErrors>({})
  const [commentFormError, setCommentFormError] = React.useState<string | null>(null)
  const recordRef = React.useRef<RequestRecord | null>(null)
  const itemsRef = React.useRef<RequestItemRecord[]>([])
  const itemSaveTimersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const itemSaveResetTimersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const itemSavedSnapshotRef = React.useRef<Record<string, string>>({})
  const [itemSaveStates, setItemSaveStates] = React.useState<Record<string, ItemSaveState>>({})
  const [selectedItemIds, setSelectedItemIds] = React.useState<string[]>([])
  const [bulkItemStatus, setBulkItemStatus] = React.useState('')
  const [bulkQuantity, setBulkQuantity] = React.useState('')
  const [bulkSupplierOrderNumber, setBulkSupplierOrderNumber] = React.useState('')
  const [bulkPurchasingNote, setBulkPurchasingNote] = React.useState('')
  const [permissions, setPermissions] = React.useState<PurchasingPermissions>({
    canUpdateRequests: false,
    canViewItems: false,
    canOpenOperationalItems: false,
    canManageItems: false,
    canManageComments: false,
    canViewAttachments: false,
    canManageAttachments: false,
  })

  const load = React.useCallback(async () => {
    if (!id) {
      setError(t('purchasing.requests.errors.notFound', 'Purchasing request not found.'))
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const [featureCall, requestPayload, commentPayload] = await Promise.all([
        apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            features: [
              'attachments.view',
              'attachments.manage',
            ],
          }),
        }),
        readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(`/api/purchasing/requests?id=${encodeURIComponent(id)}&page=1&pageSize=1`),
        readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(`/api/purchasing/comments?requestId=${encodeURIComponent(id)}&page=1&pageSize=100`),
      ])
      const granted = Array.isArray(featureCall.result?.granted) ? featureCall.result.granted : []
      const roleNames = Array.isArray(featureCall.result?.roles) ? featureCall.result.roles : []
      const nextPermissions = {
        canUpdateRequests: canManagePurchasingRequest(roleNames),
        canViewItems: canAccessPurchasingModule(roleNames),
        canOpenOperationalItems: canViewPurchasingOperationalItems(roleNames),
        canManageItems: canManagePurchasingItems(roleNames),
        canManageComments: canManagePurchasingComments(roleNames),
        canViewAttachments:
          featureCall.result?.ok === true
          || granted.includes('attachments.view')
          || granted.includes('attachments.manage'),
        canManageAttachments:
          featureCall.result?.ok === true
          || granted.includes('attachments.manage')
          || granted.includes('attachments.view'),
      }
      setPermissions(nextPermissions)
      const requestEntry = Array.isArray(requestPayload.items) ? requestPayload.items[0] : null
      if (!requestEntry) throw new Error(t('purchasing.requests.errors.notFound', 'Purchasing request not found.'))
      const itemPayload = nextPermissions.canViewItems
        ? await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(`/api/purchasing/request-items?requestId=${encodeURIComponent(id)}&page=1&pageSize=100`)
        : { items: [] }
      const nextItems = (Array.isArray(itemPayload.items) ? itemPayload.items : []).map(mapItemRecord)
      Object.values(itemSaveTimersRef.current).forEach((timer) => clearTimeout(timer))
      Object.values(itemSaveResetTimersRef.current).forEach((timer) => clearTimeout(timer))
      itemSaveTimersRef.current = {}
      itemSaveResetTimersRef.current = {}
      itemSavedSnapshotRef.current = Object.fromEntries(
        nextItems.map((item) => [item.id, serializeRequestItemPayload(item)]),
      )
      setItemSaveStates({})
      setRecord(mapRequestRecord(requestEntry))
      setItems(nextItems)
      setComments((Array.isArray(commentPayload.items) ? commentPayload.items : []).map(mapCommentRecord))
      setHistoryLoading(true)
      try {
        const historyPayload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          `/api/purchasing/request-history?requestId=${encodeURIComponent(id)}&limit=100`,
        )
        setHistory((Array.isArray(historyPayload.items) ? historyPayload.items : []).map(mapHistoryRecord))
      } catch {
        setHistory([])
      } finally {
        setHistoryLoading(false)
      }
      setRequestFieldErrors({})
      setRequestFormError(null)
      setItemFieldErrors({})
      setCommentFieldErrors({})
      setCommentFormError(null)
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : t('purchasing.requests.errors.load', 'Failed to load purchasing request.')
      setError(message)
      setRecord(null)
      setItems([])
      setComments([])
      setHistory([])
      itemSavedSnapshotRef.current = {}
      setItemSaveStates({})
      setPermissions({
        canUpdateRequests: false,
        canViewItems: false,
        canOpenOperationalItems: false,
        canManageItems: false,
        canManageComments: false,
        canViewAttachments: false,
        canManageAttachments: false,
      })
    } finally {
      setIsLoading(false)
    }
  }, [id, t])

  React.useEffect(() => {
    recordRef.current = record
  }, [record])

  React.useEffect(() => {
    itemsRef.current = items
  }, [items])

  React.useEffect(() => {
    setSelectedItemIds((current) => current.filter((itemId) => items.some((item) => item.id === itemId)))
  }, [items])

  React.useEffect(() => {
    return () => {
      Object.values(itemSaveTimersRef.current).forEach((timer) => clearTimeout(timer))
      Object.values(itemSaveResetTimersRef.current).forEach((timer) => clearTimeout(timer))
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function loadAssignees() {
      try {
        const payload = await readApiResultOrThrow<{ items?: AssigneeOption[] }>('/api/purchasing/assignees')
        if (!cancelled) setAssignees(Array.isArray(payload.items) ? payload.items : [])
      } catch {
        if (!cancelled) setAssignees([])
      }
    }
    void loadAssignees()
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const saveRequest = React.useCallback(async () => {
    const currentRecord = recordRef.current
    if (!currentRecord) return
    const validation = validateRequestDetailForm(currentRecord, t)
    if (Object.keys(validation.fieldErrors).length > 0) {
      setRequestFieldErrors(validation.fieldErrors)
      setRequestFormError(validation.message ?? t('purchasing.validation.fixHighlightedFields', 'Check the highlighted fields and try again.'))
      return
    }
    try {
      setRequestFieldErrors({})
      setRequestFormError(null)
      await runMutation({
        operation: () => readApiResultOrThrow<{ ok: boolean }>(
          '/api/purchasing/requests',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: currentRecord.id,
              customerNip: currentRecord.customerNip,
              customerName: currentRecord.customerName,
              customerOrderNumber: currentRecord.customerOrderNumber,
              requestText: currentRecord.requestText,
              purchasingOwnerUserId: currentRecord.purchasingOwnerUserId,
              requestStatus: currentRecord.requestStatus,
            }),
          },
        ),
        context: { resourceType: 'purchasing.request', resourceId: currentRecord.id },
        mutationPayload: currentRecord,
      })
      flash(t('purchasing.requests.flash.updated', 'Purchasing request updated.'), 'success')
    } catch (saveError) {
      const normalized = resolvePurchasingFormError(
        saveError,
        t('purchasing.requests.errors.update', 'Failed to update purchasing request.'),
      )
      setRequestFieldErrors(normalized.fieldErrors)
      setRequestFormError(normalized.message)
      const message = normalized.message
      flash(message, 'error')
    }
  }, [runMutation, t])

  const saveItem = React.useCallback(async (itemId: string) => {
    const item = itemsRef.current.find((entry) => entry.id === itemId)
    if (!item || !id) return
    const validation = validateRequestItemForm(item, t)
    if (Object.keys(validation.fieldErrors).length > 0) {
      setItemFieldErrors((current) => ({
        ...current,
        [itemId]: validation.fieldErrors,
      }))
      setItemSaveStates((current) => ({ ...current, [itemId]: 'error' }))
      return
    }
    try {
      if (itemSaveResetTimersRef.current[itemId]) {
        clearTimeout(itemSaveResetTimersRef.current[itemId])
        delete itemSaveResetTimersRef.current[itemId]
      }
      setItemFieldErrors((current) => {
        const next = { ...current }
        delete next[itemId]
        return next
      })
      setItemSaveStates((current) => ({ ...current, [itemId]: 'saving' }))
      const payload = buildRequestItemPayload(item)
      await runMutation({
        operation: () => readApiResultOrThrow<{ ok: boolean }>(
          '/api/purchasing/request-items',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
        ),
        context: { resourceType: 'purchasing.request', resourceId: id },
        mutationPayload: payload,
      })
      itemSavedSnapshotRef.current[itemId] = serializeRequestItemPayload(item)
      setItemSaveStates((current) => ({ ...current, [itemId]: 'saved' }))
      itemSaveResetTimersRef.current[itemId] = setTimeout(() => {
        setItemSaveStates((current) => (current[itemId] === 'saved' ? { ...current, [itemId]: 'idle' } : current))
        delete itemSaveResetTimersRef.current[itemId]
      }, 1500)
      const requestPayload = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
        `/api/purchasing/requests?id=${encodeURIComponent(id)}&page=1&pageSize=1`,
      )
      const requestEntry = Array.isArray(requestPayload.items) ? requestPayload.items[0] : null
      if (requestEntry) setRecord(mapRequestRecord(requestEntry))
      const latest = itemsRef.current.find((entry) => entry.id === itemId)
      if (latest && serializeRequestItemPayload(latest) !== itemSavedSnapshotRef.current[itemId]) {
        setItemSaveStates((current) => ({ ...current, [itemId]: 'dirty' }))
      }
    } catch (saveError) {
      const normalized = resolvePurchasingFormError(
        saveError,
        t('purchasing.items.errors.update', 'Failed to update request item.'),
      )
      setItemFieldErrors((current) => ({
        ...current,
        [itemId]: normalized.fieldErrors,
      }))
      setItemSaveStates((current) => ({ ...current, [itemId]: 'error' }))
      flash(normalized.message, 'error')
    }
  }, [id, runMutation, t])

  const queueItemAutosave = React.useCallback((itemId: string, delay = 800) => {
    if (itemSaveTimersRef.current[itemId]) clearTimeout(itemSaveTimersRef.current[itemId])
    itemSaveTimersRef.current[itemId] = setTimeout(() => {
      delete itemSaveTimersRef.current[itemId]
      void saveItem(itemId)
    }, delay)
  }, [saveItem])

  React.useEffect(() => {
    if (!permissions.canManageItems) return
    const nextIds = new Set(items.map((item) => item.id))
    const removedIds = new Set<string>()
    for (const itemId of Object.keys(itemSavedSnapshotRef.current)) {
      if (nextIds.has(itemId)) continue
      removedIds.add(itemId)
      delete itemSavedSnapshotRef.current[itemId]
      if (itemSaveTimersRef.current[itemId]) {
        clearTimeout(itemSaveTimersRef.current[itemId])
        delete itemSaveTimersRef.current[itemId]
      }
      if (itemSaveResetTimersRef.current[itemId]) {
        clearTimeout(itemSaveResetTimersRef.current[itemId])
        delete itemSaveResetTimersRef.current[itemId]
      }
    }
    let hasDirtyChanges = false
    for (const item of items) {
      const serialized = serializeRequestItemPayload(item)
      const saved = itemSavedSnapshotRef.current[item.id]
      if (typeof saved === 'undefined') {
        itemSavedSnapshotRef.current[item.id] = serialized
        continue
      }
      if (saved === serialized) continue
      hasDirtyChanges = true
      queueItemAutosave(item.id)
    }
    if (removedIds.size > 0 || hasDirtyChanges) {
      setItemSaveStates((current) => {
        let changed = false
        const next = { ...current }
        for (const itemId of removedIds) {
          if (itemId in next) {
            delete next[itemId]
            changed = true
          }
        }
        if (hasDirtyChanges) {
          for (const item of items) {
            const serialized = serializeRequestItemPayload(item)
            const saved = itemSavedSnapshotRef.current[item.id]
            if (saved === serialized || next[item.id] === 'saving' || next[item.id] === 'dirty') continue
            next[item.id] = 'dirty'
            changed = true
          }
        }
        return changed ? next : current
      })
    }
  }, [items, permissions.canManageItems, queueItemAutosave])

  const removeItem = React.useCallback(async (itemId: string) => {
    if (!permissions.canManageItems) return
    try {
      await runMutation({
        operation: () => readApiResultOrThrow<{ ok: boolean }>(
          `/api/purchasing/request-items?id=${encodeURIComponent(itemId)}`,
          { method: 'DELETE' },
        ),
        context: { resourceType: 'purchasing.request', resourceId: id },
        mutationPayload: { id: itemId },
      })
      flash(t('purchasing.items.flash.deleted', 'Product removed from the request.'), 'success')
      await load()
    } catch (error) {
      const normalized = resolvePurchasingFormError(
        error,
        t('purchasing.items.errors.delete', 'Failed to remove product from request.'),
      )
      flash(normalized.message, 'error')
    }
  }, [id, load, permissions.canManageItems, runMutation, t])

  const allItemsSelected = items.length > 0 && selectedItemIds.length === items.length

  const applyBulkItemPatch = React.useCallback((
    patch: Partial<Pick<RequestItemRecord, 'itemStatus' | 'quantity' | 'supplierOrderNumber' | 'purchasingNote'>>,
    fieldsToClear: Array<'itemStatus' | 'quantity' | 'supplierOrderNumber' | 'purchasingNote'>,
  ) => {
    if (!permissions.canManageItems || selectedItemIds.length === 0) return
    const selectedIdSet = new Set(selectedItemIds)
    setItems((current) => current.map((item) => (
      selectedIdSet.has(item.id)
        ? { ...item, ...patch }
        : item
    )))
    setItemFieldErrors((current) => {
      const next = { ...current }
      for (const itemId of selectedItemIds) {
        let fieldState = next[itemId] ?? {}
        for (const field of fieldsToClear) fieldState = clearFieldError(fieldState, field)
        next[itemId] = fieldState
      }
      return next
    })
  }, [permissions.canManageItems, selectedItemIds])

  const addComment = React.useCallback(async () => {
    if (!id) return
    const validation = validateCommentForm(commentBody, t)
    if (Object.keys(validation.fieldErrors).length > 0) {
      setCommentFieldErrors(validation.fieldErrors)
      setCommentFormError(validation.message ?? t('purchasing.validation.fixHighlightedFields', 'Check the highlighted fields and try again.'))
      return
    }
    try {
      setCommentFieldErrors({})
      setCommentFormError(null)
      await runMutation({
        operation: () => readApiResultOrThrow<{ id?: string }>(
          '/api/purchasing/comments',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              requestId: id,
              body: commentBody.trim(),
            }),
          },
        ),
        context: { resourceType: 'purchasing.request', resourceId: id },
        mutationPayload: { requestId: id, body: commentBody.trim() },
      })
      setCommentBody('')
      flash(t('purchasing.comments.flash.created', 'Comment added.'), 'success')
      await load()
    } catch (saveError) {
      const normalized = resolvePurchasingFormError(
        saveError,
        t('purchasing.comments.errors.create', 'Failed to add comment.'),
      )
      setCommentFieldErrors(normalized.fieldErrors)
      setCommentFormError(normalized.message)
      const message = normalized.message
      flash(message, 'error')
    }
  }, [commentBody, id, load, runMutation, t])

  const tabs = React.useMemo(
    () => [
      { id: 'items' as const, label: t('purchasing.requests.detail.tabs.items', 'Items') },
      { id: 'comments' as const, label: t('purchasing.requests.detail.tabs.comments', 'Comments') },
      { id: 'attachments' as const, label: t('purchasing.requests.detail.tabs.attachments', 'Attachments') },
      { id: 'history' as const, label: t('purchasing.requests.detail.tabs.history', 'Activity history') },
    ],
    [t],
  )

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('purchasing.requests.loading', 'Loading purchasing request...')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !record) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('purchasing.requests.errors.load', 'Failed to load purchasing request.')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody className="space-y-6">
        <div className="space-y-6" data-testid="purchasing-request-detail-page">
          <FormHeader
            mode="detail"
            backHref="/backend/purchasing/requests"
            backLabel={t('common.back', 'Back')}
            entityTypeLabel={t('purchasing.requests.detail.title', 'Purchasing request')}
            title={(
              <div className="flex min-w-0 items-center gap-3">
                <span className="truncate">{record.requestNumber}</span>
                <Badge
                  data-testid="purchasing-detail-request-status"
                  variant={resolveRequestStatusVariant(record.requestStatus)}
                  className={cn('shrink-0 font-semibold', resolveRequestStatusClassName(record.requestStatus))}
                >
                  {t(`purchasing.requestStatus.${record.requestStatus}`, record.requestStatus)}
                </Badge>
                <span className="truncate text-sm font-normal text-muted-foreground">
                  {`${record.customerName ?? '-'}${record.customerNip ? ` · NIP ${record.customerNip}` : ''}`}
                </span>
              </div>
            )}
            actionsContent={(
              <div className="flex flex-wrap gap-2">
                {permissions.canOpenOperationalItems ? (
                  <Button data-testid="purchasing-detail-open-items-view" type="button" variant="outline" size="sm" onClick={() => router.push(`/backend/purchasing/request-items?requestId=${encodeURIComponent(record.id)}`)}>
                    {t('purchasing.items.actions.openOperationalList', 'Open items view')}
                  </Button>
                ) : null}
                {permissions.canUpdateRequests ? (
                  <Button data-testid="purchasing-detail-save-request" type="button" size="sm" onClick={() => { void saveRequest() }}>
                    {t('common.save', 'Save')}
                  </Button>
                ) : null}
              </div>
            )}
          />

          <section className="space-y-6">
            <section className="rounded-lg border bg-card p-4 shadow-sm">
              <FormErrorNotice message={requestFormError} />
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">{t('purchasing.requests.side.overview', 'Overview')}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('purchasing.requests.side.overviewHint', 'Core request context for customer, source, and current workload.')}
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('purchasing.requests.fields.customerName', 'Customer name')}</div>
                    {permissions.canUpdateRequests ? (
                      <>
                        <Input
                          data-testid="purchasing-detail-customer-name"
                          value={record.customerName ?? ''}
                          onChange={(event) => {
                            setRecord((current) => current ? { ...current, customerName: event.target.value } : current)
                            setRequestFieldErrors((current) => clearFieldError(clearFieldError(current, 'customerName'), 'customerNip'))
                          }}
                          aria-invalid={requestFieldErrors.customerName ? 'true' : 'false'}
                          className={cn(requestFieldErrors.customerName ? 'border-destructive focus-visible:ring-destructive/30' : null)}
                        />
                        <FieldError message={requestFieldErrors.customerName} />
                      </>
                    ) : (
                      <div className="text-base font-medium" data-testid="purchasing-detail-customer-name-readonly">{record.customerName ?? '-'}</div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('purchasing.requests.fields.customerNip', 'Customer NIP')}</div>
                    {permissions.canUpdateRequests ? (
                      <>
                        <Input
                          data-testid="purchasing-detail-customer-nip"
                          value={record.customerNip ?? ''}
                          onChange={(event) => {
                            setRecord((current) => current ? { ...current, customerNip: event.target.value } : current)
                            setRequestFieldErrors((current) => clearFieldError(clearFieldError(current, 'customerNip'), 'customerName'))
                          }}
                          aria-invalid={requestFieldErrors.customerNip ? 'true' : 'false'}
                          className={cn(requestFieldErrors.customerNip ? 'border-destructive focus-visible:ring-destructive/30' : null)}
                        />
                        <FieldError message={requestFieldErrors.customerNip} />
                      </>
                    ) : (
                      <div className="text-base font-medium" data-testid="purchasing-detail-customer-nip-readonly">{record.customerNip ?? '-'}</div>
                    )}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <RequestInfoStat
                    label={t('purchasing.requests.fields.sourceChannel', 'Source channel')}
                    value={t(`purchasing.source.${record.sourceChannel ?? 'other'}`, record.sourceChannel ?? 'Other')}
                  />
                  <RequestInfoStat
                    label={t('purchasing.requests.fields.formVariant', 'Form variant')}
                    value={t(`purchasing.formVariant.${record.formVariant ?? 'simple'}`, record.formVariant ?? 'Simple')}
                  />
                  <RequestInfoStat
                    label={t('purchasing.requests.summary.itemsCount', 'Items')}
                    value={String(items.length)}
                  />
                  <RequestInfoStat
                    label={t('purchasing.requests.summary.openItems', 'Open items')}
                    value={String(items.filter((item) => isOpenItemStatus(item.itemStatus)).length)}
                  />
                </div>
                <div className="rounded-md border bg-muted/10 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('purchasing.requests.side.workflow', 'Workflow')}</h3>
                    <Badge
                      variant={resolveRequestStatusVariant(record.requestStatus)}
                      className={cn('font-semibold', resolveRequestStatusClassName(record.requestStatus))}
                    >
                      {t(`purchasing.requestStatus.${record.requestStatus}`, record.requestStatus)}
                    </Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.1fr_1.2fr_1fr_180px]">
                    <div className="space-y-2">
                      <FieldLabel>{t('purchasing.requests.fields.requestStatus', 'Request status')}</FieldLabel>
                      <select
                        data-testid="purchasing-detail-request-status-select"
                        className={selectClassName()}
                        value={record.requestStatus}
                        onChange={(event) => setRecord((current) => current ? { ...current, requestStatus: event.target.value } : current)}
                        disabled={!permissions.canUpdateRequests}
                      >
                        {requestStatusViewValues.map((status) => (
                          <option key={status} value={status}>
                            {t(`purchasing.requestStatus.${status}`, status)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>{t('purchasing.requests.fields.purchasingOwner', 'Purchasing owner')}</FieldLabel>
                      {permissions.canUpdateRequests ? (
                        <select
                          data-testid="purchasing-detail-owner-select"
                          className={selectClassName()}
                          value={record.purchasingOwnerUserId ?? ''}
                          onChange={(event) => setRecord((current) => current ? { ...current, purchasingOwnerUserId: event.target.value || null } : current)}
                        >
                          <option value="">{t('purchasing.requests.fields.purchasingOwnerPlaceholder', 'Unassigned')}</option>
                          {assignees.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          data-testid="purchasing-detail-owner-readonly"
                          value={resolveAssigneeLabel(assignees, record.purchasingOwnerUserId, t('purchasing.requests.fields.purchasingOwnerPlaceholder', 'Unassigned'))}
                          readOnly
                        />
                      )}
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>{t('purchasing.requests.fields.customerOrderNumber', 'Customer order number')}</FieldLabel>
                      <Input
                        value={record.customerOrderNumber ?? ''}
                        onChange={(event) => setRecord((current) => current ? { ...current, customerOrderNumber: event.target.value } : current)}
                        readOnly={!permissions.canUpdateRequests}
                      />
                    </div>
                    <div className="flex items-end">
                      {permissions.canUpdateRequests ? (
                        <Button
                          data-testid="purchasing-detail-save-workflow"
                          type="button"
                          className="w-full"
                          onClick={() => { void saveRequest() }}
                        >
                          {t('purchasing.requests.actions.saveWorkflow', 'Save workflow')}
                        </Button>
                      ) : (
                        <div className="w-full text-sm text-muted-foreground">
                          {t('purchasing.requests.side.workflowHint', 'Save workflow after changing request status, owner, or customer order number.')}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <DetailTabsLayout
              className="space-y-6"
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              sectionAction={null}
              onSectionAction={() => {}}
              navAriaLabel={t('purchasing.requests.detail.tabs.label', 'Purchasing request detail sections')}
              navClassName="gap-4"
            >
              {activeTab === 'items' ? (
                <section className="space-y-4 rounded-lg border bg-card p-4 shadow-sm" data-testid="purchasing-detail-items-section">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                <div>
                  <div>
                    <h2 className="text-xl font-semibold" data-testid="purchasing-detail-selected-items-title">{t('purchasing.items.section.title', 'Request items')}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('purchasing.items.preview.helper', 'Review selected products and update operational fields for each item.')}
                    </p>
                  </div>
                </div>
                <div className="rounded-full border bg-muted/20 px-3 py-1 text-sm text-muted-foreground" data-testid="purchasing-detail-selected-items-count">
                  {t('purchasing.items.selected.count', '{count} selected', { count: items.length })}
                </div>
              </div>
              <div className="space-y-4" data-testid="purchasing-detail-selected-items">
                {items.length === 0 ? (
                  <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground" data-testid="purchasing-detail-items-empty">
                    {permissions.canManageItems
                      ? t('purchasing.items.emptyDetailManage', 'No products are attached to this request yet.')
                      : t('purchasing.items.emptyDetailView', 'No products are attached to this request yet.')}
                  </div>
                ) : null}
                {items.length > 0 ? (
                  <div className="space-y-3">
                    {permissions.canManageItems ? (
                      <div className="rounded-lg border bg-muted/15 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedItemIds(allItemsSelected ? [] : items.map((item) => item.id))}
                          >
                            {allItemsSelected
                              ? t('purchasing.items.bulk.clearSelection', 'Clear selection')
                              : t('purchasing.items.bulk.selectAll', 'Select all visible items')}
                          </Button>
                          {selectedItemIds.length > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              {t('purchasing.items.bulk.selectedCount', '{count} selected', { count: selectedItemIds.length })}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-3 grid gap-3 xl:grid-cols-4">
                          <div className="space-y-2">
                            <FieldLabel>{t('purchasing.items.bulk.status', 'Bulk status update')}</FieldLabel>
                            <select
                              data-testid="purchasing-detail-bulk-status"
                              className={selectClassName()}
                              value={bulkItemStatus}
                              onChange={(event) => setBulkItemStatus(event.target.value)}
                              disabled={selectedItemIds.length === 0}
                            >
                              <option value="">{t('purchasing.items.filters.allStatuses', 'All statuses')}</option>
                              {itemStatusViewValues.map((status) => (
                                <option key={status} value={status}>
                                  {t(`purchasing.itemStatus.${status}`, status)}
                                </option>
                              ))}
                            </select>
                            <Button
                              data-testid="purchasing-detail-bulk-apply-status"
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={selectedItemIds.length === 0 || bulkItemStatus.length === 0}
                              onClick={() => {
                                applyBulkItemPatch({ itemStatus: bulkItemStatus }, ['itemStatus'])
                              }}
                            >
                              {t('purchasing.items.bulk.applyStatus', 'Apply status')}
                            </Button>
                          </div>
                          <div className="space-y-2">
                            <FieldLabel>{t('purchasing.items.bulk.quantity', 'Bulk quantity')}</FieldLabel>
                            <Input
                              data-testid="purchasing-detail-bulk-quantity"
                              type="number"
                              min="1"
                              step="1"
                              value={bulkQuantity}
                              onChange={(event) => setBulkQuantity(event.target.value)}
                              disabled={selectedItemIds.length === 0}
                              placeholder={t('purchasing.items.fields.quantity', 'Quantity')}
                            />
                            <Button
                              data-testid="purchasing-detail-bulk-apply-quantity"
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={selectedItemIds.length === 0 || bulkQuantity.trim().length === 0}
                              onClick={() => {
                                const nextQuantity = Number(bulkQuantity)
                                if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) return
                                applyBulkItemPatch({ quantity: nextQuantity }, ['quantity'])
                              }}
                            >
                              {t('purchasing.items.bulk.applyQuantity', 'Apply quantity')}
                            </Button>
                          </div>
                          <div className="space-y-2">
                            <FieldLabel>{t('purchasing.items.bulk.supplierOrderNumber', 'Bulk supplier order')}</FieldLabel>
                            <Input
                              data-testid="purchasing-detail-bulk-supplier-order"
                              value={bulkSupplierOrderNumber}
                              onChange={(event) => setBulkSupplierOrderNumber(event.target.value)}
                              disabled={selectedItemIds.length === 0}
                              placeholder={t('purchasing.items.fields.supplierOrderNumber', 'Supplier order number')}
                            />
                            <Button
                              data-testid="purchasing-detail-bulk-apply-supplier-order"
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={selectedItemIds.length === 0}
                              onClick={() => {
                                applyBulkItemPatch({ supplierOrderNumber: bulkSupplierOrderNumber || null }, ['supplierOrderNumber'])
                              }}
                            >
                              {t('purchasing.items.bulk.applySupplierOrderNumber', 'Apply supplier order')}
                            </Button>
                          </div>
                          <div className="space-y-2">
                            <FieldLabel>{t('purchasing.items.bulk.note', 'Bulk note')}</FieldLabel>
                            <Textarea
                              data-testid="purchasing-detail-bulk-note"
                              rows={2}
                              value={bulkPurchasingNote}
                              onChange={(event) => setBulkPurchasingNote(event.target.value)}
                              disabled={selectedItemIds.length === 0}
                              placeholder={t('purchasing.items.fields.purchasingNote', 'Purchasing note')}
                            />
                            <Button
                              data-testid="purchasing-detail-bulk-apply-note"
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={selectedItemIds.length === 0}
                              onClick={() => {
                                applyBulkItemPatch({ purchasingNote: bulkPurchasingNote || null }, ['purchasingNote'])
                              }}
                            >
                              {t('purchasing.items.bulk.applyNote', 'Apply note')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="overflow-x-auto rounded-lg border" data-testid="purchasing-detail-items-table">
                    <Table className="min-w-[980px]">
                            <TableHeader className="bg-muted/40">
                              <TableRow>
                                {permissions.canManageItems ? (
                                  <TableHead className="w-[52px] text-center">
                                    <input
                                      type="checkbox"
                                      checked={allItemsSelected}
                                      onChange={() => setSelectedItemIds(allItemsSelected ? [] : items.map((item) => item.id))}
                                      aria-label={t('purchasing.items.bulk.selectAll', 'Select all visible items')}
                                    />
                                  </TableHead>
                                ) : null}
                                <TableHead>{t('purchasing.items.table.product', 'Product')}</TableHead>
                                <TableHead>{t('purchasing.items.table.quantity', 'Quantity')}</TableHead>
                                <TableHead>{t('purchasing.items.table.status', 'Status')}</TableHead>
                                <TableHead>{t('purchasing.items.table.supplierOrderNumber', 'Supplier order')}</TableHead>
                                <TableHead className="w-[180px] text-right">{t('common.actions', 'Actions')}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {items.map((item, index) => (
                                <TableRow key={item.id} className="align-top">
                                  {permissions.canManageItems ? (
                                    <TableCell className="text-center align-middle">
                                      <input
                                        type="checkbox"
                                        checked={selectedItemIds.includes(item.id)}
                                        onChange={() => {
                                          setSelectedItemIds((current) => (
                                            current.includes(item.id)
                                              ? current.filter((entryId) => entryId !== item.id)
                                              : [...current, item.id]
                                          ))
                                        }}
                                        aria-label={t('purchasing.items.bulk.selectRow', 'Select item')}
                                      />
                                    </TableCell>
                                  ) : null}
                                  <TableCell>
                                    <div className="min-w-[280px] space-y-3">
                                      <div className="font-medium" data-testid={`purchasing-detail-item-product-${index}`}>{item.productName}</div>
                                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                        <span>{t('purchasing.items.fields.sku', 'SKU')}: {item.sku || '—'}</span>
                                        <span>{t('purchasing.items.fields.referenceNumber', 'Reference number')}: {item.referenceNumber || '—'}</span>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge
                                          variant={resolveItemStatusVariant(item.itemStatus)}
                                          className={cn('font-semibold', resolveItemStatusClassName(item.itemStatus))}
                                        >
                                          {t(`purchasing.itemStatus.${item.itemStatus}`, item.itemStatus)}
                                        </Badge>
                                        {item.catalogProductId ? (
                                          <Badge variant="outline">{t('purchasing.products.lookup.selected', 'Selected')}</Badge>
                                        ) : null}
                                      </div>
                                      {itemFieldErrors[item.id]?.productName ? (
                                        <FieldError message={itemFieldErrors[item.id]?.productName} />
                                      ) : null}
                                      <div className="space-y-2">
                                        <FieldLabel>{t('purchasing.items.fields.purchasingNote', 'Purchasing note')}</FieldLabel>
                                        <Textarea
                                          data-testid={`purchasing-detail-item-note-${index}`}
                                          value={item.purchasingNote ?? ''}
                                          onChange={(event) => {
                                            setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, purchasingNote: event.target.value } : entry))
                                            setItemFieldErrors((current) => ({
                                              ...current,
                                              [item.id]: clearFieldError(current[item.id] ?? {}, 'purchasingNote'),
                                            }))
                                          }}
                                          rows={2}
                                          placeholder={t('purchasing.items.fields.purchasingNote', 'Purchasing note')}
                                          readOnly={!permissions.canManageItems}
                                        />
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="w-28 space-y-2">
                                      <Input
                                        data-testid={`purchasing-detail-item-quantity-${index}`}
                                        type="number"
                                        min="1"
                                        value={String(item.quantity)}
                                        onChange={(event) => {
                                          setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, quantity: Number(event.target.value || '0') } : entry))
                                          setItemFieldErrors((current) => ({
                                            ...current,
                                            [item.id]: clearFieldError(current[item.id] ?? {}, 'quantity'),
                                          }))
                                        }}
                                        aria-invalid={itemFieldErrors[item.id]?.quantity ? 'true' : 'false'}
                                        className={cn(itemFieldErrors[item.id]?.quantity ? 'border-destructive focus-visible:ring-destructive/30' : null)}
                                        readOnly={!permissions.canManageItems}
                                      />
                                      <FieldError message={itemFieldErrors[item.id]?.quantity} />
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="w-56">
                                      <select
                                        data-testid={`purchasing-detail-item-status-${index}`}
                                        className={selectClassName()}
                                        value={item.itemStatus}
                                        onChange={(event) => {
                                          setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, itemStatus: event.target.value } : entry))
                                          setItemFieldErrors((current) => ({
                                            ...current,
                                            [item.id]: clearFieldError(current[item.id] ?? {}, 'itemStatus'),
                                          }))
                                        }}
                                        disabled={!permissions.canManageItems}
                                      >
                                        {itemStatusViewValues.map((status) => (
                                          <option key={status} value={status}>
                                            {t(`purchasing.itemStatus.${status}`, status)}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="w-48">
                                      <Input
                                        data-testid={`purchasing-detail-item-supplier-order-${index}`}
                                        value={item.supplierOrderNumber ?? ''}
                                        onChange={(event) => {
                                          setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, supplierOrderNumber: event.target.value } : entry))
                                          setItemFieldErrors((current) => ({
                                            ...current,
                                            [item.id]: clearFieldError(current[item.id] ?? {}, 'supplierOrderNumber'),
                                          }))
                                        }}
                                        placeholder={t('purchasing.items.fields.supplierOrderNumber', 'Supplier order number')}
                                        readOnly={!permissions.canManageItems}
                                      />
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {permissions.canManageItems ? (
                                      <div className="flex items-center justify-end gap-2">
                                        <span
                                          className={cn(
                                            'text-xs font-medium',
                                            itemSaveStates[item.id] === 'error' ? 'text-destructive' : 'text-muted-foreground',
                                            itemSaveStates[item.id] === 'saved' ? 'text-emerald-600' : null,
                                          )}
                                          data-testid={`purchasing-detail-item-autosave-${index}`}
                                        >
                                          {itemSaveStates[item.id] === 'saving'
                                            ? t('purchasing.items.autosave.saving', 'Saving...')
                                            : itemSaveStates[item.id] === 'saved'
                                              ? t('purchasing.items.autosave.saved', 'Saved')
                                              : itemSaveStates[item.id] === 'error'
                                                ? t('purchasing.items.autosave.error', 'Save failed')
                                                : itemSaveStates[item.id] === 'dirty'
                                                  ? t('purchasing.items.autosave.pending', 'Saving soon')
                                                  : t('purchasing.items.autosave.idle', 'Up to date')}
                                        </span>
                                        <Button
                                          data-testid={`purchasing-detail-item-remove-${index}`}
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => { void removeItem(item.id) }}
                                        >
                                          {t('purchasing.items.actions.remove', 'Remove')}
                                        </Button>
                                      </div>
                                    ) : (
                                      <span className="text-sm text-muted-foreground">{t('common.readOnly', 'Read only')}</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                    </Table>
                  </div>
                  </div>
                ) : null}
              </div>
                </section>
              ) : null}

              {activeTab === 'comments' ? (
                <section className="space-y-4 rounded-lg border bg-card p-4 shadow-sm" data-testid="purchasing-detail-comments-section">
              <div>
                <h2 className="text-xl font-semibold">{t('purchasing.comments.section.title', 'Comments')}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('purchasing.comments.helper', 'Keep sales and purchasing aligned with clear updates, blockers, and next steps.')}
                </p>
              </div>
              <div className="space-y-3">
                {comments.length === 0 ? (
                  <div className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
                    {t('purchasing.comments.empty', 'No activity yet. Add the first update for sales and purchasing.')}
                  </div>
                ) : null}
                {comments.map((comment) => (
                  <div key={comment.id} className="space-y-3 rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {comment.authorName ?? comment.authorEmail ?? comment.authorUserId ?? t('purchasing.comments.author.system', 'System')}
                        </div>
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{formatDateLabel(comment.createdAt)}</div>
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
                    {permissions.canViewAttachments ? (
                      <AttachmentsSection
                        entityId={E.purchasing.purchasing_comment}
                        recordId={comment.id}
                        title={t('purchasing.attachments.comment.title', 'Comment attachments')}
                        description={t('purchasing.attachments.comment.description', 'Attach supplier offers, screenshots, or supporting files directly to this comment.')}
                        showHeader={false}
                        onChanged={() => { void load() }}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
              {permissions.canManageComments ? (
                <div className="space-y-3 border-t pt-4">
                  <FormErrorNotice message={commentFormError} />
                  <div className="space-y-2">
                    <FieldLabel required>{t('purchasing.comments.fields.body', 'Add a comment')}</FieldLabel>
                    <Textarea
                      data-testid="purchasing-detail-comment-body"
                      value={commentBody}
                      onChange={(event) => {
                        setCommentBody(event.target.value)
                        setCommentFieldErrors((current) => clearFieldError(current, 'body'))
                      }}
                      rows={4}
                      placeholder={t('purchasing.comments.fields.body', 'Add a comment')}
                      aria-invalid={commentFieldErrors.body ? 'true' : 'false'}
                      className={cn(commentFieldErrors.body ? 'border-destructive focus-visible:ring-destructive/30' : null)}
                    />
                    <FieldError message={commentFieldErrors.body} />
                  </div>
                  <div className="flex justify-end">
                    <Button data-testid="purchasing-detail-add-comment" type="button" onClick={() => { void addComment() }}>
                      {t('purchasing.comments.actions.add', 'Add comment')}
                    </Button>
                  </div>
                </div>
              ) : null}
                </section>
              ) : null}

              {activeTab === 'attachments' ? (
                <section className="space-y-4 rounded-lg border bg-card p-4 shadow-sm" data-testid="purchasing-detail-attachments-section">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{t('purchasing.attachments.request.title', 'Request attachments')}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('purchasing.requests.detail.attachmentsHint', 'Keep request-level screenshots, customer files and competitor offers visible in one place.')}
                  </p>
                </div>
                <Badge variant="outline" data-testid="purchasing-detail-attachments-count">
                  {record.attachmentsCount}
                </Badge>
              </div>
              {permissions.canViewAttachments ? (
                <AttachmentsSection
                  entityId={E.purchasing.purchasing_request}
                  recordId={record.id}
                  title={t('purchasing.attachments.request.title', 'Request attachments')}
                  description={t('purchasing.attachments.request.description', 'Add screenshots, competitor offers, or customer files before creating the request.')}
                  showHeader={false}
                  onChanged={() => { void load() }}
                />
              ) : (
                <div className="rounded-md border border-dashed px-4 py-5 text-sm text-muted-foreground">
                  {t('purchasing.attachments.request.unavailable', 'Attachments are still unavailable for this session. Refresh the page after RBAC updates are applied.')}
                </div>
              )}
                </section>
              ) : null}

              {activeTab === 'history' ? (
                <section className="space-y-4 rounded-lg border bg-card p-4 shadow-sm" data-testid="purchasing-detail-history-section">
                  <div>
                    <h2 className="text-xl font-semibold">{t('purchasing.history.section.title', 'Activity history')}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('purchasing.history.section.helper', 'Track status transitions, comments, and request workflow actions over time.')}
                    </p>
                  </div>
                  {historyLoading ? (
                    <LoadingMessage label={t('purchasing.history.loading', 'Loading activity history...')} />
                  ) : null}
                  {!historyLoading && history.length === 0 ? (
                    <div className="rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
                      {t('purchasing.history.empty', 'No activity has been recorded for this request yet.')}
                    </div>
                  ) : null}
                  {!historyLoading && history.length > 0 ? (
                    <div className="space-y-3">
                      {history.map((entry, index) => (
                        <HistoryEntryCard
                          key={entry.id}
                          entry={entry}
                          isLast={index === history.length - 1}
                          t={t}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </DetailTabsLayout>
          </section>
        </div>
      </PageBody>
    </Page>
  )
}

function mapRequestRecord(item: Record<string, unknown>): RequestRecord {
  return {
    id: typeof item.id === 'string' ? item.id : '',
    requestNumber: typeof item.requestNumber === 'string' ? item.requestNumber : typeof item.request_number === 'string' ? item.request_number : '',
    customerNip: typeof item.customerNip === 'string' ? item.customerNip : typeof item.customer_nip === 'string' ? item.customer_nip : null,
    customerName: typeof item.customerName === 'string' ? item.customerName : typeof item.customer_name === 'string' ? item.customer_name : null,
    requestStatus: normalizeRequestStatusForView(
      typeof item.requestStatus === 'string' ? item.requestStatus : typeof item.request_status === 'string' ? item.request_status : 'unassigned',
    ),
    sourceChannel: typeof item.sourceChannel === 'string' ? item.sourceChannel : typeof item.source_channel === 'string' ? item.source_channel : null,
    formVariant: typeof item.formVariant === 'string' ? item.formVariant : typeof item.form_variant === 'string' ? item.form_variant : null,
    purchasingOwnerUserId: typeof item.purchasingOwnerUserId === 'string' ? item.purchasingOwnerUserId : typeof item.purchasing_owner_user_id === 'string' ? item.purchasing_owner_user_id : null,
    requestText: typeof item.requestText === 'string' ? item.requestText : typeof item.request_text === 'string' ? item.request_text : null,
    customerOrderNumber: typeof item.customerOrderNumber === 'string' ? item.customerOrderNumber : typeof item.customer_order_number === 'string' ? item.customer_order_number : null,
    attachmentsCount: typeof item.attachmentsCount === 'number' ? item.attachmentsCount : typeof item.attachments_count === 'number' ? item.attachments_count : 0,
  }
}

function mapItemRecord(item: Record<string, unknown>): RequestItemRecord {
  return {
    id: typeof item.id === 'string' ? item.id : '',
    catalogProductId: typeof item.catalogProductId === 'string' ? item.catalogProductId : typeof item.catalog_product_id === 'string' ? item.catalog_product_id : null,
    catalogQuery: typeof item.productName === 'string' ? item.productName : typeof item.product_name === 'string' ? item.product_name : '',
    sku: typeof item.sku === 'string' ? item.sku : null,
    referenceNumber: typeof item.referenceNumber === 'string' ? item.referenceNumber : typeof item.reference_number === 'string' ? item.reference_number : null,
    productName: typeof item.productName === 'string' ? item.productName : typeof item.product_name === 'string' ? item.product_name : '',
    quantity: typeof item.quantity === 'number' ? item.quantity : Number(item.quantity ?? 0),
    itemStatus: normalizeItemStatusForView(
      typeof item.itemStatus === 'string' ? item.itemStatus : typeof item.item_status === 'string' ? item.item_status : 'to_order',
    ),
    supplierOrderNumber: typeof item.supplierOrderNumber === 'string' ? item.supplierOrderNumber : typeof item.supplier_order_number === 'string' ? item.supplier_order_number : null,
    purchasingNote: typeof item.purchasingNote === 'string' ? item.purchasingNote : typeof item.purchasing_note === 'string' ? item.purchasing_note : null,
  }
}

function mapCommentRecord(item: Record<string, unknown>): CommentRecord {
  return {
    id: typeof item.id === 'string' ? item.id : '',
    body: typeof item.body === 'string' ? item.body : '',
    authorUserId:
      typeof item.authorUserId === 'string'
        ? item.authorUserId
        : typeof item.author_user_id === 'string'
          ? item.author_user_id
          : null,
    authorName:
      typeof item.authorName === 'string'
        ? item.authorName
        : typeof item.author_name === 'string'
          ? item.author_name
          : null,
    authorEmail:
      typeof item.authorEmail === 'string'
        ? item.authorEmail
        : typeof item.author_email === 'string'
          ? item.author_email
          : null,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : typeof item.created_at === 'string' ? item.created_at : null,
  }
}

function mapHistoryRecord(item: Record<string, unknown>): HistoryRecord {
  const actorCandidate = item.actor
  const metadataCandidate = item.metadata
  return {
    id: typeof item.id === 'string' ? item.id : '',
    occurredAt: typeof item.occurredAt === 'string' ? item.occurredAt : typeof item.occurred_at === 'string' ? item.occurred_at : new Date().toISOString(),
    kind: item.kind === 'status' || item.kind === 'action' || item.kind === 'comment' ? item.kind : 'action',
    action: typeof item.action === 'string' ? item.action : '',
    actor: actorCandidate && typeof actorCandidate === 'object'
      ? {
          id: typeof (actorCandidate as { id?: unknown }).id === 'string' ? (actorCandidate as { id?: string }).id ?? null : null,
          label: typeof (actorCandidate as { label?: unknown }).label === 'string' ? (actorCandidate as { label?: string }).label ?? 'system' : 'system',
        }
      : { id: null, label: 'system' },
    metadata: metadataCandidate && typeof metadataCandidate === 'object'
      ? {
          targetType:
            (metadataCandidate as { targetType?: unknown }).targetType === 'request'
            || (metadataCandidate as { targetType?: unknown }).targetType === 'item'
            || (metadataCandidate as { targetType?: unknown }).targetType === 'comment'
              ? (metadataCandidate as { targetType?: 'request' | 'item' | 'comment' }).targetType
              : undefined,
          targetLabel: typeof (metadataCandidate as { targetLabel?: unknown }).targetLabel === 'string'
            ? (metadataCandidate as { targetLabel?: string }).targetLabel ?? null
            : null,
          statusFrom: typeof (metadataCandidate as { statusFrom?: unknown }).statusFrom === 'string'
            ? (metadataCandidate as { statusFrom?: string }).statusFrom ?? null
            : null,
          statusTo: typeof (metadataCandidate as { statusTo?: unknown }).statusTo === 'string'
            ? (metadataCandidate as { statusTo?: string }).statusTo ?? null
            : null,
          commandId: typeof (metadataCandidate as { commandId?: unknown }).commandId === 'string'
            ? (metadataCandidate as { commandId?: string }).commandId ?? null
            : null,
        }
      : undefined,
  }
}

function buildRequestItemPayload(item: RequestItemRecord) {
  return {
    id: item.id,
    catalogProductId: item.catalogProductId,
    sku: item.sku,
    referenceNumber: item.referenceNumber,
    productName: item.productName,
    quantity: item.quantity,
    itemStatus: item.itemStatus,
    supplierOrderNumber: item.supplierOrderNumber,
    purchasingNote: item.purchasingNote,
  }
}

function serializeRequestItemPayload(item: RequestItemRecord): string {
  return JSON.stringify(buildRequestItemPayload(item))
}

function formatDateLabel(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function HistoryEntryCard({
  entry,
  isLast,
  t,
}: {
  entry: HistoryRecord
  isLast: boolean
  t: ReturnType<typeof useT>
}) {
  const occurredAt = formatDateTime(entry.occurredAt) ?? formatDateLabel(entry.occurredAt)
  const relativeTime = formatRelativeTime(entry.occurredAt)
  const statusFrom = entry.metadata?.statusFrom
  const statusTo = entry.metadata?.statusTo

  return (
    <div className="relative flex gap-3">
      {!isLast ? (
        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" aria-hidden />
      ) : null}
      <div className="relative z-10 mt-1 h-6 w-6 rounded-full border bg-muted" />
      <div className="flex-1 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium">{entry.actor.label}</div>
          <div className="text-xs text-muted-foreground" title={occurredAt}>
            {relativeTime ?? occurredAt}
          </div>
        </div>
        <div className="mt-2 space-y-2">
          {entry.kind === 'status' ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {entry.metadata?.targetLabel ?? t('purchasing.history.requestLabel', 'Request')}
              </span>
              <Badge variant="outline">
                {statusFrom ?? t('purchasing.history.statusUnknown', 'Unknown')}
              </Badge>
              <span className="text-muted-foreground">{t('purchasing.history.to', 'to')}</span>
              <Badge variant="secondary">
                {statusTo ?? t('purchasing.history.statusUnknown', 'Unknown')}
              </Badge>
            </div>
          ) : (
            <div className="whitespace-pre-wrap text-sm">{entry.action}</div>
          )}
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {entry.kind === 'comment'
              ? t('purchasing.history.kind.comment', 'Comment')
              : entry.kind === 'status'
                ? t('purchasing.history.kind.status', 'Status change')
                : t('purchasing.history.kind.action', 'Action')}
          </div>
        </div>
      </div>
    </div>
  )
}

function RequestInfoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/10 px-3 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-base font-medium leading-snug">{value}</div>
    </div>
  )
}

function resolveAssigneeLabel(assignees: AssigneeOption[], userId: string | null, fallback: string): string {
  if (!userId) return fallback
  const matched = assignees.find((option) => option.value === userId)
  return matched?.label ?? userId
}
