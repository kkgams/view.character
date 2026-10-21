import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView } from './character-view-test.mjs'

function deferred() {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

for (const action of ['clear', 'equip']) test(`${action} suppresses obsolete Randomize failures`, async () => {
    const gate = deferred(), failures = []
    const view = fixture(() => gate.promise)
    const item = addItem(view)
    selectionShell(view)
    view.updatePreview = () => Promise.resolve()
    view.reportCatalogFailure = error => failures.push(error)
    const pending = view.randomize()
    if (action === 'clear') view.clearSlots()
    else {
        view.selectedSlot = 'body'
        view.selectItem(item.id)
    }
    gate.reject(Error('obsolete inventory SQL failure'))
    await pending
    assert.deepEqual(failures, [])
    assert.equal(view.parts.body, action === 'clear' ? null : item.id)
})

for (const cancellation of ['Reset', 'disconnect']) {
    for (const demand of ['inventory', 'metadata', 'palettes']) {
        test(`${cancellation} suppresses stale ${demand} commits and further pages`, async t => {
            const gate = deferred(), calls = []
            const view = fixture(async (...args) => {
                const call = record(...args)
                calls.push(call)
                if (call.query.includes('FROM slots')) return [{ id: 'body', name: 'Body', icon: 'person' }]
                if (call.query.includes('FROM animations')) return [{ id: 'walk', name: 'Walk' }]
                return gate.promise
            })
            const item = addItem(view)
            const pending = demand === 'inventory' ? view.ensureInventory('body')
                : demand === 'metadata' ? view.ensureItemMetadata(item) : view.ensurePalettes()
            const generation = view.iconScheduler.generation
            if (cancellation === 'Reset') await view.reload()
            else {
                const previous = Object.getOwnPropertyDescriptor(globalThis, 'unregisterViewPlugin')
                globalThis.unregisterViewPlugin = async () => {}
                t.after(() => {
                    if (previous) Object.defineProperty(globalThis, 'unregisterViewPlugin', previous)
                    else delete globalThis.unregisterViewPlugin
                })
                view.isConnected = false
                view.disconnectedCallback()
            }
            assert.ok(view.iconScheduler.generation > generation)
            // Full pages would request another page without the cancellation guard.
            gate.resolve(demand === 'inventory'
                ? Array.from({ length: 512 }, (_, n) => itemRow('body', `i${n}`))
                : demand === 'metadata'
                    ? Array.from({ length: 512 }, (_, n) => spriteRow(item.id, `opaque-${n}`)) : paletteRows())
            assert.equal(await pending, false)
            assert.equal(view.inventories.size, 0)
            assert.equal(view.items.has('body/i0'), false)
            assert.equal(item.sheets, null)
            assert.equal(view.palettes.size, 0)
            assert.equal(view.inventoryErrors.size, 0)
            assert.equal(calls.filter(call => !/FROM (slots|animations)/.test(call.query)).length, 1)
        })
    }
}

test('motion support stays unknown until metadata loads', async () => {
    const view = fixture(async () => []), item = addItem(view)
    view.parts.body = item.id
    assert.equal(view.itemSupportsMotion(item), null)
    assert.deepEqual(view.motionAvailability().missing, [])
    await view.ensureItemMetadata(item)
    assert.equal(view.itemSupportsMotion(item), false)
    assert.deepEqual(view.motionAvailability().missing, ['one'])
    item.sheets.set('walk', [spriteRow()])
    assert.equal(view.itemSupportsMotion(item), true)
    assert.throws(() => view.itemSupportsMotion({ ...item, sheets: undefined }), /missing sprite metadata state/)
})

for (const superseded of [false, true]) test(`pack preparation waits for metadata; superseded=${superseded}`, async () => {
    const metadata = deferred(), palettes = deferred(), calls = [], updates = []
    const view = fixture((query, columns, params) => {
        calls.push(record(query, columns, params))
        if (query.includes('FROM palettes')) return palettes.promise
        if (query.includes('FROM sprites') && !columns.includes('data')) return metadata.promise
        assert.fail(`unexpected BLOB SQL before readiness or after supersession: ${query}`)
    })
    const item = addItem(view), request = {}
    view.parts.body = item.id
    view.previewRequest = request
    view.updatePalettePanel = () => updates.push('palette')
    view.updateMotionCells = () => updates.push('motion')
    // A predecoded pack avoids browser image work; support still needs metadata.
    view.packCache.set(view.packKey(item, view.currentMotion()), Promise.resolve([]))
    const pending = view.prepareSelectedPacks(request)
    assert.equal(calls.length, 2)
    assert.equal(item.sheets, null)
    palettes.resolve(paletteRows())
    await flush()
    assert.deepEqual(updates, [])
    if (superseded) {
        view.previewRequest = {}
        view.packCache.clear() // A missing stale guard would now start BLOB SQL.
    }
    metadata.resolve([spriteRow()])
    await pending
    assert.ok(item.sheets instanceof Map)
    assert.deepEqual(updates, superseded ? [] : ['palette', 'motion'])
    assert.equal(view.packCache.size, superseded ? 0 : 1)
    assert.equal(calls.length, 2)
})
const itemRow = (slot = 'body', suffix = 'one') => ({ id: `${slot}/${suffix}`, name: suffix, slot, palette: 'skin' })
const spriteRow = (item = 'body/one', id = 'opaque') => ({ id, item, animation: 'walk', layer: 1, mask: 0, body: 'm' })
const paletteRows = () => [{ id: 'skin', name: 'Skin', data: 'GIMP Palette\nName: Skin\n1 2 3 Shade\n' }]

function fixture(queryObjects) {
    const { ViewCharacter } = evaluateView({ queryObjects })
    const view = Object.create(ViewCharacter.prototype)
    view.initializeCatalogCaches()
    view.initializeIcons()
    view.loadSlots(['body', 'hair'].map(id => ({ id, name: id, icon: 'person' })))
    view.animations = [{ id: 'walk', name: 'Walk', sequence: [0] }]
    view.resetState()
    Object.assign(view, {
        isConnected: true, previewRequest: null, previewPending: false,
        packCache: new Map(), previewCache: null, previewKey: null,
        headerControls: [], equipmentGrid: null, inventoryGrid: null,
        themeObserver: { disconnect() {} }, closeTip() {},
        // Explicit DOM-shell stubs; demand and lifecycle methods stay real.
        showCatalogLoading() {}, render() {}, updatePalettePanel() {}, updateMotionCells() {},
    })
    return view
}
function addItem(view, row = itemRow()) {
    const item = { ...row, sheets: null }
    view.items.set(item.id, item)
    return item
}
const record = (query, columns, params) => ({ query, columns, params })

for (const demand of ['inventory', 'metadata']) test(`${demand} paging binds exact scope and last ID cursor`, async () => {
    const calls = []
    const rows = Array.from({ length: 512 }, (_, n) => demand === 'inventory'
        ? itemRow('body', `i${String(n).padStart(3, '0')}`) : spriteRow('body/one', `opaque-${n}`))
    const view = fixture(async (...args) => { calls.push(record(...args)); return calls.length === 1 ? rows : [] })
    const item = addItem(view)
    // Inventory owns its items; do not preinsert a colliding record.
    if (demand === 'inventory') view.items.clear()
    assert.equal(await (demand === 'inventory' ? view.ensureInventory('body') : view.ensureItemMetadata(item)), true)
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1].params, [demand === 'inventory' ? 'body' : item.id, rows.at(-1).id])
    assert.match(calls[1].query, /WHERE (slot|item) = \? AND id > \? ORDER BY id LIMIT 512$/)
    assert.equal(calls[1].columns.includes('data'), false)
    assert.equal(calls[1].columns.includes('icon'), false)
    assert.equal(demand === 'inventory' ? view.inventories.get('body').length : item.sheets.get('walk').length, 512)
})

