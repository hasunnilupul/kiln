import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { seed } from './env'

/**
 * A full trading day on a freshly seeded POS (M3 exit): first sign-in with a forced password
 * change, open a shift, sell for cash and card, refund with manager approval, close the shift with
 * no variance, and check the report. Keyboard-first, as on a till with a barcode scanner.
 *
 * Covers FR-02, FR-03, FR-30, FR-32, FR-40 to FR-43, FR-50, FR-51, FR-60, FR-61, FR-70.
 */

test.describe.configure({ mode: 'serial' })

const COLA = { barcode: '5000112637939', price: 150 }
const JUICE = { barcode: '5000112637946', price: 420 }

/** Creates the catalogue and the manager PIN through the API, as an admin would. */
async function setUpCatalogue(request: APIRequestContext) {
  const json = async (response: Awaited<ReturnType<APIRequestContext['get']>>) => {
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  await json(
    await request.post('/api/users/login', {
      data: { email: seed.adminEmail, password: seed.newPassword },
    }),
  )
  const taxRate = (await json(await request.get('/api/tax-rates?limit=1'))).docs[0]
  const outlet = (await json(await request.get('/api/outlets?limit=1'))).docs[0]
  const category = (
    await json(await request.post('/api/categories', { data: { name: 'Drinks', sortOrder: 1 } }))
  ).doc

  for (const [name, sku, item] of [
    ['Cola 330ml', 'COLA', COLA],
    ['Orange Juice 1L', 'OJ1L', JUICE],
  ] as const) {
    const product = (
      await json(
        await request.post('/api/products', {
          data: { name, sku, taxRate: taxRate.id, category: category.id },
        }),
      )
    ).doc
    const variant = (
      await json(
        await request.post('/api/product-variants', {
          data: {
            product: product.id,
            name,
            sku,
            price: item.price,
            barcodes: [{ code: item.barcode }],
          },
        }),
      )
    ).doc
    await json(
      await request.post('/api/pos/stock/adjust', {
        data: {
          variantId: variant.id,
          outletId: outlet.id,
          delta: 20,
          type: 'initial',
          reason: 'Opening stock',
        },
      }),
    )
  }
  await json(
    await request.post('/api/pos/me/pin', {
      data: { password: seed.newPassword, pin: seed.managerPin },
    }),
  )
}

async function scan(page: Page, code: string) {
  const box = page.getByLabel('Scan or search')
  await box.fill(code)
  await box.press('Enter')
}

test('a full trading day', async ({ page, request }) => {
  await test.step('first sign-in forces a password change (FR-03)', async () => {
    await page.goto('/')
    await page.getByLabel('Email').fill(seed.adminEmail)
    await page.getByLabel('Password').fill(seed.initialPassword)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    await page.getByLabel('New password').fill(seed.newPassword)
    await page.getByLabel('Repeat it').fill(seed.newPassword)
    await page.getByRole('button', { name: 'Save password' }).click()
    await expect(page.getByRole('heading', { name: 'Open a shift' })).toBeVisible()
  })

  await test.step('the admin sets up the catalogue and a PIN', async () => {
    await setUpCatalogue(request)
  })

  await test.step('open a shift with a float (FR-60)', async () => {
    await page.reload()
    await page.getByLabel('Opening float').fill('100.00')
    await page.getByLabel('Opening float').press('Enter')
    await expect(page.getByLabel('Scan or search')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Drinks' })).toBeVisible()
  })

  await test.step('cash sale with change (FR-30, FR-32, FR-41, FR-42)', async () => {
    await scan(page, COLA.barcode)
    await scan(page, COLA.barcode)
    await scan(page, JUICE.barcode)
    await expect(page.getByRole('button', { name: /^Pay \$7\.20$/ })).toBeVisible()

    await page.keyboard.press('F4')
    const pay = page.getByRole('dialog', { name: 'Pay $7.20' })
    await pay.getByLabel('Cash tendered').fill('20')
    await pay.getByLabel('Cash tendered').press('Enter')
    await expect(pay.getByText('$12.80')).toBeVisible()
    await page.keyboard.press('Enter')

    const done = page.getByRole('dialog', { name: 'Sale R1-000001 complete' })
    await expect(done.getByText('$12.80')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(done).toBeHidden()
  })

  await test.step('card sale with a reference (FR-40, FR-41)', async () => {
    await scan(page, COLA.barcode)
    await page.keyboard.press('F4')
    const pay = page.getByRole('dialog', { name: 'Pay $1.50' })
    await pay.getByRole('button', { name: 'Card' }).click()
    await pay.getByLabel(/Reference/).fill('AUTH-7731')
    await pay.getByLabel(/Reference/).press('Enter')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Sale R1-000002 complete' })).toBeVisible()
    await page.keyboard.press('Enter')
  })

  await test.step('refund one juice with manager approval and restock (FR-13, FR-50, FR-51)', async () => {
    await page.keyboard.press('F8')
    const refund = page.getByRole('dialog', { name: 'Refund' })
    await refund.getByLabel('Receipt number').fill('R1-000001')
    await refund.getByLabel('Receipt number').press('Enter')
    await refund.getByLabel('Quantity of Orange Juice 1L to refund').fill('1')
    await refund.getByRole('button', { name: 'Calculate refund' }).click()
    await expect(refund.getByRole('button', { name: 'Refund $4.20' })).toBeVisible()
    await refund.getByLabel('Reason').fill('Damaged carton')
    await refund.getByRole('button', { name: 'Refund $4.20' }).click()

    const approval = page.getByRole('dialog', { name: 'Approve refund of $4.20' })
    await approval.getByLabel('Manager PIN').fill(seed.managerPin)
    await approval.getByLabel('Manager PIN').press('Enter')
    await expect(page.getByRole('dialog', { name: 'Refund complete' })).toBeVisible()
    await page.keyboard.press('Enter')
  })

  await test.step('receipt prints at the configured width with a barcode (FR-43)', async () => {
    const receipt = await page.context().newPage()
    const sales = await request.get('/api/sales?where[receiptNumber][equals]=R1-000001&depth=0')
    const saleId = (await sales.json()).docs[0].id
    await receipt.goto(`/receipt/${saleId}`)
    await expect(receipt.getByLabel('Receipt R1-000001')).toContainText('TOTAL')
    await expect(receipt.getByLabel('Receipt R1-000001')).toContainText('$7.20')
    await expect(receipt.getByRole('img', { name: 'Barcode R1-000001' })).toBeVisible()
    await receipt.close()
  })

  await test.step('close the shift with no variance (FR-61)', async () => {
    await page.getByRole('button', { name: 'Close shift' }).click()
    const close = page.getByRole('dialog', { name: 'Close shift' })
    // Float 100.00 + cash 7.20 − cash refund 4.20.
    await close.getByLabel('Counted cash').fill('103.00')
    await close.getByLabel('Counted cash').press('Enter')

    const summary = page.getByRole('dialog', { name: 'Shift closed' })
    await expect(summary).toContainText('Sales (2)$8.70')
    await expect(summary).toContainText('Refunds (1)−$4.20')
    await expect(summary).toContainText('Expected cash$103.00')
    await expect(summary).toContainText('Variance$0.00')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Open a shift' })).toBeVisible()
  })

  await test.step('the day’s report adds up (FR-70, FR-71)', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const report = await (await request.get(`/api/pos/reports?from=${today}&to=${today}`)).json()
    expect(report.totals).toMatchObject({ salesCount: 2, total: 870, refunds: 420, net: 450 })
    expect(report.byPaymentMethod).toEqual([
      { code: 'cash', method: 'Cash', taken: 720, refunded: 420, net: 300 },
      { code: 'card', method: 'Card', taken: 150, refunded: 0, net: 150 },
    ])
    expect(report.shifts[0]).toMatchObject({ expectedCash: 10300, countedCash: 10300, variance: 0 })
  })
})
