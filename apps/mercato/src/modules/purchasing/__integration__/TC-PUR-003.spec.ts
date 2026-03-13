import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

type IdResponse = {
  id?: string | null
}

async function readJson<T>(response: APIResponse): Promise<T> {
  return await response.json() as T
}

test.describe('TC-PUR-003: purchasing API ACL and validation', () => {
  let adminToken = ''
  let employeeToken = ''

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    employeeToken = await getAuthToken(request, 'employee')
  })

  test('should enforce ACL boundaries for employee operations', async ({ request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    let requestId: string | null = null
    let itemId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/purchasing/requests', {
        token: employeeToken,
        data: {
          customerName: `ACL purchasing ${uniqueSuffix}`,
          sourceChannel: 'phone',
          formVariant: 'simple',
          requestText: `ACL flow ${uniqueSuffix}`,
          items: [
            { sku: `ACL-${uniqueSuffix}-1`, productName: 'ACL item', quantity: 1 },
          ],
        },
      })
      expect(createResponse.ok()).toBeTruthy()
      const createBody = await readJson<IdResponse>(createResponse)
      requestId = createBody.id ?? null
      expect(requestId).toBeTruthy()

      const itemsResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/request-items?requestId=${encodeURIComponent(requestId!)}&page=1&pageSize=10`,
        { token: adminToken },
      )
      expect(itemsResponse.ok()).toBeTruthy()
      const itemsBody = await itemsResponse.json() as { items?: Array<{ id?: string }> }
      itemId = itemsBody.items?.[0]?.id ?? null
      expect(itemId).toBeTruthy()

      const employeeRequestUpdateResponse = await apiRequest(request, 'PUT', '/api/purchasing/requests', {
        token: employeeToken,
        data: {
          id: requestId,
          purchasingOwnerUserId: '00000000-0000-0000-0000-000000000001',
        },
      })
      expect(employeeRequestUpdateResponse.status()).toBe(403)

      const employeeItemUpdateResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: employeeToken,
        data: {
          id: itemId,
          itemStatus: 'ordered',
        },
      })
      expect(employeeItemUpdateResponse.status()).toBe(403)

      const employeeItemsListResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/request-items?requestId=${encodeURIComponent(requestId!)}&page=1&pageSize=10`,
        { token: employeeToken },
      )
      expect(employeeItemsListResponse.status()).toBe(403)

      const employeeAssigneesResponse = await apiRequest(request, 'GET', '/api/purchasing/assignees', {
        token: employeeToken,
      })
      expect(employeeAssigneesResponse.ok()).toBeTruthy()
    } finally {
      if (requestId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/purchasing/requests?id=${encodeURIComponent(requestId)}`,
          { token: adminToken },
        ).catch(() => undefined)
      }
    }
  })

  test('should reject invalid payloads for create and comments', async ({ request }) => {
    const invalidCreateResponse = await apiRequest(request, 'POST', '/api/purchasing/requests', {
      token: adminToken,
      data: {
        sourceChannel: 'email',
        formVariant: 'simple',
        requestText: 'Invalid create payload',
        items: [
          { productName: 'Broken payload item', quantity: 1 },
        ],
      },
    })
    expect(invalidCreateResponse.status()).toBe(400)
    const invalidCreateBody = await invalidCreateResponse.json() as {
      error?: string
      details?: Array<{ path?: Array<string | number>; message?: string }>
    }
    expect(invalidCreateBody.error).toBe('Invalid input')
    expect(invalidCreateBody.details?.some((issue) => issue.message === 'Provide customer name or NIP.')).toBeTruthy()

    const invalidQuantityResponse = await apiRequest(request, 'POST', '/api/purchasing/requests', {
      token: adminToken,
      data: {
        customerName: 'Invalid quantity customer',
        sourceChannel: 'email',
        formVariant: 'simple',
        items: [
          { productName: 'Broken quantity item', quantity: 0 },
        ],
      },
    })
    expect(invalidQuantityResponse.status()).toBe(400)
    const invalidQuantityBody = await invalidQuantityResponse.json() as {
      error?: string
      details?: Array<{ path?: Array<string | number>; message?: string }>
    }
    expect(invalidQuantityBody.details?.some((issue) => issue.message === 'Quantity must be a whole number greater than 0.')).toBeTruthy()

    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    let requestId: string | null = null

    try {
      const validCreateResponse = await apiRequest(request, 'POST', '/api/purchasing/requests', {
        token: adminToken,
        data: {
          customerName: `Validation purchasing ${uniqueSuffix}`,
          sourceChannel: 'chat',
          formVariant: 'simple',
          items: [
            { productName: 'Validation item', quantity: 2 },
          ],
        },
      })
      expect(validCreateResponse.ok()).toBeTruthy()
      const validCreateBody = await readJson<IdResponse>(validCreateResponse)
      requestId = validCreateBody.id ?? null
      expect(requestId).toBeTruthy()

      const emptyCommentResponse = await apiRequest(request, 'POST', '/api/purchasing/comments', {
        token: adminToken,
        data: {
          requestId,
          body: '',
        },
      })
      expect(emptyCommentResponse.status()).toBe(400)
      const emptyCommentBody = await emptyCommentResponse.json() as {
        details?: Array<{ message?: string }>
      }
      expect(emptyCommentBody.details?.some((issue) => issue.message === 'Comment body is required.')).toBeTruthy()

      const invalidCommentUpdateResponse = await apiRequest(request, 'PUT', '/api/purchasing/comments', {
        token: adminToken,
        data: {
          id: '00000000-0000-0000-0000-000000000000',
          body: 'Update on missing comment',
        },
      })
      expect(invalidCommentUpdateResponse.status()).toBe(404)
    } finally {
      if (requestId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/purchasing/requests?id=${encodeURIComponent(requestId)}`,
          { token: adminToken },
        ).catch(() => undefined)
      }
    }
  })
})
