import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView } from './character-view-test.mjs'

function setup(t) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
    let decodes = 0
    const pixels = new Uint8ClampedArray(128 * 64 * 4).fill(123)
    globalThis.document = {
        createElement(tag) {
            if (tag === 'img') return { naturalWidth: 128, naturalHeight: 64,
                async decode() { decodes++ } }
            assert.equal(tag, 'canvas')
            const canvas = {}
            canvas.getContext = () => ({
                drawImage() {},
                getImageData() { return { data: pixels } },
                createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) } },
                putImageData(image) { canvas.pixels = [...image.data] },
            })
            return canvas
        },
    }
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, 'document', previous)
        else delete globalThis.document
    })
    const { ViewCharacter, decodeSourceImage } = evaluateView({
        async queryObjects(query, columns, ids) {
            assert.match(query, /^SELECT id, icon FROM items WHERE id IN /)
            assert.deepEqual(columns, ['id', 'icon'])
            assert(ids.length <= 10)
            return ids.map(id => ({id,icon:[1,2,3]}))
        },
    })
    const view = Object.create(ViewCharacter.prototype)
    view.initializeIcons()
    t.after(() => view.iconScheduler.invalidate(true))
    const item = { id: 'outerwear/a', slot: 'outerwear', palette: 'missing' }
    return { view, item, pixels, decodeSourceImage, decodes: () => decodes }
}

test('icons use browser-decoded source size and pixels without palette or 32px assumptions', async t => {
    const { view, item, pixels, decodes } = setup(t)
    const canvas = await view.colored(item)
    assert.equal(canvas.width, 128)
    assert.equal(canvas.height, 64)
    assert.deepEqual(canvas.pixels, [...pixels])
    assert.equal(decodes(), 1)
})

test('icon rendering caches by item, independently of selected recolor', async t => {
    const { view, item, decodes } = setup(t)
    const first = view.colored(item)
    view.colors = { outerwear: 'another-palette' }
    assert.equal(view.colored(item), first)
    assert.equal(await first, await view.colored(item))
    assert.equal(decodes(), 1)
})

test('large inventories bound native image decoding and release permits on failure', async t => {
    const { decodeSourceImage } = setup(t)
    const create = document.createElement
    let active = 0, peak = 0, calls = 0
    document.createElement = tag => {
        const element = create(tag)
        if (tag === 'img') element.decode = async () => {
            const index = calls++
            active++; peak = Math.max(peak,active)
            await new Promise(resolve => setImmediate(resolve))
            active--
            if (index === 0) throw Error('Invalid image bytes')
        }
        return element
    }
    const results = await Promise.allSettled(Array.from({length:40},() => decodeSourceImage(new Uint8Array([1,2,3]))))
    assert.equal(peak,8)
    assert.equal(active,0)
    assert.equal(results.filter(result => result.status === 'fulfilled').length,39)
    assert.equal(results[0].reason.message,'Invalid image bytes')
})

test('invalid source images reject visibly instead of synthesizing an icon', async t => {
    const { view, item } = setup(t)
    const create = document.createElement
    document.createElement = tag => tag === 'img'
        ? { async decode() { throw Error('Invalid image bytes') } } : create(tag)
    await assert.rejects(view.colored(item), /Invalid image bytes/)
})
