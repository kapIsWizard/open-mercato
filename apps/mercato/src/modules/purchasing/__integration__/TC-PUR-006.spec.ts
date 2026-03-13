import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

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

async function createRequestFixture(
  request: APIRequestContext,
  token: string,
  uniqueSuffix: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/purchasing/requests', {
    token,
    data: {
      customerNip: `PL${uniqueSuffix}`,
      customerName: `Purchasing Notification ${uniqueSuffix}`,
      sourceChannel: 'email',
      formVariant: 'simple',
      requestText: `Notification flow ${uniqueSuffix}`,
      customerOrderNumber: `CO-${uniqueSuffix}`,
      items: [
        { sku: `SKU-${uniqueSuffix}-1`, productName: 'Warehouse Scanner', quantity: 1 },
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
    `/api/notifications?type=${encodeURIComponent('purchasing.request_item.status_changed')}&sourceEntityType=${encodeURIComponent('purchasing:request')}&sourceEntityId=${encodeURIComponent(requestId)}&page=1&pageSize=100`,
    { token },
  )
  await expectOk(response, 'fetch notifications')
  const body = await readJson<PagedResponse>(response)
  return Array.isArray(body.items) ? body.items : []
}

test.describe('TC-PUR-006: purchasing status notifications contract', () => {
  let adminToken = ''
  let employeeToken = ''

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    employeeToken = await getAuthToken(request, 'employee')
  })

  test('should create notifications only for notifiable statuses and group repeated notifications by item and status', async ({ request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    let requestId: string | null = null

    try {
      requestId = await createRequestFixture(request, employeeToken, uniqueSuffix)
      const items = await fetchItems(request, adminToken, requestId)
      const itemId = requireId(typeof items[0]?.id === 'string' ? items[0].id : null, 'item id')

      const initialNotifications = await fetchNotificationsBySource(request, employeeToken, requestId)
      expect(initialNotifications).toHaveLength(0)

      const orderedResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          id: itemId,
          itemStatus: 'ordered',
          supplierOrderNumber: `SUP-${uniqueSuffix}`,
        },
      })
      await expectOk(orderedResponse, 'mark item ordered')

      await expect
        .poll(async () => {
          const notifications = await fetchNotificationsBySource(request, employeeToken, requestId as string)
          return notifications.length
        }, { timeout: 5_000 })
        .toBe(0)

      const priceChangedResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          id: itemId,
          itemStatus: 'purchase_price_changed',
          purchasingNote: `Price changed ${uniqueSuffix}`,
        },
      })
      await expectOk(priceChangedResponse, 'mark item purchase_price_changed')

      await expect
        .poll(async () => {
          const notifications = await fetchNotificationsBySource(request, employeeToken, requestId as string)
          return notifications.length
        }, { timeout: 8_000 })
        .toBe(1)

      await expect
        .poll(async () => {
          const notifications = await fetchNotificationsBySource(request, employeeToken, requestId as string)
          return notifications[0] ? readNotificationStatus(notifications[0]) : null
        }, { timeout: 8_000 })
        .toBe('purchase_price_changed')

      const transitResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          id: itemId,
          itemStatus: 'in_transit',
        },
      })
      await expectOk(transitResponse, 'mark item in_transit')

      await expect
        .poll(async () => {
          const notifications = await fetchNotificationsBySource(request, employeeToken, requestId as string)
          return notifications.length
        }, { timeout: 5_000 })
        .toBe(1)

      const inStockResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          id: itemId,
          itemStatus: 'in_stock',
        },
      })
      await expectOk(inStockResponse, 'mark item in_stock')

      await expect
        .poll(async () => {
          const notifications = await fetchNotificationsBySource(request, employeeToken, requestId as string)
          return notifications.length
        }, { timeout: 8_000 })
        .toBe(2)

      const notificationsAfterInStock = await fetchNotificationsBySource(request, employeeToken, requestId)
      const inStockNotification = notificationsAfterInStock.find((entry) => readNotificationStatus(entry) === 'in_stock')
      expect(inStockNotification).toBeTruthy()
      const inStockNotificationId = requireId(typeof inStockNotification?.id === 'string' ? inStockNotification.id : null, 'in_stock notification id')

      const orderedAgainResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          id: itemId,
          itemStatus: 'ordered',
        },
      })
      await expectOk(orderedAgainResponse, 'mark item ordered again')

      const inStockAgainResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          id: itemId,
          itemStatus: 'in_stock',
        },
      })
      await expectOk(inStockAgainResponse, 'mark item in_stock again')

      await expect
        .poll(async () => {
          const notifications = await fetchNotificationsBySource(request, employeeToken, requestId as string)
          const matches = notifications.filter((entry) => readNotificationStatus(entry) === 'in_stock')
          return {
            count: matches.length,
            id: typeof matches[0]?.id === 'string' ? matches[0].id : null,
          }
        }, { timeout: 8_000 })
        .toEqual({ count: 1, id: inStockNotificationId })

      const finalNotifications = await fetchNotificationsBySource(request, employeeToken, requestId)
      expect(finalNotifications).toHaveLength(2)
      expect(finalNotifications.every((entry) => entry.type === 'purchasing.request_item.status_changed')).toBeTruthy()
      expect(finalNotifications.every((entry) => entry.sourceEntityId === requestId)).toBeTruthy()
      expect(finalNotifications.every((entry) => entry.linkHref === `/backend/purchasing/requests/${requestId}`)).toBeTruthy()
    } finally {
      if (requestId) {
        await apiRequest(request, 'DELETE', '/api/purchasing/requests', {
          token: adminToken,
          data: { id: requestId },
        })
      }
    }
  })
})
