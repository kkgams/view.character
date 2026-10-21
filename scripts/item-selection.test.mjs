import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView } from './character-view-test.mjs'

const flush = () => new Promise(resolve => setImmediate(resolve))

function cell(dataset, selected = false) {
    const attributes = new Map([['aria-selected', String(selected)]])
    return { dataset, tabIndex: -1,
        setAttribute(name, value) { attributes.set(name, String(value)) },
        getAttribute(name) { return attributes.get(name) ?? null },
        hasAttribute(name) { return attributes.has(name) },
    }
}

function selectionFixture() {
    const { ViewCharacter } = evaluateView()
    const view = Object.create(ViewCharacter.prototype)
    const cells = [cell({ action: 'remove' }), cell({ item: 'one' }, true), cell({ item: 'two' })]
    cells[2].tabIndex = 0
    const inventory = { querySelectorAll: () => cells, contains: node => cells.includes(node),
        replaceChildren() { assert.fail('retain inventory nodes') } }
    const search = { value: 'retained search' }, calls = []
    Object.assign(view, {
        selectedSlot: 'body', search: search.value,
        parts: { body: 'one', hair: 'hair' }, colors: { body: 'old', hair: 'hair-palette' },
        items: new Map([
            ['one', { id: 'one', slot: 'body', palette: 'old' }],
            ['two', { id: 'two', slot: 'body', palette: 'new' }],
            ['hair', { id: 'hair', slot: 'hair', palette: 'hair-palette' }],
        ]),
        shadowRoot: { activeElement: cells[2], querySelectorAll: () => cells },
        required(selector) {
            if (selector.includes('choices') || selector.includes('Available parts')) return inventory
            if (selector.includes('search')) return search
            assert.fail(`Unexpected selection DOM lookup: ${selector}`)
        },
        slotRecord: id => ({ id }), closeTip() {},
        updateEquipmentSlot(slot) { calls.push(['equipment', slot]) },
        refreshPaletteControls(slot) { calls.push(['controls', slot]) },
        updatePalettes(slot) { calls.push(['palette', slot]) },
        updatePreview() { calls.push(['preview']); return Promise.resolve() },
        inventoryGrid: { refresh() { calls.push(['inventory']) } }, equipmentGrid: { refresh() {} },
    })
    for (const method of ['update', 'updatePicker', 'updateBoard'])
        view[method] = () => assert.fail(`${method} must not run for item activation`)
    return { view, cells, inventory, search, calls }
}

for (const id of ['two', null]) test(`selectItem(${JSON.stringify(id)}) updates only the active slot without rebuilding inventory`, () => {
    const { view, cells, inventory, search, calls } = selectionFixture()
    const nodes = [...cells]
    view.selectItem(id)
    // No await: equipment feedback must precede async preview preparation.
    assert.equal(view.parts.body, id)
    assert.equal(view.colors.body, id === null ? undefined : 'new')
    assert.equal(view.parts.hair, 'hair')
    assert.equal(view.colors.hair, 'hair-palette')
    assert.deepEqual(cells.map(entry => entry.getAttribute('aria-selected')),
        id === null ? ['true', 'false', 'false'] : ['false', 'false', 'true'])
    for (const kind of ['equipment', 'controls', 'palette'])
        assert.deepEqual(calls.filter(call => call[0] === kind), [[kind, 'body']])
    for (const kind of ['preview', 'inventory'])
        assert.equal(calls.filter(call => call[0] === kind).length, 1)
    assert.equal(view.required('[data-element="choices"]'), inventory)
    nodes.forEach((node, index) => assert.equal(cells[index], node))
    assert.equal(view.shadowRoot.activeElement, nodes[2])
    assert.equal(nodes[2].tabIndex, 0)
    assert.equal(view.search, 'retained search')
    assert.equal(search.value, 'retained search')
})

