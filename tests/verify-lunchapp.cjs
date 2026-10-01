// Run with Playwright installed and Chrome available:
// node tests/verify-lunchapp.cjs /path/to/LunchApp.aia https://viewer.example/
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function main() {
  const [aiaPath, url] = process.argv.slice(2);
  assert(aiaPath && url, 'Supply the rice/chicken LunchApp .aia path and viewer URL.');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('#aia-file').setInputFiles(aiaPath);
    await page.waitForFunction(() => ['ready', 'error'].includes(
      document.querySelector('#launch-status').dataset.kind));
    assert.equal(await page.locator('#launch-status').innerText(), 'Preview running.');
    assert.equal(await page.locator('#unsupported-features').innerText(), 'None detected');
    const phone = page.frameLocator('#web-preview-frame');
    for (const meal of ['rice', 'chicken', 'rice']) {
      await phone.locator('select').selectOption(meal);
      await phone.getByRole('button', { name: 'confirm', exact: true }).click();
      // Capture also verifies that the selected state can be rendered by the browser.
      await page.screenshot();
      const runtimeFrame = page.frames().find(frame => frame.url().includes('/runtime/preview.html'));
      await runtimeFrame.waitForFunction(expected =>
        document.querySelector('[data-component-name="confirmationabel"]').textContent === expected,
        `you selected${meal}`);
      assert.equal(await runtimeFrame.evaluate(() => activeRuntime.globals.get('selection_var')), meal);
      console.log(`PASS ${meal}: you selected${meal}`);
    }
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save screenshot', exact: true }).click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), 'Screen1-preview.png');
    assert.equal(await download.failure(), null);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const png = Buffer.concat(chunks);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert(png.length > 1000, 'Screenshot download is empty.');
    assert.equal(await page.locator('#capture-status').innerText(), 'Screenshot saved as PNG.');
    assert.deepEqual(errors, []);
    console.log(`PASS screenshot export: ${png.length} bytes`);
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
