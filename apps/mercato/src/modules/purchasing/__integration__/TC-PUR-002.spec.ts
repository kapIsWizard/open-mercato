import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

type IdResponse = {
  id?: string | null
}

type ImportedProductFixture = {
  id: string
  title: string
  sku: string | null
  referenceNumber: string | null
  supplier: string | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function getImportedProductFixtures(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  count = 2,
): Promise<ImportedProductFixture[]> {
  const response = await apiRequest(request, 'GET', `/api/purchasing/products?page=1&pageSize=${count + 5}`, {
    token,
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const body = await response.json() as { items?: Array<Record<string, unknown>> }
  const items = Array.isArray(body.items) ? body.items : []
  const fixtures = items
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      title: typeof item.title === 'string' ? item.title : '',
      sku: typeof item.sku === 'string' ? item.sku : null,
      referenceNumber: typeof item.referenceNumber === 'string' ? item.referenceNumber : null,
      supplier: typeof item.supplier === 'string' ? item.supplier : null,
    }))
    .filter((item) => item.id && item.title && item.supplier)
    .slice(0, count)
  expect(fixtures.length).toBeGreaterThanOrEqual(count)
  return fixtures
}

async function createRequestFixture(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  uniqueSuffix: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/purchasing/requests', {
    token,
    data: {
      customerNip: `PL${uniqueSuffix}`,
      customerName: `Purchasing UI ${uniqueSuffix}`,
      sourceChannel: 'email',
      formVariant: 'simple',
      requestText: `UI purchasing flow test ${uniqueSuffix}`,
      customerOrderNumber: `CO-${uniqueSuffix}`,
      items: [
        { sku: `UI-SKU-${uniqueSuffix}`, referenceNumber: `REF-${uniqueSuffix}`, productName: 'UI Safety Gloves', quantity: 12 },
      ],
    },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const body = await response.json() as IdResponse
  expect(body.id).toBeTruthy()
  return body.id as string
}

