import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { parseImportedCatalogCsv, importClientProductsIntoCatalog, type CatalogScope } from './lib/catalogProducts'

function parseArgs(rest: string[]) {
  const args: Record<string, string> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index]
    if (!part?.startsWith('--')) continue
    const [rawKey, rawValue] = part.slice(2).split('=')
    if (rawValue !== undefined) {
      args[rawKey] = rawValue
      continue
    }
    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      args[rawKey] = next
      index += 1
    } else {
      args[rawKey] = 'true'
    }
  }
  return args
}

async function resolveScope(em: EntityManager, args: Record<string, string>): Promise<CatalogScope> {
  const tenantId = args.tenantId ?? args.tenant ?? ''
  const organizationId = args.organizationId ?? args.org ?? args.orgId ?? ''
  if (tenantId && organizationId) return { tenantId, organizationId }

  const rows = await em.getConnection().execute<{
    tenant_id: string | null
    organization_id: string | null
  }[]>(
    `
      select distinct tenant_id, organization_id
      from users
      where deleted_at is null
        and tenant_id is not null
        and organization_id is not null
      order by tenant_id asc, organization_id asc
    `,
  )
  const scoped = rows.filter(
    (row): row is { tenant_id: string; organization_id: string } =>
      typeof row.tenant_id === 'string' && row.tenant_id.length > 0 &&
      typeof row.organization_id === 'string' && row.organization_id.length > 0,
  )
  if (scoped.length === 1) {
    return {
      tenantId: scoped[0].tenant_id,
      organizationId: scoped[0].organization_id,
    }
  }
  throw new Error('Usage: mercato purchasing import-products-csv --file <path> --tenant <tenantId> --org <organizationId>')
}

const importProductsCsvCommand: ModuleCli = {
  command: 'import-products-csv',
  async run(rest) {
    const args = parseArgs(rest)
    const filePath = String(args.file ?? args.path ?? '').trim()
    if (!filePath) {
      console.error('Usage: mercato purchasing import-products-csv --file <path> [--tenant <tenantId> --org <organizationId>]')
      return
    }
    const rows = parseImportedCatalogCsv(filePath)
    if (!rows.length) {
      console.error('No products parsed from CSV:', filePath)
      return
    }

    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      const scope = await resolveScope(em, args)
      const result = await em.transactional(async (tem) => importClientProductsIntoCatalog(tem, scope, rows))
      console.log(
        `Imported client products into catalog for org ${scope.organizationId}. Created: ${result.created}, updated: ${result.updated}.`,
      )
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

export default [importProductsCsvCommand]
