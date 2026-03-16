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
import { canUseExpandedPurchasingCreate } from '../../../../lib/roleAccess'
import { CatalogProductLookup, type CatalogProductLookupRow } from '../../../../components/CatalogProductLookup'
import {
  CustomerCompanyLookup,
  CustomerCompanySuggestInput,
  type CustomerCompanyLookupOption,
} from '../../../../components/CustomerCompanyLookup'
import {
  clearFieldError,
  FieldError,
  FieldLabel,
  FormErrorNotice,
  normalizeCustomerNipInput,
  requiredLabel,
  resolvePurchasingFormError,
  type PurchasingFormErrors,
  validateCustomerNipField,
  validateCreateRequestForm,
} from '../../../../lib/requestFormUtils'

type DraftItem = {
  clientId: string
  catalogProductId: string | null
  catalogQuery: string
  sku: string
  unit: string
  referenceNumber: string
  productName: string
  quantity: string
  purchasingNote: string
  supplier: string | null
  group: string | null
  purchasingAvailability: string | null
  availableQuantity: number | null
  unitPriceNet: string | null
}

type AttachmentListResponse = {
  items?: Array<{ id?: string | null }>
}

type FeatureCheckResponse = {
  ok?: boolean
  granted?: string[]
  roles?: string[]
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

function createDraftItemId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `draft-item-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export default function PurchasingRequestCreatePage() {
  const t = useT()
  const router = useRouter()
  const { runMutation } = useGuardedMutation<{ resourceType: string; resourceId: string | null }>({
    contextId: 'purchasing.requests.create',
  })
  const [customerCompanyId, setCustomerCompanyId] = React.useState('')
  const [selectedCustomerCompany, setSelectedCustomerCompany] = React.useState<CustomerCompanyLookupOption | null>(null)
  const [customerNip, setCustomerNip] = React.useState('')
  const [customerName, setCustomerName] = React.useState('')
  const [requestText, setRequestText] = React.useState('')
  const [customerOrderNumber, setCustomerOrderNumber] = React.useState('')
  const [items, setItems] = React.useState<DraftItem[]>([])
  const [draftAttachmentRecordId] = React.useState(() => createTemporaryAttachmentRecordId())
  const [permissions, setPermissions] = React.useState<CreatePagePermissions>({
    canViewAttachments: false,
    canManageAttachments: false,
  })
  const [roleNames, setRoleNames] = React.useState<string[]>([])
  const [isSaving, setIsSaving] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<PurchasingFormErrors>({})
  const [formError, setFormError] = React.useState<string | null>(null)

  const customerLinkMode = React.useMemo<'linked' | 'new' | 'none'>(() => {
    const hasName = customerName.trim().length > 0
    const hasNip = normalizeCustomerNipInput(customerNip).length > 0
    if (customerCompanyId) return 'linked'
    if (hasName || hasNip) return 'new'
    return 'none'
  }, [customerCompanyId, customerName, customerNip])

  const canUseExpandedCreateFields = React.useMemo(
    () => canUseExpandedPurchasingCreate(roleNames),
    [roleNames],
  )

  const applySelectedCustomerCompany = React.useCallback((next: CustomerCompanyLookupOption | null) => {
    setSelectedCustomerCompany(next)
    setCustomerCompanyId(next?.id ?? '')
    if (next?.displayName) setCustomerName(next.displayName)
    if (next?.taxId) setCustomerNip(next.taxId)
    setFieldErrors((current) => clearFieldError(clearFieldError(current, 'customerName'), 'customerNip'))
  }, [])

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
          setRoleNames(Array.isArray(featureCheck.result?.roles) ? featureCheck.result.roles : [])
          setPermissions({
            canViewAttachments: featureCheck.result?.ok === true || granted.includes('attachments.view'),
            canManageAttachments: featureCheck.result?.ok === true || granted.includes('attachments.manage'),
          })
        }
      } catch {
        if (!cancelled) {
          setRoleNames([])
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
      customerNip: normalizeCustomerNipInput(customerNip) || null,
      customerName: customerName || null,
      requestText: requestText || null,
      customerOrderNumber: customerOrderNumber || null,
      items: items.map((item) => ({
        sku: item.sku || null,
        referenceNumber: item.referenceNumber || null,
        productName: item.productName,
        quantity: Number(item.quantity || '0'),
        catalogProductId: item.catalogProductId,
        purchasingNote: item.purchasingNote || null,
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
          unit: product.unit ?? existingItem.unit,
          referenceNumber: product.referenceNumber ?? existingItem.referenceNumber,
          productName: product.title,
          supplier: product.supplier ?? existingItem.supplier,
          group: product.group ?? existingItem.group,
          purchasingAvailability: product.purchasingAvailability ?? existingItem.purchasingAvailability,
          availableQuantity: product.availableQuantity ?? existingItem.availableQuantity,
          unitPriceNet: product.unitPriceNet ?? existingItem.unitPriceNet,
        }
        return [updatedItem, ...current.filter((_, index) => index !== existingIndex)]
      }
      return [
        {
          clientId: createDraftItemId(),
          catalogProductId: product.id,
          catalogQuery: product.title,
          sku: product.sku ?? '',
          unit: product.unit ?? '',
          referenceNumber: product.referenceNumber ?? '',
          productName: product.title,
          quantity: String(quantityToAdd),
          purchasingNote: '',
          supplier: product.supplier ?? null,
          group: product.group ?? null,
          purchasingAvailability: product.purchasingAvailability ?? null,
          availableQuantity: product.availableQuantity ?? null,
          unitPriceNet: product.unitPriceNet ?? null,
        },
        ...current,
      ]
    })
  }, [])

  const addManualItem = React.useCallback(() => {
    setItems((current) => [
      {
        clientId: createDraftItemId(),
        catalogProductId: null,
        catalogQuery: '',
        sku: '',
        unit: '',
        referenceNumber: '',
        productName: '',
        quantity: '1',
        purchasingNote: '',
        supplier: null,
        group: null,
        purchasingAvailability: null,
        availableQuantity: null,
        unitPriceNet: null,
      },
      ...current,
    ])
  }, [])

  const removeDraftItem = React.useCallback((clientId: string) => {
    setItems((current) => {
      const indexToRemove = current.findIndex((item) => item.clientId === clientId)
      if (indexToRemove < 0) return current
      return current.filter((_, index) => index !== indexToRemove)
    })
    setFieldErrors((current) => {
      const indexToRemove = items.findIndex((item) => item.clientId === clientId)
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

  const updateDraftItem = React.useCallback((
    clientId: string,
    patch: Partial<Pick<DraftItem, 'quantity' | 'purchasingNote' | 'productName' | 'sku' | 'referenceNumber'>>,
  ) => {
    setItems((current) => {
      const existingIndex = current.findIndex((item) => item.clientId === clientId)
      if (existingIndex < 0) return current
      return current.map((entry, entryIndex) => (
        entryIndex === existingIndex
          ? { ...entry, ...patch }
          : entry
      ))
    })
    setFieldErrors((current) => {
      const itemIndex = items.findIndex((item) => item.clientId === clientId)
      if (itemIndex < 0) return current
      let next = current
      if (patch.quantity !== undefined) {
        next = clearFieldError(next, `items.${itemIndex}.quantity`)
      }
      if (patch.productName !== undefined) {
        next = clearFieldError(next, `items.${itemIndex}.productName`)
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
                {customerLinkMode !== 'none' ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div
                      className={cn(
                        'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium',
                        customerLinkMode === 'linked'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700',
                      )}
                    >
                      {customerLinkMode === 'linked'
                        ? t('purchasing.requests.create.customerLinkState.linked', 'Linked to an existing Open Mercato company')
                        : t('purchasing.requests.create.customerLinkState.new', 'A new Open Mercato company will be created on save')}
                    </div>
                    {customerLinkMode === 'linked' ? (
                      <span className="text-xs text-muted-foreground">
                        {t('purchasing.requests.create.customerLinkState.linkedHint', 'Editing the customer name or NIP will switch this request back to a new company.')}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <FieldLabel>{t('purchasing.requests.fields.customerCompany', 'Open Mercato company')}</FieldLabel>
                  <CustomerCompanyLookup
                    value={customerCompanyId}
                    selectedOption={selectedCustomerCompany}
                    disabled={isSaving}
                    onChange={applySelectedCustomerCompany}
                  />
                </div>
                <div className="space-y-2">
                  <FieldLabel>{t('purchasing.requests.fields.customerNip', 'Customer NIP')}</FieldLabel>
                  <CustomerCompanySuggestInput
                    data-testid="purchasing-create-customer-nip"
                    value={customerNip}
                    mode="taxId"
                    onValueChange={(next) => {
                      setCustomerNip(normalizeCustomerNipInput(next))
                      setSelectedCustomerCompany(null)
                      setCustomerCompanyId('')
                      setFieldErrors((current) => clearFieldError(clearFieldError(current, 'customerNip'), 'customerName'))
                    }}
                    onSelectCompany={applySelectedCustomerCompany}
                    onBlur={() => {
                      const message = validateCustomerNipField(customerNip, t)
                      setFieldErrors((current) => {
                        const next = clearFieldError(current, 'customerNip')
                        return message ? { ...next, customerNip: message } : next
                      })
                    }}
                    placeholder="1234567890"
                    ariaInvalid={Boolean(fieldErrors.customerNip)}
                    className={cn(fieldErrors.customerNip ? 'border-destructive focus-visible:ring-destructive/30' : null)}
                    disabled={isSaving}
                  />
                  <FieldError message={fieldErrors.customerNip} />
                </div>
                <div className="space-y-2">
                  <FieldLabel>{requiredLabel(t('purchasing.requests.fields.customerName', 'Customer name'), t)}</FieldLabel>
                  <CustomerCompanySuggestInput
                    data-testid="purchasing-create-customer-name"
                    value={customerName}
                    mode="displayName"
                    onValueChange={(next) => {
                      setCustomerName(next)
                      setSelectedCustomerCompany(null)
                      setCustomerCompanyId('')
                      setFieldErrors((current) => clearFieldError(clearFieldError(current, 'customerName'), 'customerNip'))
                    }}
                    onSelectCompany={applySelectedCustomerCompany}
                    placeholder={t('purchasing.requests.fields.customerNamePlaceholder', 'Customer company name')}
                    ariaInvalid={Boolean(fieldErrors.customerName)}
                    className={cn(fieldErrors.customerName ? 'border-destructive focus-visible:ring-destructive/30' : null)}
                    disabled={isSaving}
                  />
                  <FieldError message={fieldErrors.customerName} />
                </div>
              </div>
            </section>

            <div className={cn('grid gap-6 lg:items-start', canUseExpandedCreateFields && permissions.canViewAttachments && permissions.canManageAttachments ? 'lg:grid-cols-2' : null)}>
              {canUseExpandedCreateFields ? (
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
              ) : null}

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
            </div>
          </section>

          <section className="space-y-4 rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-medium">{t('purchasing.items.section.title', 'Request items')}</h2>
                <div className="rounded-full border bg-muted/20 px-3 py-1 text-sm text-muted-foreground">
                  {t('purchasing.items.selected.count', 'Selected: {count}', { count: items.length })}
                </div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('purchasing.validation.itemsRequiredHint', 'Each request needs at least one item with a product name and quantity.')}
            </p>
            <FieldError message={fieldErrors.items} />
            <CatalogProductLookup
              rowId="create"
              selectedRows={items.map((item) => ({
                id: item.clientId,
                catalogProductId: item.catalogProductId,
                sku: item.sku || null,
                title: item.productName || item.catalogQuery,
                unit: item.unit || null,
                referenceNumber: item.referenceNumber || null,
                supplier: item.supplier,
                group: item.group,
                purchasingAvailability: item.purchasingAvailability,
                availableQuantity: item.availableQuantity,
                unitPriceNet: item.unitPriceNet,
                quantity: item.quantity,
                purchasingNote: item.purchasingNote,
                isManual: item.catalogProductId == null,
              }))}
              onPick={addCatalogProductToItems}
              onAddManual={addManualItem}
              onRemove={removeDraftItem}
              onQuantityChange={(itemId, quantity) => updateDraftItem(itemId, { quantity })}
              onNoteChange={(itemId, purchasingNote) => updateDraftItem(itemId, { purchasingNote })}
              onTitleChange={(itemId, productName) => updateDraftItem(itemId, { productName })}
              onSkuChange={(itemId, sku) => updateDraftItem(itemId, { sku })}
              onReferenceNumberChange={(itemId, referenceNumber) => updateDraftItem(itemId, { referenceNumber })}
              disabled={isSaving}
            />
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