for (const [label, row, pattern] of [
    ['foreign item', spriteRow('hair/one'), /unknown item\/animation reference/],
    ['unknown animation', { ...spriteRow(), animation: 'unknown' }, /unknown item\/animation reference/],
    ['invalid layer', { ...spriteRow(), layer: 0 }, /layer/],
    ['invalid mask', { ...spriteRow(), mask: 2 }, /mask/],
    ['blank body', { ...spriteRow(), body: '' }, /sprite body/],
]) test(`metadata rejects ${label} without publishing sheets`, async () => {
    const view = fixture(async () => [row]), item = addItem(view)
    await assert.rejects(view.ensureItemMetadata(item), pattern)
    assert.equal(item.sheets, null)
})

for (const demand of ['inventory', 'metadata', 'palettes']) test(`${demand} SQL failure propagates without cache publication`, async () => {
    const error = Error(`synthetic ${demand} SQL failure`)
    const view = fixture(async () => { throw error }), item = addItem(view)
    await assert.rejects(demand === 'inventory' ? view.ensureInventory('body')
        : demand === 'metadata' ? view.ensureItemMetadata(item) : view.ensurePalettes(), failure => failure === error)
    assert.equal(view.inventories.size, 0)
    assert.equal(item.sheets, null)
    assert.equal(view.palettes.size, 0)
    if (demand === 'inventory') {
        assert.equal(view.inventoryErrors.get('body'), error)
        assert.equal(view.inventoryErrors.has('hair'), false)
    }
})

