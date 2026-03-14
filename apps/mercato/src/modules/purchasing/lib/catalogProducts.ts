import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogPriceKind, CatalogProduct, CatalogProductPrice } from '@open-mercato/core/modules/catalog/data/entities'
import { seedCatalogPriceKinds, seedCatalogUnits } from '@open-mercato/core/modules/catalog/lib/seeds'

export type CatalogScope = {
  tenantId: string
  organizationId: string
}

export type ImportedCatalogProductMetadata = {
  source: 'client_csv'
  sourceFileName: string
  symbol: string
  referenceNumber: string | null
  supplier: string | null
  group: string | null
  purchasingAvailability: string | null
  owner: string | null
  barcode: string | null
  warehouseLocation: string | null
  packageSize: string | null
  stockQuantity: number | null
  availableQuantity: number | null
  reservedQuantity: number | null
  unitPriceNet: string | null
  unitPriceGross: string | null
  vatRate: string | null
}

export type ImportedCatalogProductRow = {
  symbol: string
  name: string
  unit: string | null
  metadata: ImportedCatalogProductMetadata
}

export type PurchasingCatalogProductRow = {
  id: string
  sku: string | null
  title: string
  unit: string | null
  referenceNumber: string | null
  supplier: string | null
  group: string | null
  purchasingAvailability: string | null
  barcode: string | null
  stockQuantity: number | null
  availableQuantity: number | null
  reservedQuantity: number | null
  unitPriceNet: string | null
  unitPriceGross: string | null
}

type RawCsvRow = {
  Symbol?: string
  Nazwa?: string
  'J.m.'?: string
  Stan?: string
  Dostępne?: string
  Zarezerwowane?: string
  Netto?: string
  Brutto?: string
  'Stawka VAT sprzedaży'?: string
  'Podstawowy dostawca'?: string
  WMS_Lokalizacja?: string
  'Opakowanie zbiorcze'?: string
  'Kod kreskowy'?: string
  'Nr REF'?: string
  Opiekun?: string
  'Dostępność zakupowa'?: string
  Grupa?: string
}

type ProductLookupInput = {
  em: EntityManager
  scope: CatalogScope
  search?: string | null
  supplier?: string | null
  group?: string | null
  availability?: string | null
  importedOnly?: boolean
  limit?: number
}

function tryPythonCsvDecode(filePath: string): ImportedCatalogProductRow[] | null {
  const script = `
import csv
import json
import sys

path = sys.argv[1]
encodings = ['mac_latin2', 'utf-8', 'cp852', 'cp1250', 'latin2']
rows = None
for enc in encodings:
    try:
        with open(path, 'r', encoding=enc, newline='') as handle:
            parsed = list(csv.DictReader(handle, delimiter=';'))
        rows = parsed
        break
    except Exception:
        continue
if rows is None:
    raise RuntimeError('CSV_DECODE_FAILED')
print(json.dumps(rows, ensure_ascii=False))
`
  const result = spawnSync('python3', ['-c', script, filePath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.status !== 0 || !result.stdout.trim()) return null
  const parsed = JSON.parse(result.stdout) as RawCsvRow[]
  return normalizeImportedRows(parsed, filePath)
}

function scoreDecodedCsvCandidate(value: string): number {
  const replacementMatches = value.match(/\uFFFD/g) ?? []
  const suspiciousMatches = value.match(/[ÃÅ�]/g) ?? []
  const polishMatches = value.match(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g) ?? []
  const headerPenalty =
    value.includes('Symbol;') && value.includes('Nazwa;')
      ? 0
      : 100
  return (replacementMatches.length * 100) + (suspiciousMatches.length * 10) - polishMatches.length + headerPenalty
}

function decodeCsvBuffer(buffer: Buffer): string {
  const decoders = [
    new TextDecoder('utf-8', { fatal: false }),
    new TextDecoder('windows-1250', { fatal: false }),
    new TextDecoder('iso-8859-2', { fatal: false }),
    new TextDecoder('ibm852', { fatal: false }),
  ]
  let best = ''
  let bestScore = Number.POSITIVE_INFINITY
  for (const decoder of decoders) {
    const decoded = decoder.decode(buffer)
    const score = scoreDecodedCsvCandidate(decoded)
    if (score < bestScore) {
      best = decoded
      bestScore = score
    }
  }
  return best
}

function parseFallbackCsv(filePath: string): ImportedCatalogProductRow[] {
  const content = decodeCsvBuffer(readFileSync(filePath))
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length < 2) return []
  const headers = lines[0]!.split(';').map((value) => value.trim())
  return normalizeImportedRows(
    lines.slice(1).map((line) => {
      const columns = line.split(';')
      return headers.reduce<Record<string, string>>((acc, header, index) => {
        acc[header] = columns[index]?.trim() ?? ''
        return acc
      }, {})
    }),
    filePath,
  )
}

