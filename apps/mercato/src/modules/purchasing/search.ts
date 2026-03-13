import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = Array.isArray(value)
    ? value.map((item) => (item === null || item === undefined ? '' : String(item))).filter(Boolean).join(', ')
    : (typeof value === 'object' ? JSON.stringify(value) : String(value))
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

function buildIndexSource(
  ctx: SearchBuildContext,
  presenter: SearchResultPresenter,
  lines: string[],
): SearchIndexSource | null {
  if (!lines.length) return null
  return {
    text: lines,
    presenter,
    checksumSource: { record: ctx.record, customFields: ctx.customFields },
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'purchasing:purchasing_request',
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const lines: string[] = []
        appendLine(lines, 'Number', ctx.record.request_number ?? ctx.record.requestNumber)
        appendLine(lines, 'Customer', ctx.record.customer_name ?? ctx.record.customerName)
        appendLine(lines, 'NIP', ctx.record.customer_nip ?? ctx.record.customerNip)
        appendLine(lines, 'Status', ctx.record.request_status ?? ctx.record.requestStatus)
        appendLine(lines, 'Text', ctx.record.request_text ?? ctx.record.requestText)
        return buildIndexSource(ctx, {
          title: String(ctx.record.request_number ?? ctx.record.customer_name ?? ctx.record.id ?? t('purchasing.search.request', 'Request')),
          subtitle: String(ctx.record.customer_name ?? ctx.record.request_status ?? ''),
          icon: 'clipboard-list',
          badge: t('purchasing.search.badge.request', 'Request'),
        }, lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return {
          title: String(ctx.record.request_number ?? ctx.record.customer_name ?? ctx.record.id ?? t('purchasing.search.request', 'Request')),
          subtitle: [ctx.record.customer_name, ctx.record.request_status].filter(Boolean).join(' · ') || undefined,
          icon: 'clipboard-list',
          badge: t('purchasing.search.badge.request', 'Request'),
        }
      },
      resolveUrl: async (ctx) => `/backend/purchasing/requests/${encodeURIComponent(String(ctx.record.id))}`,
      fieldPolicy: { searchable: ['request_number', 'customer_name', 'customer_nip', 'request_text', 'request_status'] },
    },
    {
      entityId: 'purchasing:purchasing_request_item',
      enabled: true,
      priority: 8,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const lines: string[] = []
        appendLine(lines, 'SKU', ctx.record.sku)
        appendLine(lines, 'Reference', ctx.record.reference_number ?? ctx.record.referenceNumber)
        appendLine(lines, 'Product', ctx.record.product_name ?? ctx.record.productName)
        appendLine(lines, 'Status', ctx.record.item_status ?? ctx.record.itemStatus)
        appendLine(lines, 'Note', ctx.record.purchasing_note ?? ctx.record.purchasingNote)
        return buildIndexSource(ctx, {
          title: String(ctx.record.product_name ?? ctx.record.productName ?? ctx.record.reference_number ?? ctx.record.referenceNumber ?? ctx.record.sku ?? ctx.record.id ?? t('purchasing.search.item', 'Item')),
          subtitle: [ctx.record.reference_number ?? ctx.record.referenceNumber, ctx.record.sku, ctx.record.item_status ?? ctx.record.itemStatus].filter(Boolean).join(' · ') || undefined,
          icon: 'package',
          badge: t('purchasing.search.badge.item', 'Item'),
        }, lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return {
          title: String(ctx.record.product_name ?? ctx.record.productName ?? ctx.record.reference_number ?? ctx.record.referenceNumber ?? ctx.record.sku ?? ctx.record.id ?? t('purchasing.search.item', 'Item')),
          subtitle: [ctx.record.reference_number ?? ctx.record.referenceNumber, ctx.record.sku, ctx.record.item_status ?? ctx.record.itemStatus].filter(Boolean).join(' · ') || undefined,
          icon: 'package',
          badge: t('purchasing.search.badge.item', 'Item'),
        }
      },
      resolveUrl: async (ctx) => `/backend/purchasing/requests/${encodeURIComponent(String(ctx.record.request_id ?? ctx.record.requestId ?? ctx.record.id))}`,
      fieldPolicy: { searchable: ['sku', 'reference_number', 'product_name', 'item_status', 'purchasing_note'] },
    },
  ],
}

export default searchConfig
export const config = searchConfig