function selectionShell(view) {
    const search = { value: 'old search' }, choices = { querySelectorAll: () => [] }
    const cells = view.slots.map(({ id }) => ({ dataset: { slot: id }, setAttribute() {} }))
    view.required = selector => {
        if (selector === '[data-field="search"]') return search
        if (selector === '[data-element="equipment"]') return { querySelectorAll: () => cells }
        if (selector === '[data-element="choices"]') return choices
        assert.fail(`unexpected DOM lookup: ${selector}`)
    }
    view.equipmentGrid = { refresh() {} }
    view.inventoryGrid = { refresh() {} }
    view.refreshPaletteControls = () => {}
    view.updatePalettes = () => {}
    view.updateEquipmentSlot = () => {}
    return { search }
}

for (const failed of [false, true]) test(`stale slot ${failed ? 'failure' : 'completion'} cannot replace current picker`, async () => {
    const body = deferred(), hair = deferred(), pickers = [], failures = []
    const view = fixture((query, columns, [slot]) => slot === 'body' ? body.promise : hair.promise)
    const { search } = selectionShell(view)
    view.updatePicker = () => pickers.push(view.selectedSlot)
    view.ensureInventorySupport = async () => true // Support demand is covered separately.
    view.reportCatalogFailure = error => failures.push(error)
    const old = view.selectSlot('body'), current = view.selectSlot('hair')
    assert.equal(search.value, '')
    assert.deepEqual(pickers, ['body', 'hair'])
    hair.resolve([itemRow('hair')])
    await current
    assert.deepEqual(pickers, ['body', 'hair', 'hair'])
    if (failed) body.reject(Error('stale slot failure'))
    else body.resolve([itemRow()])
    await old
    assert.equal(view.selectedSlot, 'hair')
    assert.deepEqual(pickers, ['body', 'hair', 'hair'])
    assert.deepEqual(failures, [])
    if (!failed) assert.equal(view.inventories.has('body'), true)
})

test('equipping metadata-loaded item with unknown palette fails before BLOB demand', async () => {
    const calls = [], view = fixture(async query => {
        calls.push(query)
        assert.equal(query, 'SELECT id, name, data FROM palettes ORDER BY id')
        return paletteRows()
    })
    const item = addItem(view, { ...itemRow(), palette: 'missing' })
    item.sheets = new Map([['walk', [spriteRow()]]])
    view.selectedSlot = 'body'
    selectionShell(view)
    let preparation
    view.updatePreview = () => {
        const request = {}
        view.previewRequest = request
        preparation = view.prepareSelectedPacks(request)
    }
    view.selectItem(item.id)
    assert.equal(view.parts.body, item.id)
    await assert.rejects(preparation, /body\/one: unknown palette reference/)
    assert.equal(calls.length, 1)
    assert.equal(view.packCache.size, 0)
})

