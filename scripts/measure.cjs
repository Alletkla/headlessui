// Opens the sheet with real clicks under CPU throttling and counts opens without a transform transition.
// Needs: npm run dev -- --port 5179
// Usage: node scripts/measure.cjs '[{"rate":1,"queued":20,"taskMs":15,"mount":100,"cycles":8}]'
const { chromium } = require('playwright')
const configs = JSON.parse(process.argv[2] || '[{"rate":1,"queued":20,"taskMs":15,"mount":100,"cycles":8}]')
const base = process.env.URL || 'http://localhost:5179/'

;(async () => {
  const browser = await chromium.launch()
  for (const c of configs) {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } })
    const query = new URLSearchParams()
    for (const k of ['queued', 'taskMs', 'mount', 'api']) if (c[k] !== undefined) query.set(k, c[k])
    await page.goto(`${base}?${query}`)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: c.rate ?? 1 })
    await page.evaluate(() => {
      document.addEventListener('transitionrun', (e) => {
        if (e.target.id === 'panel' && e.propertyName === 'transform') window.__runs++
      })
      document.addEventListener('transitioncancel', (e) => {
        if (e.target.id === 'panel' && e.propertyName === 'transform') window.__cancels++
      })
    })
    const runs = []
    const stales = []
    const leaves = []
    for (let i = 0; i < c.cycles; i++) {
      await page.evaluate(() => (window.__runs = window.__cancels = 0))
      await page.locator('#open').click()
      await page.waitForTimeout(1300)
      stales.push(await page.evaluate(() => window.__staleChecks))
      runs.push(await page.evaluate(() => window.__runs - window.__cancels))
      await page.evaluate(() => (window.__runs = window.__cancels = 0))
      await page.locator('#close').click()
      await page.waitForTimeout(1300)
      leaves.push(await page.evaluate(() => window.__runs - window.__cancels))
    }
    const stale = await page.evaluate(() => window.__staleChecks)
    console.log(JSON.stringify(c), '| completed (run minus cancelled) transitions per open:', runs.join(','),
      `| opens without transition: ${runs.filter((r) => r === 0).length}/${c.cycles}`, '| leave transitions:', leaves.join(','), '| stale checks (cumulative after each open):', stales.join(','))
    await page.close()
  }
  await browser.close()
})()
