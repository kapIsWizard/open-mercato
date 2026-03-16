import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, postForm } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

const PURCHASING_ROLE_NAMES = {
  sales: true,
  bok: true,
  purchasing: true,
} as const

const TEST_PASSWORD = 'Valid1!Pass'
const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const

export type PurchasingRoleName = keyof typeof PURCHASING_ROLE_NAMES

export type PurchasingRoleFixture = {
  tenantId: string
  organizationId: string
  users: Record<PurchasingRoleName, { email: string; password: string; roleId: string; userId: string }>
}

type RoleListResponse = {
  items?: Array<{
    id?: string
    name?: string
    tenantId?: string | null
  }>
}

type CreateResponse = {
  id?: string | null
}

async function ensureRole(
  request: APIRequestContext,
  adminToken: string,
  tenantId: string,
  roleName: PurchasingRoleName,
): Promise<string> {
  const listResponse = await apiRequest(
    request,
    'GET',
    `/api/auth/roles?tenantId=${encodeURIComponent(tenantId)}&search=${encodeURIComponent(roleName)}&page=1&pageSize=50`,
    { token: adminToken },
  )
  expect(listResponse.ok(), await listResponse.text()).toBeTruthy()
  const listBody = (await listResponse.json()) as RoleListResponse
  const exactMatch = Array.isArray(listBody.items)
    ? listBody.items.find((item) => item.name === roleName && item.tenantId === tenantId)
    : null
  if (typeof exactMatch?.id === 'string' && exactMatch.id.length > 0) return exactMatch.id

  const createResponse = await apiRequest(request, 'POST', '/api/auth/roles', {
    token: adminToken,
    data: {
      name: roleName,
      tenantId,
    },
  })
  expect(createResponse.status(), await createResponse.text()).toBe(201)
  const createBody = (await createResponse.json()) as CreateResponse
  expect(typeof createBody.id).toBe('string')
  return createBody.id as string
}

async function createRoleUser(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  input: {
    email: string
    password: string
    roleName: PurchasingRoleName
  },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/auth/users', {
    token: adminToken,
    data: {
      email: input.email,
      password: input.password,
      organizationId,
      roles: ['employee', input.roleName],
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  const body = (await response.json()) as CreateResponse
  expect(typeof body.id).toBe('string')
  return body.id as string
}

export async function provisionPurchasingRoleFixtures(
  request: APIRequestContext,
  adminToken: string,
  prefix: string,
): Promise<PurchasingRoleFixture> {
  const { tenantId, organizationId } = getTokenContext(adminToken)
  const users = {} as PurchasingRoleFixture['users']

  for (const roleName of Object.keys(PURCHASING_ROLE_NAMES) as PurchasingRoleName[]) {
    const roleId = await ensureRole(request, adminToken, tenantId, roleName)
    const email = `${prefix}-${roleName}@acme.com`
    const userId = await createRoleUser(request, adminToken, organizationId, {
      email,
      password: TEST_PASSWORD,
      roleName,
    })
    users[roleName] = { email, password: TEST_PASSWORD, roleId, userId }
  }

  return {
    tenantId,
    organizationId,
    users,
  }
}

export async function cleanupPurchasingRoleFixtures(
  request: APIRequestContext,
  adminToken: string,
  fixtures: PurchasingRoleFixture | null,
): Promise<void> {
  if (!fixtures) return
  for (const user of Object.values(fixtures.users)) {
    const listResponse = await apiRequest(
      request,
      'GET',
      `/api/auth/users?search=${encodeURIComponent(user.email)}&page=1&pageSize=20`,
      { token: adminToken },
    )
    if (!listResponse.ok()) continue
    const listBody = (await listResponse.json()) as { items?: Array<{ id?: string; email?: string }> }
    const userMatch = Array.isArray(listBody.items)
      ? listBody.items.find((item) => item.email === user.email)
      : null
    if (typeof userMatch?.id !== 'string' || userMatch.id.length === 0) continue
    await apiRequest(request, 'DELETE', `/api/auth/users?id=${encodeURIComponent(userMatch.id)}`, {
      token: adminToken,
    }).catch(() => undefined)
  }
}

export async function getTenantUserToken(
  request: APIRequestContext,
  tenantId: string,
  email: string,
  password = TEST_PASSWORD,
): Promise<string> {
  const response = await postForm(request, '/api/auth/login', {
    email,
    password,
    tenantId,
  })
  const body = (await response.json().catch(() => null)) as { token?: string; error?: string } | null
  expect(response.ok(), body?.error ?? `Expected login for ${email} to succeed`).toBeTruthy()
  expect(typeof body?.token).toBe('string')
  return body?.token as string
}

function decodeJwtClaims(token: string): { tenantId?: string; orgId?: string | null } | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const normalized = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as {
      tenantId?: string
      orgId?: string | null
    }
  } catch {
    return null
  }
}

export async function loginTenantUser(
  page: Page,
  input: {
    tenantId: string
    email: string
    password?: string
    expectedRedirect?: RegExp
  },
): Promise<void> {
  const password = input.password ?? TEST_PASSWORD
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  await page.context().addCookies([
    {
      name: 'om_demo_notice_ack',
      value: 'ack',
      url: baseUrl,
      sameSite: 'Lax',
    },
    {
      name: 'om_cookie_notice_ack',
      value: 'ack',
      url: baseUrl,
      sameSite: 'Lax',
    },
  ])

  const loginResponse = await page.request.post('/api/auth/login', {
    form: {
      email: input.email,
      password,
      tenantId: input.tenantId,
    },
  })
  const loginBody = (await loginResponse.json().catch(() => null)) as { token?: string; redirect?: string; error?: string } | null
  expect(loginResponse.ok(), loginBody?.error ?? `Expected UI login for ${input.email} to succeed`).toBeTruthy()
  expect(typeof loginBody?.token).toBe('string')

  const token = loginBody?.token as string
  const claims = decodeJwtClaims(token)
  const cookies = [
    {
      name: 'auth_token',
      value: token,
      url: baseUrl,
      sameSite: 'Lax' as const,
      httpOnly: true,
    },
    {
      name: 'om_login_tenant',
      value: input.tenantId,
      url: baseUrl,
      sameSite: 'Lax' as const,
    },
  ]
  if (claims?.tenantId) {
    cookies.push({
      name: 'om_selected_tenant',
      value: claims.tenantId,
      url: baseUrl,
      sameSite: 'Lax' as const,
    })
  }
  if (claims?.orgId) {
    cookies.push({
      name: 'om_selected_org',
      value: claims.orgId,
      url: baseUrl,
      sameSite: 'Lax' as const,
    })
  }
  await page.context().addCookies(cookies)

  await page.goto(loginBody?.redirect || '/backend/purchasing/requests', { waitUntil: 'domcontentloaded' })
  await page.waitForURL(input.expectedRedirect ?? /\/backend\/purchasing\/requests(?:\/.*)?(?:\?.*)?$/, {
    timeout: 15_000,
  })
}

export function createValidNip(seed: string): string {
  const digits = seed
    .replace(/\D/g, '')
    .padStart(9, '0')
    .slice(-9)
    .split('')
    .map((value) => Number(value))
  const checksum = digits.reduce((sum, digit, index) => sum + (digit * NIP_WEIGHTS[index]), 0) % 11
  if (checksum === 10) {
    return createValidNip(String(Number(seed || '0') + 1))
  }
  return `${digits.join('')}${checksum}`
}
