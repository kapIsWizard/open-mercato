"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, withDataTableNamespaces } from '@open-mercato/ui/backend/DataTable'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const PAGE_SIZE = 50

type ProductRow = {
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

type ProductsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
  filters?: {
    suppliers?: string[]
    groups?: string[]
    availabilities?: string[]
  }
}

export default function PurchasingProductsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<ProductRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [supplier, setSupplier] = React.useState('')
  const [group, setGroup] = React.useState('')
  const [availability, setAvailability] = React.useState('')
  const [suppliers, setSuppliers] = React.useState<string[]>([])
  const [groups, setGroups] = React.useState<string[]>([])
  const [availabilities, setAvailabilities] = React.useState<string[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  const labels = React.useMemo(() => ({
    title: t('purchasing.products.page.title', 'Imported products'),
    searchPlaceholder: t('purchasing.products.page.search', 'Search imported products...'),
    empty: t('purchasing.products.page.empty', 'No imported products available.'),
    supplierAll: t('purchasing.products.filters.allSuppliers', 'All suppliers'),
    groupAll: t('purchasing.products.filters.allGroups', 'All groups'),
    availabilityAll: t('purchasing.products.filters.allAvailabilities', 'All availabilities'),
    columns: {
      sku: t('purchasing.products.fields.sku', 'SKU'),
      title: t('purchasing.products.fields.title', 'Product'),
      referenceNumber: t('purchasing.products.fields.referenceNumber', 'Reference'),
      supplier: t('purchasing.products.fields.supplier', 'Supplier'),
      group: t('purchasing.products.fields.group', 'Group'),
      availability: t('purchasing.products.fields.availability', 'Availability'),
      availableQuantity: t('purchasing.products.fields.availableQuantity', 'Available'),
      unitPriceNet: t('purchasing.products.fields.unitPriceNet', 'Net price'),
    },
  }), [t])

  const columns = React.useMemo<ColumnDef<ProductRow>[]>(() => [
    { accessorKey: 'sku', header: labels.columns.sku, cell: ({ row }) => row.original.sku ?? '-' },
    { accessorKey: 'title', header: labels.columns.title },
    { accessorKey: 'referenceNumber', header: labels.columns.referenceNumber, cell: ({ row }) => row.original.referenceNumber ?? '-' },
    { accessorKey: 'supplier', header: labels.columns.supplier, cell: ({ row }) => row.original.supplier ?? '-' },
    { accessorKey: 'group', header: labels.columns.group, cell: ({ row }) => row.original.group ?? '-' },
    { accessorKey: 'purchasingAvailability', header: labels.columns.availability, cell: ({ row }) => row.original.purchasingAvailability ?? '-' },
    { accessorKey: 'availableQuantity', header: labels.columns.availableQuantity, cell: ({ row }) => row.original.availableQuantity ?? '-' },
    { accessorKey: 'unitPriceNet', header: labels.columns.unitPriceNet, cell: ({ row }) => row.original.unitPriceNet ?? '-' },
  ], [labels])

  const loadRows = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (search.trim()) params.set('search', search.trim())
      if (supplier) params.set('supplier', supplier)
      if (group) params.set('group', group)
      if (availability) params.set('availability', availability)
      const payload = await readApiResultOrThrow<ProductsResponse>(`/api/purchasing/products?${params.toString()}`)
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapProductRow))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      setSuppliers(Array.isArray(payload.filters?.suppliers) ? payload.filters.suppliers : [])
      setGroups(Array.isArray(payload.filters?.groups) ? payload.filters.groups : [])
      setAvailabilities(Array.isArray(payload.filters?.availabilities) ? payload.filters.availabilities : [])
    } catch {
      setRows([])
      setTotal(0)
      setTotalPages(1)
      setSuppliers([])
      setGroups([])
      setAvailabilities([])
    } finally {
      setIsLoading(false)
    }
  }, [availability, group, page, search, supplier])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows, scopeVersion])

  return (
    <Page>
      <PageBody>
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2" data-testid="purchasing-products-page">
          <select
            data-testid="purchasing-products-filter-supplier"
            className="h-8 rounded-md border border-input bg-background px-3 text-sm"
            value={supplier}
            onChange={(event) => { setSupplier(event.target.value); setPage(1) }}
          >
            <option value="">{labels.supplierAll}</option>
            {suppliers.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select
            data-testid="purchasing-products-filter-group"
            className="h-8 rounded-md border border-input bg-background px-3 text-sm"
            value={group}
            onChange={(event) => { setGroup(event.target.value); setPage(1) }}
          >
            <option value="">{labels.groupAll}</option>
            {groups.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select
            data-testid="purchasing-products-filter-availability"
            className="h-8 rounded-md border border-input bg-background px-3 text-sm"
            value={availability}
            onChange={(event) => { setAvailability(event.target.value); setPage(1) }}
          >
            <option value="">{labels.availabilityAll}</option>
            {availabilities.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <DataTable<ProductRow>
          title={labels.title}
          data={rows}
          columns={columns}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={labels.searchPlaceholder}
          emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{labels.empty}</p>}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
        />
      </PageBody>
    </Page>
  )
}

function mapProductRow(item: Record<string, unknown>): ProductRow {
  return withDataTableNamespaces({
    id: typeof item.id === 'string' ? item.id : '',
    sku: typeof item.sku === 'string' ? item.sku : null,
    title: typeof item.title === 'string' ? item.title : '',
    referenceNumber: typeof item.referenceNumber === 'string' ? item.referenceNumber : null,
    supplier: typeof item.supplier === 'string' ? item.supplier : null,
    group: typeof item.group === 'string' ? item.group : null,
    purchasingAvailability: typeof item.purchasingAvailability === 'string' ? item.purchasingAvailability : null,
    availableQuantity: typeof item.availableQuantity === 'number' ? item.availableQuantity : null,
    unitPriceNet: typeof item.unitPriceNet === 'string' ? item.unitPriceNet : null,
  }, item)
}
