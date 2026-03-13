"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { E } from '@/.mercato/generated/entities.ids.generated'
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
  isOpenItemStatus,
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
} from '../form-utils'

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
  createdAt: string | null
}

type AssigneeOption = {
  value: string
  label: string
}

type FeatureCheckResponse = {
  ok?: boolean
  granted?: string[]
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
  const [commentBody, setCommentBody] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [requestFieldErrors, setRequestFieldErrors] = React.useState<PurchasingFormErrors>({})
  const [requestFormError, setRequestFormError] = React.useState<string | null>(null)
  const [itemFieldErrors, setItemFieldErrors] = React.useState<Record<string, PurchasingFormErrors>>({})
  const [commentFieldErrors, setCommentFieldErrors] = React.useState<PurchasingFormErrors>({})
  const [commentFormError, setCommentFormError] = React.useState<string | null>(null)
  const recordRef = React.useRef<RequestRecord | null>(null)
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
              'purchasing.requests.update',
              'purchasing.items.view',
              'purchasing.items.update',
              'purchasing.comments.manage',
              'attachments.view',
              'attachments.manage',
            ],
          }),
        }),
        readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(`/api/purchasing/requests?id=${encodeURIComponent(id)}&page=1&pageSize=1`),
        readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(`/api/purchasing/comments?requestId=${encodeURIComponent(id)}&page=1&pageSize=100`),
      ])
      const granted = Array.isArray(featureCall.result?.granted) ? featureCall.result.granted : []
      const nextPermissions = {
        canUpdateRequests:
          featureCall.result?.ok === true
          || granted.includes('purchasing.requests.update')
          || granted.includes('purchasing.requests.assign')
          || granted.includes('purchasing.admin'),
        canViewItems: true,
        canOpenOperationalItems:
          featureCall.result?.ok === true
          || granted.includes('purchasing.items.view')
          || granted.includes('purchasing.items.update')
          || granted.includes('purchasing.admin'),
        canManageItems:
          featureCall.result?.ok === true
          || granted.includes('purchasing.items.update')
          || granted.includes('purchasing.admin'),
        canManageComments: featureCall.result?.ok === true || granted.includes('purchasing.comments.manage'),
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
      setRecord(mapRequestRecord(requestEntry))
      setItems((Array.isArray(itemPayload.items) ? itemPayload.items : []).map(mapItemRecord))
      setComments((Array.isArray(commentPayload.items) ? commentPayload.items : []).map(mapCommentRecord))
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
    const item = items.find((entry) => entry.id === itemId)
    if (!item) return
    const validation = validateRequestItemForm(item, t)
    if (Object.keys(validation.fieldErrors).length > 0) {
      setItemFieldErrors((current) => ({
        ...current,
        [itemId]: validation.fieldErrors,
      }))
      flash(validation.message ?? t('purchasing.validation.fixHighlightedFields', 'Check the highlighted fields and try again.'), 'error')
      return
    }
    try {
      setItemFieldErrors((current) => {
        const next = { ...current }
        delete next[itemId]
        return next
      })
      await runMutation({
        operation: () => readApiResultOrThrow<{ ok: boolean }>(
          '/api/purchasing/request-items',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: item.id,
              catalogProductId: item.catalogProductId,
              sku: item.sku,
              referenceNumber: item.referenceNumber,
              productName: item.productName,
              quantity: item.quantity,
              itemStatus: item.itemStatus,
              supplierOrderNumber: item.supplierOrderNumber,
              purchasingNote: item.purchasingNote,
            }),
          },
        ),
        context: { resourceType: 'purchasing.request', resourceId: id },
        mutationPayload: item,
      })
      flash(t('purchasing.items.flash.updated', 'Request item updated.'), 'success')
      await load()
    } catch (saveError) {
      const normalized = resolvePurchasingFormError(
        saveError,
        t('purchasing.items.errors.update', 'Failed to update request item.'),
      )
      setItemFieldErrors((current) => ({
        ...current,
        [itemId]: normalized.fieldErrors,
      }))
      const message = normalized.message
      flash(message, 'error')
    }
  }, [id, items, load, runMutation, t])

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
                <Badge data-testid="purchasing-detail-request-status" variant={resolveRequestStatusVariant(record.requestStatus)} className="shrink-0">
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
                    <Badge variant={resolveRequestStatusVariant(record.requestStatus)}>
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
                  <div className="overflow-x-auto rounded-lg border" data-testid="purchasing-detail-items-table">
                    <Table className="min-w-[980px]">
                            <TableHeader className="bg-muted/40">
                              <TableRow>
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
                                  <TableCell>
                                    <div className="min-w-[280px] space-y-3">
                                      <div className="font-medium" data-testid={`purchasing-detail-item-product-${index}`}>{item.productName}</div>
                                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                        <span>{t('purchasing.items.fields.sku', 'SKU')}: {item.sku || '—'}</span>
                                        <span>{t('purchasing.items.fields.referenceNumber', 'Reference number')}: {item.referenceNumber || '—'}</span>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant={resolveItemStatusVariant(item.itemStatus)}>
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
                                          onChange={(event) => setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, purchasingNote: event.target.value } : entry))}
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
                                        onChange={(event) => setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, itemStatus: event.target.value } : entry))}
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
                                        onChange={(event) => setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, supplierOrderNumber: event.target.value } : entry))}
                                        placeholder={t('purchasing.items.fields.supplierOrderNumber', 'Supplier order number')}
                                        readOnly={!permissions.canManageItems}
                                      />
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {permissions.canManageItems ? (
                                      <div className="flex justify-end gap-2">
                                        <Button data-testid={`purchasing-detail-item-save-${index}`} type="button" variant="outline" size="sm" onClick={() => { void saveItem(item.id) }}>
                                          {t('purchasing.items.actions.save', 'Save item')}
                                        </Button>
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
                ) : null}
              </div>
            </section>

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
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{formatDateLabel(comment.createdAt)}</div>
                    <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
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
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : typeof item.created_at === 'string' ? item.created_at : null,
  }
}

function formatDateLabel(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
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
