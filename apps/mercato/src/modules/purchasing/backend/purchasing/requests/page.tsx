"use client"

import * as React from 'react'
import Link from 'next/link'
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
import { normalizeRequestStatusForView, requestStatusViewValues, resolveRequestStatusVariant } from '../../../lib/statuses'

const PAGE_SIZE = 50

type RequestRow = {
  id: string
  requestNumber: string
  customerName: string | null
  customerNip: string | null
  requestStatus: string
  purchasingOwnerUserId?: string | null
  itemsCount: number
  openItemsCount: number
  updatedAt: string | null
}

type RequestsResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  totalPages?: number
}

type AssigneeOption = {
  value: string
  label: string
}

export default function PurchasingRequestsPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<RequestRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [requestStatus, setRequestStatus] = React.useState('')
  const [purchasingOwnerUserId, setPurchasingOwnerUserId] = React.useState('')
  const [createdFrom, setCreatedFrom] = React.useState('')
  const [createdTo, setCreatedTo] = React.useState('')
  const [assignees, setAssignees] = React.useState<AssigneeOption[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'updatedAt', desc: true }])

  const labels = React.useMemo(() => ({
    title: t('purchasing.requests.page.title', 'Purchasing requests'),
    subtitle: t('purchasing.requests.page.subtitle', 'Review incoming requests, owners, and operational pressure in one place.'),
    table: {
      requestNumber: t('purchasing.requests.table.requestNumber', 'Request'),
      customer: t('purchasing.requests.table.customer', 'Customer'),
      status: t('purchasing.requests.table.status', 'Status'),
      items: t('purchasing.requests.table.items', 'Items'),
      updatedAt: t('purchasing.requests.table.updatedAt', 'Updated'),
      empty: t('purchasing.requests.table.empty', 'No purchasing requests yet.'),
      search: t('purchasing.requests.table.search', 'Search purchasing requests...'),
    },
    actions: {
      add: t('purchasing.requests.actions.add', 'New request'),
      refresh: t('purchasing.requests.actions.refresh', 'Refresh'),
      clearFilters: t('purchasing.requests.actions.clearFilters', 'Clear filters'),
    },
    filters: {
      title: t('purchasing.requests.filters.title', 'Filters'),
      search: t('purchasing.requests.filters.search', 'Search by request number, customer, NIP, SKU or notes'),
      status: t('purchasing.requests.filters.status', 'Status'),
      owner: t('purchasing.requests.filters.owner', 'Purchasing owner'),
      ownerAll: t('purchasing.requests.filters.ownerAll', 'All owners'),
      statusAll: t('purchasing.requests.filters.statusAll', 'All statuses'),
      createdFrom: t('purchasing.requests.filters.createdFrom', 'Created from'),
      createdTo: t('purchasing.requests.filters.createdTo', 'Created to'),
    },
    errors: {
      load: t('purchasing.requests.errors.load', 'Failed to load purchasing requests.'),
    },
  }), [t])

  const stats = React.useMemo(() => {
    const totalItems = rows.reduce((sum, row) => sum + row.itemsCount, 0)
    const totalOpenItems = rows.reduce((sum, row) => sum + row.openItemsCount, 0)
    const unassigned = rows.filter((row) => !row.purchasingOwnerUserId).length
    return { totalRequests: total, totalItems, totalOpenItems, unassigned }
  }, [rows, total])

  const columns = React.useMemo<ColumnDef<RequestRow>[]>(() => [
    {
      accessorKey: 'requestNumber',
      header: labels.table.requestNumber,
      meta: { priority: 1, sticky: true },
    },
    {
      accessorKey: 'customerName',
      header: labels.table.customer,
      meta: { priority: 2 },
      cell: ({ row }) => {
        const customerName = row.original.customerName ?? '-'
        const nip = row.original.customerNip ? ` · NIP ${row.original.customerNip}` : ''
        return `${customerName}${nip}`
      },
    },
    {
      accessorKey: 'requestStatus',
      header: labels.table.status,
      meta: { priority: 3 },
      cell: ({ row }) => (
        <Badge variant={resolveRequestStatusVariant(row.original.requestStatus)}>
          {t(`purchasing.requestStatus.${row.original.requestStatus}`, row.original.requestStatus)}
        </Badge>
      ),
    },
    {
      accessorKey: 'itemsCount',
      header: labels.table.items,
      meta: { priority: 4 },
      cell: ({ row }) => `${row.original.openItemsCount}/${row.original.itemsCount}`,
    },
    {
      accessorKey: 'updatedAt',
      header: labels.table.updatedAt,
      meta: { priority: 5 },
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
      if (search.trim().length) params.set('search', search.trim())
      if (requestStatus) params.set('requestStatus', requestStatus)
      if (purchasingOwnerUserId) params.set('purchasingOwnerUserId', purchasingOwnerUserId)
      if (createdFrom) params.set('createdFrom', createdFrom)
      if (createdTo) params.set('createdTo', createdTo)
      const activeSort = sorting[0]
      if (activeSort?.id) {
        params.set('sortField', activeSort.id)
        params.set('sortDir', activeSort.desc ? 'desc' : 'asc')
      }
      const payload = await readApiResultOrThrow<RequestsResponse>(
        `/api/purchasing/requests?${params.toString()}`,
        undefined,
        { errorMessage: labels.errors.load },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setRows(items.map(mapRequestRow))
      setTotal(typeof payload.total === 'number' ? payload.total : items.length)
      setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
    } catch {
      setRows([])
      setTotal(0)
      setTotalPages(1)
    } finally {
      setIsLoading(false)
    }
  }, [createdFrom, createdTo, labels.errors.load, page, purchasingOwnerUserId, requestStatus, search, sorting])

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
    void loadRows()
  }, [loadRows, scopeVersion])

  const clearFilters = React.useCallback(() => {
    setSearch('')
    setRequestStatus('')
    setPurchasingOwnerUserId('')
    setCreatedFrom('')
    setCreatedTo('')
    setPage(1)
  }, [])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <section className="flex flex-wrap items-start justify-between gap-4 rounded-lg border bg-card p-4 shadow-sm">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{labels.title}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{labels.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href="/backend/purchasing/products">{t('purchasing.products.actions.openBrowser', 'Browse products')}</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/backend/purchasing/requests/create">{labels.actions.add}</Link>
              </Button>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <RequestMetricCard label={t('purchasing.requests.metrics.totalRequests', 'Requests')} value={String(stats.totalRequests)} />
            <RequestMetricCard label={t('purchasing.requests.metrics.totalItems', 'Products in requests')} value={String(stats.totalItems)} />
            <RequestMetricCard label={t('purchasing.requests.metrics.unassigned', 'Unassigned')} value={String(stats.unassigned)} />
            <RequestMetricCard label={t('purchasing.requests.metrics.toHandle', 'Open items')} value={String(stats.totalOpenItems)} />
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{labels.filters.title}</h2>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                {labels.actions.clearFilters}
              </Button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_220px_280px_180px_180px]">
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
                  className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={requestStatus}
                  onChange={(event) => {
                    setRequestStatus(event.target.value)
                    setPage(1)
                  }}
                >
                  <option value="">{labels.filters.statusAll}</option>
                  {requestStatusViewValues.map((status) => (
                    <option key={status} value={status}>
                      {t(`purchasing.requestStatus.${status}`, status)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{labels.filters.owner}</label>
                <select
                  className="flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={purchasingOwnerUserId}
                  onChange={(event) => {
                    setPurchasingOwnerUserId(event.target.value)
                    setPage(1)
                  }}
                >
                  <option value="">{labels.filters.ownerAll}</option>
                  {assignees.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{labels.filters.createdFrom}</label>
                <Input
                  type="date"
                  value={createdFrom}
                  onChange={(event) => {
                    setCreatedFrom(event.target.value)
                    setPage(1)
                  }}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{labels.filters.createdTo}</label>
                <Input
                  type="date"
                  value={createdTo}
                  onChange={(event) => {
                    setCreatedTo(event.target.value)
                    setPage(1)
                  }}
                />
              </div>
            </div>
          </section>

          <div className="rounded-lg border bg-card p-2 shadow-sm">
            <DataTable<RequestRow>
              title={labels.title}
              data={rows}
              columns={columns}
              isLoading={isLoading}
              emptyState={<p className="py-8 text-center text-sm text-muted-foreground">{labels.table.empty}</p>}
              refreshButton={{
                label: labels.actions.refresh,
                onRefresh: loadRows,
                isRefreshing: isLoading,
              }}
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
                router.push(`/backend/purchasing/requests/${encodeURIComponent(row.id)}`)
              }}
            />
          </div>
        </div>
      </PageBody>
    </Page>
  )
}

function mapRequestRow(item: Record<string, unknown>): RequestRow {
  const row = {
    id: typeof item.id === 'string' ? item.id : '',
    requestNumber: typeof item.requestNumber === 'string' ? item.requestNumber : typeof item.request_number === 'string' ? item.request_number : '',
    customerName: typeof item.customerName === 'string' ? item.customerName : typeof item.customer_name === 'string' ? item.customer_name : null,
    customerNip: typeof item.customerNip === 'string' ? item.customerNip : typeof item.customer_nip === 'string' ? item.customer_nip : null,
    requestStatus: normalizeRequestStatusForView(
      typeof item.requestStatus === 'string' ? item.requestStatus : typeof item.request_status === 'string' ? item.request_status : 'unassigned',
    ),
    purchasingOwnerUserId: typeof item.purchasingOwnerUserId === 'string' ? item.purchasingOwnerUserId : typeof item.purchasing_owner_user_id === 'string' ? item.purchasing_owner_user_id : null,
    itemsCount: typeof item.itemsCount === 'number' ? item.itemsCount : 0,
    openItemsCount: typeof item.openItemsCount === 'number' ? item.openItemsCount : 0,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : typeof item.updated_at === 'string' ? item.updated_at : null,
  }
  return withDataTableNamespaces(row, item)
}

function RequestMetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
    </div>
  )
}

function formatDateLabel(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