test('clearSlots unequips every slot with one preview and retains the active inventory', () => {
    const { view, cells, search, calls } = selectionFixture()
    view.slots = [{ id: 'body' }, { id: 'hair' }, { id: 'empty' }]
    view.parts.empty = null
    const nodes = [...cells]
    view.clearSlots()
    assert.deepEqual(view.parts, { body: null, hair: null, empty: null })
    assert.equal(view.selectedSlot, 'body')
    assert.equal(view.search, 'retained search')
    assert.equal(search.value, 'retained search')
    assert.deepEqual(cells.map(entry => entry.getAttribute('aria-selected')), ['true', 'false', 'false'])
    nodes.forEach((node, index) => assert.equal(cells[index], node))
    assert.deepEqual(calls.filter(call => call[0] === 'equipment').map(call => call[1]).sort(), ['body', 'empty', 'hair'])
    for (const kind of ['controls', 'palette'])
        assert.deepEqual(calls.filter(call => call[0] === kind), [[kind, 'body']])
    assert.deepEqual(view.colors, {})
    assert.equal(calls.filter(call => call[0] === 'preview').length, 1)
    view.clearSlots()
    assert.deepEqual(view.parts, { body: null, hair: null, empty: null })
})

test('selectItem rejects another slot before changing selection', () => {
    const { view, calls } = selectionFixture()
    assert.throws(() => view.selectItem('hair'), /another slot|belongs|slot mismatch/)
    assert.deepEqual(view.parts, { body: 'one', hair: 'hair' })
    assert.deepEqual(view.colors, { body: 'old', hair: 'hair-palette' })
    assert.deepEqual(calls, [])
})

function renderingFixture(t) {
    const previous = ['document', 'unregisterViewPlugin'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
    const work = { canvases: 0, draws: 0 }
    globalThis.document = { createElement(tag) {
        assert.equal(tag, 'canvas')
        work.canvases++
        const canvas = { pixels: null }
        canvas.getContext = () => ({
            createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) } },
            putImageData(image) { canvas.pixels = new Uint8ClampedArray(image.data) },
            drawImage(source) { work.draws++; canvas.pixels = new Uint8ClampedArray(source.pixels) },
            getImageData() { return { data: canvas.pixels } },
        })
        return canvas
    } }
    globalThis.unregisterViewPlugin = async () => {}
    t.after(() => {
        for (const [name, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor)
            else delete globalThis[name]
        }
    })
    let rejectSql
    const sqlGate = new Promise((resolve, reject) => { rejectSql = reject })
    const { ViewCharacter } = evaluateView({ queryObjects: () => sqlGate })
    const view = Object.create(ViewCharacter.prototype)
    const motion = { id: 'tiny', name: 'Tiny', frame_width: 1, frame_height: 1,
        frame_count: 2, directions: 'S', sequence: [0, 1], durations_ms: [100, 100] }
    const component = { id: 'opaque-sprite', item: 'one', slot: 'body', body: 'm', animation: 'tiny', layer: 1, mask: 0,
        image: { width: 2, height: 1, pixels: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]) } }
    const item = { id: 'one', name: 'One', slot: 'body', palette: 'original', sheets: new Map([['tiny', [component]]]) }
    const commits = [], status = {}, facing = { options: [{ value: 'south' }] }
    const preview = { parentElement: {}, clientHeight: 1,
        set clip(value) { commits.push(value) }, get clip() { return commits.at(-1) },
        async setClipAsync(clip, isCurrent) {
            if (!isCurrent()) return false
            this.clip = clip
            return true
        },
    }
    const gates = []
    Object.assign(view, {
        isConnected: true, selectedAnimation: 'tiny', selectedSlot: 'body', animations: [motion],
        body: 'm', direction: 'south', scale: 1, playing: false,
        parts: { body: 'one' }, colors: { body: 'original' }, items: new Map([['one', item]]),
        palettes: new Map([['original', { id: 'original', colors: [[0, 0, 0, 0], [255, 0, 0, 255]] }]]),
        previewRequest: null, previewCache: null, previewWidget: null, previewKey: null,
        packCache: new Map(), headerControls: [], themeObserver: { disconnect() {} },
        equipmentGrid: null, inventoryGrid: null, closeTip() {}, showCatalogLoading() {},
        updateMotionCells() {}, updateLayerConflicts() {}, updatePlayback() {},
        required(selector) {
            if (selector.includes('character-preview')) return preview
            if (selector.includes('direction')) return facing
            if (selector.includes('status') || selector === 'output') return status
            assert.fail(`Unexpected rendering DOM lookup: ${selector}`)
        },
        shadowRoot: { querySelector: () => status },
        yieldRender() { return new Promise(resolve => gates.push(resolve)) },
    })
    view.initializeIcons()
    view.packCache.set(view.packKey(item, motion), Promise.resolve([component]))
    const failures = []
    view.reportFailure = error => failures.push(error)
    return { view, gates, commits, work, failures, rejectSql }
}

