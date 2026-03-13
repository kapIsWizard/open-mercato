"use client"

import * as React from 'react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type CatalogProductLookupRow = {
  id: string
  sku: string | null
  title: string
  referenceNumber: string | null
  supplier: string | null
  group: string | null
  purchasingAvailability: string | null
  availableQuantity: number | null
  unitPriceNet: string | null
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
  selectedProductIds?: string[]
  onQueryChange?: (value: string) => void
  onPick: (product: CatalogProductLookupRow) => void
  disabled?: boolean
  fullWidth?: boolean
}

const PAGE_SIZE = 8

export function CatalogProductLookup({
  rowId,
  query = '',
  selectedProductIds = [],
  onQueryChange,
  onPick,
  disabled = false,
  fullWidth = false,
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
  const [isLoading, setIsLoading] = React.useState(false)

  React.useEffect(() => {
    setSearchValue(query)
  }, [query])

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
      setSuppliers(Array.isArray(payload.filters?.suppliers) ? payload.filters.suppliers : [])
      setGroups(Array.isArray(payload.filters?.groups) ? payload.filters.groups : [])
      setAvailabilities(Array.isArray(payload.filters?.availabilities) ? payload.filters.availabilities : [])
    } catch {
      setResults([])
      setSuppliers([])
      setGroups([])
      setAvailabilities([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadProducts({
        search: searchValue,
        supplier,
        group,
        availability,
      })
    }, searchValue.trim().length > 1 ? 250 : 0)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [availability, group, loadProducts, searchValue, supplier])

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
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
          {t('purchasing.products.lookup.helper', 'Start with the suggested list, then narrow it down with filters or search.')}
        </p>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t('purchasing.products.lookup.loading', 'Searching catalog...')}</p>
        ) : null}
      </div>

      <div
        className={cn(
          'grid gap-3',
          fullWidth ? 'grid-cols-1' : 'lg:grid-cols-2',
        )}
        data-testid={`purchasing-catalog-lookup-results-${rowId}`}
      >
        {results.map((product) => {
          const isSelected = selectedProductIds.includes(product.id)
          return (
            <button
              key={product.id}
              type="button"
              data-testid={`purchasing-catalog-lookup-pick-${rowId}-${product.id}`}
              className={cn(
                'rounded-lg border bg-background p-3 text-left transition hover:border-primary/40 hover:shadow-sm',
                isSelected ? 'border-primary ring-1 ring-primary/30' : null,
              )}
              onClick={() => onPick(product)}
              disabled={disabled}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="truncate text-sm font-semibold">{product.title}</div>
                  <div className="flex flex-wrap gap-1">
                    {product.sku ? <Badge variant="outline">{product.sku}</Badge> : null}
                    {product.referenceNumber ? <Badge variant="outline">{product.referenceNumber}</Badge> : null}
                    {product.supplier ? <Badge variant="secondary">{product.supplier}</Badge> : null}
                  </div>
                </div>
                <div className="shrink-0">
                  {isSelected ? (
                    <Badge>{t('purchasing.products.lookup.selected', 'Selected')}</Badge>
                  ) : (
                    <Badge variant="outline">{t('purchasing.products.lookup.pick', 'Use product')}</Badge>
                  )}
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                <div>
                  <span className="font-medium text-foreground">{t('purchasing.products.fields.group', 'Group')}:</span>{' '}
                  {product.group ?? '-'}
                </div>
                <div>
                  <span className="font-medium text-foreground">{t('purchasing.products.fields.availability', 'Availability')}:</span>{' '}
                  {product.purchasingAvailability ?? '-'}
                </div>
                <div>
                  <span className="font-medium text-foreground">{t('purchasing.products.fields.availableQuantity', 'Available')}:</span>{' '}
                  {product.availableQuantity ?? '-'}
                </div>
                <div>
                  <span className="font-medium text-foreground">{t('purchasing.products.fields.unitPriceNet', 'Net price')}:</span>{' '}
                  {product.unitPriceNet ?? '-'}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {!isLoading && results.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
          {t('purchasing.products.lookup.empty', 'No products match the current filters.')}
        </p>
      ) : null}
    </div>
  )
}
