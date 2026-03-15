"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AttachmentsSection } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { CatalogProductLookup, type CatalogProductLookupRow } from '../../../../components/CatalogProductLookup'
import { CustomerCompanyLookup, type CustomerCompanyLookupOption } from '../../../../components/CustomerCompanyLookup'
import {
  clearFieldError,
  FieldError,
  FieldLabel,
  FormErrorNotice,
  requiredLabel,
  resolvePurchasingFormError,
  type PurchasingFormErrors,
  validateCreateRequestForm,
} from '../../../../lib/requestFormUtils'

type DraftItem = {
  catalogProductId: string | null
  catalogQuery: string
  sku: string
  referenceNumber: string
  productName: string
  quantity: string
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
  const [customerCompanyId, setCustomerCompanyId] = React.useState('')
  const [customerNip, setCustomerNip] = React.useState('')
  const [customerName, setCustomerName] = React.useState('')
  const [requestText, setRequestText] = React.useState('')
  const [customerOrderNumber, setCustomerOrderNumber] = React.useState('')
  const [items, setItems] = React.useState<DraftItem[]>([])
  const [itemsTab, setItemsTab] = React.useState<'catalog' | 'selected'>('catalog')
  const [draftAttachmentRecordId] = React.useState(() => createTemporaryAttachmentRecordId())
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
        const featureCheck = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['attachments.view', 'attachments.manage'] }),
        })
        if (!cancelled) {
          const granted = Array.isArray(featureCheck.result?.granted) ? featureCheck.result.granted : []
          setPermissions({
            canViewAttachments: featureCheck.result?.ok === true || granted.includes('attachments.view'),
            canManageAttachments: featureCheck.result?.ok === true || granted.includes('attachments.manage'),
          })
        }
      } catch {
        if (!cancelled) {
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
    const validation = validateCreateRequestForm({ customerCompanyId, customerNip, customerName, items }, t)
    if (Object.keys(validation.fieldErrors).length > 0) {
      setFieldErrors(validation.fieldErrors)
      setFormError(validation.message ?? t('purchasing.validation.fixHighlightedFields', 'Check the highlighted fields and try again.'))
      return
    }

    const payload = {
      customerCompanyId: customerCompanyId || null,
      customerNip: customerNip || null,
      customerName: customerName || null,
      requestText: requestText || null,
      customerOrderNumber: customerOrderNumber || null,
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
    customerCompanyId,
    customerNip,
    customerName,
    requestText,
    customerOrderNumber,
    items,
    runMutation,
    loadDraftAttachmentIds,
    router,
    draftAttachmentRecordId,
    t,
    permissions.canViewAttachments,
  ])

  const addCatalogProductToItems = React.useCallback((product: CatalogProductLookupRow, quantityToAdd: number) => {
    setItems((current) => {
      const existingIndex = current.findIndex((item) => item.catalogProductId === product.id)
      if (existingIndex >= 0) {
        const existingItem = current[existingIndex]!
        const nextQuantity = Number(existingItem.quantity || '0')
        const updatedItem: DraftItem = {
          ...existingItem,
          quantity: String(Number.isFinite(nextQuantity) && nextQuantity > 0 ? nextQuantity + quantityToAdd : quantityToAdd),
          catalogQuery: product.title,
          sku: product.sku ?? existingItem.sku,
          referenceNumber: product.referenceNumber ?? existingItem.referenceNumber,
          productName: product.title,
        }
        return [updatedItem, ...current.filter((_, index) => index !== existingIndex)]
      }
      return [
        {
          catalogProductId: product.id,
          catalogQuery: product.title,
          sku: product.sku ?? '',
          referenceNumber: product.referenceNumber ?? '',
          productName: product.title,
          quantity: String(quantityToAdd),
        },
        ...current,
      ]
    })
    setItemsTab('selected')
  }, [])

  const updateDraftItem = React.useCallback((indexToUpdate: number, patch: Partial<DraftItem>) => {
    setItems((current) => current.map((entry, entryIndex) => entryIndex === indexToUpdate ? { ...entry, ...patch } : entry))
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

  const removeDraftItemByProductId = React.useCallback((catalogProductId: string) => {
    setItems((current) => {
      const indexToRemove = current.findIndex((item) => item.catalogProductId === catalogProductId)
      if (indexToRemove < 0) return current
      return current.filter((_, index) => index !== indexToRemove)
    })
    setFieldErrors((current) => {
      const indexToRemove = items.findIndex((item) => item.catalogProductId === catalogProductId)
      if (indexToRemove < 0) return current
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
  }, [items])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6" data-testid="purchasing-request-create-page">
          <div>
            <h1 className="text-2xl font-semibold">{t('purchasing.requests.create.title', 'New purchasing request')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('purchasing.requests.create.subtitle', 'Capture the request quickly and split it into request items.')}</p>
          </div>

          <FormErrorNotice message={formError} />

          <section className="space-y-6">
            <section className="space-y-4 rounded-lg border bg-card p-4">
              <div>
                <h2 className="text-lg font-semibold">{t('purchasing.requests.create.customerSectionTitle', 'Customer context')}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('purchasing.validation.customerHint', 'Link an existing Open Mercato company or provide customer name / NIP so purchasing can identify the request.')}
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <FieldLabel>{t('purchasing.requests.fields.customerCompany', 'Open Mercato company')}</FieldLabel>
                  <CustomerCompanyLookup
                    value={customerCompanyId}
                    disabled={isSaving}
                    onChange={(next: CustomerCompanyLookupOption | null) => {
                      setCustomerCompanyId(next?.id ?? '')
                      if (next?.displayName) {
                        setCustomerName(next.displayName)
                      }
                      setFieldErrors((current) => clearFieldError(clearFieldError(current, 'customerName'), 'customerNip'))
                    }}
                  />
                </div>
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
                  {t('purchasing.requests.create.detailsSectionDescription', 'Capture the customer order reference and the raw request context in one place.')}
                </p>
              </div>
              <div className="grid gap-4">
                <div className="space-y-2">
                  <FieldLabel>{t('purchasing.requests.fields.customerOrderNumber', 'Customer order number')}</FieldLabel>
                  <Input data-testid="purchasing-create-customer-order-number" value={customerOrderNumber} onChange={(event) => setCustomerOrderNumber(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <FieldLabel>{t('purchasing.requests.fields.requestText', 'Request text')}</FieldLabel>
                  <Textarea data-testid="purchasing-create-request-text" value={requestText} onChange={(event) => setRequestText(event.target.value)} rows={5} placeholder={t('purchasing.requests.fields.requestTextPlaceholder', 'Paste the raw customer request here.')} />
                </div>
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
            <Tabs value={itemsTab} onValueChange={(value) => setItemsTab(value as 'catalog' | 'selected')} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-lg bg-muted/40 p-1 sm:w-auto">
                  <TabsTrigger value="catalog" className="whitespace-nowrap">
                    {t('purchasing.products.lookup.title', 'Product browser')}
                  </TabsTrigger>
                  <TabsTrigger value="selected" className="whitespace-nowrap">
                    {t('purchasing.items.selected.title', 'Selected products')} ({items.length})
                  </TabsTrigger>
                </TabsList>
                <div className="rounded-full border bg-muted/20 px-3 py-1 text-sm text-muted-foreground">
                  {t('purchasing.items.selected.count', 'Selected: {count}', { count: items.length })}
                </div>
              </div>

              <TabsContent value="catalog" className="mt-0 space-y-3 rounded-md border bg-muted/10 p-3">
                <CatalogProductLookup
                  rowId="create"
                  selectedProductIds={items.map((item) => item.catalogProductId).filter((value): value is string => typeof value === 'string' && value.length > 0)}
                  selectedProductQuantities={Object.fromEntries(
                    items
                      .filter((item): item is DraftItem & { catalogProductId: string } => typeof item.catalogProductId === 'string' && item.catalogProductId.length > 0)
                      .map((item) => [item.catalogProductId, item.quantity]),
                  )}
                  onPick={addCatalogProductToItems}
                  onRemove={removeDraftItemByProductId}
                  disabled={isSaving}
                  fullWidth
                />
              </TabsContent>

              <TabsContent value="selected" className="mt-0 space-y-3" data-testid="purchasing-create-selected-items">
                {items.length === 0 ? (
                  <div className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
                    {t('purchasing.items.emptySelection', 'No products selected yet. Use the product browser above to build the request.')}
                  </div>
                ) : null}
                {items.map((item, index) => (
                  <div key={`item-${index}`} className="space-y-3 rounded-md border p-3" data-testid={`purchasing-create-selected-item-${index}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="truncate text-sm font-semibold">
                          {item.productName || item.catalogQuery || t('purchasing.items.fields.productName', 'Product name')}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>{t('purchasing.items.fields.sku', 'SKU')}: {item.sku || '—'}</span>
                          <span>{t('purchasing.items.fields.referenceNumber', 'Reference number')}: {item.referenceNumber || '—'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 rounded-full border bg-muted/20 px-3 py-1 text-sm text-muted-foreground">
                        <span>{t('purchasing.products.lookup.orderedQuantity', 'Ordered: {count}', { count: item.quantity || '0' })}</span>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
                      <div className="rounded-md border bg-muted/10 px-3 py-2 text-sm">
                        <div className="font-medium">{t('purchasing.items.selected.productLocked', 'Product selected from catalog')}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t('purchasing.items.selected.productLockedHint', 'Use the browser tab to add more units of this product or remove it from the request.')}
                        </div>
                      </div>
                      <div className="space-y-2 min-w-0">
                        <FieldLabel required>{t('purchasing.items.fields.quantity', 'Quantity')}</FieldLabel>
                        <Input
                          data-testid={`purchasing-create-item-quantity-${index}`}
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(event) => {
                            updateDraftItem(index, { quantity: event.target.value })
                            setFieldErrors((current) => clearFieldError(current, `items.${index}.quantity`))
                          }}
                          placeholder={t('purchasing.items.fields.quantity', 'Quantity')}
                          aria-invalid={fieldErrors[`items.${index}.quantity`] ? 'true' : 'false'}
                          className={cn(fieldErrors[`items.${index}.quantity`] ? 'border-destructive focus-visible:ring-destructive/30' : null)}
                        />
                        <FieldError message={fieldErrors[`items.${index}.quantity`]} />
                      </div>
                      <div className="flex items-end">
                        <Button
                          data-testid={`purchasing-create-item-remove-${index}`}
                          type="button"
                          variant="ghost"
                          onClick={() => removeDraftItem(index)}
                        >
                          {t('purchasing.items.actions.remove', 'Remove')}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
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
