import { Buffer } from 'node:buffer'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

type IdResponse = {
  id?: string | null
}

type PagedResponse = {
  items?: Array<Record<string, unknown>>
}

type AttachmentListResponse = {
  items?: Array<Record<string, unknown>>
}

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

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
      customerName: `Purchasing Attachments ${uniqueSuffix}`,
      sourceChannel: 'email',
      formVariant: 'simple',
      requestText: `Attachments flow ${uniqueSuffix}`,
      items: [
        { sku: `SKU-${uniqueSuffix}`, referenceNumber: `REF-${uniqueSuffix}`, productName: 'Attachment Gloves', quantity: 4 },
      ],
    },
  })
  await expectOk(response, 'create request')
  const body = await readJson<IdResponse>(response)
  return requireId(body.id, 'request id')
}

async function uploadAttachment(
  request: APIRequestContext,
  token: string,
  entityId: string,
  recordId: string,
  fileName: string,
  content: string,
): Promise<string> {
  const response = await request.fetch(`${BASE_URL}/api/attachments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    multipart: {
      entityId,
      recordId,
      file: {
        name: fileName,
        mimeType: 'text/plain',
        buffer: Buffer.from(content, 'utf-8'),
      },
    },
  })
  await expectOk(response, `upload attachment ${fileName}`)
  const body = await readJson<{ item?: { id?: string | null } }>(response)
  return requireId(body.item?.id ?? null, 'attachment id')
}

async function listAttachments(
  request: APIRequestContext,
  token: string,
  entityId: string,
  recordId: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await request.fetch(
    `${BASE_URL}/api/attachments?entityId=${encodeURIComponent(entityId)}&recordId=${encodeURIComponent(recordId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )
  await expectOk(response, `list attachments for ${entityId}:${recordId}`)
  const body = await readJson<AttachmentListResponse>(response)
  return Array.isArray(body.items) ? body.items : []
}

test.describe('TC-PUR-007: purchasing attachments contract', () => {
  let adminToken = ''
  let employeeToken = ''

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    employeeToken = await getAuthToken(request, 'employee')
  })

  test('should handle request and comment attachments across upload, read model, and cleanup', async ({ request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    let requestId: string | null = null
    let firstCommentId: string | null = null
    let secondCommentId: string | null = null

    try {
      requestId = await createRequestFixture(request, employeeToken, uniqueSuffix)

      const requestAttachmentId = await uploadAttachment(
        request,
        adminToken,
        E.purchasing.purchasing_request,
        requestId,
        `request-${uniqueSuffix}.txt`,
        `request attachment ${uniqueSuffix}`,
      )
      expect(requestAttachmentId).toBeTruthy()

      const requestAttachmentRows = await listAttachments(
        request,
        adminToken,
        E.purchasing.purchasing_request,
        requestId,
      )
      expect(requestAttachmentRows).toHaveLength(1)
      expect(requestAttachmentRows[0]?.fileName).toBe(`request-${uniqueSuffix}.txt`)

      const requestListResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/requests?id=${encodeURIComponent(requestId)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      await expectOk(requestListResponse, 'read request with attachment count')
      const requestListBody = await readJson<PagedResponse>(requestListResponse)
      const requestRow = Array.isArray(requestListBody.items) ? requestListBody.items[0] : null
      expect(requestRow?.attachments_count ?? requestRow?.attachmentsCount).toBe(1)

      const createFirstCommentResponse = await apiRequest(request, 'POST', '/api/purchasing/comments', {
        token: employeeToken,
        data: {
          requestId,
          body: `Attachment comment ${uniqueSuffix}`,
        },
      })
      await expectOk(createFirstCommentResponse, 'create first comment')
      firstCommentId = requireId((await readJson<IdResponse>(createFirstCommentResponse)).id, 'first comment id')

      const firstCommentAttachmentId = await uploadAttachment(
        request,
        adminToken,
        E.purchasing.purchasing_comment,
        firstCommentId,
        `comment-${uniqueSuffix}.txt`,
        `comment attachment ${uniqueSuffix}`,
      )
      expect(firstCommentAttachmentId).toBeTruthy()

      const firstCommentAttachments = await listAttachments(
        request,
        adminToken,
        E.purchasing.purchasing_comment,
        firstCommentId,
      )
      expect(firstCommentAttachments).toHaveLength(1)
      expect(firstCommentAttachments[0]?.fileName).toBe(`comment-${uniqueSuffix}.txt`)

      const deleteCommentResponse = await apiRequest(
        request,
        'DELETE',
        `/api/purchasing/comments?id=${encodeURIComponent(firstCommentId)}`,
        { token: adminToken, data: { id: firstCommentId } },
      )
      await expectOk(deleteCommentResponse, 'delete first comment')

      const deletedCommentAttachments = await listAttachments(
        request,
        adminToken,
        E.purchasing.purchasing_comment,
        firstCommentId,
      )
      expect(deletedCommentAttachments).toHaveLength(0)

      const createSecondCommentResponse = await apiRequest(request, 'POST', '/api/purchasing/comments', {
        token: adminToken,
        data: {
          requestId,
          body: `Cleanup attachment comment ${uniqueSuffix}`,
        },
      })
      await expectOk(createSecondCommentResponse, 'create second comment')
      secondCommentId = requireId((await readJson<IdResponse>(createSecondCommentResponse)).id, 'second comment id')

      const secondCommentAttachmentId = await uploadAttachment(
        request,
        adminToken,
        E.purchasing.purchasing_comment,
        secondCommentId,
        `cleanup-comment-${uniqueSuffix}.txt`,
        `cleanup comment attachment ${uniqueSuffix}`,
      )
      expect(secondCommentAttachmentId).toBeTruthy()

      const deleteRequestResponse = await apiRequest(
        request,
        'DELETE',
        `/api/purchasing/requests?id=${encodeURIComponent(requestId)}`,
        { token: adminToken, data: { id: requestId } },
      )
      await expectOk(deleteRequestResponse, 'delete request with attachments')

      const requestAttachmentsAfterDelete = await listAttachments(
        request,
        adminToken,
        E.purchasing.purchasing_request,
        requestId,
      )
      expect(requestAttachmentsAfterDelete).toHaveLength(0)

      const secondCommentAttachmentsAfterDelete = await listAttachments(
        request,
        adminToken,
        E.purchasing.purchasing_comment,
        secondCommentId,
      )
      expect(secondCommentAttachmentsAfterDelete).toHaveLength(0)

      requestId = null
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
