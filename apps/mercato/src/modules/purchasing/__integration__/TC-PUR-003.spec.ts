import { Buffer } from 'node:buffer'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { E } from '@/.mercato/generated/entities.ids.generated'
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

async function createPurchasingCatalogProduct(
  request: APIRequestContext,
  token: string,
  uniqueSuffix: string,
): Promise<{
  id: string
  sku: string
  title: string
  referenceNumber: string
}> {
  const sku = `PUR-${uniqueSuffix}`
  const referenceNumber = `REF-${uniqueSuffix}`
  const title = `Purchasing Product ${uniqueSuffix}`
  const response = await apiRequest(request, 'POST', '/api/catalog/products', {
    token,
    data: {
      title,
      sku,
      handle: `purchasing-product-${uniqueSuffix.toLowerCase()}`,
      description: `Purchasing catalog fixture ${uniqueSuffix}`,
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
          availableQuantity: 24,
          unitPriceNet: '12.30',
        },
      },
    },
  })
  await expectOk(response, 'create purchasing catalog product')
  const body = await readJson<IdResponse>(response)
  return {
    id: requireId(body.id, 'catalog product id'),
    sku,
    title,
    referenceNumber,
  }
}

async function createPurchasingRequest(
  request: APIRequestContext,
  token: string,
  input: {
    customerName: string
    customerNip: string
    customerOrderNumber?: string | null
    requestText?: string | null
    product: { id: string; sku: string; title: string; referenceNumber: string }
    quantity?: number
  },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/purchasing/requests', {
    token,
    data: {
      customerName: input.customerName,
      customerNip: input.customerNip,
      customerOrderNumber: input.customerOrderNumber ?? null,
      requestText: input.requestText ?? null,
      items: [
        {
          catalogProductId: input.product.id,
          sku: input.product.sku,
          referenceNumber: input.product.referenceNumber,
          productName: input.product.title,
          quantity: input.quantity ?? 1,
        },
      ],
    },
  })
  await expectOk(response, 'create purchasing request')
  const body = await readJson<IdResponse>(response)
  return requireId(body.id, 'request id')
}