async function firstYield(fixture) {
    const running = fixture.view.updatePreview()
    await flush()
    assert.deepEqual(fixture.failures, [], 'synthetic rendering fixture must be valid')
    assert.equal(fixture.gates.length, 1, 'render must yield before heavy composition')
    assert.equal(fixture.work.canvases, 0, 'no canvas work before the first yield')
    assert.equal(fixture.commits.length, 0, 'do not publish before all frames complete')
    return { running }
}
async function releaseYield(fixture) {
    assert.ok(fixture.gates.length, 'expected controlled render yield')
    fixture.gates.shift()()
    await flush()
}

test('real rendering yields before composition and between frames, then commits one complete clip', async t => {
    const fixture = renderingFixture(t)
    const { running } = await firstYield(fixture)
    await releaseYield(fixture)
    assert.equal(fixture.work.draws, 1, 'one frame finishes before the next yield')
    assert.equal(fixture.gates.length, 1, 'yield between frames')
    assert.equal(fixture.commits.length, 0, 'never publish a partial animation')
    // Allow, but do not require, a final publication yield.
    for (let i = 0; i < 4 && fixture.gates.length; i++) await releaseYield(fixture)
    await running
    assert.deepEqual(fixture.failures, [])
    assert.equal(fixture.commits.length, 1)
    const clip = fixture.commits[0]
    assert.equal(clip.frames.length, 2)
    assert.deepEqual(clip.frames.map(frame => frame.durationMs), [100, 100])
    assert.deepEqual(clip.frames.map(frame => frame.pixels.data), [[255, 0, 0, 255], [0, 0, 255, 255]])
    assert.equal(fixture.view.previewCache.clip, clip)
})

test('rapid real render requests publish only the latest item pixels and cache key', async t => {
    const fixture = renderingFixture(t)
    const { running: old } = await firstYield(fixture)
    const previous = fixture.view.items.get('one')
    const component = { ...previous.sheets.get('tiny')[0], item:'two',
        image:{width:2,height:1,pixels:new Uint8ClampedArray([0,255,0,255,0,255,0,255])} }
    const latest = {...previous,id:'two',name:'Two',sheets:new Map([['tiny',[component]]])}
    fixture.view.items.set(latest.id,latest)
    fixture.view.parts.body = latest.id
    fixture.view.packCache.set(fixture.view.packKey(latest,fixture.view.currentMotion()),Promise.resolve([component]))
    const running = fixture.view.updatePreview()
    await flush()
    await releaseYield(fixture)
    await old
    assert.equal(fixture.work.draws,0,'obsolete request must not compose after its yield')
    for (let i=0;i<5 && fixture.gates.length;i++) await releaseYield(fixture)
    await running
    assert.deepEqual(fixture.failures,[])
    assert.equal(fixture.commits.length,1)
    assert(fixture.view.previewKey.includes('two'))
    assert(fixture.commits[0].frames.every(frame => frame.pixels.data.join(',') === '0,255,0,255'))
})

for (const cancellation of ['new selection', 'disconnect', 'Reset'])
    test(`${cancellation} cancels a real render between frames without publishing`, async t => {
        const fixture = renderingFixture(t)
        const { running } = await firstYield(fixture)
        await releaseYield(fixture)
        assert.equal(fixture.work.draws, 1)
        assert.equal(fixture.gates.length, 1)
        let reset
        if (cancellation === 'new selection') {
            // Supersede the old render before newer pack preparation completes.
            fixture.view.prepareSelectedPacks = () => new Promise(() => {})
            void fixture.view.updatePreview()
        } else if (cancellation === 'disconnect') {
            fixture.view.isConnected = false
            fixture.view.disconnectedCallback()
        } else {
            // Invalidate at Reset entry, not after pending catalog SQL completes.
            reset = fixture.view.reload().catch(error => error)
        }
        await releaseYield(fixture)
        await running
        assert.equal(fixture.work.draws, 1, 'cancel before composing another frame')
        assert.equal(fixture.commits.length, 0, 'never publish cancelled work')
        assert.equal(fixture.view.previewCache, null, 'never cache cancelled work')
        assert.deepEqual(fixture.failures, [])
        if (reset) {
            fixture.rejectSql(Error('synthetic Reset SQL stopped'))
            assert.match((await reset).message, /synthetic Reset SQL stopped/)
        }
    })
