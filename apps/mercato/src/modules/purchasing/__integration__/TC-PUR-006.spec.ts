import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import {
  cleanupPurchasingRoleFixtures,
  createValidNip,
  getTenantUserToken,
  provisionPurchasingRoleFixtures,
  type PurchasingRoleFixture,
} from './helpers'

type IdResponse = {
  id?: string | null
}

type PagedResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
}

function readNotificationStatus(entry: Record<string, unknown>): string | null {
  const bodyVariables = entry.bodyVariables
  if (!bodyVariables || typeof bodyVariables !== 'object' || Array.isArray(bodyVariables)) return null
  const record = bodyVariables as Record<string, unknown>
  return typeof record.status === 'string' ? record.status : null
}

async function readJson<T>(response: APIResponse): Promise<T> {
  return await response.json() as T
}

async function expectOk(response: APIResponse, label: string): Promise<void> {
  const body = await response.text()
  expect(response.ok(), `${label} failed with status ${response.status()}: ${body}`).toBeTruthy()
}

function requireId(value: string | null | undefined, label: string): string {
  expect(value, `${label} should be present`).toBeTruthy()
  return value as string
}

async function createPurchasingCatalogProduct(
  request: APIRequestContext,
  token: string,
  uniqueSuffix: string,
): Promise<{ id: string; sku: string; title: string; referenceNumber: string }> {
  const sku = `NOTIF-${uniqueSuffix}`
  const referenceNumber = `NOTIF-REF-${uniqueSuffix}`
  const title = `Notification Product ${uniqueSuffix}`
  const response = await apiRequest(request, 'POST', '/api/catalog/products', {
    token,
    data: {
      title,
      sku,
      handle: `notification-product-${uniqueSuffix.toLowerCase()}`,
      description: `Notification product ${uniqueSuffix}`,
      defaultUnit: 'pc',
      defaultSalesUnit: 'pc',
      primaryCurrencyCode: 'PLN',
      taxRate: 8,
      metadata: {
        purchasingImport: {
          source: 'akeneo',
          symbol: sku,
          referenceNumber,
          supplier: `Supplier ${uniqueSuffix}`,
          group: `Group ${uniqueSuffix}`,
          purchasingAvailability: 'AVAILABLE',
          availableQuantity: 4,
          unitPriceNet: '44.00',
        },
      },
    },
  })
  await expectOk(response, 'create notification product')
  const body = await readJson<IdResponse>(response)
  return { id: requireId(body.id, 'catalog product id'), sku, title, referenceNumber }
}

async function createRequestFixture(
  request: APIRequestContext,
  token: string,
  uniqueSuffix: string,
  product: { id: string; sku: string; title: string; referenceNumber: string },
): Promise<string> {
  const uniqueDigits = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const response = await apiRequest(request, 'POST', '/api/purchasing/requests', {
    token,
    data: {
      customerNip: createValidNip(uniqueDigits),
      customerName: `Purchasing Notification ${uniqueSuffix}`,
      customerOrderNumber: `NOTIF-${uniqueSuffix}`,
      items: [
        {
          catalogProductId: product.id,
          sku: product.sku,
          referenceNumber: product.referenceNumber,
          productName: product.title,
          quantity: 1,
        },
      ],
    },
  })
  await expectOk(response, 'create request')
  const body = await readJson<IdResponse>(response)
  return requireId(body.id, 'request id')
}

async function fetchItems(
  request: APIRequestContext,
  token: string,
  requestId: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/purchasing/request-items?requestId=${encodeURIComponent(requestId)}&page=1&pageSize=100&sortField=lineNo&sortDir=asc`,
    { token },
  )
  await expectOk(response, 'fetch request items')
  const body = await readJson<PagedResponse>(response)
  return Array.isArray(body.items) ? body.items : []
}

async function fetchNotificationsBySource(
  request: APIRequestContext,
  token: string,
  requestId: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/notifications?sourceEntityType=${encodeURIComponent('purchasing:request')}&sourceEntityId=${encodeURIComponent(requestId)}&page=1&pageSize=100`,
    { token },
  )
  await expectOk(response, 'fetch notifications')
  const body = await readJson<PagedResponse>(response)
  return Array.isArray(body.items) ? body.items : []
}

