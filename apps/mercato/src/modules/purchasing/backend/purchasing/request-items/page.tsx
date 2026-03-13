"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, withDataTableNamespaces } from '@open-mercato/ui/backend/DataTable'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { itemStatusViewValues, normalizeItemStatusForView, resolveItemStatusVariant } from '../../../lib/statuses'

const PAGE_SIZE = 50

type ItemRow = {
  id: string
  requestId: string
  lineNo: number
  sku: string | null
  referenceNumber: string | null
  productName: string
  quantity: number
  itemStatus: string
  supplierOrderNumber: string | null
  updatedAt: string | null
}

type ItemResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

export default function PurchasingRequestItemsPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<ItemRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState('')
  const [skuFilter, setSkuFilter] = React.useState('')
  const [referenceFilter, setReferenceFilter] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'updatedAt', desc: true }])

  const labels = React.useMemo(() => ({
    title: t('purchasing.items.page.title', 'Purchasing items'),
    table: {
      request: t('purchasing.items.table.request', 'Request'),
      sku: t('purchasing.items.table.sku', 'SKU'),
      referenceNumber: t('purchasing.items.table.referenceNumber', 'Reference'),
      product: t('purchasing.items.table.product', 'Product'),
      quantity: t('purchasing.items.table.quantity', 'Quantity'),
      status: t('purchasing.items.table.status', 'Status'),
      supplierOrderNumber: t('purchasing.items.table.supplierOrderNumber', 'Supplier order'),
      updatedAt: t('purchasing.items.table.updatedAt', 'Updated'),
      empty: t('purchasing.items.table.empty', 'No purchasing items yet.'),
    },
    actions: {
      refresh: t('purchasing.items.actions.refresh', 'Refresh'),
      allStatuses: t('purchasing.items.filters.allStatuses', 'All statuses'),
      clearFilters: t('purchasing.items.actions.clearFilters', 'Clear filters'),
    },
    filters: {
      title: t('purchasing.items.filters.title', 'Filters'),
      search: t('purchasing.items.filters.search', 'Search by request, product, SKU or reference number'),
      status: t('purchasing.items.filters.status', 'Status'),
      sku: t('purchasing.items.filters.sku', 'SKU'),
      referenceNumber: t('purchasing.items.filters.referenceNumber', 'Reference number'),
    },
    errors: {
      load: t('purchasing.items.errors.load', 'Failed to load purchasing items.'),
    },
  }), [t])

  const columns = React.useMemo<ColumnDef<ItemRow>[]>(() => [
    {
      accessorKey: 'requestId',
      header: labels.table.request,
      meta: { priority: 1, sticky: true },
      cell: ({ row }) => `#${row.original.lineNo} · ${row.original.requestId.slice(0, 8)}`,
    },
    {
      accessorKey: 'sku',
      header: labels.table.sku,
      meta: { priority: 2 },
      cell: ({ row }) => row.original.sku ?? '-',
    },
    {
      accessorKey: 'referenceNumber',
      header: labels.table.referenceNumber,
      meta: { priority: 3 },
      cell: ({ row }) => row.original.referenceNumber ?? '-',
    },
    {
      accessorKey: 'productName',
      header: labels.table.product,
      meta: { priority: 4, truncate: true, maxWidth: '260px' },
    },
    {
      accessorKey: 'quantity',
      header: labels.table.quantity,
      meta: { priority: 5 },
    },
    {
      accessorKey: 'itemStatus',
      header: labels.table.status,
      meta: { priority: 6 },
      cell: ({ row }) => (
        <Badge variant={resolveItemStatusVariant(row.original.itemStatus)}>
          {t(`purchasing.itemStatus.${row.original.itemStatus}`, row.original.itemStatus)}
        </Badge>
      ),
    },
    {
      accessorKey: 'supplierOrderNumber',
      header: labels.table.supplierOrderNumber,
      meta: { priority: 7 },
      cell: ({ row }) => row.original.supplierOrderNumber ?? '-',
    },
    {
      accessorKey: 'updatedAt',
      header: labels.table.updatedAt,
      meta: { priority: 8 },
      cell: ({ row }) => formatDateLabel(row.original.updatedAt),
    },
  ], [labels, t])

  const loadRows = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (search.trim()) params.set('search', search.trim())
      if (statusFilter) params.set('itemStatus', statusFilter)
      if (skuFilter.trim()) params.set('sku', skuFilter.trim())
      if (referenceFilter.trim()) params.set('referenceNumber', referenceFilter.trim())
      const activeSort = sorting[0]
      if (activeSort?.id) {
        params.set('sortField', activeSort.id)
        params.set('sortDir', activeSort.desc ? 'desc' : 'asc')
      }
      const payload = await readApiResultOrThrow<ItemResponse>(
        `/api/purchasing/request-items?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapItemRow))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
    } catch {
      setRows([])
      setTotal(0)
      setTotalPages(1)
    } finally {
      setIsLoading(false)
    }
  }, [labels.errors.load, page, referenceFilter, search, skuFilter, sorting, statusFilter])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows, scopeVersion])

  const clearFilters = React.useCallback(() => {
    setSearch('')
    setStatusFilter('')
    setSkuFilter('')
    setReferenceFilter('')
    setPage(1)
  }, [])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6" data-testid="purchasing-items-page">
          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{labels.filters.title}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                  {labels.actions.clearFilters}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => { void loadRows() }}>
                  {labels.actions.refresh}
                </Button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_220px_220px_220px]">
              <div className="space-y-2">
                <label className="text-sm font-medium">{labels.filters.search}</label>
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                  placeholder={labels.filters.search}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{labels.filters.status}</label>
                <select
                  data-testid="purchasing-items-status-filter"
                  className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value)
                    setPage(1)
                  }}
                >
                  <option value="">{labels.actions.allStatuses}</option>
                  {itemStatusViewValues.map((status) => (
                    <option key={status} value={status}>
                      {t(`purchasing.itemStatus.${status}`, status)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{labels.filters.sku}</label>
                <Input
                  value={skuFilter}
                  onChange={(event) => {
                    setSkuFilter(event.target.value)
                    setPage(1)
                  }}
                  placeholder={labels.filters.sku}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{labels.filters.referenceNumber}</label>
                <Input
                  value={referenceFilter}
                  onChange={(event) => {
                    setReferenceFilter(event.target.value)
                    setPage(1)
                  }}
                  placeholder={labels.filters.referenceNumber}
                />
              </div>
            </div>
          </section>

          <div className="rounded-lg border bg-card p-2 shadow-sm">
            <DataTable<ItemRow>
              title={labels.title}
              data={rows}
              columns={columns}
              isLoading={isLoading}
              emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{labels.table.empty}</p>}
              sortable
              sorting={sorting}
              onSortingChange={setSorting}
              pagination={{
                page,
                pageSize: PAGE_SIZE,
                total,
                totalPages,
                onPageChange: setPage,
              }}
              onRowClick={(row) => {
                router.push(`/backend/purchasing/requests/${encodeURIComponent(row.requestId)}`)
              }}
            />
          </div>
        </div>
      </PageBody>
    </Page>
  )
}

function mapItemRow(item: Record<string, unknown>): ItemRow {
  return withDataTableNamespaces({
    id: typeof item.id === 'string' ? item.id : '',
    requestId: typeof item.requestId === 'string' ? item.requestId : typeof item.request_id === 'string' ? item.request_id : '',
    lineNo: typeof item.lineNo === 'number' ? item.lineNo : typeof item.line_no === 'number' ? item.line_no : 0,
    sku: typeof item.sku === 'string' ? item.sku : null,
    referenceNumber: typeof item.referenceNumber === 'string' ? item.referenceNumber : typeof item.reference_number === 'string' ? item.reference_number : null,
    productName: typeof item.productName === 'string' ? item.productName : typeof item.product_name === 'string' ? item.product_name : '',
    quantity: typeof item.quantity === 'number' ? item.quantity : Number(item.quantity ?? 0),
    itemStatus: normalizeItemStatusForView(
      typeof item.itemStatus === 'string' ? item.itemStatus : typeof item.item_status === 'string' ? item.item_status : 'to_order',
    ),
    supplierOrderNumber: typeof item.supplierOrderNumber === 'string' ? item.supplierOrderNumber : typeof item.supplier_order_number === 'string' ? item.supplier_order_number : null,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : typeof item.updated_at === 'string' ? item.updated_at : null,
  }, item)
}

function formatDateLabel(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
