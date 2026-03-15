import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { hash } from 'bcryptjs'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { Role, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'

export const setup: ModuleSetupConfig = {
  seedDefaults: async ({ em, tenantId, organizationId }) => {
    const employeeRole = await em.findOne(Role, { name: 'employee', tenantId })
    if (!employeeRole) return

    const demoPurchasers = [
      { email: 'purchasing.anna@acme.com', name: 'Anna Zakupy' },
      { email: 'purchasing.marek@acme.com', name: 'Marek Zakupy' },
      { email: 'purchasing.julia@acme.com', name: 'Julia Zakupy' },
    ] as const

    for (const purchaser of demoPurchasers) {
      let user = await em.findOne(User, { email: purchaser.email, deletedAt: null })
      if (!user) {
        user = em.create(User, {
          tenantId,
          organizationId,
          email: purchaser.email,
          emailHash: computeEmailHash(purchaser.email),
          name: purchaser.name,
          passwordHash: await hash('secret', 10),
          isConfirmed: true,
          createdAt: new Date(),
        })
        em.persist(user)
        await em.flush()
      }

      const userRole = await em.findOne(UserRole, { user, role: employeeRole })
      if (!userRole) {
        em.persist(em.create(UserRole, {
          user,
          role: employeeRole,
          createdAt: new Date(),
        }))
      }

      let userAcl = await em.findOne(UserAcl, { user, tenantId })
      const features = [
        'attachments.view',
        'attachments.manage',
        'purchasing.requests.view',
        'purchasing.requests.create',
        'purchasing.requests.update',
        'purchasing.requests.assign',
        'purchasing.items.view',
        'purchasing.items.update',
        'purchasing.comments.view',
        'purchasing.comments.manage',
      ]
      if (!userAcl) {
        userAcl = em.create(UserAcl, {
          user,
          tenantId,
          featuresJson: features,
          isSuperAdmin: false,
          organizationsJson: [organizationId],
          createdAt: new Date(),
        })
        em.persist(userAcl)
      } else {
        userAcl.featuresJson = Array.from(new Set([...(userAcl.featuresJson ?? []), ...features]))
        userAcl.organizationsJson = Array.from(new Set([...(userAcl.organizationsJson ?? []), organizationId]))
      }
    }

    await em.flush()
  },

  defaultRoleFeatures: {
    superadmin: ['purchasing.*'],
    admin: ['purchasing.*'],
    employee: [
      'attachments.view',
      'attachments.manage',
      'purchasing.requests.view',
      'purchasing.requests.create',
      'purchasing.items.view',
      'purchasing.comments.view',
      'purchasing.comments.manage',
    ],
  },
}

export default setup
