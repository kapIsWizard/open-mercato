import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { AuthService } from '@open-mercato/core/modules/auth/services/authService'

export async function resolvePurchasingRoleNames(request: Request): Promise<string[] | null> {
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub || !auth.tenantId) return null
  const container = await createRequestContainer()
  const authService = container.resolve('authService') as AuthService
  return authService.getUserRoles(
    {
      id: auth.sub,
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
    } as never,
    auth.tenantId,
  )
}

export async function guardPurchasingAccess(
  request: Request,
  predicate: (roleNames: readonly string[]) => boolean,
): Promise<NextResponse | null> {
  const roleNames = await resolvePurchasingRoleNames(request)
  if (!roleNames) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!predicate(roleNames)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}
