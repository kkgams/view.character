import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView } from './character-view-test.mjs'

test('recolor panel shows only Palette and Colors while retaining the select accessible label', t => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    t.after(() => {
        if (descriptor) Object.defineProperty(globalThis, 'document', descriptor)
        else delete globalThis.document
    })
    const select = { addEventListener() {} }
    const panel = { dataset: {}, querySelector: () => select }
    globalThis.document = { createElement(tag) { assert.equal(tag, 'fieldset'); return panel } }
    const { ViewCharacter } = evaluateView()
    const view = Object.create(ViewCharacter.prototype)
    let mounted
    Object.assign(view, {
        selectedSlot: 'hair', parts: { hair: 'item' }, colors: { hair: 'original' },
        palettes: new Map([['original', {}]]),
        shadowRoot: { querySelector: () => null },
        paletteItem: () => ({ palette: 'original' }), slotRecord: () => ({ name: 'Hair' }),
        compatiblePalettes: () => [{ id: 'original', name: 'Original' }],
        required: () => ({ before(value) { mounted = value } }), updatePalettes() {},
    })
    view.updatePalettePanel()
    assert.equal(mounted, panel)
    assert.deepEqual([...panel.innerHTML.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map(match => match[1]), ['Palette', 'Colors'])
    assert.doesNotMatch(panel.innerHTML, /<th scope="row">/)
    assert.match(panel.innerHTML, /aria-label="Hair palette"/)
    assert.match(panel.innerHTML, /<widget-animation-preview data-palette="hair"/)
    assert.equal(select.value, 'original')
})