test('inventory deduplicates demand and cached revisits are SQL-free', async () => {
    const gate = deferred(), calls = []
    const view = fixture((...args) => { calls.push(record(...args)); return gate.promise })
    const first = view.ensureInventory('body'), second = view.ensureInventory('body')
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], {
        query: 'SELECT id, name, slot, palette FROM items WHERE slot = ? ORDER BY id LIMIT 512',
        columns: ['id', 'name', 'slot', 'palette'], params: ['body'],
    })
    gate.resolve([itemRow('body', 'z'), itemRow('body', 'a')])
    assert.deepEqual(await Promise.all([first, second]), [true, true])
    assert.deepEqual(view.inventories.get('body').map(item => item.id), ['body/z', 'body/a'])
    assert.equal(view.items.get('body/z'), view.inventories.get('body')[0])
    assert.equal(view.items.get('body/z').sheets, null)
    assert.equal(await view.ensureInventory('body'), true)
    assert.equal(view.palettes.size, 0)
    assert.equal(view.inventories.has('hair'), false)
    await assert.rejects(view.ensureInventory('unknown'), /unknown editor slot/)
    assert.equal(calls.length, 1)
})

for (const [label, rows, pattern] of [
    ['wrong slot', [itemRow('hair')], /unexpected slot reference/],
    ['invalid ID', [{ ...itemRow(), id: 'unscoped' }], /invalid item ID/],
    ['blank name', [{ ...itemRow(), name: '' }], /item name/],
    ['invalid palette', [{ ...itemRow(), palette: '' }], /item palette/],
    ['duplicate ID', [itemRow(), itemRow()], /duplicate item/],
    ['malformed result', null, /expected rows/],
]) test(`inventory scopes and caches ${label} failures without partial commits`, async () => {
    let calls = 0
    const view = fixture(async () => { calls++; return rows })
    const unrelated = addItem(view, itemRow('hair'))
    await assert.rejects(view.ensureInventory('body'), pattern)
    const error = view.inventoryErrors.get('body')
    assert.ok(error instanceof Error)
    assert.equal(view.inventories.has('body'), false)
    assert.deepEqual([...view.items.values()], [unrelated])
    await assert.rejects(view.ensureInventory('body'), failure => failure === error)
    assert.equal(calls, 1)
})

test('metadata deduplicates requested item and cached metadata issues no SQL', async () => {
    const gate = deferred(), calls = []
    const view = fixture((...args) => { calls.push(record(...args)); return gate.promise })
    const item = addItem(view), other = addItem(view, itemRow('hair'))
    const first = view.ensureItemMetadata(item), second = view.ensureItemMetadata(item)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], {
        query: 'SELECT id, item, animation, layer, mask, body FROM sprites WHERE item = ? ORDER BY id LIMIT 512',
        columns: ['id', 'item', 'animation', 'layer', 'mask', 'body'], params: [item.id],
    })
    gate.resolve([spriteRow()])
    assert.deepEqual(await Promise.all([first, second]), [true, true])
    assert.deepEqual(item.sheets.get('walk'), [{ ...spriteRow(), slot: 'body' }])
    assert.equal(other.sheets, null)
    assert.equal(await view.ensureItemMetadata(item), true)
    assert.equal(calls.length, 1)
})

test('palettes are lazy, deduplicated and cached', async () => {
    const gate = deferred(), calls = []
    const view = fixture((...args) => { calls.push(record(...args)); return gate.promise })
    assert.equal(calls.length, 0)
    assert.equal(view.palettes.size, 0)
    const first = view.ensurePalettes(), second = view.ensurePalettes()
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], {
        query: 'SELECT id, name, data FROM palettes ORDER BY id', columns: ['id', 'name', 'data'], params: undefined,
    })
    gate.resolve(paletteRows())
    assert.deepEqual(await Promise.all([first, second]), [true, true])
    const cached = view.palettes
    assert.ok(cached.get('skin').colors.length > 0)
    assert.equal(await view.ensurePalettes(), true)
    assert.equal(view.palettes, cached)
    assert.equal(calls.length, 1)
})