export function parseImportedCatalogCsv(filePath: string): ImportedCatalogProductRow[] {
  return tryPythonCsvDecode(filePath) ?? parseFallbackCsv(filePath)
}

function normalizeImportedRows(rows: RawCsvRow[], filePath: string): ImportedCatalogProductRow[] {
  return rows
    .map((row) => normalizeImportedRow(row, filePath))
    .filter((row): row is ImportedCatalogProductRow => row !== null)
}

function normalizeImportedRow(row: RawCsvRow, filePath: string): ImportedCatalogProductRow | null {
  const symbol = normalizeText(row.Symbol)
  const name = normalizeText(row.Nazwa)
  if (!symbol || !name) return null
  const metadata: ImportedCatalogProductMetadata = {
    source: 'client_csv',
    sourceFileName: basename(filePath),
    symbol,
    referenceNumber: normalizeText(row['Nr REF']),
    supplier: normalizeText(row['Podstawowy dostawca']),
    group: normalizeText(row.Grupa),
    purchasingAvailability: normalizeText(row['Dostępność zakupowa']),
    owner: normalizeText(row.Opiekun),
    barcode: normalizeText(row['Kod kreskowy']),
    warehouseLocation: normalizeText(row.WMS_Lokalizacja),
    packageSize: normalizeText(row['Opakowanie zbiorcze']),
    stockQuantity: parseIntegerValue(row.Stan),
    availableQuantity: parseIntegerValue(row['Dostępne']),
    reservedQuantity: parseIntegerValue(row.Zarezerwowane),
    unitPriceNet: parseDecimalValue(row.Netto),
    unitPriceGross: parseDecimalValue(row.Brutto),
    vatRate: parseDecimalValue(row['Stawka VAT sprzedaży']),
  }
  return {
    symbol,
    name,
    unit: normalizeUnit(row['J.m.']),
    metadata,
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeUnit(value: unknown): string | null {
  const normalized = normalizeText(value)
  if (!normalized) return null
  const lower = normalized.toLowerCase()
  if (lower === 'szt') return 'pc'
  return lower
}

function parseIntegerValue(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\s+/g, '').replace(',', '.').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

function parseDecimalValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\s+/g, '').replace(',', '.').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null
}

function buildProductHandle(symbol: string): string {
  return symbol
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150)
}

