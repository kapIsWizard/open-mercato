"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { DataTable, withDataTableNamespaces } from '@open-mercato/ui/backend/DataTable'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { canViewPurchasingOperationalItems } from '../../../lib/roleAccess'
import { itemStatusViewValues, normalizeItemStatusForView, resolveItemStatusClassName, resolveItemStatusVariant } from '../../../lib/statuses'

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

type FeatureCheckResponse = {
  roles?: string[]
}

export default function PurchasingRequestItemsPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { runMutation } = useGuardedMutation<{ resourceType: string; resourceId: string | null }>({
    contextId: 'purchasing.request-items.list',
  })
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
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [bulkStatus, setBulkStatus] = React.useState('')
  const [isApplyingBulkStatus, setIsApplyingBulkStatus] = React.useState(false)
  const [roleNames, setRoleNames] = React.useState<string[]>([])
  const [rolesLoaded, setRolesLoaded] = React.useState(false)
  const canAccessOperationalItems = React.useMemo(() => canViewPurchasingOperationalItems(roleNames), [roleNames])

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
      applyBulkStatus: t('purchasing.items.actions.applyBulkStatus', 'Apply status'),
      selectedCount: t('purchasing.items.bulk.selectedCount', '{count} selected', { count: selectedIds.length }),
      clearSelection: t('purchasing.items.bulk.clearSelection', 'Clear selection'),
    },
    filters: {
      title: t('purchasing.items.filters.title', 'Filters'),
      search: t('purchasing.items.filters.search', 'Search by request, product, SKU or reference number'),
      status: t('purchasing.items.filters.status', 'Status'),
      sku: t('purchasing.items.filters.sku', 'SKU'),
      referenceNumber: t('purchasing.items.filters.referenceNumber', 'Reference number'),
      bulkStatus: t('purchasing.items.bulk.status', 'Bulk status update'),
    },
    errors: {
      load: t('purchasing.items.errors.load', 'Failed to load purchasing items.'),
      bulkUpdate: t('purchasing.items.errors.bulkUpdate', 'Failed to update selected items.'),
    },
  }), [selectedIds.length, t])

  const columns = React.useMemo<ColumnDef<ItemRow>[]>(() => [
    {
      id: 'select',
      header: () => {
        const visibleIds = rows.map((row) => row.id).filter((value) => value.length > 0)
        const selectedOnPage = visibleIds.filter((id) => selectedIds.includes(id))
        const allSelected = visibleIds.length > 0 && selectedOnPage.length === visibleIds.length
        const partiallySelected = selectedOnPage.length > 0 && !allSelected
        return (
          <Checkbox
            checked={allSelected ? true : (partiallySelected ? 'indeterminate' : false)}
            aria-label={t('purchasing.items.bulk.selectAll', 'Select all visible items')}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={(checked) => {
              const shouldSelect = checked === true
              setSelectedIds((current) => {
                if (shouldSelect) {
                  return Array.from(new Set([...current, ...visibleIds]))
                }
                return current.filter((id) => !visibleIds.includes(id))
              })
            }}
          />
        )
      },
      cell: ({ row }) => (
        <Checkbox
          checked={selectedIds.includes(row.original.id)}
          aria-label={t('purchasing.items.bulk.selectRow', 'Select item')}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={(checked) => {
            setSelectedIds((current) => {
              if (checked === true) return Array.from(new Set([...current, row.original.id]))
              return current.filter((id) => id !== row.original.id)
            })
          }}
        />
      ),
      enableSorting: false,
      meta: { priority: 0, sticky: true },
    },
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
        <Badge
          variant={resolveItemStatusVariant(row.original.itemStatus)}
          className={cn('font-semibold', resolveItemStatusClassName(row.original.itemStatus))}
        >
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
  ], [labels, rows, selectedIds, t])

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
    let cancelled = false
    async function loadRoles() {
      try {
        const payload = await readApiResultOrThrow<FeatureCheckResponse>(
          '/api/auth/feature-check',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ features: [] }),
          },
        )
        if (!cancelled) {
          setRoleNames(Array.isArray(payload.roles) ? payload.roles : [])
          setRolesLoaded(true)
        }
      } catch {
        if (!cancelled) {
          setRoleNames([])
          setRolesLoaded(true)
        }
      }
    }
    void loadRoles()
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    if (!rolesLoaded) return
    if (!canAccessOperationalItems) {
      setRows([])
      setTotal(0)
      setTotalPages(1)
      setIsLoading(false)
      return
    }
    void loadRows()
  }, [canAccessOperationalItems, loadRows, scopeVersion])

  React.useEffect(() => {
    setSelectedIds((current) => current.filter((id) => rows.some((row) => row.id === id)))
  }, [rows])

  const clearFilters = React.useCallback(() => {
    setSearch('')
    setStatusFilter('')
    setSkuFilter('')
    setReferenceFilter('')
    setPage(1)
  }, [])

  const applyBulkStatus = React.useCallback(async () => {
    if (!bulkStatus || selectedIds.length === 0) return
    const selectedRows = rows.filter((row) => selectedIds.includes(row.id))
    if (selectedRows.length === 0) return
    setIsApplyingBulkStatus(true)
    try {
      await runMutation({
        operation: async () => {
          for (const row of selectedRows) {
            await readApiResultOrThrow(
              '/api/purchasing/request-items',
              {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  id: row.id,
                  itemStatus: bulkStatus,
                }),
              },
              { errorMessage: labels.errors.bulkUpdate },
            )
          }
          return { ok: true }
        },
        context: { resourceType: 'purchasing.request_item.bulk', resourceId: null },
        mutationPayload: { ids: selectedIds, itemStatus: bulkStatus },
      })
      flash(
        t('purchasing.items.flash.bulkUpdated', 'Updated {count} selected items.', { count: selectedRows.length }),
        'success',
      )
      setSelectedIds([])
      setBulkStatus('')
      await loadRows()
    } catch (error) {
      const message = error instanceof Error ? error.message : labels.errors.bulkUpdate
      flash(message, 'error')
    } finally {
      setIsApplyingBulkStatus(false)
    }
  }, [bulkStatus, labels.errors.bulkUpdate, loadRows, rows, runMutation, selectedIds, t])

  return (
    <Page>
      <PageBody>
        {rolesLoaded && !canAccessOperationalItems ? (
          <ErrorMessage label={t('purchasing.items.errors.forbidden', 'You do not have access to operational purchasing items.')} />
        ) : null}
        {!rolesLoaded ? null : canAccessOperationalItems ? (
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

          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{labels.filters.bulkStatus}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{labels.actions.selectedCount}</p>
              </div>
              {selectedIds.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedIds([])}
                >
                  {labels.actions.clearSelection}
                </Button>
              ) : null}
            </div>
            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
              <div className="w-full max-w-sm space-y-2">
                <label className="text-sm font-medium">{labels.filters.status}</label>
                <select
                  data-testid="purchasing-items-bulk-status"
                  className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={bulkStatus}
                  onChange={(event) => setBulkStatus(event.target.value)}
                >
                  <option value="">{labels.actions.allStatuses}</option>
                  {itemStatusViewValues.map((status) => (
                    <option key={status} value={status}>
                      {t(`purchasing.itemStatus.${status}`, status)}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                onClick={() => { void applyBulkStatus() }}
                disabled={selectedIds.length === 0 || !bulkStatus || isApplyingBulkStatus}
              >
                {labels.actions.applyBulkStatus}
              </Button>
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
        ) : null}
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
