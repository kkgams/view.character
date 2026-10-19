import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView } from './character-view-test.mjs'

function setup(t) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
    globalThis.document = {
        createElement(tag) {
            assert.equal(tag, 'canvas')
            const canvas = {}
            canvas.getContext = () => ({
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
    const { ViewCharacter } = evaluateView()
    const view = Object.create(ViewCharacter.prototype)
    const clear = [0, 0, 0, 0]
    const small = { id: 'small', colors: [clear, [10, 20, 30, 255]] }
    const large = { id: 'large', colors: [clear, [40, 50, 60, 255], [70, 80, 90, 255]] }
    const alternate = { id: 'alternate', colors: [clear, [100, 110, 120, 255]] }
    const item = (id, palette, index) => ({
        id: `outerwear/${id}`, slot: 'outerwear', palette: palette.id,
        icon: { width: 1, height: 1, indices: new Uint8Array([index]), palette: palette.colors },
    })
    const cardigan = item('cardigan', small, 1), suspenders = item('suspenders', large, 2)
    view.items = new Map([[cardigan.id, cardigan], [suspenders.id, suspenders]])
    view.slots = [{ id: 'outerwear' }]
    view.palettes = new Map([small, large, alternate].map(palette => [palette.id, palette]))
    view.animations = []
    view.coloredCache = new Map()
    view.resetState()
    return { view, cardigan, suspenders, small, large, alternate }
}

test('inventory renders unequal-palette alternatives before they are equipped', t => {
    const { view, cardigan, suspenders, small, large } = setup(t)
    assert.equal(view.parts.outerwear, cardigan.id)
    assert.deepEqual(view.colored(cardigan).pixels, small.colors[1])
    assert.deepEqual(view.colored(suspenders).pixels, large.colors[2])
    assert(view.coloredCache.has(`${suspenders.id}:large:icon`))
    assert.equal(view.colors.outerwear, small.id, 'rendering an alternative must not change the slot palette')
})

test('compatible inventory alternatives still use the selected recolor and cache by effective palette', t => {
    const { view, cardigan, suspenders, alternate, large } = setup(t)
    view.colors.outerwear = alternate.id
    assert.deepEqual(view.colored(cardigan).pixels, alternate.colors[1])
    const candidate = view.colored(suspenders)
    assert.deepEqual(candidate.pixels, large.colors[2])
    view.colors.outerwear = 'small'
    assert.equal(view.colored(suspenders), candidate, 'the same effective default palette reuses its icon')
    assert(view.coloredCache.has(`${cardigan.id}:alternate:icon`))
})

test('unequipped slots can render all alternatives with different palette sizes', t => {
    const { view, cardigan, suspenders, small, large } = setup(t)
    view.parts.outerwear = null
    assert.deepEqual(view.colored(cardigan).pixels, small.colors[1])
    assert.deepEqual(view.colored(suspenders).pixels, large.colors[2])
})

test('invalid equipped palette counts and missing palette references still fail loudly', t => {
    const { view, suspenders } = setup(t)
    view.parts.outerwear = suspenders.id
    assert.throws(() => view.colored(suspenders), /replacement palette count mismatch/)
    view.parts.outerwear = null
    view.colors.outerwear = 'missing'
    assert.throws(() => view.colored(suspenders), /missing palette missing/)
    view.colors.outerwear = 'small'
    view.palettes.delete('large')
    assert.throws(() => view.colored(suspenders), /missing palette large/)
})