function metadataMatchesSearch(metadata: ImportedCatalogProductMetadata, search: string): boolean {
  const haystack = [
    metadata.referenceNumber,
    metadata.supplier,
    metadata.group,
    metadata.purchasingAvailability,
    metadata.barcode,
    metadata.owner,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase()
  return haystack.includes(search)
}

export function extractImportedCatalogMetadata(metadata: unknown): ImportedCatalogProductMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null
  const imported = (metadata as { purchasingImport?: unknown }).purchasingImport
  if (!imported || typeof imported !== 'object') return null
  const candidate = imported as Partial<ImportedCatalogProductMetadata>
  if (candidate.source !== 'client_csv' || typeof candidate.symbol !== 'string' || candidate.symbol.length === 0) {
    return null
  }
  return {
    source: 'client_csv',
    sourceFileName: typeof candidate.sourceFileName === 'string' ? candidate.sourceFileName : 'client-products.csv',
    symbol: candidate.symbol,
    referenceNumber: typeof candidate.referenceNumber === 'string' ? candidate.referenceNumber : null,
    supplier: typeof candidate.supplier === 'string' ? candidate.supplier : null,
    group: typeof candidate.group === 'string' ? candidate.group : null,
    purchasingAvailability: typeof candidate.purchasingAvailability === 'string' ? candidate.purchasingAvailability : null,
    owner: typeof candidate.owner === 'string' ? candidate.owner : null,
    barcode: typeof candidate.barcode === 'string' ? candidate.barcode : null,
    warehouseLocation: typeof candidate.warehouseLocation === 'string' ? candidate.warehouseLocation : null,
    packageSize: typeof candidate.packageSize === 'string' ? candidate.packageSize : null,
    stockQuantity: typeof candidate.stockQuantity === 'number' ? candidate.stockQuantity : null,
    availableQuantity: typeof candidate.availableQuantity === 'number' ? candidate.availableQuantity : null,
    reservedQuantity: typeof candidate.reservedQuantity === 'number' ? candidate.reservedQuantity : null,
    unitPriceNet: typeof candidate.unitPriceNet === 'string' ? candidate.unitPriceNet : null,
    unitPriceGross: typeof candidate.unitPriceGross === 'string' ? candidate.unitPriceGross : null,
    vatRate: typeof candidate.vatRate === 'string' ? candidate.vatRate : null,
  }
}

export function mapCatalogProductToPurchasingRow(
  product: CatalogProduct,
  metadata: ImportedCatalogProductMetadata | null,
): PurchasingCatalogProductRow {
  return {
    id: product.id,
    sku: product.sku ?? null,
    title: product.title,
    unit: product.defaultUnit ?? null,
    referenceNumber: metadata?.referenceNumber ?? null,
    supplier: metadata?.supplier ?? null,
    group: metadata?.group ?? null,
    purchasingAvailability: metadata?.purchasingAvailability ?? null,
    barcode: metadata?.barcode ?? null,
    stockQuantity: metadata?.stockQuantity ?? null,
    availableQuantity: metadata?.availableQuantity ?? null,
    reservedQuantity: metadata?.reservedQuantity ?? null,
    unitPriceNet: metadata?.unitPriceNet ?? null,
    unitPriceGross: metadata?.unitPriceGross ?? null,
  }
}

export async function listPurchasingCatalogProducts({
  em,
  scope,
  search,
  supplier,
  group,
  availability,
  importedOnly = true,
  limit = 500,
}: ProductLookupInput): Promise<PurchasingCatalogProductRow[]> {
  const products = await findWithDecryption(
    em,
    CatalogProduct,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      isActive: true,
    } as FilterQuery<CatalogProduct>,
    {
      fields: ['id', 'title', 'sku', 'defaultUnit', 'metadata'],
      limit,
      orderBy: { title: 'asc' },
    },
    scope,
  )
  const searchTerm = search?.trim().toLowerCase() ?? ''
  const supplierTerm = supplier?.trim().toLowerCase() ?? ''
  const groupTerm = group?.trim().toLowerCase() ?? ''
  const availabilityTerm = availability?.trim().toLowerCase() ?? ''

  return products
    .map((product) => {
      const metadata = extractImportedCatalogMetadata(product.metadata)
      return { product, metadata }
    })
    .filter(({ metadata }) => (importedOnly ? Boolean(metadata) : true))
    .filter(({ product, metadata }) => {
      if (supplierTerm && metadata?.supplier?.toLowerCase() !== supplierTerm) return false
      if (groupTerm && metadata?.group?.toLowerCase() !== groupTerm) return false
      if (availabilityTerm && metadata?.purchasingAvailability?.toLowerCase() !== availabilityTerm) return false
      if (!searchTerm) return true
      const baseHaystack = [product.title, product.sku ?? '', product.defaultUnit ?? '']
        .join(' ')
        .toLowerCase()
      return baseHaystack.includes(searchTerm) || (metadata ? metadataMatchesSearch(metadata, searchTerm) : false)
    })
    .map(({ product, metadata }) => mapCatalogProductToPurchasingRow(product, metadata))
}

