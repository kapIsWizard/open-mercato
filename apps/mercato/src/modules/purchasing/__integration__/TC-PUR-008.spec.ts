import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

type IdResponse = {
  id?: string | null
}

type PagedResponse = {
  items?: Array<Record<string, unknown>>
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

async function createImportedProductFixture(
  request: APIRequestContext,
  token: string,
  uniqueSuffix: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/catalog/products', {
    token,
    data: {
      title: `Imported Gloves ${uniqueSuffix}`,
      sku: `IMP-${uniqueSuffix}`,
      handle: `imp-${uniqueSuffix.toLowerCase()}`,
      description: `Imported purchasing product ${uniqueSuffix}`,
      defaultUnit: 'pc',
      defaultSalesUnit: 'pc',
      primaryCurrencyCode: 'PLN',
      taxRate: 8,
      metadata: {
        purchasingImport: {
          source: 'client_csv',
          sourceFileName: 'Przykladowe produkty.csv',
          symbol: `IMP-${uniqueSuffix}`,
          referenceNumber: `REF-IMP-${uniqueSuffix}`,
          supplier: `Supplier ${uniqueSuffix}`,
          group: `Group ${uniqueSuffix}`,
          purchasingAvailability: 'DOSTĘPNE',
          owner: 'Oskar',
          barcode: `BAR-${uniqueSuffix}`,
          warehouseLocation: `A-${uniqueSuffix}`,
          packageSize: '50',
          stockQuantity: 120,
          availableQuantity: 95,
          reservedQuantity: 25,
          unitPriceNet: '12.30',
          unitPriceGross: '13.28',
          vatRate: '8.00',
        },
      },
    },
  })
  await expectOk(response, 'create imported catalog product')
  const body = await readJson<IdResponse>(response)
  return requireId(body.id, 'catalog product id')
}

async function deleteRequestIfExists(
  request: APIRequestContext,
  token: string,
  requestId: string | null,
): Promise<void> {
  if (!requestId) return
  await apiRequest(request, 'DELETE', '/api/purchasing/requests', {
    token,
    data: { id: requestId },
  })
}

async function deleteProductIfExists(
  request: APIRequestContext,
  token: string,
  productId: string | null,
): Promise<void> {
  if (!productId) return
  await apiRequest(request, 'DELETE', `/api/catalog/products?id=${encodeURIComponent(productId)}`, { token })
}

test.describe('TC-PUR-008: purchasing imported product lookup and catalog linkage', () => {
  let adminToken = ''
  let employeeToken = ''

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    employeeToken = await getAuthToken(request, 'employee')
  })

  test('should filter imported catalog products and persist catalogProductId on request items', async ({ request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    let productId: string | null = null
    let requestId: string | null = null

    try {
      productId = await createImportedProductFixture(request, adminToken, uniqueSuffix)

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/products?search=${encodeURIComponent(`IMP-${uniqueSuffix}`)}&supplier=${encodeURIComponent(`Supplier ${uniqueSuffix}`)}&group=${encodeURIComponent(`Group ${uniqueSuffix}`)}&availability=${encodeURIComponent('DOSTĘPNE')}&page=1&pageSize=20`,
        { token: employeeToken },
      )
      await expectOk(listResponse, 'list purchasing products')
      const listBody = await readJson<{
        items?: Array<Record<string, unknown>>
        filters?: { suppliers?: string[]; groups?: string[]; availabilities?: string[] }
      }>(listResponse)
      const productRow = Array.isArray(listBody.items) ? listBody.items.find((item) => item.id === productId) : null
      expect(productRow).toBeTruthy()
      expect(productRow?.supplier).toBe(`Supplier ${uniqueSuffix}`)
      expect(productRow?.group).toBe(`Group ${uniqueSuffix}`)
      expect(productRow?.referenceNumber).toBe(`REF-IMP-${uniqueSuffix}`)
      expect(listBody.filters?.suppliers).toContain(`Supplier ${uniqueSuffix}`)
      expect(listBody.filters?.groups).toContain(`Group ${uniqueSuffix}`)
      expect(listBody.filters?.availabilities).toContain('DOSTĘPNE')

      const createRequestResponse = await apiRequest(request, 'POST', '/api/purchasing/requests', {
        token: employeeToken,
        data: {
          customerNip: `PL${uniqueSuffix}`,
          customerName: `Imported Customer ${uniqueSuffix}`,
          sourceChannel: 'phone',
          formVariant: 'simple',
          requestText: `Imported product linkage ${uniqueSuffix}`,
          items: [
            {
              catalogProductId: productId,
              sku: `IMP-${uniqueSuffix}`,
              referenceNumber: `REF-IMP-${uniqueSuffix}`,
              productName: `Imported Gloves ${uniqueSuffix}`,
              quantity: 4,
            },
          ],
        },
      })
      await expectOk(createRequestResponse, 'create request with imported product')
      requestId = requireId((await readJson<IdResponse>(createRequestResponse)).id, 'request id')

      const itemsResponse = await apiRequest(
        request,
        'GET',
        `/api/purchasing/request-items?requestId=${encodeURIComponent(requestId)}&page=1&pageSize=20`,
        { token: adminToken },
      )
      await expectOk(itemsResponse, 'list request items')
      const itemsBody = await readJson<PagedResponse>(itemsResponse)
      const item = Array.isArray(itemsBody.items) ? itemsBody.items[0] : null
      expect(item).toBeTruthy()
      expect(item?.catalog_product_id ?? item?.catalogProductId).toBe(productId)
      expect(item?.sku).toBe(`IMP-${uniqueSuffix}`)
      expect(item?.reference_number ?? item?.referenceNumber).toBe(`REF-IMP-${uniqueSuffix}`)
    } finally {
      await deleteRequestIfExists(request, adminToken, requestId)
      await deleteProductIfExists(request, adminToken, productId)
    }
  })
})
