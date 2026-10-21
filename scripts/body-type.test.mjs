import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView } from './character-view-test.mjs'

function fixture(types = ['f', 'f'], slot = 'body') {
    const { ViewCharacter } = evaluateView()
    const view = Object.create(ViewCharacter.prototype)
    const item = { id: 'selected', slot, palette: 'original',
        sheets: new Map(types.map((body, i) => [`animation-${i}`, [{ body }]])) }
    const calls = []
    Object.assign(view, {
        isConnected: true, previewRequest: {}, body: 'm', parts: { [slot]: item.id },
        items: new Map([[item.id, item]]), palettes: new Map([['original', {}]]),
        currentMotion() { calls.push(['motion', this.body]); return null },
        updateMotionCells() { calls.push(['cells', this.body]) },
        refreshInventorySupport() { calls.push(['support', this.body]); return Promise.resolve() },
    })
    return { view, item, calls }
}

test('startup and Reset use the default body type', () => {
    const { view } = fixture()
    view.slots = [{ id: 'body' }]
    view.animations = []
    view.body = 'f'
    view.resetState()
    assert.equal(view.body, 'm')
    assert.equal(view.parts.body, null)
})

test('equipped body item sets the whole editor mode before selecting animation packs', async () => {
    const { view, calls } = fixture()
    await view.prepareSelectedPacks()
    assert.equal(view.body, 'f')
    assert.deepEqual(calls, [['cells', 'f'], ['support', 'f'], ['motion', 'f']])
    calls.length = 0
    await view.prepareSelectedPacks()
    assert.deepEqual(calls, [['motion', 'f']], 'unchanged mode needs no availability refresh')
})

test('body mode is set after lazy metadata resolves', async () => {
    const { view, item } = fixture()
    const sheets = item.sheets
    item.sheets = null
    let resolve
    view.ensureItemMetadata = async () => {
        await new Promise(done => { resolve = done })
        item.sheets = sheets
        return true
    }
    view.ensurePalettes = async () => true
    view.updatePalettePanel = () => {}
    const pending = view.prepareSelectedPacks()
    assert.equal(view.body, 'm')
    resolve()
    await pending
    assert.equal(view.body, 'f')
})

for (const types of [[], ['m', 'f'], ['mf'], ['x'], ['']]) {
    test(`invalid body item types ${JSON.stringify(types)} fail without changing mode`, async () => {
        const { view } = fixture(types)
        await assert.rejects(view.prepareSelectedPacks(), /body item must define/)
        assert.equal(view.body, 'm')
    })
}

test('other slots do not control body mode', async () => {
    const { view } = fixture(['mf'], 'hair')
    await view.prepareSelectedPacks()
    assert.equal(view.body, 'm')
})

for (const cancellation of ['new selection', 'disconnect']) {
    test(`${cancellation} prevents late body metadata from changing mode`, async () => {
        const { view, item } = fixture()
        const sheets = item.sheets
        item.sheets = null
        let resolve
        view.ensureItemMetadata = async () => {
            await new Promise(done => { resolve = done })
            item.sheets = sheets
            return true
        }
        view.ensurePalettes = async () => true
        const pending = view.prepareSelectedPacks()
        if (cancellation === 'new selection') view.previewRequest = {}
        else view.isConnected = false
        resolve()
        await pending
        assert.equal(view.body, 'm')
    })
}