export function collectProductFilterOptions(rows: PurchasingCatalogProductRow[]) {
  const collect = (items: Array<string | null>) =>
    Array.from(new Set(items.filter((value): value is string => typeof value === 'string' && value.length > 0))).sort((a, b) => a.localeCompare(b))
  return {
    suppliers: collect(rows.map((row) => row.supplier)),
    groups: collect(rows.map((row) => row.group)),
    availabilities: collect(rows.map((row) => row.purchasingAvailability)),
  }
}

export async function importClientProductsIntoCatalog(
  em: EntityManager,
  scope: CatalogScope,
  rows: ImportedCatalogProductRow[],
): Promise<{ created: number; updated: number }> {
  await seedCatalogUnits(em, scope)
  await seedCatalogPriceKinds(em, scope)
  const priceKind = await em.findOne(CatalogPriceKind, {
    tenantId: scope.tenantId,
    code: 'regular',
    deletedAt: null,
  })
  if (!priceKind) {
    throw new Error('Missing catalog regular price kind')
  }

  let created = 0
  let updated = 0
  for (const row of rows) {
    const existing = await em.findOne(CatalogProduct, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      sku: row.symbol,
      deletedAt: null,
    })
    const metadata = { purchasingImport: row.metadata }
    if (existing) {
      existing.title = row.name
      existing.subtitle = row.metadata.group ?? null
      existing.defaultUnit = row.unit ?? null
      existing.defaultSalesUnit = row.unit ?? null
      existing.primaryCurrencyCode = 'PLN'
      existing.taxRate = row.metadata.vatRate ?? null
      existing.metadata = metadata
      existing.isActive = true
      existing.updatedAt = new Date()
      updated += 1
      await upsertCatalogRegularPrice(em, scope, priceKind, existing, row.metadata)
      continue
    }
    const product = em.create(CatalogProduct, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      title: row.name,
      subtitle: row.metadata.group ?? null,
      description: row.metadata.supplier ?? row.metadata.referenceNumber ?? row.name,
      sku: row.symbol,
      handle: buildProductHandle(row.symbol),
      defaultUnit: row.unit ?? null,
      defaultSalesUnit: row.unit ?? null,
      primaryCurrencyCode: 'PLN',
      taxRate: row.metadata.vatRate ?? null,
      productType: 'simple',
      metadata,
      isConfigurable: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(product)
    created += 1
    await em.flush()
    await upsertCatalogRegularPrice(em, scope, priceKind, product, row.metadata)
  }
  await em.flush()
  return { created, updated }
}

async function upsertCatalogRegularPrice(
  em: EntityManager,
  scope: CatalogScope,
  priceKind: CatalogPriceKind,
  product: CatalogProduct,
  metadata: ImportedCatalogProductMetadata,
): Promise<void> {
  if (!metadata.unitPriceNet && !metadata.unitPriceGross) return
  const existingPrice = await em.findOne(CatalogProductPrice, {
    product,
    priceKind,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (existingPrice) {
    existingPrice.currencyCode = 'PLN'
    existingPrice.kind = 'regular'
    existingPrice.minQuantity = 1
    existingPrice.unitPriceNet = metadata.unitPriceNet
    existingPrice.unitPriceGross = metadata.unitPriceGross
    existingPrice.taxRate = metadata.vatRate
    existingPrice.updatedAt = new Date()
    return
  }
  const price = em.create(CatalogProductPrice, {
    product,
    priceKind,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    currencyCode: 'PLN',
    kind: 'regular',
    minQuantity: 1,
    unitPriceNet: metadata.unitPriceNet,
    unitPriceGross: metadata.unitPriceGross,
    taxRate: metadata.vatRate,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(price)
}