test.describe('TC-PUR-006: purchasing status notifications for sales submitter', () => {
  test.describe.configure({ timeout: 90_000 })
  let adminToken = ''
  let fixtures: PurchasingRoleFixture | null = null
  let salesToken = ''
  let purchasingToken = ''

  test.beforeAll(async ({ request }) => {
    test.setTimeout(90_000)
    adminToken = await getAuthToken(request, 'admin')
    fixtures = await provisionPurchasingRoleFixtures(request, adminToken, `qa-pur-006-${Date.now()}`)
    salesToken = await getTenantUserToken(request, fixtures.tenantId, fixtures.users.sales.email)
    purchasingToken = await getTenantUserToken(request, fixtures.tenantId, fixtures.users.purchasing.email)
  })

  test.afterAll(async ({ request }) => {
    test.setTimeout(90_000)
    await cleanupPurchasingRoleFixtures(request, adminToken, fixtures)
  })

  test('should notify sales submitter for purchase_price_changed, in_stock, and cancelled, but not for ordered', async ({ request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    let requestId: string | null = null
    let productId: string | null = null

    try {
      const product = await createPurchasingCatalogProduct(request, adminToken, uniqueSuffix)
      productId = product.id
      requestId = await createRequestFixture(request, salesToken, uniqueSuffix, product)
      const items = await fetchItems(request, purchasingToken, requestId)
      const itemId = requireId(typeof items[0]?.id === 'string' ? items[0].id : null, 'item id')

      const initialNotifications = await fetchNotificationsBySource(request, salesToken, requestId)
      expect(initialNotifications).toHaveLength(1)
      expect(initialNotifications[0]?.type).toBe('purchasing.request.created')

      const orderedResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: purchasingToken,
        data: {
          id: itemId,
          itemStatus: 'ordered',
          supplierOrderNumber: `SUP-${uniqueSuffix}`,
        },
      })
      await expectOk(orderedResponse, 'mark item ordered')

      await expect
        .poll(async () => {
          const notifications = await fetchNotificationsBySource(request, salesToken, requestId as string)
          return notifications.filter((entry) => entry.type === 'purchasing.request_item.status_changed').length
        }, { timeout: 5_000 })
        .toBe(0)

      const changedResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: purchasingToken,
        data: {
          id: itemId,
          itemStatus: 'purchase_price_changed',
          purchasingNote: `Price changed ${uniqueSuffix}`,
        },
      })
      await expectOk(changedResponse, 'mark item purchase_price_changed')

      await expect
        .poll(async () => {
          const notifications = await fetchNotificationsBySource(request, salesToken, requestId as string)
          return notifications.filter((entry) => readNotificationStatus(entry) === 'purchase_price_changed').length
        }, { timeout: 8_000 })
        .toBe(1)

      const inStockResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: purchasingToken,
        data: {
          id: itemId,
          itemStatus: 'in_stock',
        },
      })
      await expectOk(inStockResponse, 'mark item in_stock')

      await expect
        .poll(async () => {
          const notifications = await fetchNotificationsBySource(request, salesToken, requestId as string)
          return notifications.filter((entry) => readNotificationStatus(entry) === 'in_stock').length
        }, { timeout: 8_000 })
        .toBe(1)

      const cancelledResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: purchasingToken,
        data: {
          id: itemId,
          itemStatus: 'cancelled',
        },
      })
      await expectOk(cancelledResponse, 'mark item cancelled')

      await expect
        .poll(async () => {
          const notifications = await fetchNotificationsBySource(request, salesToken, requestId as string)
          return notifications.filter((entry) => readNotificationStatus(entry) === 'cancelled').length
        }, { timeout: 8_000 })
        .toBe(1)

      const finalNotifications = await fetchNotificationsBySource(request, salesToken, requestId)
      expect(finalNotifications.some((entry) => entry.type === 'purchasing.request.created')).toBeTruthy()
      expect(finalNotifications.filter((entry) => entry.type === 'purchasing.request_item.status_changed')).toHaveLength(3)
      expect(finalNotifications.every((entry) => entry.sourceEntityId === requestId)).toBeTruthy()
      expect(finalNotifications.every((entry) => entry.linkHref === `/backend/purchasing/requests/${requestId}`)).toBeTruthy()
    } finally {
      if (requestId) {
        await apiRequest(request, 'DELETE', '/api/purchasing/requests', {
          token: adminToken,
          data: { id: requestId },
        }).catch(() => undefined)
      }
      await deleteCatalogProductIfExists(request, adminToken, productId)
    }
  })
})
