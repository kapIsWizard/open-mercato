import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { ensureRoles } from '@open-mercato/core/modules/auth/lib/setup-app'
import { setup } from './setup'

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '')
    const value = argv[index + 1]
    if (key) args[key] = value
  }
  return args
}

const seedDefaultsCommand: ModuleCli = {
  command: 'seed-defaults',
  async run(argv) {
    const args = parseArgs(argv)
    const tenantId = args.tenantId ?? args.tenant ?? args.tenant_id ?? null
    const organizationIdArg = args.organizationId ?? args.orgId ?? args.org ?? null
    if (!tenantId) {
      console.error('Usage: mercato purchasing seed-defaults --tenant <tenantId> [--org <organizationId>]')
      return
    }

    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager

    await ensureRoles(em, { tenantId })

    const organization = organizationIdArg
      ? await em.findOne(Organization, { id: organizationIdArg, tenant: tenantId as never })
      : await em.findOne(Organization, { tenant: tenantId as never })

    if (!organization?.id) {
      throw new Error(`ORGANIZATION_NOT_FOUND:${organizationIdArg ?? tenantId}`)
    }

    await setup.seedDefaults?.({
      em,
      tenantId,
      organizationId: String(organization.id),
      container,
    })

    await em.flush()
    console.log(`✅ Purchasing defaults seeded for tenant ${tenantId} and org ${String(organization.id)}`)
  },
}

const commands: ModuleCli[] = [seedDefaultsCommand]

export default commands