test.describe('TC-PUR-002: purchasing request UI happy path', () => {
  let adminToken = ''
  let employeeToken = ''

  test.beforeAll(async ({ request }) => {
    adminToken = await getAuthToken(request, 'admin')
    employeeToken = await getAuthToken(request, 'employee')
  })

  test('should create request, update item status, add comment and open items view', async ({ page, request }) => {
    test.setTimeout(90_000)
    const uniqueSuffix = Date.now().toString()
    let requestId: string | null = null

    await login(page, 'admin')

    try {
      const [product] = await getImportedProductFixtures(request, adminToken, 1)

      await page.goto('/backend/purchasing/requests/create', { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('purchasing-request-create-page')).toBeVisible()

      await page.getByTestId('purchasing-catalog-lookup-filter-supplier-create').selectOption(product.supplier as string)
      await page.getByTestId(`purchasing-catalog-lookup-pick-create-${product.id}`).click()
      await expect(page.getByTestId('purchasing-create-item-sku-0')).toHaveValue(product.sku ?? '')
      await expect(page.getByTestId('purchasing-create-item-reference-0')).toHaveValue(product.referenceNumber ?? '')
      await expect(page.getByTestId('purchasing-create-item-product-0')).toHaveValue(product.title)
      await page.getByTestId('purchasing-create-item-quantity-0').fill('12')
      const attachmentsSection = page.getByTestId('purchasing-create-attachments-section')
      await attachmentsSection.scrollIntoViewIfNeeded()
      await expect(attachmentsSection).toBeVisible()
      const uploadResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/attachments') && response.request().method() === 'POST',
      )
      await attachmentsSection.locator('input[type="file"]').setInputFiles({
        name: `request-${uniqueSuffix}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from(`request attachment ${uniqueSuffix}`, 'utf-8'),
      })
      expect((await uploadResponsePromise).ok()).toBeTruthy()
      await expect(attachmentsSection).toContainText(`request-${uniqueSuffix}.txt`)
      await page.getByTestId('purchasing-create-customer-nip').fill(`PL${uniqueSuffix}`)
      await page.getByTestId('purchasing-create-customer-name').fill(`Purchasing UI ${uniqueSuffix}`)
      await page.getByTestId('purchasing-create-request-text').fill('UI purchasing flow test')
      const ownerSelect = page.getByTestId('purchasing-create-owner')
      await ownerSelect.waitFor()
      if (await ownerSelect.locator('option').evaluateAll((options) => options.some((option) => option.textContent?.includes('Purchasing Anna')))) {
        const annaValue = await ownerSelect.locator('option').evaluateAll((options) => {
          const matched = options.find((option) => option.textContent?.includes('Purchasing Anna'))
          return matched?.getAttribute('value') ?? ''
        })
        if (annaValue) await ownerSelect.selectOption(annaValue)
      }

      const createResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/purchasing/requests') && response.request().method() === 'POST',
      )
      await page.getByTestId('purchasing-create-submit').click()
      const createResponse = await createResponsePromise
      expect(createResponse.ok(), await createResponse.text()).toBeTruthy()
      await expect(page).toHaveURL(/\/backend\/purchasing\/requests\/(?!create(?:\?|$))[^/?]+(?:\?.*)?$/)
      requestId = page.url().split('/').pop()?.split('?')[0] ?? null
      expect(requestId).toMatch(UUID_PATTERN)

      await expect(page.getByTestId('purchasing-request-detail-page')).toBeVisible()
      await expect(page.getByText(`Purchasing UI ${uniqueSuffix}`)).toBeVisible()
      await expect(page.getByTestId('purchasing-detail-selected-items-title')).toContainText('Request items')
      await expect(page.getByTestId('purchasing-detail-item-reference-0')).toHaveValue(product.referenceNumber ?? '')
      await expect(page.getByTestId('purchasing-detail-request-attachments-section')).toContainText(`request-${uniqueSuffix}.txt`)
      await expect(page.getByTestId('purchasing-detail-owner-select')).toContainText(/Purchasing Anna|Purchasing Marek|Purchasing Julia|Employee|Admin/)

      await page.getByTestId('purchasing-detail-request-status-select').selectOption('in_progress')
      await expect(page.getByTestId('purchasing-detail-request-status-select')).toHaveValue('in_progress')
      const updateRequestResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/purchasing/requests') && response.request().method() === 'PUT',
      )
      await page.getByTestId('purchasing-detail-save-request').click()
      expect((await updateRequestResponsePromise).ok()).toBeTruthy()
      await expect(page.getByTestId('purchasing-detail-request-status')).toContainText('In progress')

      await page.getByTestId('purchasing-detail-item-status-0').selectOption('cancelled')
      const updateItemResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/purchasing/request-items') && response.request().method() === 'PUT',
      )
      await page.getByTestId('purchasing-detail-item-save-0').click()
      expect((await updateItemResponsePromise).ok()).toBeTruthy()
      await expect(page.getByTestId('purchasing-detail-item-status-0')).toHaveValue('cancelled')

      await page.getByTestId('purchasing-detail-comment-body').fill(`Comment ${uniqueSuffix}`)
      await page.getByTestId('purchasing-detail-add-comment').click()
      await expect(page.getByText(`Comment ${uniqueSuffix}`)).toBeVisible()

      await page.getByTestId('purchasing-detail-open-items-view').click()
      await expect(page).toHaveURL(/\/backend\/purchasing\/request-items(?:\?.*)?$/)
      await expect(page.getByTestId('purchasing-items-page')).toBeVisible()
      await page.getByTestId('purchasing-items-status-filter').selectOption('cancelled')
      await expect(page.getByText('UI Safety Gloves').first()).toBeVisible()
    } finally {
      if (requestId) {
        await apiRequest(request, 'DELETE', '/api/purchasing/requests', {
          token: adminToken,
          data: { id: requestId },
        })
      }
    }
  })

  test('should let user add and remove products from create form before submit', async ({ page, request }) => {
    const uniqueSuffix = `${Date.now()}-multi`

    await login(page, 'admin')

    try {
      const [firstProduct, secondProduct] = await getImportedProductFixtures(request, adminToken, 2)

      await page.goto('/backend/purchasing/requests/create', { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('purchasing-request-create-page')).toBeVisible()

      await page.getByTestId('purchasing-catalog-lookup-filter-supplier-create').selectOption(firstProduct.supplier as string)
      await page.getByTestId(`purchasing-catalog-lookup-pick-create-${firstProduct.id}`).click()
      await page.getByTestId('purchasing-catalog-lookup-filter-supplier-create').selectOption(secondProduct.supplier as string)
      await page.getByTestId(`purchasing-catalog-lookup-pick-create-${secondProduct.id}`).click()

      await expect(page.getByTestId('purchasing-create-selected-items').locator('[data-testid^="purchasing-create-selected-item-"]')).toHaveCount(2)

      await page.getByTestId('purchasing-create-item-remove-0').click()
      await expect(page.getByTestId('purchasing-create-selected-items').locator('[data-testid^="purchasing-create-selected-item-"]')).toHaveCount(1)

      await page.getByTestId('purchasing-create-item-remove-0').click()
      await expect(page.getByTestId('purchasing-create-selected-items').locator('[data-testid^="purchasing-create-selected-item-"]')).toHaveCount(0)

      await page.getByTestId('purchasing-create-customer-name').fill(`Purchasing UI ${uniqueSuffix}`)
      await page.getByTestId('purchasing-create-submit').click()
      await expect(page.getByText('Add at least one request item.')).toBeVisible()
    } finally {
      void request
    }
  })

  test('should let admin add and remove products from request detail', async ({ page, request }) => {
    const uniqueSuffix = `${Date.now()}-detail`
    let requestId: string | null = null

    await login(page, 'admin')

    try {
      const [, secondProduct] = await getImportedProductFixtures(request, adminToken, 2)
      requestId = await createRequestFixture(request, adminToken, uniqueSuffix)

      await page.goto(`/backend/purchasing/requests/${encodeURIComponent(requestId)}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('purchasing-request-detail-page')).toBeVisible()
      await expect(page.getByTestId('purchasing-detail-selected-items-count')).toContainText('1 selected')
      await expect(page.getByTestId('purchasing-catalog-lookup-query-detail')).toHaveCount(0)
      await expect(page.getByTestId('purchasing-detail-item-status-0').locator('option')).toContainText([
        'Sent to purchasing',
        'Sent to supplier',
        'Waiting for supplier',
        'Alternative needed',
        'Quoted',
        'Ordered',
        'In transit',
        'Delivered',
        'Cancelled',
      ])

      await page.getByTestId('purchasing-catalog-lookup-filter-supplier-detail').selectOption(secondProduct.supplier as string)
      const createItemResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/purchasing/request-items') && response.request().method() === 'POST',
      )
      await page.getByTestId(`purchasing-catalog-lookup-pick-detail-${secondProduct.id}`).click()
      expect((await createItemResponsePromise).ok()).toBeTruthy()
      await expect(page.getByTestId('purchasing-detail-items-section').locator('[data-testid^="purchasing-detail-item-remove-"]')).toHaveCount(2)

      const removeItemResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/purchasing/request-items?id=') && response.request().method() === 'DELETE',
      )
      await page.getByTestId('purchasing-detail-item-remove-1').click()
      expect((await removeItemResponsePromise).ok()).toBeTruthy()
      await expect(page.getByTestId('purchasing-detail-items-section').locator('[data-testid^="purchasing-detail-item-remove-"]')).toHaveCount(1)

      const removeLastItemResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/purchasing/request-items?id=') && response.request().method() === 'DELETE',
      )
      await page.getByTestId('purchasing-detail-item-remove-0').click()
      expect((await removeLastItemResponsePromise).ok()).toBeTruthy()
      await expect(page.getByTestId('purchasing-detail-items-empty')).toContainText('No products selected yet')
    } finally {
      if (requestId) {
        await apiRequest(request, 'DELETE', '/api/purchasing/requests', {
          token: adminToken,
          data: { id: requestId },
        }).catch(() => undefined)
      }
    }
  })

  test('should show required-field guidance on create form', async ({ page }) => {
    await login(page, 'admin')

    await page.goto('/backend/purchasing/requests/create', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('purchasing-request-create-page')).toBeVisible()

    await expect(page.getByText('Customer name *')).toBeVisible()
    await expect(page.getByText('Provide customer name or NIP so purchasing can identify the request.')).toBeVisible()
    await expect(page.getByText('Each request needs at least one item with a product name and quantity.')).toBeVisible()
    await expect(page.getByText('No products selected yet. Use the product browser above to build the request.')).toBeVisible()
  })

  test('should let employee open request detail without operational items access', async ({ page, request }) => {
    const uniqueSuffix = `${Date.now()}-employee`
    let requestId: string | null = null

    try {
      requestId = await createRequestFixture(request, employeeToken, uniqueSuffix)

      await login(page, 'employee')
      await page.goto(`/backend/purchasing/requests/${encodeURIComponent(requestId)}`)
      await expect(page.getByTestId('purchasing-request-detail-page')).toBeVisible()
      await expect(page.getByTestId('purchasing-detail-customer-name-readonly')).toHaveText(`Purchasing UI ${uniqueSuffix}`)
      await expect(page.getByTestId('purchasing-detail-items-section')).toBeVisible()
      await expect(page.getByTestId('purchasing-detail-item-product-0')).toHaveValue('UI Safety Gloves')
      await expect(page.getByTestId('purchasing-detail-open-items-view')).toHaveCount(0)
      await expect(page.getByTestId('purchasing-detail-save-request')).toHaveCount(0)

      await page.getByTestId('purchasing-detail-comment-body').fill(`Employee comment ${uniqueSuffix}`)
      await page.getByTestId('purchasing-detail-add-comment').click()
      await expect(page.getByText(`Employee comment ${uniqueSuffix}`)).toBeVisible()
    } finally {
      if (requestId) {
        await apiRequest(request, 'DELETE', '/api/purchasing/requests', {
          token: adminToken,
          data: { id: requestId },
        })
      }
    }
  })

  test('should hide request attachments on create form when user cannot view attachments', async ({ page }) => {
    await login(page, 'employee')

    await page.goto('/backend/purchasing/requests/create', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('purchasing-request-create-page')).toBeVisible()
    await expect(page.getByTestId('purchasing-create-attachments-section')).toHaveCount(0)
  })
})
