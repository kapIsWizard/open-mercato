import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { hash } from 'bcryptjs'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { Role, RoleAcl, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'

const ROLE_DEFINITIONS = {
  sales: {
    demoUsers: [
      { email: 'sales.aleks@acme.com', name: 'Aleks Handlowiec' },
      { email: 'sales.nina@acme.com', name: 'Nina Handlowiec' },
    ],
  },
  bok: {
    demoUsers: [
      { email: 'bok.kasia@acme.com', name: 'Kasia BOK' },
    ],
  },
  purchasing: {
    demoUsers: [
      { email: 'purchasing.anna@acme.com', name: 'Anna Zakupy' },
      { email: 'purchasing.marek@acme.com', name: 'Marek Zakupy' },
      { email: 'purchasing.julia@acme.com', name: 'Julia Zakupy' },
    ],
  },
} as const

type PurchasingRoleName = keyof typeof ROLE_DEFINITIONS

async function ensureTenantRole(em: EntityManager, tenantId: string, name: string): Promise<Role> {
  let role = await em.findOne(Role, { name, tenantId, deletedAt: null })
  if (role) return role
  role = em.create(Role, {
    name,
    tenantId,
    createdAt: new Date(),
  })
  em.persist(role)
  await em.flush()
  return role
}

async function disableTenantRoleAcl(em: EntityManager, tenantId: string, role: Role) {
  const acls = await em.find(RoleAcl, { role, tenantId, deletedAt: null })
  for (const acl of acls) {
    acl.deletedAt = new Date()
  }
}

async function ensureUserRole(em: EntityManager, user: User, role: Role) {
  const existing = await em.findOne(UserRole, { user, role, deletedAt: null })
  if (existing) return
  em.persist(em.create(UserRole, {
    user,
    role,
    createdAt: new Date(),
  }))
}

async function ensureDemoUser(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  employeeRole: Role,
  customRole: Role,
  input: { email: string; name: string },
) {
  const emailHash = computeEmailHash(input.email)
  const matches = await em.find(User, {
    tenantId,
    deletedAt: null,
    $or: [
      { email: input.email },
      { emailHash },
    ],
  } as never, {
    orderBy: { createdAt: 'desc' },
  })
  const [user, ...duplicates] = matches
  for (const duplicate of duplicates) {
    duplicate.deletedAt = new Date()
  }
  let targetUser = user
  if (!targetUser) {
    targetUser = em.create(User, {
      tenantId,
      organizationId,
      email: input.email,
      emailHash,
      name: input.name,
      passwordHash: await hash('secret', 10),
      isConfirmed: true,
      createdAt: new Date(),
    })
    em.persist(targetUser)
    await em.flush()
  } else {
    targetUser.email = input.email
    targetUser.emailHash = emailHash
    targetUser.organizationId = organizationId
    targetUser.name = input.name
    targetUser.passwordHash = await hash('secret', 10)
    targetUser.isConfirmed = true
  }

  await ensureUserRole(em, targetUser, employeeRole)
  await ensureUserRole(em, targetUser, customRole)

  const userAcl = await em.findOne(UserAcl, { user: targetUser, tenantId, deletedAt: null })
  if (!userAcl) return
  userAcl.deletedAt = new Date()
}

export const setup: ModuleSetupConfig = {
  seedDefaults: async ({ em, tenantId, organizationId }) => {
    const employeeRole = await em.findOne(Role, { name: 'employee', tenantId, deletedAt: null })
    if (!employeeRole) return

    const purchasingRoles = {} as Record<PurchasingRoleName, Role>
    for (const [roleName] of Object.entries(ROLE_DEFINITIONS) as Array<[PurchasingRoleName, (typeof ROLE_DEFINITIONS)[PurchasingRoleName]]>) {
      const role = await ensureTenantRole(em, tenantId, roleName)
      purchasingRoles[roleName] = role
      await disableTenantRoleAcl(em, tenantId, role)
    }

    for (const [roleName, definition] of Object.entries(ROLE_DEFINITIONS) as Array<[PurchasingRoleName, (typeof ROLE_DEFINITIONS)[PurchasingRoleName]]>) {
      for (const demoUser of definition.demoUsers) {
        await ensureDemoUser(em, tenantId, organizationId, employeeRole, purchasingRoles[roleName], demoUser)
      }
    }

    await em.flush()
  },

  defaultRoleFeatures: {
    superadmin: ['purchasing.*'],
    admin: ['purchasing.*'],
    employee: [],
  },
}

export default setup
