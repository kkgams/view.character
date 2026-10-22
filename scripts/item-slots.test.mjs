import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { evaluateView } from './character-view-test.mjs'

const { ViewCharacter, loadCatalog } = evaluateView()
const slot = (id, requiredItems = []) => ({ id, name: id, icon: 'person', requiredItems })
function fixture() {
    const view = Object.create(ViewCharacter.prototype)
    view.loadSlots([slot('body'), slot('attachment', ['body/a', 'body/b']),
        slot('detail', ['attachment/a']), slot('ordinary'),
        slot('cycle-a', ['cycle/b']), slot('cycle-b', ['cycle/a'])])
    view.parts = { body: null, attachment: 'attachment/a', detail: 'detail/a', ordinary: null,
        'cycle-a': 'cycle/a', 'cycle-b': 'cycle/b' }
    view.colors = { attachment: 'custom', detail: 'custom-detail' }
    view.selectedSlot = 'body'
    return view
}

test('slot relationships load within the two startup queries with exact result columns and SQL ordering', async () => {
    const db = new DatabaseSync(':memory:')
    try {
        // Consumer-owned synthetic schema: no producer imports or supplied catalog.
        db.exec(`CREATE TABLE slots (id TEXT, name TEXT, icon TEXT, "order" INTEGER);
            CREATE TABLE "item-slots" (item TEXT, slot TEXT);
            CREATE TABLE animations (id TEXT, name TEXT, "order" INTEGER);
            INSERT INTO slots VALUES ('attachment','Attachment','person',0), ('body','Body','person',1);
            INSERT INTO "item-slots" VALUES ('opaque/one','attachment'), ('opaque/two','attachment');
            INSERT INTO animations VALUES ('walk','Walk',0);`)
        const queries = []
        const sql = { async queryObjects(query, columns) {
            queries.push(query)
            const statement = db.prepare(query)
            assert.deepEqual(statement.columns().map(column => column.name), columns)
            return statement.all()
        } }
        const catalog = await loadCatalog(sql)
        assert.equal(queries.length, 2)
        assert.deepEqual(catalog.slots.map(({ id }) => id), ['attachment', 'body'])
        assert.deepEqual(catalog.slots.map(({ requiredItems }) => requiredItems),
            [['opaque/one', 'opaque/two'], []])
        db.exec('DROP TABLE "item-slots"')
        await assert.rejects(loadCatalog(sql), /no such table/)
    } finally { db.close() }
})

test('conditional slots require an equipped visible owner; retained items and colors return unchanged', () => {
    const view = fixture()
    const visible = () => view.visibleSlots().map(({ id }) => id)
    assert.deepEqual(visible(), ['body', 'ordinary'])
    assert.deepEqual(view.activeParts(), [])
    view.parts.body = 'body/a'
    assert.deepEqual(visible(), ['body', 'attachment', 'detail', 'ordinary'])
    assert.deepEqual(view.activeParts(), ['body/a', 'attachment/a', 'detail/a'])
    view.parts.body = 'body/other'
    assert.deepEqual(visible(), ['body', 'ordinary'])
    assert.deepEqual(view.activeParts(), ['body/other'])
    assert.equal(view.parts.attachment, 'attachment/a')
    assert.equal(view.colors.attachment, 'custom')
    assert.equal(view.colors.detail, 'custom-detail')
    view.parts.body = 'body/b'
    assert.deepEqual(visible(), ['body', 'attachment', 'detail', 'ordinary'])
    // Catalog order does not determine dependency resolution.
    view.slots.reverse()
    assert.deepEqual(visible(), ['ordinary', 'detail', 'attachment', 'body'])
})

test('hiding the active slot cancels its support demand and clears its picker, not its equipment', () => {
    const view = fixture(), calls = []
    view.parts.body = 'body/a'
    view.selectedSlot = 'detail'
    view.inventorySupportRequest = {}
    const previous = view.visibleSlots()
    view.parts.body = null
    for (const method of ['updatePicker', 'updatePalettePanel', 'updateBoard'])
        view[method] = () => calls.push(method)
    assert.equal(view.syncSlotVisibility(previous), true)
    assert.equal(view.selectedSlot, null)
    assert.equal(view.inventorySupportRequest, null)
    assert.equal(view.parts.detail, 'detail/a')
    assert.deepEqual(calls, ['updatePicker', 'updatePalettePanel', 'updateBoard'])
    assert.equal(view.syncSlotVisibility(view.visibleSlots()), false)
    assert.throws(() => view.selectSlot('attachment'), /hidden slot/)
})