async function fetchRequestItems(
  request: APIRequestContext,
  token: string,
  requestId: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/purchasing/request-items?requestId=${encodeURIComponent(requestId)}&page=1&pageSize=50&sortField=lineNo&sortDir=asc`,
    { token },
  )
  await expectOk(response, 'fetch request items')
  const body = await readJson<PagedResponse>(response)
  return Array.isArray(body.items) ? body.items : []
}

async function fetchRequestRow(
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
  await expectOk(response, 'fetch purchasing request')
  const body = await readJson<PagedResponse>(response)
  const row = Array.isArray(body.items) ? body.items[0] : null
  expect(row).toBeTruthy()
  return row as Record<string, unknown>
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

test.describe('TC-PUR-003: purchasing API role workflows and user stories', () => {
  test.describe.configure({ timeout: 90_000 })
  let adminToken = ''
  let fixtures: PurchasingRoleFixture | null = null
  let salesToken = ''
  let bokToken = ''
  let purchasingToken = ''

  test.beforeAll(async ({ request }) => {
    test.setTimeout(90_000)
    adminToken = await getAuthToken(request, 'admin')
    fixtures = await provisionPurchasingRoleFixtures(request, adminToken, `qa-pur-003-${Date.now()}`)
    salesToken = await getTenantUserToken(request, fixtures.tenantId, fixtures.users.sales.email)
    bokToken = await getTenantUserToken(request, fixtures.tenantId, fixtures.users.bok.email)
    purchasingToken = await getTenantUserToken(request, fixtures.tenantId, fixtures.users.purchasing.email)
  })

  test.afterAll(async ({ request }) => {
    test.setTimeout(90_000)
    await cleanupPurchasingRoleFixtures(request, adminToken, fixtures)
  })

  test('sales quick intake should create request and auto-create Open Mercato company while blocking workflow edits', async ({ request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    const uniqueDigits = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const customerName = `Sales Intake ${uniqueSuffix} Sp z oo`
    const customerNip = createValidNip(uniqueDigits)
    let productId: string | null = null
    let requestId: string | null = null

    try {
      const product = await createPurchasingCatalogProduct(request, adminToken, uniqueSuffix)
      productId = product.id

      requestId = await createPurchasingRequest(request, salesToken, {
        customerName,
        customerNip,
        product,
        quantity: 3,
      })

      const requestRow = await fetchRequestRow(request, purchasingToken, requestId)
      expect(requestRow.customer_name ?? requestRow.customerName).toBe(customerName)
      expect(requestRow.customer_nip ?? requestRow.customerNip).toBe(customerNip)
      expect(requestRow.request_status ?? requestRow.requestStatus).toBe('unassigned')
      expect(requestRow.sales_owner_user_id ?? requestRow.salesOwnerUserId).toBeTruthy()
      expect(requestRow.customer_company_id ?? requestRow.customerCompanyId).toBeTruthy()
      const customerCompanyId = String(requestRow.customer_company_id ?? requestRow.customerCompanyId)

      const companiesResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/companies?id=${encodeURIComponent(customerCompanyId)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      await expectOk(companiesResponse, 'fetch created OM company')
      const companiesBody = await readJson<PagedResponse>(companiesResponse)
      const company = Array.isArray(companiesBody.items) ? companiesBody.items[0] : null
      expect(company).toBeTruthy()

      const items = await fetchRequestItems(request, purchasingToken, requestId)
      const itemId = requireId(typeof items[0]?.id === 'string' ? items[0].id : null, 'request item id')

      const salesRequestUpdateResponse = await apiRequest(request, 'PUT', '/api/purchasing/requests', {
        token: salesToken,
        data: {
          id: requestId,
          purchasingOwnerUserId: fixtures?.users.purchasing.userId,
        },
      })
      expect(salesRequestUpdateResponse.status()).toBe(403)

      const salesItemUpdateResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
        token: salesToken,
        data: {
          id: itemId,
          itemStatus: 'ordered',
        },
      })
      expect(salesItemUpdateResponse.status()).toBe(403)
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

  test('bok expanded intake should support detailed fields and searching by company, SKU, and order number', async ({ request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    const uniqueDigits = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const customerName = `BOK Intake ${uniqueSuffix}`
    const customerOrderNumber = `BOK-${uniqueSuffix}`
    let productId: string | null = null
    let requestId: string | null = null

    try {
      const product = await createPurchasingCatalogProduct(request, adminToken, uniqueSuffix)
      productId = product.id

      requestId = await createPurchasingRequest(request, bokToken, {
        customerName,
        customerNip: createValidNip(uniqueDigits),
        customerOrderNumber,
        requestText: `Table pasted from email ${uniqueSuffix}`,
        product,
        quantity: 7,
      })

      const searchTerms = [customerName, product.sku, customerOrderNumber]
      for (const term of searchTerms) {
        const response = await apiRequest(
          request,
          'GET',
          `/api/purchasing/requests?search=${encodeURIComponent(term)}&page=1&pageSize=20`,
          { token: bokToken },
        )
        await expectOk(response, `search request by ${term}`)
        const body = await readJson<PagedResponse>(response)
        expect(Array.isArray(body.items) && body.items.some((row) => row.id === requestId)).toBeTruthy()
      }

      const bokUpdateResponse = await apiRequest(request, 'PUT', '/api/purchasing/requests', {
        token: bokToken,
        data: {
          id: requestId,
          requestStatus: 'assigned',
        },
      })
      expect(bokUpdateResponse.status()).toBe(403)
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

  test('purchasing should assign request, update statuses, auto-complete, and add comment attachments', async ({ request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    const uniqueDigits = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    let firstProductId: string | null = null
    let secondProductId: string | null = null
    let requestId: string | null = null
    let commentId: string | null = null

    try {
      const firstProduct = await createPurchasingCatalogProduct(request, adminToken, `${uniqueSuffix}-a`)
      const secondProduct = await createPurchasingCatalogProduct(request, adminToken, `${uniqueSuffix}-b`)
      firstProductId = firstProduct.id
      secondProductId = secondProduct.id

      const createResponse = await apiRequest(request, 'POST', '/api/purchasing/requests', {
        token: salesToken,
        data: {
          customerName: `Workflow ${uniqueSuffix}`,
          customerNip: createValidNip(uniqueDigits),
          items: [
            {
              catalogProductId: firstProduct.id,
              sku: firstProduct.sku,
              referenceNumber: firstProduct.referenceNumber,
              productName: firstProduct.title,
              quantity: 2,
            },
            {
              catalogProductId: secondProduct.id,
              sku: secondProduct.sku,
              referenceNumber: secondProduct.referenceNumber,
              productName: secondProduct.title,
              quantity: 5,
            },
          ],
        },
      })
      await expectOk(createResponse, 'create workflow request')
      requestId = requireId((await readJson<IdResponse>(createResponse)).id, 'request id')

      const assignResponse = await apiRequest(request, 'PUT', '/api/purchasing/requests', {
        token: purchasingToken,
        data: {
          id: requestId,
          purchasingOwnerUserId: fixtures?.users.purchasing.userId,
        },
      })
      await expectOk(assignResponse, 'assign purchasing owner')

      const items = await fetchRequestItems(request, purchasingToken, requestId)
      expect(items).toHaveLength(2)
      for (const item of items) {
        const itemId = requireId(typeof item.id === 'string' ? item.id : null, 'request item id')
        const updateResponse = await apiRequest(request, 'PUT', '/api/purchasing/request-items', {
          token: purchasingToken,
          data: {
            id: itemId,
            itemStatus: 'in_stock',
            supplierOrderNumber: `SUP-${uniqueSuffix}`,
            purchasingNote: `Ready on warehouse ${uniqueSuffix}`,
          },
        })
        await expectOk(updateResponse, `mark item ${itemId} in_stock`)
      }

      const completedRequest = await fetchRequestRow(request, purchasingToken, requestId)
      expect(completedRequest.request_status ?? completedRequest.requestStatus).toBe('completed')

      const createCommentResponse = await apiRequest(request, 'POST', '/api/purchasing/comments', {
        token: purchasingToken,
        data: {
          requestId,
          body: `Supplier PDF attached ${uniqueSuffix}`,
        },
      })
      await expectOk(createCommentResponse, 'create purchasing comment')
      commentId = requireId((await readJson<IdResponse>(createCommentResponse)).id, 'comment id')

      const attachmentId = await uploadAttachment(
        request,
        purchasingToken,
        E.purchasing.purchasing_comment,
        commentId,
        `supplier-offer-${uniqueSuffix}.txt`,
        `supplier attachment ${uniqueSuffix}`,
      )
      expect(attachmentId).toBeTruthy()

      const commentAttachments = await listAttachments(
        request,
        purchasingToken,
        E.purchasing.purchasing_comment,
        commentId,
      )
      expect(commentAttachments).toHaveLength(1)
      expect(commentAttachments[0]?.fileName).toBe(`supplier-offer-${uniqueSuffix}.txt`)
    } finally {
      if (requestId) {
        await apiRequest(request, 'DELETE', '/api/purchasing/requests', {
          token: adminToken,
          data: { id: requestId },
        }).catch(() => undefined)
      }
      await deleteCatalogProductIfExists(request, adminToken, firstProductId)
      await deleteCatalogProductIfExists(request, adminToken, secondProductId)
    }
  })

  test('manual request item should auto-create native Open Mercato catalog product', async ({ request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    const manualSku = `MANUAL-${uniqueSuffix}`
    const manualReference = `MANUAL-REF-${uniqueSuffix}`
    const manualTitle = `Manual Purchasing ${uniqueSuffix}`
    let requestId: string | null = null
    let createdCatalogProductId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/purchasing/requests', {
        token: salesToken,
        data: {
          customerName: `Manual Intake ${uniqueSuffix}`,
          customerNip: createValidNip(`${Date.now()}${Math.floor(Math.random() * 1000)}`),
          items: [
            {
              sku: manualSku,
              referenceNumber: manualReference,
              productName: manualTitle,
              quantity: 2,
            },
          ],
        },
      })
      await expectOk(createResponse, 'create request with manual item')
      requestId = requireId((await readJson<IdResponse>(createResponse)).id, 'request id')

      const items = await fetchRequestItems(request, purchasingToken, requestId)
      expect(items).toHaveLength(1)
      createdCatalogProductId = requireId(
        typeof items[0]?.catalog_product_id === 'string'
          ? items[0].catalog_product_id
          : typeof items[0]?.catalogProductId === 'string'
            ? items[0].catalogProductId
            : null,
        'catalog product id for manual item',
      )

      const catalogResponse = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?search=${encodeURIComponent(manualSku)}&page=1&pageSize=20`,
        { token: adminToken },
      )
      await expectOk(catalogResponse, 'search native OM catalog product created from manual item')
      const catalogBody = await readJson<PagedResponse>(catalogResponse)
      const productRow = Array.isArray(catalogBody.items)
        ? catalogBody.items.find((item) => item.id === createdCatalogProductId)
        : null
      expect(productRow).toBeTruthy()
      expect(productRow?.sku).toBe(manualSku)
      expect(productRow?.title).toBe(manualTitle)
    } finally {
      if (requestId) {
        await apiRequest(request, 'DELETE', '/api/purchasing/requests', {
          token: adminToken,
          data: { id: requestId },
        }).catch(() => undefined)
      }
      await deleteCatalogProductIfExists(request, adminToken, createdCatalogProductId)
    }
  })
})
