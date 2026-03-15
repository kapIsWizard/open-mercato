"use client"

import * as React from 'react'
import { CheckCircle2, CirclePlus } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type CatalogProductLookupRow = {
  id: string
  sku: string | null
  title: string
  unit: string | null
  referenceNumber: string | null
  supplier: string | null
  group: string | null
  purchasingAvailability: string | null
  availableQuantity: number | null
  unitPriceNet: string | null
}

export type CatalogProductLookupSelection = CatalogProductLookupRow & {
  quantity: string
  purchasingNote: string
}

type LookupResponse = {
  items?: CatalogProductLookupRow[]
  filters?: {
    suppliers?: string[]
    groups?: string[]
    availabilities?: string[]
  }
}

type CatalogProductLookupProps = {
  rowId: string
  query?: string
  selectedRows?: CatalogProductLookupSelection[]
  onQueryChange?: (value: string) => void
  onPick: (product: CatalogProductLookupRow, quantity: number) => void
  onRemove?: (productId: string) => void
  onQuantityChange?: (productId: string, quantity: string) => void
  onNoteChange?: (productId: string, note: string) => void
  disabled?: boolean
}

const PAGE_SIZE = 8

export function CatalogProductLookup({
  rowId,
  query = '',
  selectedRows = [],
  onQueryChange,
  onPick,
  onRemove,
  onQuantityChange,
  onNoteChange,
  disabled = false,
}: CatalogProductLookupProps) {
  const t = useT()
  const [searchValue, setSearchValue] = React.useState(query)
  const [results, setResults] = React.useState<CatalogProductLookupRow[]>([])
  const [suppliers, setSuppliers] = React.useState<string[]>([])
  const [groups, setGroups] = React.useState<string[]>([])
  const [availabilities, setAvailabilities] = React.useState<string[]>([])
  const [supplier, setSupplier] = React.useState('')
  const [group, setGroup] = React.useState('')
  const [availability, setAvailability] = React.useState('')
  const [draftQuantities, setDraftQuantities] = React.useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = React.useState(false)

  React.useEffect(() => {
    setSearchValue(query)
  }, [query])

  const applyFilterOptions = React.useCallback((payload: LookupResponse | null | undefined) => {
    setSuppliers(Array.isArray(payload?.filters?.suppliers) ? payload.filters.suppliers : [])
    setGroups(Array.isArray(payload?.filters?.groups) ? payload.filters.groups : [])
    setAvailabilities(Array.isArray(payload?.filters?.availabilities) ? payload.filters.availabilities : [])
  }, [])

  const loadFilterOptions = React.useCallback(async () => {
    try {
      const payload = await readApiResultOrThrow<LookupResponse>('/api/purchasing/products?page=1&pageSize=1')
      applyFilterOptions(payload)
    } catch {
      setSuppliers([])
      setGroups([])
      setAvailabilities([])
    }
  }, [applyFilterOptions])

  React.useEffect(() => {
    void loadFilterOptions()
  }, [loadFilterOptions])

  const loadProducts = React.useCallback(async (params?: { search?: string; supplier?: string; group?: string; availability?: string }) => {
    setIsLoading(true)
    try {
      const searchParams = new URLSearchParams({
        page: '1',
        pageSize: String(PAGE_SIZE),
      })
      if (params?.search?.trim()) searchParams.set('search', params.search.trim())
      if (params?.supplier) searchParams.set('supplier', params.supplier)
      if (params?.group) searchParams.set('group', params.group)
      if (params?.availability) searchParams.set('availability', params.availability)

      const payload = await readApiResultOrThrow<LookupResponse>(`/api/purchasing/products?${searchParams.toString()}`)
      setResults(Array.isArray(payload.items) ? payload.items : [])
      applyFilterOptions(payload)
    } catch {
      setResults([])
    } finally {
      setIsLoading(false)
    }
  }, [applyFilterOptions])

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      const hasFilters = Boolean(supplier || group || availability)
      const hasSearch = searchValue.trim().length >= 2
      if (!hasFilters && !hasSearch) {
        setResults([])
        setIsLoading(false)
        return
      }
      void loadProducts({
        search: searchValue,
        supplier,
        group,
        availability,
      })
    }, 250)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [availability, group, loadProducts, searchValue, supplier])

  const selectedById = React.useMemo(() => new Map(selectedRows.map((row) => [row.id, row])), [selectedRows])
  const searchRows = React.useMemo(
    () => results.filter((product) => !selectedById.has(product.id)),
    [results, selectedById],
  )
  const hasActiveSearch = searchValue.trim().length >= 2 || Boolean(supplier || group || availability)

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-3">
      <div className="space-y-3">
        <Input
          data-testid={`purchasing-catalog-lookup-query-${rowId}`}
          value={searchValue}
          onChange={(event) => {
            setSearchValue(event.target.value)
            onQueryChange?.(event.target.value)
          }}
          placeholder={t('purchasing.products.lookup.placeholder', 'Search product catalog by SKU, reference, or name')}
          disabled={disabled}
          className="w-full"
        />
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_220px_auto]">
          <select
            data-testid={`purchasing-catalog-lookup-filter-supplier-${rowId}`}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={supplier}
            onChange={(event) => setSupplier(event.target.value)}
            disabled={disabled}
          >
            <option value="">{t('purchasing.products.filters.allSuppliers', 'All suppliers')}</option>
            {suppliers.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select
            data-testid={`purchasing-catalog-lookup-filter-group-${rowId}`}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            disabled={disabled}
          >
            <option value="">{t('purchasing.products.filters.allGroups', 'All groups')}</option>
            {groups.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select
            data-testid={`purchasing-catalog-lookup-filter-availability-${rowId}`}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={availability}
            onChange={(event) => setAvailability(event.target.value)}
            disabled={disabled}
          >
            <option value="">{t('purchasing.products.filters.allAvailabilities', 'All availabilities')}</option>
            {availabilities.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <Button
            data-testid={`purchasing-catalog-lookup-reset-${rowId}`}
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              setSearchValue('')
              onQueryChange?.('')
              setSupplier('')
              setGroup('')
              setAvailability('')
            }}
          >
            {t('common.clear', 'Clear')}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t('purchasing.products.lookup.helper', 'Search the product catalog, pick rows, and keep selected products below.')}
        </p>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t('purchasing.products.lookup.loading', 'Searching catalog...')}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t('purchasing.products.lookup.resultsTitle', 'Search results')}</h3>
          {hasActiveSearch ? (
            <span className="text-xs text-muted-foreground">
              {t('purchasing.products.lookup.resultsCount', '{count} results', { count: searchRows.length })}
            </span>
          ) : null}
        </div>
        <div className="overflow-x-auto rounded-lg border bg-background" data-testid={`purchasing-catalog-lookup-results-${rowId}`}>
          <table className="min-w-[1080px] w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.sku', 'SKU')}</th>
                <th className="w-[240px] px-3 py-3 font-medium">{t('purchasing.products.fields.title', 'Product')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.referenceNumber', 'Reference')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.supplier', 'Supplier')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.group', 'Group')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.availability', 'Availability')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.availableQuantity', 'Available')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.unitPriceNet', 'Net price')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.unit', 'Unit')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.items.fields.quantity', 'Quantity')}</th>
                <th className="px-3 py-3 text-right font-medium">{t('purchasing.products.lookup.selected', 'Selected')}</th>
              </tr>
            </thead>
            <tbody>
              {searchRows.map((product) => {
                const quantityValue = draftQuantities[product.id] ?? '1'
                const selectProduct = () => {
                  const nextQuantity = Number(quantityValue || '1')
                  const normalizedQuantity = Number.isFinite(nextQuantity) && nextQuantity > 0 ? nextQuantity : 1
                  onPick(product, normalizedQuantity)
                  setDraftQuantities((current) => ({
                    ...current,
                    [product.id]: String(normalizedQuantity),
                  }))
                }

                return (
                  <tr
                    key={product.id}
                    className="cursor-pointer border-t transition-colors hover:bg-muted/20"
                    onClick={() => {
                      if (disabled) return
                      selectProduct()
                    }}
                  >
                    <td className="px-3 py-3 align-middle">{product.sku ?? '—'}</td>
                    <td className="px-3 py-3 align-middle">
                      <div className="line-clamp-2 min-w-0 font-medium leading-5">{product.title}</div>
                    </td>
                    <td className="px-3 py-3 align-middle">{product.referenceNumber ?? '—'}</td>
                    <td className="px-3 py-3 align-middle">{product.supplier ?? '—'}</td>
                    <td className="px-3 py-3 align-middle">{product.group ?? '—'}</td>
                    <td className="px-3 py-3 align-middle">
                      {product.purchasingAvailability ? <Badge variant="outline">{product.purchasingAvailability}</Badge> : '—'}
                    </td>
                    <td className="px-3 py-3 align-middle">{product.availableQuantity ?? '—'}</td>
                    <td className="px-3 py-3 align-middle">{product.unitPriceNet ?? '—'}</td>
                    <td className="px-3 py-3 align-middle">{product.unit ?? '—'}</td>
                    <td className="px-3 py-3 align-middle">
                      <div onClick={(event) => event.stopPropagation()}>
                        <Input
                          data-testid={`purchasing-catalog-lookup-quantity-${rowId}-${product.id}`}
                          type="number"
                          min="1"
                          step="1"
                          value={quantityValue}
                          onChange={(event) => {
                            setDraftQuantities((current) => ({
                              ...current,
                              [product.id]: event.target.value,
                            }))
                          }}
                          disabled={disabled}
                          className="w-[112px]"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-3 align-middle text-right">
                      <button
                        type="button"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
                        onClick={(event) => {
                          event.stopPropagation()
                          if (disabled) return
                          selectProduct()
                        }}
                        aria-label={t('purchasing.products.lookup.addWithQuantity', 'Add product')}
                      >
                        <CirclePlus className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t('purchasing.items.selected.title', 'Selected products')}</h3>
          <span className="text-xs text-muted-foreground">
            {t('purchasing.items.selected.count', 'Selected: {count}', { count: selectedRows.length })}
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border bg-background">
          <table className="min-w-[1240px] w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.sku', 'SKU')}</th>
                <th className="w-[220px] px-3 py-3 font-medium">{t('purchasing.products.fields.title', 'Product')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.referenceNumber', 'Reference')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.supplier', 'Supplier')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.group', 'Group')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.availability', 'Availability')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.availableQuantity', 'Available')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.unitPriceNet', 'Net price')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.products.fields.unit', 'Unit')}</th>
                <th className="px-3 py-3 font-medium">{t('purchasing.items.fields.quantity', 'Quantity')}</th>
                <th className="w-[240px] px-3 py-3 font-medium">{t('purchasing.items.fields.purchasingNote', 'Purchasing note')}</th>
                <th className="px-3 py-3 text-right font-medium">{t('purchasing.products.lookup.selected', 'Selected')}</th>
              </tr>
            </thead>
            <tbody>
              {selectedRows.map((product) => (
                <tr key={product.id} className="border-t bg-primary/5">
                  <td className="px-3 py-3 align-middle">{product.sku ?? '—'}</td>
                  <td className="px-3 py-3 align-middle">
                    <div className="line-clamp-3 min-w-0 font-medium leading-5">{product.title}</div>
                  </td>
                  <td className="px-3 py-3 align-middle">{product.referenceNumber ?? '—'}</td>
                  <td className="px-3 py-3 align-middle">{product.supplier ?? '—'}</td>
                  <td className="px-3 py-3 align-middle">{product.group ?? '—'}</td>
                  <td className="px-3 py-3 align-middle">
                    {product.purchasingAvailability ? <Badge variant="outline">{product.purchasingAvailability}</Badge> : '—'}
                  </td>
                  <td className="px-3 py-3 align-middle">{product.availableQuantity ?? '—'}</td>
                  <td className="px-3 py-3 align-middle">{product.unitPriceNet ?? '—'}</td>
                  <td className="px-3 py-3 align-middle">{product.unit ?? '—'}</td>
                  <td className="px-3 py-3 align-middle">
                    <Input
                      data-testid={`purchasing-selected-quantity-${rowId}-${product.id}`}
                      type="number"
                      min="1"
                      step="1"
                      value={product.quantity}
                      onChange={(event) => onQuantityChange?.(product.id, event.target.value)}
                      disabled={disabled}
                      className="w-[112px]"
                    />
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <Textarea
                      data-testid={`purchasing-selected-note-${rowId}-${product.id}`}
                      rows={2}
                      value={product.purchasingNote}
                      onChange={(event) => onNoteChange?.(product.id, event.target.value)}
                      disabled={disabled}
                      placeholder={t('purchasing.items.fields.purchasingNote', 'Purchasing note')}
                    />
                  </td>
                  <td className="px-3 py-3 align-middle text-right">
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600 transition-colors"
                      onClick={() => onRemove?.(product.id)}
                      aria-label={t('purchasing.products.lookup.remove', 'Remove')}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!isLoading && searchRows.length === 0 && selectedRows.length === 0 && !hasActiveSearch ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
          {t('purchasing.products.lookup.idle', 'Search by SKU, reference number, or product name to start adding items.')}
        </p>
      ) : null}
      {!isLoading && searchRows.length === 0 && hasActiveSearch ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
          {t('purchasing.products.lookup.empty', 'No products match the current filters.')}
        </p>
      ) : null}
    </div>
  )
}
