import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

type IdResponse = {
  id?: string | null
}

type AssigneeOption = {
  value?: string
  label?: string
}

type PagedResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
}

async function readJson<T>(response: APIResponse): Promise<T> {
  return await response.json() as T
}

function requireId(value: string | null | undefined, label: string): string {
  expect(value, `${label} should be present`).toBeTruthy()
  return value as string
}

async function expectOk(response: APIResponse, label: string): Promise<void> {
  const body = await response.text()
  expect(response.ok(), `${label} failed with status ${response.status()}: ${body}`).toBeTruthy()
}

async function createRequestFixture(
  request: APIRequestContext,
  token: string,
  uniqueSuffix: string,
): Promise<string> {
  const createResponse = await apiRequest(request, 'POST', '/api/purchasing/requests', {
    token,
    data: {
      customerNip: `PL${uniqueSuffix}`,
      customerName: `Purchasing Test ${uniqueSuffix}`,
      sourceChannel: 'email',
      formVariant: 'simple',
      requestText: `Need products for POC flow ${uniqueSuffix}`,
      customerOrderNumber: `CO-${uniqueSuffix}`,
      items: [
        { sku: `SKU-${uniqueSuffix}-1`, referenceNumber: `REF-${uniqueSuffix}-1`, productName: 'Safety Gloves', quantity: 10 },
        { sku: `SKU-${uniqueSuffix}-2`, referenceNumber: `REF-${uniqueSuffix}-2`, productName: 'Safety Glasses', quantity: 5 },
      ],
    },
  })
  await expectOk(createResponse, 'create request')
  const createBody = await readJson<IdResponse>(createResponse)
  return requireId(createBody.id, 'request id')
}

