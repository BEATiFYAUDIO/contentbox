import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(dashboardRoot, relativePath), 'utf8')
const absolute = (relativePath) => path.join(dashboardRoot, relativePath)

const pngDimensions = (relativePath) => {
  const image = readFileSync(absolute(relativePath))
  assert.equal(image.subarray(1, 4).toString('ascii'), 'PNG')
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  }
}

test('dashboard manifest is installable and uses the Certifyd brand assets', () => {
  const manifest = JSON.parse(read('public/manifest.json'))
  assert.equal(manifest.id, '/')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.theme_color, '#0b2330')
  assert.deepEqual(
    manifest.icons.map(({ sizes, purpose }) => ({ sizes, purpose })),
    [
      { sizes: '192x192', purpose: 'any' },
      { sizes: '512x512', purpose: 'any' },
      { sizes: '512x512', purpose: 'maskable' },
    ],
  )

  for (const icon of manifest.icons) {
    const relativePath = `public${icon.src}`
    assert.equal(existsSync(absolute(relativePath)), true, `${icon.src} must exist`)
    const [width, height] = icon.sizes.split('x').map(Number)
    assert.deepEqual(pngDimensions(relativePath), { width, height })
  }

  assert.deepEqual(pngDimensions('public/pwa/certifyd-180.png'), { width: 180, height: 180 })

  const html = read('index.html')
  assert.match(html, /rel="manifest" href="\/manifest\.json"/)
  assert.match(html, /rel="apple-touch-icon" sizes="180x180"/)
  assert.match(html, /meta name="theme-color" content="#0b2330"/)
})

test('service worker is production-only, update-safe and never caches application data', () => {
  const main = read('src/main.tsx')
  const worker = read('public/service-worker.js')

  assert.match(main, /import\.meta\.env\.PROD && 'serviceWorker' in navigator/)
  assert.match(main, /register\('\/service-worker\.js', \{ updateViaCache: 'none' \}\)/)
  assert.match(main, /registration\.update\(\)/)
  assert.match(worker, /request\.method !== 'GET'/)
  assert.match(worker, /url\.origin !== self\.location\.origin/)
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/)
  assert.match(worker, /request\.mode === 'navigate'/)
  assert.match(worker, /fetch\(request, \{ cache: 'no-store' \}\)/)
  assert.doesNotMatch(worker, /\bcaches\b/)
  assert.doesNotMatch(worker, /cache\.put|cache\.add|cache\.addAll/)
})