test('item activation refreshes visibility only when the visible slot set changes', () => {
    const view = fixture(), calls = []
    view.items = new Map(['body/a', 'body/b', 'body/other'].map(id => [id, { id, slot: 'body', palette: 'original' }]))
    view.required = () => ({ querySelectorAll: () => [] })
    view.inventoryGrid = { refresh() {} }
    for (const method of ['closeTip', 'refreshPaletteControls', 'updatePalettes']) view[method] = () => {}
    view.updateBoard = () => calls.push('board')
    view.updateEquipmentSlot = () => calls.push('cell')
    view.updatePreview = () => calls.push('preview')
    view.selectItem('body/a')
    assert.deepEqual(calls.splice(0), ['board', 'preview'])
    view.selectItem('body/b')
    assert.deepEqual(calls.splice(0), ['cell', 'preview'])
    view.selectItem(null)
    assert.deepEqual(calls.splice(0), ['board', 'preview'])
    assert.equal(view.parts.attachment, 'attachment/a')
    assert.equal(view.colors.attachment, 'custom')
    view.selectItem('body/a')
    assert.deepEqual(view.activeParts(), ['body/a', 'attachment/a', 'detail/a'])
})

test('hidden equipment contributes no availability, metadata loads or animation packs', async () => {
    const view = fixture()
    view.parts.body = 'body/other'
    view.body = 'm'
    view.isConnected = true
    view.previewRequest = {}
    const motion = { id: 'walk', name: 'Walk', sequence: [0] }
    view.currentMotion = () => motion
    view.items = new Map([['body/other', { id: 'body/other', slot: 'body', palette: 'original',
        sheets: new Map([['walk', [{ mask: 0, body: 'm' }]]]) }]])
    view.palettes = new Map([['original', {}]])
    const packs = []
    view.prepareMotionPacks = async motion => packs.push(motion.id)
    assert.deepEqual(view.motionAvailability().supported, ['body/other'])
    await view.prepareSelectedPacks()
    assert.deepEqual(packs, ['walk'])
})

test('Clear clears retained hidden equipment and colors without activating hidden inventories', () => {
    const view = fixture(), cells = []
    view.selectedSlot = null
    view.updateEquipmentSlot = slot => cells.push(slot)
    view.updatePalettePanel = view.updatePreview = () => {}
    view.clearSlots()
    assert(Object.values(view.parts).every(item => item === null))
    assert.deepEqual(view.colors, {})
    assert.deepEqual(cells, ['body', 'ordinary'])
})

test('Randomize loads only visible inventories and follows newly unlocked slots', async () => {
    const view = fixture(), demanded = []
    view.isConnected = true
    view.iconScheduler = { generation: 0 }
    view.inventories = new Map()
    view.items = new Map()
    view.ensureInventory = async slot => {
        demanded.push(slot)
        const item = { id: `${slot}/a`, palette: 'original' }
        view.inventories.set(slot, [item])
        view.items.set(item.id, item)
        return true
    }
    view.updateBoard = view.render = () => {}
    await view.randomize()
    assert.deepEqual(demanded, ['body', 'ordinary', 'attachment', 'detail'])
    assert.equal(view.parts['cycle-a'], 'cycle/a')
})

test('malformed required slot relationships fail instead of silently showing slots', async () => {
    for (const requiredItems of ['not-json', '{}', '[null]', '[""]', '["same","same"]']) {
        await assert.rejects(loadCatalog({ async queryObjects() {
            return [{ id: 'body', name: 'Body', icon: 'person', requiredItems }]
        } }))
    }
})

test('equipment board contains only visible slots in SQL order', () => {
    const view = fixture(), rows = []
    const body = {
        contains: () => false,
        replaceChildren() { rows.length = 0 },
        insertRow() {
            const cells = []
            rows.push(cells)
            return {
                append(cell) { cells.push(cell) },
                insertCell() { const cell = { setAttribute() {} }; cells.push(cell); return cell },
            }
        },
    }
    view.required = () => body
    view.shadowRoot = { activeElement: null }
    view.itemCell = slot => slot
    view.item = id => ({ id })
    view.equipmentGrid = { refresh() {} }
    view.demandIcons = () => {}
    const rendered = () => rows.flat().filter(cell => typeof cell === 'string')
    view.updateBoard()
    assert.deepEqual(rendered(), ['body', 'ordinary'])
    assert.equal(rows[0][1].rowSpan, 1)
    view.parts.body = 'body/a'
    view.updateBoard()
    assert.deepEqual(rendered(), ['body', 'attachment', 'detail', 'ordinary'])
    assert.equal(rows[0][1].rowSpan, 2)
    view.parts.body = null
    view.updateBoard()
    assert.deepEqual(rendered(), ['body', 'ordinary'])
})

test('a failed newly unlocked Randomize inventory never publishes partial equipment', async () => {
    const view = fixture()
    view.isConnected = true
    view.iconScheduler = { generation: 0 }
    view.inventories = new Map([['body', [{ id: 'body/a', palette: 'original' }]], ['ordinary', []]])
    view.items = new Map([['body/a', { id: 'body/a', palette: 'original' }]])
    const before = { ...view.parts }, colors = { ...view.colors }, failure = Error('inventory failed')
    view.ensureInventory = async slot => {
        if (slot === 'attachment') throw failure
        return true
    }
    view.reportCatalogFailure = error => assert.equal(error, failure)
    await view.randomize()
    assert.deepEqual(view.parts, before)
    assert.deepEqual(view.colors, colors)
})
