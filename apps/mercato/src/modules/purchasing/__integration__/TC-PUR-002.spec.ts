import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import {
  cleanupPurchasingRoleFixtures,
  createValidNip,
  getTenantUserToken,
  loginTenantUser,
  provisionPurchasingRoleFixtures,
  type PurchasingRoleFixture,
} from './helpers'

type IdResponse = {
  id?: string | null
}

async function createPurchasingCatalogProduct(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  uniqueSuffix: string,
): Promise<{ id: string; sku: string; title: string; referenceNumber: string }> {
  const sku = `UI-PUR-${uniqueSuffix}`
  const referenceNumber = `UI-REF-${uniqueSuffix}`
  const title = `UI Purchasing Product ${uniqueSuffix}`
  const response = await apiRequest(request, 'POST', '/api/catalog/products', {
    token,
    data: {
      title,
      sku,
      handle: `ui-purchasing-product-${uniqueSuffix.toLowerCase()}`,
      description: `UI purchasing product ${uniqueSuffix}`,
      defaultUnit: 'pc',
      defaultSalesUnit: 'pc',
      primaryCurrencyCode: 'PLN',
      taxRate: 8,
      metadata: {
        purchasingImport: {
          source: 'akeneo',
          symbol: sku,
          referenceNumber,
          supplier: `UI Supplier ${uniqueSuffix}`,
          group: `UI Group ${uniqueSuffix}`,
          purchasingAvailability: 'AVAILABLE',
          availableQuantity: 20,
          unitPriceNet: '15.50',
        },
      },
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const body = (await response.json()) as IdResponse
  expect(typeof body.id).toBe('string')
  return { id: body.id as string, sku, title, referenceNumber }
}

async function createRequestFixture(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  input: {
    customerName: string
    customerNip: string
    product: { id: string; sku: string; title: string; referenceNumber: string }
    quantity?: number
  },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/purchasing/requests', {
    token,
    data: {
      customerName: input.customerName,
      customerNip: input.customerNip,
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
  expect(response.ok(), await response.text()).toBeTruthy()
  const body = (await response.json()) as IdResponse
  expect(typeof body.id).toBe('string')
  return body.id as string
}

test.describe('TC-PUR-002: purchasing UI role-based workflows', () => {
  test.describe.configure({ timeout: 90_000 })
  let adminToken = ''
  let fixtures: PurchasingRoleFixture | null = null
  let salesToken = ''
  let purchasingToken = ''

  test.beforeAll(async ({ request }) => {
    test.setTimeout(90_000)
    adminToken = await getAuthToken(request, 'admin')
    fixtures = await provisionPurchasingRoleFixtures(request, adminToken, `qa-pur-002-${Date.now()}`)
    salesToken = await getTenantUserToken(request, fixtures.tenantId, fixtures.users.sales.email)
    purchasingToken = await getTenantUserToken(request, fixtures.tenantId, fixtures.users.purchasing.email)
  })

  test.afterAll(async ({ request }) => {
    test.setTimeout(90_000)
    await cleanupPurchasingRoleFixtures(request, adminToken, fixtures)
  })

  test('sales should land on purchasing list, use quick intake form, and get read-only detail with comments', async ({ page, request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    let productId: string | null = null
    let requestId: string | null = null

    try {
      const product = await createPurchasingCatalogProduct(request, adminToken, uniqueSuffix)
      productId = product.id

      await loginTenantUser(page, {
        tenantId: fixtures!.tenantId,
        email: fixtures!.users.sales.email,
      })
      await expect(page).toHaveURL(/\/backend\/purchasing\/requests(?:\?.*)?$/)

      await page.goto('/backend/purchasing/requests/create', { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('purchasing-request-create-page')).toBeVisible()
      await expect(page.getByText('Request details')).toHaveCount(0)
      await expect(page.getByTestId('purchasing-create-attachments-section')).toBeVisible()

      await page.getByPlaceholder('1234567890').fill(createValidNip(`55547${String(uniqueSuffix).slice(-5)}`))
      await page.getByPlaceholder('Customer company name').fill(`Sales UI ${uniqueSuffix}`)
      await page.getByTestId('purchasing-catalog-lookup-query-create').fill(product.sku)
      await expect(page.getByTestId('purchasing-catalog-lookup-results-create')).toContainText(product.title)
      await page.getByTestId(`purchasing-catalog-lookup-quantity-create-${product.id}`).fill('4')
      await page.getByTestId('purchasing-catalog-lookup-results-create')
        .locator('tr', { hasText: product.sku })
        .getByRole('button', { name: /add product/i })
        .click()

      await expect(page.getByTestId(`purchasing-selected-quantity-create-${product.id}`)).toHaveValue('4')
      const createResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/purchasing/requests') && response.request().method() === 'POST',
      )
      await page.getByTestId('purchasing-create-submit').click()
      const createResponse = await createResponsePromise
      expect(createResponse.ok(), await createResponse.text()).toBeTruthy()
      await expect(page).toHaveURL(/\/backend\/purchasing\/requests\/[^/?]+(?:\?.*)?$/)
      requestId = page.url().split('/').pop()?.split('?')[0] ?? null

      await expect(page.getByTestId('purchasing-request-detail-page')).toBeVisible()
      await expect(page.getByTestId('purchasing-detail-save-workflow')).toHaveCount(0)
      await expect(page.getByTestId('purchasing-detail-owner-readonly')).toBeVisible()
      await expect(page.getByTestId('purchasing-detail-item-status-0')).toBeDisabled()

      await page.getByRole('tab', { name: 'Comments' }).click()
      await expect(page.getByTestId('purchasing-detail-comments-section')).toBeVisible()
      await page.getByTestId('purchasing-detail-comment-body').fill(`Sales comment ${uniqueSuffix}`)
      await page.getByTestId('purchasing-detail-add-comment').click()
      await expect(page.getByText(`Sales comment ${uniqueSuffix}`)).toBeVisible()
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

  test('bok should see expanded create form and persist detailed request fields', async ({ page, request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    let productId: string | null = null
    let requestId: string | null = null

    try {
      const product = await createPurchasingCatalogProduct(request, adminToken, uniqueSuffix)
      productId = product.id

      await loginTenantUser(page, {
        tenantId: fixtures!.tenantId,
        email: fixtures!.users.bok.email,
      })
      await page.goto('/backend/purchasing/requests/create', { waitUntil: 'domcontentloaded' })
      await expect(page.getByText('Request details')).toBeVisible()
      await expect(page.getByTestId('purchasing-create-customer-order-number')).toBeVisible()
      await expect(page.getByTestId('purchasing-create-request-text')).toBeVisible()

      await page.getByPlaceholder('1234567890').fill(createValidNip(`66647${String(uniqueSuffix).slice(-5)}`))
      await page.getByPlaceholder('Customer company name').fill(`BOK UI ${uniqueSuffix}`)
      await page.getByTestId('purchasing-create-customer-order-number').fill(`BOK-ORDER-${uniqueSuffix}`)
      await page.getByTestId('purchasing-create-request-text').fill(`Pasted from customer email ${uniqueSuffix}`)
      await page.getByTestId('purchasing-catalog-lookup-query-create').fill(product.sku)
      await expect(page.getByTestId('purchasing-catalog-lookup-results-create')).toContainText(product.title)
      await page.getByTestId('purchasing-catalog-lookup-results-create')
        .locator('tr', { hasText: product.sku })
        .click()

      const createResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/purchasing/requests') && response.request().method() === 'POST',
      )
      await page.getByTestId('purchasing-create-submit').click()
      expect((await createResponsePromise).ok()).toBeTruthy()
      await expect(page).toHaveURL(/\/backend\/purchasing\/requests\/[^/?]+(?:\?.*)?$/)
      requestId = page.url().split('/').pop()?.split('?')[0] ?? null

      await expect(page.locator(`input[value="BOK-ORDER-${uniqueSuffix}"]`).first()).toBeVisible()
      await expect(page.getByTestId('purchasing-detail-save-workflow')).toHaveCount(0)
      await expect(page.getByTestId('purchasing-detail-owner-readonly')).toBeVisible()
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

  test('purchasing should manage detail workflow and bulk-edit submitted request items', async ({ page, request }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`
    let firstProductId: string | null = null
    let secondProductId: string | null = null
    let requestId: string | null = null

    try {
      const firstProduct = await createPurchasingCatalogProduct(request, adminToken, `${uniqueSuffix}-a`)
      const secondProduct = await createPurchasingCatalogProduct(request, adminToken, `${uniqueSuffix}-b`)
      firstProductId = firstProduct.id
      secondProductId = secondProduct.id

      const createResponse = await apiRequest(request, 'POST', '/api/purchasing/requests', {
        token: salesToken,
        data: {
          customerName: `Purchasing UI ${uniqueSuffix}`,
          customerNip: createValidNip(`77747${String(uniqueSuffix).slice(-5)}`),
          items: [
            {
              catalogProductId: firstProduct.id,
              sku: firstProduct.sku,
              referenceNumber: firstProduct.referenceNumber,
              productName: firstProduct.title,
              quantity: 1,
            },
            {
              catalogProductId: secondProduct.id,
              sku: secondProduct.sku,
              referenceNumber: secondProduct.referenceNumber,
              productName: secondProduct.title,
              quantity: 2,
            },
          ],
        },
      })
      expect(createResponse.ok(), await createResponse.text()).toBeTruthy()
      requestId = ((await createResponse.json()) as IdResponse).id ?? null
      expect(requestId).toBeTruthy()

      await loginTenantUser(page, {
        tenantId: fixtures!.tenantId,
        email: fixtures!.users.purchasing.email,
        expectedRedirect: /\/backend\/purchasing\/requests(?:\?.*)?$/,
      })
      await page.goto(`/backend/purchasing/requests/${requestId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('purchasing-request-detail-page')).toBeVisible()
      await expect(page.getByTestId('purchasing-detail-save-workflow')).toBeVisible()
      await expect(page.getByTestId('purchasing-detail-owner-select')).toBeVisible()

      await page.getByRole('button', { name: /select all visible items/i }).click()
      await expect(page.getByTestId('purchasing-detail-selected-items-count')).toContainText('2 selected')

      await page.getByTestId('purchasing-detail-bulk-quantity').fill('6')
      await page.getByTestId('purchasing-detail-bulk-apply-quantity').click()
      await expect(page.getByTestId('purchasing-detail-item-quantity-0')).toHaveValue('6')
      await expect(page.getByTestId('purchasing-detail-item-quantity-1')).toHaveValue('6')

      await page.getByTestId('purchasing-detail-bulk-note').fill(`Bulk note ${uniqueSuffix}`)
      await page.getByTestId('purchasing-detail-bulk-apply-note').click()
      await expect(page.getByTestId('purchasing-detail-item-note-0')).toHaveValue(`Bulk note ${uniqueSuffix}`)
      await expect(page.getByTestId('purchasing-detail-item-note-1')).toHaveValue(`Bulk note ${uniqueSuffix}`)

      await page.getByTestId('purchasing-detail-bulk-status').selectOption('in_stock')
      await page.getByTestId('purchasing-detail-bulk-apply-status').click()
      await expect(page.getByTestId('purchasing-detail-item-status-0')).toHaveValue('in_stock')
      await expect(page.getByTestId('purchasing-detail-item-status-1')).toHaveValue('in_stock')
      await expect(page.getByTestId('purchasing-detail-item-autosave-0')).toContainText(/Saving soon|Saving|Saved/)
      await expect(page.getByTestId('purchasing-detail-item-autosave-1')).toContainText(/Saving soon|Saving|Saved/)
      await expect.poll(async () => await page.getByTestId('purchasing-detail-request-status').textContent()).toContain('Completed')

      await page.getByRole('tab', { name: /activity history/i }).click()
      await expect(page.getByTestId('purchasing-detail-history-section')).toBeVisible()
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
})
