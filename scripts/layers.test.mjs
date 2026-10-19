import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { evaluateView } from './character-view-test.mjs'
const { LAYERS, orderedComponents } = evaluateView()

const draw = (slot, item, layer, mask = 0) => ({ slot, item, layer, mask })

test('renderer layer definitions match the documented numeric contract', async () => {
    const docs = await readFile(new URL('../docs/layers.md', import.meta.url), 'utf8')
    const definitions = [...docs.matchAll(/^\| (\d+) \| ([^|]+) \|$/gm)].map(([, id, name]) => [Number(id), name.trim()])
    assert.deepEqual([...LAYERS], definitions)
    assert.deepEqual([...LAYERS.keys()], [...LAYERS.keys()].sort((a, b) => a - b))
    const manifest = JSON.parse(await readFile(new URL('./lpc-fixtures.json', import.meta.url), 'utf8'))
    assert(manifest.items.every(item => Number.isSafeInteger(item.layer) && LAYERS.has(item.layer)))
})

test('components paint in numeric order, not slot order or lexical ID order', () => {
    const components = [draw('hair', 'front', 120), draw('body', 'body', 10), draw('legs', 'pants', 20)]
    assert.deepEqual(orderedComponents(components, 'walk').map(component => component.layer), [10, 20, 120])
    assert.equal(components[0].layer, 120, 'ordering must not mutate the input')
})

test('two equipped items on the same drawing layer fail with actionable context', () => {
    assert.throws(() => orderedComponents([draw('torso', 'shirt', 35), draw('outerwear', 'cardigan', 35)], 'walk'),
        /Layer 35 conflict \(walk\): torso\/shirt and outerwear\/cardigan/)
})

test('multi-layer items and multiple masks are allowed without claiming occupancy', () => {
    const components = [draw('hair', 'long-hair', 9), draw('hair', 'long-hair', 120),
        draw('headwear', 'helmet', 120, 1), draw('neckwear', 'scarf', 120, 1)]
    assert.equal(orderedComponents(components, 'idle').length, 4)
    assert.equal(orderedComponents([draw('headwear', 'helmet', 9, 1)], 'idle').length, 1,
        'a mask may target a valid currently-empty layer')
})

test('missing/unknown/noninteger layers and invalid mask flags fail', () => {
    for (const layer of [undefined, null, 0, -1, 1.5, '20', 999]) {
        assert.throws(() => orderedComponents([draw('torso', 'shirt', layer)], 'idle'), /unknown layer/)
    }
    assert.throws(() => orderedComponents([draw('hair', 'hair', 120, 2)], 'idle'), /mask must be 0 or 1/)
})
