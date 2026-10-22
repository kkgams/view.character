import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView, viewSource } from './character-view-test.mjs'

function fixture(t) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
    globalThis.document = { createElement(tag) {
        assert.equal(tag, 'canvas')
        const canvas = { width: 0, height: 0, pixels: null }
        const allocate = () => { canvas.pixels ??= new Uint8ClampedArray(canvas.width * canvas.height * 4) }
        canvas.getContext = () => ({
            createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) } },
            putImageData(image) { canvas.pixels = new Uint8ClampedArray(image.data) },
            drawImage(source, x = 0, y = 0) {
                allocate()
                for (let row = 0; row < source.height; row++)
                    for (let col = 0; col < source.width; col++) {
                        const from = (row * source.width + col) * 4
                        canvas.pixels.set(source.pixels.slice(from, from + 4), ((row + y) * canvas.width + col + x) * 4)
                    }
            },
        })
        return canvas
    } }
    t.after(() => previous ? Object.defineProperty(globalThis, 'document', previous) : delete globalThis.document)
    const { ViewCharacter } = evaluateView()
    const view = Object.create(ViewCharacter.prototype)
    const motions = [
        { id: 'first', name: 'First', frame_width: 1, frame_height: 1, frame_count: 2, directions: 'NESW', sequence: [1, 1], durations_ms: [100, 100] },
        { id: 'second', name: 'Second', frame_width: 1, frame_height: 1, frame_count: 1, directions: 'S', sequence: [0], durations_ms: [100] },
    ]
    const components = motions.map((motion, i) => ({ id: `sprite-${i}`, item: 'item', slot: 'body', body: 'm',
        animation: motion.id, layer: 1, mask: 0,
        image: { width: motion.frame_count, height: motion.directions.length,
            pixels: new Uint8ClampedArray(i === 0 ? [10,0,0,255, 20,0,0,255, 30,0,0,255, 40,0,0,255, 50,0,0,255, 60,0,0,255, 70,0,0,255, 80,0,0,255] : [90,0,0,255]) },
    }))
    const item = { id: 'item', slot: 'body', name: 'Item', palette: 'original',
        sheets: new Map(motions.map((m, i) => [m.id, [components[i]]])) }
    const commits = []
    Object.assign(view, { animations: motions, selectedAnimation: 'first', selectedSheets: new Set(['second', 'first']),
        previewMode: 'spritesheet', body: 'm', playing: false, isConnected: true,
        parts: { body: 'item' }, colors: { body: 'original' }, items: new Map([['item', item]]),
        palettes: new Map([['original', { colors: [] }]]), previewRequest: {}, previewKey: 'old',
        packCache: new Map(motions.map((m, i) => [JSON.stringify(['item', m.id, 'm']), Promise.resolve([components[i]])])),
        yieldRender: async () => {}, installCanvasClip(clip) { commits.push(clip); this.previewClip = clip }, updatePlayback() {},
    })
    return { view, commits, item, motions }
}

test('mode radios and checkbox controls use native semantic inputs without new CSS', () => {
    assert.match(viewSource, /type="radio" name="preview-mode" data-field="preview-mode" value="animation"/)
    assert.match(viewSource, /type="radio" name="preview-mode" data-field="preview-mode" value="spritesheet"/)
    assert.match(viewSource, /checkbox.type = "checkbox"/)
})

test('spritesheet mode stacks all source columns and facing rows in catalog order, not playback order', async t => {
    const { view, commits } = fixture(t)
    assert.deepEqual(view.previewMotions().map(m => m.id), ['first', 'second'])
    assert.equal(view.canPlayAnimation(), false)
    await view.renderSpritesheet(view.previewRequest)
    assert.equal(commits.length, 1)
    const clip = commits[0]
    assert.equal(clip.width, 2)
    assert.equal(clip.height, 5)
    assert.equal(clip.frames.length, 1)
    assert.deepEqual(view.calculateContentBounds(clip), { minX: 0, minY: 0, maxX: 2, maxY: 5 })
    assert.equal(clip.frames[0].canvas.width, clip.width)
    assert.equal(clip.frames[0].canvas.height, clip.height)
    assert.deepEqual([...clip.frames[0].canvas.pixels], [
        10,0,0,255, 20,0,0,255,
        30,0,0,255, 40,0,0,255,
        50,0,0,255, 60,0,0,255,
        70,0,0,255, 80,0,0,255,
        90,0,0,255, 0,0,0,0,
    ])
    assert.equal(view.previewKey, null)
})

test('only checked motions prepare packs; animation mode retains its single animation', async t => {
    const { view } = fixture(t)
    const prepared = []
    view.prepareMotionPacks = async motion => prepared.push(motion.id)
    view.selectedSheets.delete('first')
    await view.prepareSelectedPacks()
    assert.deepEqual(prepared, ['second'])
    prepared.length = 0
    view.previewMode = 'animation'
    await view.prepareSelectedPacks()
    assert.deepEqual(prepared, ['first'])
    assert.equal(view.canPlayAnimation(), true)
})

test('empty selection or no equipped parts clears the canvas without fabrication', async t => {
    const { view, commits } = fixture(t)
    view.selectedSheets.clear()
    await view.renderSpritesheet(view.previewRequest)
    assert.deepEqual(commits, [null])
    view.selectedSheets.add('first')
    view.parts.body = null
    await view.renderSpritesheet(view.previewRequest)
    assert.deepEqual(commits, [null, null])
})

test('unsupported animation gets transparent space, not substituted frames', async t => {
    const { view, item } = fixture(t)
    item.sheets.delete('first')
    await view.renderSpritesheet(view.previewRequest)
    const pixels = view.previewClip.frames[0].canvas.pixels
    assert.ok(pixels.slice(0, 32).every(n => n === 0))
    assert.deepEqual([...pixels.slice(32)], [90,0,0,255, 0,0,0,0])
})

for (const reason of ['selection', 'reset', 'disconnect']) {
    test(`spritesheet ${reason} during composition never publishes partial or stale work`, async t => {
        const { view, commits } = fixture(t)
        const old = { old: true }
        view.previewClip = old
        let yields = 0
        view.yieldRender = async () => {
            if (++yields !== 2) return
            if (reason === 'disconnect') view.isConnected = false
            else view.previewRequest = reason === 'reset' ? null : {}
        }
        await view.renderSpritesheet(view.previewRequest)
        assert.deepEqual(commits, [])
        assert.equal(view.previewClip, old)
    })
}

test('superseded pack preparation does not start remaining selected motions', async t => {
    const { view } = fixture(t)
    const prepared = []
    view.prepareMotionPacks = async motion => {
        prepared.push(motion.id)
        view.previewRequest = {}
    }
    await view.prepareSelectedPacks()
    assert.deepEqual(prepared, ['first'])
})

test('mode switching mounts only active controls without relying on overridden hidden styles', t => {
    const { view } = fixture(t)
    let mounted = []
    view.previewControls = Object.fromEntries(['sheets', 'animation', 'facing'].map(name =>
        [name, { name, remove() { mounted = mounted.filter(node => node !== this) } }]))
    view.required = () => ({ before(...nodes) { mounted.push(...nodes) } })
    view.updatePreviewMode()
    assert.deepEqual(mounted.map(node => node.name), ['sheets'])
    view.previewMode = 'animation'
    view.updatePreviewMode()
    assert.deepEqual(mounted.map(node => node.name), ['animation', 'facing'])
})