async function fetchRequest(
  request: APIRequestContext,
  token: string,
  requestId: string,
): Promise<Record<string, unknown>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/purchasing/requests?id=${encodeURIComponent(requestId)}&page=1&pageSize=1`,
    { token },
  )
  await expectOk(response, 'fetch request')
  const body = await readJson<PagedResponse>(response)
  const row = Array.isArray(body.items) ? body.items[0] : null
  expect(row, 'request row should exist').toBeTruthy()
  return row as Record<string, unknown>
}

async function fetchRequestItems(
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

test.describe('TC-PUR-001: purchasing API business path POC', () => {
  let adminToken = ''
  let employeeToken = ''

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    employeeToken = await getAuthToken(request, 'employee')
  })

  test('should execute the full POC business lifecycle across intake, assignment, fulfillment, comments, and cleanup', async ({ request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    const uniqueThirdSku = `BOOTS-${uniqueSuffix}`
    let requestId: string | null = null
    let firstItemId: string | null = null
    let secondItemId: string | null = null
    let requestCommentId: string | null = null
    let itemCommentId: string | null = null

    try {
      requestId = await createRequestFixture(request, employeeToken, uniqueSuffix)

      const initialRequest = await fetchRequest(request, adminToken, requestId)
      expect(initialRequest.customer_name ?? initialRequest.customerName).toBe(`Purchasing Test ${uniqueSuffix}`)
      expect(initialRequest.request_status ?? initialRequest.requestStatus).toBe('unassigned')
      expect(initialRequest.customer_order_number ?? initialRequest.customerOrderNumber).toBe(`CO-${uniqueSuffix}`)
      expect(initialRequest.itemsCount).toBe(2)
      expect(initialRequest.openItemsCount).toBe(2)
      expect(initialRequest.sales_owner_user_id ?? initialRequest.salesOwnerUserId).toBeTruthy()
      expect(initialRequest.purchasing_owner_user_id ?? initialRequest.purchasingOwnerUserId).toBeFalsy()

      const assigneesResponse = await apiRequest(request, 'GET', '/api/purchasing/assignees', {
        token: adminToken,
      })
      await expectOk(assigneesResponse, 'list assignees')
      const assigneesBody = await readJson<{ items?: AssigneeOption[] }>(assigneesResponse)
      const employeeAssignee = Array.isArray(assigneesBody.items)
        ? assigneesBody.items.find((entry) => typeof entry.value === 'string')
        : null
      const assigneeId = requireId(employeeAssignee?.value ?? null, 'employee assignee id')

      const assignResponse = await apiRequest(request, 'PUT', '/api/purchasing/requests', {
        token: adminToken,
        data: {
          id: requestId,
          purchasingOwnerUserId: assigneeId,
        },
      })
      await expectOk(assignResponse, 'assign request')

      const assignedRequest = await fetchRequest(request, adminToken, requestId)
      expect(assignedRequest.request_status ?? assignedRequest.requestStatus).toBe('assigned')
      expect(assignedRequest.purchasing_owner_user_id ?? assignedRequest.purchasingOwnerUserId).toBe(assigneeId)

      const initialItems = await fetchRequestItems(
        request,
        adminToken,
        `requestId=${encodeURIComponent(requestId)}&page=1&pageSize=100&sortField=lineNo&sortDir=asc`,
      )
      expect(initialItems).toHaveLength(2)
      firstItemId = requireId(typeof initialItems[0]?.id === 'string' ? initialItems[0].id : null, 'first item id')
      secondItemId = requireId(typeof initialItems[1]?.id === 'string' ? initialItems[1].id : null, 'second item id')
      expect(initialItems[0]?.reference_number ?? initialItems[0]?.referenceNumber).toBe(`REF-${uniqueSuffix}-1`)
      expect(initialItems[0]?.item_status ?? initialItems[0]?.itemStatus).toBe('to_order')
      expect(initialItems[1]?.item_status ?? initialItems[1]?.itemStatus).toBe('to_order')

      const markSecondItemInProgressResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          id: secondItemId,
          itemStatus: 'purchase_price_changed',
          purchasingNote: `Price changed for ${uniqueSuffix}`,
        },
      })
      await expectOk(markSecondItemInProgressResponse, 'mark second item in progress')

      const inProgressRequest = await fetchRequest(request, adminToken, requestId)
      expect(inProgressRequest.request_status ?? inProgressRequest.requestStatus).toBe('in_progress')
      expect(inProgressRequest.itemsCount).toBe(2)
      expect(inProgressRequest.openItemsCount).toBe(2)

      const updateFirstItemResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          id: firstItemId,
          itemStatus: 'ordered',
          supplierOrderNumber: `SUP-${uniqueSuffix}`,
          purchasingNote: `Ordered for ${uniqueSuffix}`,
        },
      })
      await expectOk(updateFirstItemResponse, 'update first item')

      const partiallyOrderedRequest = await fetchRequest(request, adminToken, requestId)
      expect(partiallyOrderedRequest.request_status ?? partiallyOrderedRequest.requestStatus).toBe('partially_ordered')
      expect(partiallyOrderedRequest.openItemsCount).toBe(2)

      const addThirdItemResponse = await apiRequest(request, 'POST', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          requestId,
          sku: uniqueThirdSku,
          productName: 'Safety Boots',
          quantity: 2,
          itemStatus: 'to_order',
        },
      })
      await expectOk(addThirdItemResponse, 'create third item')
      const addThirdItemBody = await readJson<IdResponse>(addThirdItemResponse)
      const thirdItemId = requireId(addThirdItemBody.id, 'third item id')

      const searchBySkuItems = await fetchRequestItems(
        request,
        adminToken,
        `sku=${encodeURIComponent(uniqueThirdSku)}&page=1&pageSize=100`,
      )
      expect(searchBySkuItems).toHaveLength(1)
      expect(searchBySkuItems[0]?.product_name ?? searchBySkuItems[0]?.productName).toBe('Safety Boots')

      const requestSearchResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/requests?search=${encodeURIComponent(uniqueSuffix)}&page=1&pageSize=10`,
        { token: adminToken },
      )
      await expectOk(requestSearchResponse, 'search request')
      const requestSearchBody = await readJson<PagedResponse>(requestSearchResponse)
      expect(
        Array.isArray(requestSearchBody.items)
        && requestSearchBody.items.some((row) => row.id === requestId),
      ).toBeTruthy()

      const itemStatusFilterResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/requests?itemStatus=ordered&page=1&pageSize=10`,
        { token: adminToken },
      )
      await expectOk(itemStatusFilterResponse, 'filter requests by item status')
      const itemStatusFilterBody = await readJson<PagedResponse>(itemStatusFilterResponse)
      expect(
        Array.isArray(itemStatusFilterBody.items)
        && itemStatusFilterBody.items.some((row) => row.id === requestId),
      ).toBeTruthy()

      const createRequestCommentResponse = await apiRequest(request, 'POST', '/api/purchasing/comments', {
        token: employeeToken,
        data: {
          requestId,
          body: `Request-level note ${uniqueSuffix}`,
        },
      })
      await expectOk(createRequestCommentResponse, 'create request comment')
      const createRequestCommentBody = await readJson<IdResponse>(createRequestCommentResponse)
      requestCommentId = requireId(createRequestCommentBody.id, 'request comment id')

      const createItemCommentResponse = await apiRequest(request, 'POST', '/api/purchasing/comments', {
        token: adminToken,
        data: {
          requestId,
          requestItemId: firstItemId,
          body: `Item-level note ${uniqueSuffix}`,
        },
      })
      await expectOk(createItemCommentResponse, 'create item comment')
      const createItemCommentBody = await readJson<IdResponse>(createItemCommentResponse)
      itemCommentId = requireId(createItemCommentBody.id, 'item comment id')

      const updateItemCommentResponse = await apiRequest(request, 'PUT', '/api/purchasing/comments', {
        token: adminToken,
        data: {
          id: itemCommentId,
          body: `Item-level note updated ${uniqueSuffix}`,
        },
      })
      await expectOk(updateItemCommentResponse, 'update item comment')

      const requestComments = await fetchComments(
        request,
        adminToken,
        `requestId=${encodeURIComponent(requestId)}&page=1&pageSize=100`,
      )
      expect(requestComments).toHaveLength(2)
      expect(
        requestComments.some((entry) => entry.body === `Request-level note ${uniqueSuffix}`),
      ).toBeTruthy()
      expect(
        requestComments.some((entry) => entry.body === `Item-level note updated ${uniqueSuffix}`),
      ).toBeTruthy()

      const itemComments = await fetchComments(
        request,
        adminToken,
        `requestId=${encodeURIComponent(requestId)}&requestItemId=${encodeURIComponent(firstItemId)}&page=1&pageSize=100`,
      )
      expect(itemComments).toHaveLength(1)
      expect(itemComments[0]?.body).toBe(`Item-level note updated ${uniqueSuffix}`)

      const deleteThirdItemResponse = await apiRequest(
        request,
        'DELETE',
        `/api/purchasing/request-items?id=${encodeURIComponent(thirdItemId)}`,
        { token: adminToken },
      )
      await expectOk(deleteThirdItemResponse, 'delete third item')

      const completeFirstItemResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          id: firstItemId,
          itemStatus: 'in_stock',
          deliveryDueAt: '2026-03-20T10:00:00.000Z',
          supplierOrderNumber: `SUP-${uniqueSuffix}`,
          purchasingNote: `Delivered for ${uniqueSuffix}`,
        },
      })
      await expectOk(completeFirstItemResponse, 'complete first item')

      const finalizeSecondItemResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          id: secondItemId,
          itemStatus: 'cancelled',
          purchasingNote: `Cancelled for ${uniqueSuffix}`,
        },
      })
      await expectOk(finalizeSecondItemResponse, 'finalize second item')

      const completedRequest = await fetchRequest(request, adminToken, requestId)
      expect(completedRequest.request_status ?? completedRequest.requestStatus).toBe('completed')
      expect(completedRequest.itemsCount).toBe(2)
      expect(completedRequest.openItemsCount).toBe(0)

      const completedItems = await fetchRequestItems(
        request,
        adminToken,
        `requestId=${encodeURIComponent(requestId)}&page=1&pageSize=100&sortField=lineNo&sortDir=asc`,
      )
      expect(completedItems).toHaveLength(2)
      expect(completedItems[0]?.item_status ?? completedItems[0]?.itemStatus).toBe('in_stock')
      expect(completedItems[0]?.supplier_order_number ?? completedItems[0]?.supplierOrderNumber).toBe(`SUP-${uniqueSuffix}`)
      expect(completedItems[1]?.item_status ?? completedItems[1]?.itemStatus).toBe('cancelled')

      const completedFilterResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/requests?requestStatus=completed&page=1&pageSize=10`,
        { token: adminToken },
      )
      await expectOk(completedFilterResponse, 'filter requests by completed status')
      const completedFilterBody = await readJson<PagedResponse>(completedFilterResponse)
      expect(
        Array.isArray(completedFilterBody.items)
        && completedFilterBody.items.some((row) => row.id === requestId),
      ).toBeTruthy()

      const deleteRequestCommentResponse = await apiRequest(
        request,
        'DELETE',
        `/api/purchasing/comments?id=${encodeURIComponent(requestCommentId)}`,
        { token: adminToken },
      )
      await expectOk(deleteRequestCommentResponse, 'delete request comment')

      const commentsAfterDelete = await fetchComments(
        request,
        adminToken,
        `requestId=${encodeURIComponent(requestId)}&page=1&pageSize=100`,
      )
      expect(commentsAfterDelete).toHaveLength(1)
      expect(commentsAfterDelete[0]?.body).toBe(`Item-level note updated ${uniqueSuffix}`)
    } finally {
      if (requestId) {
        const deleteRequestResponse = await apiRequest(
          request,
          'DELETE',
          `/api/purchasing/requests?id=${encodeURIComponent(requestId)}`,
          { token: adminToken },
        )
        await expectOk(deleteRequestResponse, 'delete request')

        const requestsAfterDeleteResponse = await apiRequest(
          request,
          'GET',
          `/api/purchasing/requests?id=${encodeURIComponent(requestId)}&page=1&pageSize=1`,
          { token: adminToken },
        )
        await expectOk(requestsAfterDeleteResponse, 'fetch deleted request')
        const requestsAfterDeleteBody = await readJson<PagedResponse>(requestsAfterDeleteResponse)
        expect(Array.isArray(requestsAfterDeleteBody.items) ? requestsAfterDeleteBody.items : []).toHaveLength(0)

        const itemsAfterDelete = await fetchRequestItems(
          request,
          adminToken,
          `requestId=${encodeURIComponent(requestId)}&page=1&pageSize=100`,
        )
        expect(itemsAfterDelete).toHaveLength(0)

        const commentsAfterRequestDelete = await fetchComments(
          request,
          adminToken,
          `requestId=${encodeURIComponent(requestId)}&page=1&pageSize=100`,
        )
        expect(commentsAfterRequestDelete).toHaveLength(0)
      }
    }
  })
})
