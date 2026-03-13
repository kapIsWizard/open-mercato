"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AttachmentsSection } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { CatalogProductLookup, type CatalogProductLookupRow } from '../../../../components/CatalogProductLookup'
import {
  clearFieldError,
  FieldError,
  FieldLabel,
  FormErrorNotice,
  requiredLabel,
  resolvePurchasingFormError,
  selectClassName,
  type PurchasingFormErrors,
  validateCreateRequestForm,
} from '../form-utils'

type DraftItem = {
  catalogProductId: string | null
  catalogQuery: string
  sku: string
  referenceNumber: string
  productName: string
  quantity: string
}

type AssigneeOption = {
  value: string
  label: string
}

type AttachmentListResponse = {
  items?: Array<{ id?: string | null }>
}

type FeatureCheckResponse = {
  ok?: boolean
  granted?: string[]
}

type CreatePagePermissions = {
  canViewAttachments: boolean
  canManageAttachments: boolean
}

function createTemporaryAttachmentRecordId(): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `purchasing-request-draft:${randomPart}`
}

export default function PurchasingRequestCreatePage() {
  const t = useT()
  const router = useRouter()
  const { runMutation } = useGuardedMutation<{ resourceType: string; resourceId: string | null }>({
    contextId: 'purchasing.requests.create',
  })
  const [customerNip, setCustomerNip] = React.useState('')
  const [customerName, setCustomerName] = React.useState('')
  const [sourceChannel, setSourceChannel] = React.useState('phone')
  const [formVariant, setFormVariant] = React.useState('simple')
  const [requestText, setRequestText] = React.useState('')
  const [customerOrderNumber, setCustomerOrderNumber] = React.useState('')
  const [purchasingOwnerUserId, setPurchasingOwnerUserId] = React.useState('')
  const [items, setItems] = React.useState<DraftItem[]>([])
  const [draftAttachmentRecordId] = React.useState(() => createTemporaryAttachmentRecordId())
  const [assignees, setAssignees] = React.useState<AssigneeOption[]>([])
  const [permissions, setPermissions] = React.useState<CreatePagePermissions>({
    canViewAttachments: false,
    canManageAttachments: false,
  })
  const [isSaving, setIsSaving] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<PurchasingFormErrors>({})
  const [formError, setFormError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function loadInitialData() {
      try {
        const [payload, featureCheck] = await Promise.all([
          readApiResultOrThrow<{ items?: AssigneeOption[] }>('/api/purchasing/assignees'),
          apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ features: ['attachments.view', 'attachments.manage'] }),
          }),
        ])
        if (!cancelled) {
          setAssignees(Array.isArray(payload.items) ? payload.items : [])
          const granted = Array.isArray(featureCheck.result?.granted) ? featureCheck.result.granted : []
          setPermissions({
            canViewAttachments: featureCheck.result?.ok === true || granted.includes('attachments.view'),
            canManageAttachments: featureCheck.result?.ok === true || granted.includes('attachments.manage'),
          })
        }
      } catch {
        if (!cancelled) {
          setAssignees([])
          setPermissions({
            canViewAttachments: false,
            canManageAttachments: false,
          })
        }
      }
    }
    void loadInitialData()
    return () => { cancelled = true }
  }, [])

  const loadDraftAttachmentIds = React.useCallback(async (): Promise<string[]> => {
    const call = await apiCall<AttachmentListResponse>(
      `/api/attachments?entityId=${encodeURIComponent(E.purchasing.purchasing_request)}&recordId=${encodeURIComponent(draftAttachmentRecordId)}`,
      undefined,
      { fallback: { items: [] } },
    )
    if (!call.ok || !Array.isArray(call.result?.items)) return []
    return call.result.items
      .map((item) => (typeof item.id === 'string' ? item.id : null))
      .filter((value): value is string => Boolean(value))
  }, [draftAttachmentRecordId])

  const submit = React.useCallback(async () => {
    const validation = validateCreateRequestForm({ customerNip, customerName, items }, t)
    if (Object.keys(validation.fieldErrors).length > 0) {
      setFieldErrors(validation.fieldErrors)
      setFormError(validation.message ?? t('purchasing.validation.fixHighlightedFields', 'Check the highlighted fields and try again.'))
      return
    }

    const payload = {
      customerNip: customerNip || null,
      customerName: customerName || null,
      sourceChannel,
      formVariant,
      requestText: requestText || null,
      customerOrderNumber: customerOrderNumber || null,
      purchasingOwnerUserId: purchasingOwnerUserId || null,
      items: items.map((item) => ({
        sku: item.sku || null,
        referenceNumber: item.referenceNumber || null,
        productName: item.productName,
        quantity: Number(item.quantity || '0'),
        catalogProductId: item.catalogProductId,
      })),
    }
    setIsSaving(true)
    setFieldErrors({})
    setFormError(null)
    try {
      const result = await runMutation({
        operation: () => readApiResultOrThrow<{ id?: string }>(
          '/api/purchasing/requests',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
        ),
        context: {
          resourceType: 'purchasing.request',
          resourceId: null,
        },
        mutationPayload: payload,
      })
      if (permissions.canViewAttachments && typeof result?.id === 'string' && result.id.length > 0) {
        const attachmentIds = await loadDraftAttachmentIds()
        if (attachmentIds.length > 0) {
          const transfer = await apiCall<{ ok?: boolean; error?: string }>(
            '/api/attachments/transfer',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                entityId: E.purchasing.purchasing_request,
                attachmentIds,
                fromRecordId: draftAttachmentRecordId,
                toRecordId: result.id,
              }),
            },
            { fallback: null },
          )
          if (!transfer.ok) {
            flash(
              transfer.result?.error ?? t('purchasing.attachments.errors.transfer', 'Request created, but attachment transfer failed.'),
              'warning',
            )
          }
        }
      }
      flash(t('purchasing.requests.flash.created', 'Purchasing request created.'), 'success')
      if (typeof result?.id === 'string' && result.id.length > 0) {
        router.push(`/backend/purchasing/requests/${encodeURIComponent(result.id)}`)
        return
      }
      router.push('/backend/purchasing/requests')
    } catch (error) {
      const normalized = resolvePurchasingFormError(
        error,
        t('purchasing.requests.errors.create', 'Failed to create purchasing request.'),
      )
      setFieldErrors(normalized.fieldErrors)
      setFormError(normalized.message)
      const message = normalized.message
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [
    customerNip,
    customerName,
    sourceChannel,
    formVariant,
    requestText,
    customerOrderNumber,
    purchasingOwnerUserId,
    items,
    runMutation,
    loadDraftAttachmentIds,
    router,
    draftAttachmentRecordId,
    t,
    permissions.canViewAttachments,
  ])

  const addCatalogProductToItems = React.useCallback((product: CatalogProductLookupRow) => {
    setItems((current) => {
      const existingIndex = current.findIndex((item) => item.catalogProductId === product.id)
      if (existingIndex >= 0) {
        return current.map((item, index) => {
          if (index !== existingIndex) return item
          const nextQuantity = Number(item.quantity || '0')
          return {
            ...item,
            quantity: String(Number.isFinite(nextQuantity) && nextQuantity > 0 ? nextQuantity + 1 : 1),
            catalogQuery: product.title,
            sku: product.sku ?? item.sku,
            referenceNumber: product.referenceNumber ?? item.referenceNumber,
            productName: product.title,
          }
        })
      }
      return [
        ...current,
        {
          catalogProductId: product.id,
          catalogQuery: product.title,
          sku: product.sku ?? '',
          referenceNumber: product.referenceNumber ?? '',
          productName: product.title,
          quantity: '1',
        },
      ]
    })
  }, [])

  const removeDraftItem = React.useCallback((indexToRemove: number) => {
    setItems((current) => current.filter((_, index) => index !== indexToRemove))
    setFieldErrors((current) => {
      const next: PurchasingFormErrors = {}
      for (const [key, value] of Object.entries(current)) {
        if (key.startsWith(`items.${indexToRemove}.`)) continue
        const match = key.match(/^items\.(\d+)\.(.+)$/)
        if (!match) {
          next[key] = value
          continue
        }
        const originalIndex = Number(match[1])
        const field = match[2]
        const mappedIndex = originalIndex > indexToRemove ? originalIndex - 1 : originalIndex
        next[`items.${mappedIndex}.${field}`] = value
      }
      return next
    })
  }, [])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6" data-testid="purchasing-request-create-page">
          <div>
            <h1 className="text-2xl font-semibold">{t('purchasing.requests.create.title', 'New purchasing request')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('purchasing.requests.create.subtitle', 'Capture the request quickly and split it into request items.')}</p>
          </div>

          <FormErrorNotice message={formError} />

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_380px]">
            <div className="space-y-6">
              <section className="space-y-4 rounded-lg border bg-card p-4">
                <div>
                  <h2 className="text-lg font-semibold">{t('purchasing.requests.create.customerSectionTitle', 'Customer context')}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('purchasing.validation.customerHint', 'Provide customer name or NIP so purchasing can identify the request.')}
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <FieldLabel>{t('purchasing.requests.fields.customerNip', 'Customer NIP')}</FieldLabel>
                    <Input
                      data-testid="purchasing-create-customer-nip"
                      value={customerNip}
                      onChange={(event) => {
                        setCustomerNip(event.target.value)
                        setFieldErrors((current) => clearFieldError(clearFieldError(current, 'customerNip'), 'customerName'))
                      }}
                      placeholder="1234567890"
                      aria-invalid={fieldErrors.customerNip ? 'true' : 'false'}
                      className={cn(fieldErrors.customerNip ? 'border-destructive focus-visible:ring-destructive/30' : null)}
                    />
                    <FieldError message={fieldErrors.customerNip} />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel>{requiredLabel(t('purchasing.requests.fields.customerName', 'Customer name'), t)}</FieldLabel>
                    <Input
                      data-testid="purchasing-create-customer-name"
                      value={customerName}
                      onChange={(event) => {
                        setCustomerName(event.target.value)
                        setFieldErrors((current) => clearFieldError(clearFieldError(current, 'customerName'), 'customerNip'))
                      }}
                      placeholder={t('purchasing.requests.fields.customerNamePlaceholder', 'Customer company name')}
                      aria-invalid={fieldErrors.customerName ? 'true' : 'false'}
                      className={cn(fieldErrors.customerName ? 'border-destructive focus-visible:ring-destructive/30' : null)}
                    />
                    <FieldError message={fieldErrors.customerName} />
                  </div>
                </div>
              </section>

              <section className="space-y-4 rounded-lg border bg-card p-4">
                <div>
                  <h2 className="text-lg font-semibold">{t('purchasing.requests.create.detailsSectionTitle', 'Request details')}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('purchasing.requests.create.detailsSectionDescription', 'Capture source, customer order number, and the raw request context in one place.')}
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <FieldLabel>{t('purchasing.requests.fields.sourceChannel', 'Source channel')}</FieldLabel>
                    <select data-testid="purchasing-create-source-channel" className={selectClassName()} value={sourceChannel} onChange={(event) => setSourceChannel(event.target.value)}>
                      <option value="phone">{t('purchasing.source.phone', 'Phone')}</option>
                      <option value="email">{t('purchasing.source.email', 'Email')}</option>
                      <option value="meeting">{t('purchasing.source.meeting', 'Meeting')}</option>
                      <option value="chat">{t('purchasing.source.chat', 'Chat')}</option>
                      <option value="other">{t('purchasing.source.other', 'Other')}</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <FieldLabel>{t('purchasing.requests.fields.formVariant', 'Form variant')}</FieldLabel>
                    <select data-testid="purchasing-create-form-variant" className={selectClassName()} value={formVariant} onChange={(event) => setFormVariant(event.target.value)}>
                      <option value="simple">{t('purchasing.formVariant.simple', 'Simple')}</option>
                      <option value="extended">{t('purchasing.formVariant.extended', 'Extended')}</option>
                    </select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <FieldLabel>{t('purchasing.requests.fields.customerOrderNumber', 'Customer order number')}</FieldLabel>
                    <Input data-testid="purchasing-create-customer-order-number" value={customerOrderNumber} onChange={(event) => setCustomerOrderNumber(event.target.value)} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <FieldLabel>{t('purchasing.requests.fields.requestText', 'Request text')}</FieldLabel>
                    <Textarea data-testid="purchasing-create-request-text" value={requestText} onChange={(event) => setRequestText(event.target.value)} rows={5} placeholder={t('purchasing.requests.fields.requestTextPlaceholder', 'Paste the raw customer request here.')} />
                  </div>
                </div>
              </section>
            </div>

            <aside className="space-y-6">
              <section className="space-y-4 rounded-lg border bg-card p-4">
                <div className="space-y-2">
                  <h2 className="text-base font-semibold">{t('purchasing.requests.create.assignmentTitle', 'Assignment')}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t('purchasing.requests.create.assignmentDescription', 'Assign the request to a purchaser now, or leave it unassigned and route it later.')}
                  </p>
                </div>
                <div className="space-y-2">
                  <FieldLabel>{t('purchasing.requests.fields.purchasingOwner', 'Purchasing owner')}</FieldLabel>
                  <select data-testid="purchasing-create-owner" className={selectClassName()} value={purchasingOwnerUserId} onChange={(event) => setPurchasingOwnerUserId(event.target.value)}>
                    <option value="">{t('purchasing.requests.fields.purchasingOwnerPlaceholder', 'Unassigned')}</option>
                    {assignees.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                  {purchasingOwnerUserId
                    ? assignees.find((option) => option.value === purchasingOwnerUserId)?.label
                    : t('purchasing.requests.create.unassignedHint', 'No purchasing owner selected yet.')}
                </div>
              </section>

              {permissions.canViewAttachments && permissions.canManageAttachments ? (
                <section className="space-y-4 rounded-lg border bg-card p-4" data-testid="purchasing-create-attachments-section">
                  <div>
                    <h3 className="text-base font-semibold">{t('purchasing.attachments.request.title', 'Request attachments')}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t('purchasing.attachments.request.description', 'Add screenshots, competitor offers, or customer files before creating the request.')}
                    </p>
                  </div>
                  <AttachmentsSection
                    entityId={E.purchasing.purchasing_request}
                    recordId={draftAttachmentRecordId}
                    title={t('purchasing.attachments.request.title', 'Request attachments')}
                    description={t('purchasing.attachments.request.description', 'Add screenshots, competitor offers, or customer files before creating the request.')}
                    showHeader={false}
                  />
                </section>
              ) : null}
            </aside>
          </section>

          <section className="space-y-4 rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium">{t('purchasing.items.section.title', 'Request items')}</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('purchasing.validation.itemsRequiredHint', 'Each request needs at least one item with a product name and quantity.')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => router.push('/backend/purchasing/products')}>
                  {t('purchasing.products.actions.openBrowser', 'Browse products')}
                </Button>
              </div>
            </div>
            <FieldError message={fieldErrors.items} />
            <section className="space-y-3 rounded-md border bg-muted/10 p-3">
              <div>
                <h3 className="text-base font-semibold">{t('purchasing.products.lookup.title', 'Product browser')}</h3>
              </div>
              <CatalogProductLookup
                rowId="create"
                selectedProductIds={items.map((item) => item.catalogProductId).filter((value): value is string => typeof value === 'string' && value.length > 0)}
                onPick={addCatalogProductToItems}
                disabled={isSaving}
                fullWidth
              />
            </section>
            <section className="space-y-3" data-testid="purchasing-create-selected-items">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold">{t('purchasing.items.selected.title', 'Selected products')}</h3>
                <div className="rounded-full border bg-muted/20 px-3 py-1 text-sm text-muted-foreground">
                  {t('purchasing.items.selected.count', 'Selected: {count}', { count: items.length })}
                </div>
              </div>
              {items.length === 0 ? (
                <div className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  {t('purchasing.items.emptySelection', 'No products selected yet. Use the product browser above to build the request.')}
                </div>
              ) : null}
              {items.map((item, index) => (
                <div key={`item-${index}`} className="space-y-3 rounded-md border p-3" data-testid={`purchasing-create-selected-item-${index}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
                      <span className="font-medium">{t('purchasing.products.lookup.selected', 'Selected')}:</span>{' '}
                      {item.productName || item.catalogQuery || t('purchasing.items.fields.productName', 'Product name')}
                      {item.referenceNumber ? ` · ${item.referenceNumber}` : ''}
                    </div>
                    <Button
                      data-testid={`purchasing-create-item-remove-${index}`}
                      type="button"
                      variant="ghost"
                      onClick={() => removeDraftItem(index)}
                    >
                      {t('purchasing.items.actions.remove', 'Remove')}
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[160px_180px_1fr_120px]">
                    <div className="space-y-2">
                      <FieldLabel>{t('purchasing.items.fields.sku', 'SKU')}</FieldLabel>
                      <Input
                        data-testid={`purchasing-create-item-sku-${index}`}
                        value={item.sku}
                        onChange={(event) => setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, sku: event.target.value } : entry))}
                        placeholder={t('purchasing.items.fields.sku', 'SKU')}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel>{t('purchasing.items.fields.referenceNumber', 'Reference number')}</FieldLabel>
                      <Input
                        data-testid={`purchasing-create-item-reference-${index}`}
                        value={item.referenceNumber}
                        onChange={(event) => setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, referenceNumber: event.target.value } : entry))}
                        placeholder={t('purchasing.items.fields.referenceNumber', 'Reference number')}
                      />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel required>{t('purchasing.items.fields.productName', 'Product name')}</FieldLabel>
                      <Input
                        data-testid={`purchasing-create-item-product-${index}`}
                        value={item.productName}
                        onChange={(event) => {
                          setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, productName: event.target.value, catalogQuery: event.target.value } : entry))
                          setFieldErrors((current) => clearFieldError(current, `items.${index}.productName`))
                        }}
                        placeholder={t('purchasing.items.fields.productName', 'Product name')}
                        aria-invalid={fieldErrors[`items.${index}.productName`] ? 'true' : 'false'}
                        className={cn(fieldErrors[`items.${index}.productName`] ? 'border-destructive focus-visible:ring-destructive/30' : null)}
                      />
                      <FieldError message={fieldErrors[`items.${index}.productName`]} />
                    </div>
                    <div className="space-y-2">
                      <FieldLabel required>{t('purchasing.items.fields.quantity', 'Quantity')}</FieldLabel>
                      <Input
                        data-testid={`purchasing-create-item-quantity-${index}`}
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(event) => {
                          setItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantity: event.target.value } : entry))
                          setFieldErrors((current) => clearFieldError(current, `items.${index}.quantity`))
                        }}
                        placeholder={t('purchasing.items.fields.quantity', 'Quantity')}
                        aria-invalid={fieldErrors[`items.${index}.quantity`] ? 'true' : 'false'}
                        className={cn(fieldErrors[`items.${index}.quantity`] ? 'border-destructive focus-visible:ring-destructive/30' : null)}
                      />
                      <FieldError message={fieldErrors[`items.${index}.quantity`]} />
                    </div>
                  </div>
                </div>
              ))}
            </section>
          </section>

          <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.push('/backend/purchasing/requests')}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button data-testid="purchasing-create-submit" type="button" onClick={() => { void submit() }} disabled={isSaving}>
              {isSaving ? t('common.saving', 'Saving...') : t('purchasing.requests.actions.save', 'Create request')}
            </Button>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
