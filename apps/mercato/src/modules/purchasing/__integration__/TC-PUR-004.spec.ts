import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

type IdResponse = {
  id?: string | null
}

type PagedResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
}

type AssigneeOption = {
  value?: string
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
      customerName: `Purchasing Contract ${uniqueSuffix}`,
      sourceChannel: 'email',
      formVariant: 'simple',
      requestText: `Contract flow ${uniqueSuffix}`,
      customerOrderNumber: `CO-${uniqueSuffix}`,
      items: [
        { sku: `SKU-${uniqueSuffix}-1`, referenceNumber: `REF-${uniqueSuffix}-1`, productName: 'Safety Gloves', quantity: 2 },
        { sku: `SKU-${uniqueSuffix}-2`, referenceNumber: `REF-${uniqueSuffix}-2`, productName: 'Safety Glasses', quantity: 3 },
      ],
    },
  })
  await expectOk(response, 'create request')
  const body = await readJson<IdResponse>(response)
  return requireId(body.id, 'request id')
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

test.describe('TC-PUR-004: purchasing API detailed contract and lifecycle coverage', () => {
  let adminToken = ''
  let employeeToken = ''

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    employeeToken = await getAuthToken(request, 'employee')
  })

  test('should cover filters, lifecycle edge cases, comment contract, and cleanup semantics', async ({ request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    const createdAtIso = new Date().toISOString()
    let primaryRequestId: string | null = null
    let secondaryRequestId: string | null = null
    let primaryFirstItemId: string | null = null
    let primarySecondItemId: string | null = null
    let foreignItemId: string | null = null
    let commentId: string | null = null

    try {
      primaryRequestId = await createRequestFixture(request, employeeToken, `${uniqueSuffix}-A`)
      secondaryRequestId = await createRequestFixture(request, employeeToken, `${uniqueSuffix}-B`)

      const primaryInitial = await fetchRequest(request, adminToken, primaryRequestId)
      const salesOwnerUserId = requireId(
        typeof (primaryInitial.sales_owner_user_id ?? primaryInitial.salesOwnerUserId) === 'string'
          ? String(primaryInitial.sales_owner_user_id ?? primaryInitial.salesOwnerUserId)
          : null,
        'sales owner user id',
      )

      const assigneesResponse = await apiRequest(request, 'GET', '/api/purchasing/assignees', { token: adminToken })
      await expectOk(assigneesResponse, 'list assignees')
      const assigneesBody = await readJson<{ items?: AssigneeOption[] }>(assigneesResponse)
      const assigneeId = requireId(
        Array.isArray(assigneesBody.items)
          ? assigneesBody.items.find((entry) => typeof entry.value === 'string')?.value ?? null
          : null,
        'assignee id',
      )

      const assignResponse = await apiRequest(request, 'PUT', '/api/purchasing/requests', {
        token: adminToken,
        data: { id: primaryRequestId, purchasingOwnerUserId: assigneeId },
      })
      await expectOk(assignResponse, 'assign primary request')

      const customerFilterResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/requests?customerNip=${encodeURIComponent(`PL${uniqueSuffix}-A`)}&page=1&pageSize=10`,
        { token: adminToken },
      )
      await expectOk(customerFilterResponse, 'filter by customer nip')
      const customerFilterBody = await readJson<PagedResponse>(customerFilterResponse)
      expect(customerFilterBody.items?.some((row) => row.id === primaryRequestId)).toBeTruthy()

      const referenceFilterResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/requests?referenceNumber=${encodeURIComponent(`REF-${uniqueSuffix}-A-1`)}&page=1&pageSize=10`,
        { token: adminToken },
      )
      await expectOk(referenceFilterResponse, 'filter by reference number')
      const referenceFilterBody = await readJson<PagedResponse>(referenceFilterResponse)
      expect(referenceFilterBody.items?.some((row) => row.id === primaryRequestId)).toBeTruthy()

      const assigneeFilterResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/requests?purchasingOwnerUserId=${encodeURIComponent(assigneeId)}&page=1&pageSize=10`,
        { token: adminToken },
      )
      await expectOk(assigneeFilterResponse, 'filter by purchasing owner')
      const assigneeFilterBody = await readJson<PagedResponse>(assigneeFilterResponse)
      expect(assigneeFilterBody.items?.some((row) => row.id === primaryRequestId)).toBeTruthy()

      const salesOwnerFilterResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/requests?salesOwnerUserId=${encodeURIComponent(salesOwnerUserId)}&page=1&pageSize=10`,
        { token: adminToken },
      )
      await expectOk(salesOwnerFilterResponse, 'filter by sales owner')
      const salesOwnerFilterBody = await readJson<PagedResponse>(salesOwnerFilterResponse)
      expect(salesOwnerFilterBody.items?.some((row) => row.id === primaryRequestId)).toBeTruthy()

      const createdRangeResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/requests?createdFrom=${encodeURIComponent(createdAtIso)}&createdTo=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}&page=1&pageSize=20`,
        { token: adminToken },
      )
      await expectOk(createdRangeResponse, 'filter by creation range')
      const createdRangeBody = await readJson<PagedResponse>(createdRangeResponse)
      expect(createdRangeBody.items?.some((row) => row.id === primaryRequestId)).toBeTruthy()

      const assignedFilterResponse = await apiRequest(
        request,
        'GET',
        '/api/purchasing/requests?requestStatus=assigned&page=1&pageSize=20',
        { token: adminToken },
      )
      await expectOk(assignedFilterResponse, 'filter by assigned status')
      const assignedFilterBody = await readJson<PagedResponse>(assignedFilterResponse)
      expect(assignedFilterBody.items?.some((row) => row.id === primaryRequestId)).toBeTruthy()

      const primaryItems = await fetchItems(
        request,
        adminToken,
        `requestId=${encodeURIComponent(primaryRequestId)}&page=1&pageSize=100&sortField=lineNo&sortDir=asc`,
      )
      expect(primaryItems).toHaveLength(2)
      expect(primaryItems[0]?.line_no ?? primaryItems[0]?.lineNo).toBe(1)
      expect(primaryItems[1]?.line_no ?? primaryItems[1]?.lineNo).toBe(2)
      expect(primaryItems[0]?.reference_number ?? primaryItems[0]?.referenceNumber).toBe(`REF-${uniqueSuffix}-A-1`)
      primaryFirstItemId = requireId(typeof primaryItems[0]?.id === 'string' ? primaryItems[0].id : null, 'primary first item id')
      primarySecondItemId = requireId(typeof primaryItems[1]?.id === 'string' ? primaryItems[1].id : null, 'primary second item id')

      const secondaryItems = await fetchItems(
        request,
        adminToken,
        `requestId=${encodeURIComponent(secondaryRequestId)}&page=1&pageSize=100&sortField=lineNo&sortDir=asc`,
      )
      foreignItemId = requireId(typeof secondaryItems[0]?.id === 'string' ? secondaryItems[0].id : null, 'foreign item id')

      const inTransitResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          id: primaryFirstItemId,
          itemStatus: 'in_transit',
          supplierOrderNumber: `SUP-${uniqueSuffix}`,
          purchasingNote: `Transit ${uniqueSuffix}`,
        },
      })
      await expectOk(inTransitResponse, 'move first item to in transit')

      const cancelledResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          id: primarySecondItemId,
          itemStatus: 'cancelled',
          purchasingNote: `Cancelled ${uniqueSuffix}`,
        },
      })
      await expectOk(cancelledResponse, 'cancel second item')

      const transitFilterResponse = await apiRequest(
        request,
        'GET',
        '/api/purchasing/request-items?itemStatus=in_transit&page=1&pageSize=20',
        { token: adminToken },
      )
      await expectOk(transitFilterResponse, 'filter items by in_transit')
      const transitFilterBody = await readJson<PagedResponse>(transitFilterResponse)
      expect(transitFilterBody.items?.some((row) => row.id === primaryFirstItemId)).toBeTruthy()

      const searchNoteResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/request-items?search=${encodeURIComponent(`Transit ${uniqueSuffix}`)}&page=1&pageSize=20`,
        { token: adminToken },
      )
      await expectOk(searchNoteResponse, 'search items by note')
      const searchNoteBody = await readJson<PagedResponse>(searchNoteResponse)
      expect(searchNoteBody.items?.some((row) => row.id === primaryFirstItemId)).toBeTruthy()

      const partialRequest = await fetchRequest(request, adminToken, primaryRequestId)
      expect(partialRequest.request_status ?? partialRequest.requestStatus).toBe('partially_ordered')

      const mismatchedCommentResponse = await apiRequest(request, 'POST', '/api/purchasing/comments', {
        token: adminToken,
        data: {
          requestId: primaryRequestId,
          requestItemId: foreignItemId,
          body: `Mismatched item comment ${uniqueSuffix}`,
        },
      })
      expect(mismatchedCommentResponse.status()).toBe(400)

      const createCommentResponse = await apiRequest(request, 'POST', '/api/purchasing/comments', {
        token: employeeToken,
        data: {
          requestId: primaryRequestId,
          body: `Contract comment ${uniqueSuffix}`,
        },
      })
      await expectOk(createCommentResponse, 'create request comment')
      const createCommentBody = await readJson<IdResponse>(createCommentResponse)
      commentId = requireId(createCommentBody.id, 'comment id')

      const requestComments = await fetchComments(
        request,
        adminToken,
        `requestId=${encodeURIComponent(primaryRequestId)}&page=1&pageSize=20`,
      )
      expect(requestComments.some((entry) => entry.id === commentId)).toBeTruthy()

      const deleteTransitItemResponse = await apiRequest(
        request,
        'DELETE',
        `/api/purchasing/request-items?id=${encodeURIComponent(primaryFirstItemId)}`,
        { token: adminToken },
      )
      await expectOk(deleteTransitItemResponse, 'delete in transit item')

      const cancelledRequest = await fetchRequest(request, adminToken, primaryRequestId)
      expect(cancelledRequest.request_status ?? cancelledRequest.requestStatus).toBe('cancelled')

      const deleteCancelledItemResponse = await apiRequest(
        request,
        'DELETE',
        `/api/purchasing/request-items?id=${encodeURIComponent(primarySecondItemId)}`,
        { token: adminToken },
      )
      await expectOk(deleteCancelledItemResponse, 'delete cancelled item')

      const assignedAgainRequest = await fetchRequest(request, adminToken, primaryRequestId)
      expect(assignedAgainRequest.request_status ?? assignedAgainRequest.requestStatus).toBe('assigned')
      expect(assignedAgainRequest.itemsCount).toBe(0)
      expect(assignedAgainRequest.openItemsCount).toBe(0)

      const recreateItemResponse = await apiRequest(request, 'POST', '/api/purchasing/request-items', {
        token: adminToken,
        data: {
          requestId: primaryRequestId,
          sku: `SKU-${uniqueSuffix}-recreated`,
          productName: 'Respirator Mask',
          quantity: 1,
          itemStatus: 'in_stock',
        },
      })
      await expectOk(recreateItemResponse, 'recreate item after cleanup')
      const recreateItemBody = await readJson<IdResponse>(recreateItemResponse)
      const recreatedItemId = requireId(recreateItemBody.id, 'recreated item id')

      const recreatedItems = await fetchItems(
        request,
        adminToken,
        `requestId=${encodeURIComponent(primaryRequestId)}&page=1&pageSize=100&sortField=lineNo&sortDir=asc`,
      )
      expect(recreatedItems).toHaveLength(1)
      expect(recreatedItems[0]?.id).toBe(recreatedItemId)
      expect(recreatedItems[0]?.line_no ?? recreatedItems[0]?.lineNo).toBe(1)

      const completedRequest = await fetchRequest(request, adminToken, primaryRequestId)
      expect(completedRequest.request_status ?? completedRequest.requestStatus).toBe('completed')

      const deleteCommentResponse = await apiRequest(
        request,
        'DELETE',
        `/api/purchasing/comments?id=${encodeURIComponent(commentId)}`,
        { token: adminToken },
      )
      await expectOk(deleteCommentResponse, 'delete request comment')

      const commentsAfterDelete = await fetchComments(
        request,
        adminToken,
        `requestId=${encodeURIComponent(primaryRequestId)}&page=1&pageSize=20`,
      )
      expect(commentsAfterDelete.some((entry) => entry.id === commentId)).toBeFalsy()
    } finally {
      for (const id of [primaryRequestId, secondaryRequestId]) {
        if (!id) continue
        await apiRequest(request, 'DELETE', '/api/purchasing/requests', {
          token: adminToken,
          data: { id },
        })
      }
    }
  })
})
