import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

type IdResponse = {
  id?: string | null
}

type PagedResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
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
      customerName: `Purchasing Cleanup ${uniqueSuffix}`,
      sourceChannel: 'email',
      formVariant: 'simple',
      requestText: `Cleanup test ${uniqueSuffix}`,
      customerOrderNumber: `CO-${uniqueSuffix}`,
      items: [
        { sku: `SKU-${uniqueSuffix}-1`, productName: 'Disposable Gloves', quantity: 4 },
        { sku: `SKU-${uniqueSuffix}-2`, productName: 'Protective Apron', quantity: 1 },
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
  query: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await apiRequest(request, 'GET', `/api/purchasing/request-items?${query}`, { token })
  await expectOk(response, 'fetch request items')
  const body = await readJson<PagedResponse>(response)
  return Array.isArray(body.items) ? body.items : []
}

async function fetchComments(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await apiRequest(request, 'GET', `/api/purchasing/comments?${query}`, { token })
  await expectOk(response, 'fetch comments')
  const body = await readJson<PagedResponse>(response)
  return Array.isArray(body.items) ? body.items : []
}

test.describe('TC-PUR-005: purchasing API cleanup and deleted-resource contract', () => {
  let adminToken = ''
  let employeeToken = ''

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    employeeToken = await getAuthToken(request, 'employee')
  })

  test('should hide deleted resources from reads and reject writes against deleted parents and children', async ({ request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    let requestId: string | null = null
    let itemId: string | null = null
    let commentId: string | null = null

    requestId = await createRequestFixture(request, employeeToken, uniqueSuffix)

    try {
      const initialItems = await fetchItems(
        request,
        adminToken,
        `requestId=${encodeURIComponent(requestId)}&page=1&pageSize=100&sortField=lineNo&sortDir=asc`,
      )
      expect(initialItems).toHaveLength(2)
      itemId = requireId(typeof initialItems[0]?.id === 'string' ? initialItems[0].id : null, 'item id')

      const createCommentResponse = await apiRequest(request, 'POST', '/api/purchasing/comments', {
        token: employeeToken,
        data: {
          requestId,
          requestItemId: itemId,
          body: `Cleanup comment ${uniqueSuffix}`,
        },
      })
      await expectOk(createCommentResponse, 'create comment')
      const createCommentBody = await readJson<IdResponse>(createCommentResponse)
      commentId = requireId(createCommentBody.id, 'comment id')

      const deleteResponse = await apiRequest(request, 'DELETE', '/api/purchasing/requests', {
        token: adminToken,
        data: { id: requestId },
      })
      await expectOk(deleteResponse, 'delete request')

      const requestAfterDeleteResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/requests?id=${encodeURIComponent(requestId)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      await expectOk(requestAfterDeleteResponse, 'list request after delete')
      const requestAfterDeleteBody = await readJson<PagedResponse>(requestAfterDeleteResponse)
      expect(requestAfterDeleteBody.items ?? []).toHaveLength(0)

      const itemsAfterDelete = await fetchItems(
        request,
        adminToken,
        `requestId=${encodeURIComponent(requestId)}&page=1&pageSize=100`,
      )
      expect(itemsAfterDelete).toHaveLength(0)

      const commentsAfterDelete = await fetchComments(
        request,
        adminToken,
        `requestId=${encodeURIComponent(requestId)}&page=1&pageSize=100`,
      )
      expect(commentsAfterDelete).toHaveLength(0)

      const deletedItemUpdateResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          id: itemId,
          itemStatus: 'ordered',
        },
      })
      expect(deletedItemUpdateResponse.status()).toBe(404)

      const deletedCommentUpdateResponse = await apiRequest(request, 'PUT', '/api/purchasing/comments', {
        token: adminToken,
        data: {
          id: commentId,
          body: `Updated after delete ${uniqueSuffix}`,
        },
      })
      expect(deletedCommentUpdateResponse.status()).toBe(404)

      const createItemOnDeletedRequestResponse = await apiRequest(request, 'POST', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          requestId,
          sku: `SKU-${uniqueSuffix}-3`,
          productName: 'Face Shield',
          quantity: 1,
        },
      })
      expect(createItemOnDeletedRequestResponse.status()).toBe(404)

      const createCommentOnDeletedRequestResponse = await apiRequest(request, 'POST', '/api/purchasing/comments', {
        token: employeeToken,
        data: {
          requestId,
          body: `Late comment ${uniqueSuffix}`,
        },
      })
      expect(createCommentOnDeletedRequestResponse.status()).toBe(404)

      const deleteDeletedItemResponse = await apiRequest(
        request,
        'DELETE',
        `/api/purchasing/request-items?id=${encodeURIComponent(itemId)}`,
        { token: adminToken },
      )
      expect(deleteDeletedItemResponse.status()).toBe(404)

      const deleteDeletedCommentResponse = await apiRequest(
        request,
        'DELETE',
        `/api/purchasing/comments?id=${encodeURIComponent(commentId)}`,
        { token: adminToken },
      )
      expect(deleteDeletedCommentResponse.status()).toBe(404)

      const searchDeletedRequestResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/requests?search=${encodeURIComponent(`Cleanup ${uniqueSuffix}`)}&page=1&pageSize=20`,
        { token: adminToken },
      )
      await expectOk(searchDeletedRequestResponse, 'search deleted request')
      const searchDeletedRequestBody = await readJson<PagedResponse>(searchDeletedRequestResponse)
      expect(searchDeletedRequestBody.items?.some((row) => row.id === requestId)).toBeFalsy()
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
