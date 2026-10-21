import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView } from './character-view-test.mjs'

const { ViewCharacter, orderedComponents } = evaluateView()
const components = [
    { slot: 'shield_trim-z5', item: 'shield_trim-z5/shield_heater_paint', layer: 48, mask: 0 },
    { slot: 'beard-z48', item: 'beard-z48/beards_5oclock_shadow', layer: 48, mask: 0 },
]
function conflict() {
    try { orderedComponents(components, 'walk') } catch (error) { return error }
    assert.fail('expected occupancy conflict')
}
function element() {
    const classes = new Set()
    return { dataset: {}, attrs: {}, children: [],
        setAttribute(key, value) { this.attrs[key] = value },
        append(child) { this.children.push(child); child.remove = () => this.children.splice(this.children.indexOf(child), 1) },
        replaceChildren(...children) { this.children = children },
        isConnected: true,
        querySelector() { return this.children.find(child => child.dataset.element === 'layer-conflict') || null },
        classList: {
            toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name) },
            contains(name) { return classes.has(name) },
            add(name) { classes.add(name) },
        },
    }
}
function fixture(t) {
    const previous = globalThis.document
    globalThis.document = { createElement: () => element() }
    t.after(() => { globalThis.document = previous })
    const view = Object.create(ViewCharacter.prototype)
    view.previewRequest = null
    view.parts = Object.fromEntries(components.map(c => [c.slot, c.item]))
    const cells = components.map(c => Object.assign(element(), { dataset: { slot: c.slot } }))
    cells.push(Object.assign(element(), { dataset: { slot: 'empty' } }))
    view.parts.empty = null
    view.items = new Map(components.map(c => [c.item, { id: c.item, name: c.item, slot: c.slot }]))
    view.currentMotion = () => null
    view.slotRecord = slot => ({ name: slot })
    view.required = () => ({ querySelectorAll: () => cells })
    return { view, cells }
}

test('layer conflicts retain opaque slot/item IDs as structured context', () => {
    const error = conflict()
    assert.match(error.message, /Layer 48 conflict \(walk\)/)
    assert.deepEqual(error.components, components.map(({ slot, item }) => ({ slot, item })))
})

test('both implicated slots get decorative corner warnings and accessible conflict details; clearing preserves cells', t => {
    const { view, cells } = fixture(t)
    view.updateLayerConflicts(conflict())
    for (const cell of cells.slice(0, 2)) {
        assert.equal(cell.classList.contains('danger'), true)
        assert.equal(cell.classList.contains('warning'), false)
        assert.match(cell.attrs['aria-label'], /Layer 48 conflict \(walk\)/)
        assert.match(cell.dataset.layerConflict, /shield_heater_paint.*beards_5oclock_shadow/)
        assert.equal(cell.children.length, 1)
        assert.equal(cell.children[0].textContent, 'warning')
        assert.equal(cell.children[0].attrs['aria-hidden'], 'true')
        assert.equal(cell.children[0].className, 'warning')
    }
    assert.equal(cells[2].children.length, 0)
    view.updateLayerConflicts()
    for (const cell of cells) {
        assert.equal(cell.children.length, 0)
        assert.equal(cell.dataset.layerConflict, undefined)
        assert.doesNotMatch(cell.attrs['aria-label'], /conflict/)
        assert.equal(cell.classList.contains('danger'), false)
    }
})

test('current async conflict marks slots but a stale request cannot restore badges', async t => {
    const { view, cells } = fixture(t)
    view.isConnected = true
    view.updateStatus = () => {}
    const pending = []
    view.prepareSelectedPacks = () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
    const failures = []
    view.reportFailure = error => failures.push(error)
    const stale = view.updatePreview()
    const current = view.updatePreview()
    pending[1].reject(conflict())
    await current
    assert.equal(cells[0].children.length, 1)
    const next = view.updatePreview()
    assert.equal(cells[0].children.length, 0)
    pending[0].reject(conflict())
    await stale
    assert.equal(cells[0].children.length, 0)
    pending[2].reject(Error('unrelated'))
    await next
    assert.equal(cells[0].children.length, 0)
    assert.equal(failures.length, 2)
})

test('progressive icon publication retains a conflict badge and its accessible name', t => {
    const { view, cells } = fixture(t)
    const cell = cells[0]
    cell.dataset.iconItem = components[0].item
    view.updateLayerConflicts(conflict())
    const badge = cell.children[0], label = cell.attrs['aria-label']
    let entries
    view.iconScheduler = { setDemand(group, demand) { assert.equal(group, 'equipment'); entries = demand } }
    view.demandIcons('equipment', { querySelectorAll: () => [cell] })
    entries[0].publish({ width: 1, height: 1, getContext: () => ({ getImageData: () => ({ data: [0, 0, 0, 255] }) }) })
    assert.equal(cell.children.length, 2)
    assert.equal(cell.children[1], badge)
    assert.equal(cell.attrs['aria-label'], label)
    assert.equal(cell.dataset.iconItem, undefined)
})

test('missing frames use warning, conflicts take danger precedence, and recovery clears both', t => {
    const { view, cells } = fixture(t)
    const cell = cells[0], slot = components[0].slot, item = view.item(components[0].item)
    view.currentMotion = () => ({ id: 'walk', name: 'Walk' })
    view.direction = 'south'
    let supported = false
    view.itemMotionStatus = () => supported ? 'supported' : 'missing-animation'
    view.updateCellMotion(cell, slot, item, true)
    assert.equal(cell.classList.contains('warning'), true)
    assert.equal(cell.classList.contains('danger'), false)
    assert.match(cell.attrs['aria-label'], /No source frames for Walk/)
    view.updateLayerConflicts(conflict())
    assert.equal(cell.classList.contains('warning'), false)
    assert.equal(cell.classList.contains('danger'), true)
    view.updateLayerConflicts()
    assert.equal(cell.classList.contains('warning'), true)
    assert.equal(cell.classList.contains('danger'), false)
    supported = true
    view.updateCellMotion(cell, slot, item, true)
    assert.equal(cell.classList.contains('warning'), false)
    assert.equal(cell.classList.contains('danger'), false)
    assert.doesNotMatch(cell.attrs['aria-label'], /No source frames|conflict/)
})

test('missing-frame tooltips remain accurate when a conflict takes precedence', t => {
    const { view } = fixture(t)
    view.currentMotion = () => ({ id: 'walk', name: 'Walk' })
    view.direction = 'south'
    let supported = false, tooltip
    view.itemMotionStatus = () => supported ? 'supported' : 'missing-animation'
    view.bindTip = (cell, content) => { tooltip = content }
    const cell = view.itemCell(components[0].slot, view.item(components[0].item), true)
    assert.match(tooltip(), /No source frames for Walk/)
    cell.dataset.layerConflict = conflict().message
    view.updateCellMotion(cell, components[0].slot, view.item(components[0].item), true)
    assert.match(tooltip(), /No source frames for Walk.*Layer 48 conflict/)
    supported = true
    view.updateCellMotion(cell, components[0].slot, view.item(components[0].item), true)
    assert.doesNotMatch(tooltip(), /No source frames/)
    assert.match(tooltip(), /Layer 48 conflict/)
})

test('inventory tooltips show only the catalog name while accessible warnings remain', t => {
    const { view } = fixture(t)
    const slot = components[0].slot
    const item = { ...view.item(components[0].item), name: 'Skeleton (male)' }
    view.currentMotion = () => ({ id: 'walk', name: 'Walk' })
    view.direction = 'south'
    view.itemMotionStatus = () => 'missing-animation'
    let tooltip
    view.bindTip = (cell, content) => { tooltip = content }
    const cell = view.itemCell(slot, item, false)
    assert.equal(tooltip(), 'Skeleton (male)')
    assert.match(cell.attrs['aria-label'], /Equip Skeleton \(male\).*No source frames for Walk/)
    cell.dataset.layerConflict = conflict().message
    assert.equal(tooltip(), 'Skeleton (male)')
})

test('inventory remove tooltip retains its action label', t => {
    const { view } = fixture(t)
    let tooltip
    view.bindTip = (cell, content) => { tooltip = content }
    view.itemCell(components[0].slot, null, false)
    assert.equal(tooltip(), `Unequip ${components[0].slot}`)
})

test('body mismatch uses danger without a triangle; pending, missing animation and recovery update in place', t => {
    const { view, cells } = fixture(t)
    const cell = cells[0], slot = components[0].slot
    const item = view.item(components[0].item)
    view.body = 'm'
    view.direction = 'south'
    view.currentMotion = () => ({ id: 'walk', name: 'Walk' })
    view.inventorySupport = new Map()
    view.inventorySupportComplete = new Set()
    item.sheets = null
    view.updateCellMotion(cell, slot, item, true)
    assert.equal(cell.classList.contains('warning'), false)
    assert.equal(cell.classList.contains('danger'), false)
    const flags = new Map([[item.id, 'body-mismatch']])
    view.inventorySupport.set(view.supportKey(slot, 'walk'), flags)
    view.updateCellMotion(cell, slot, item, true)
    assert.equal(cell.classList.contains('danger'), true)
    assert.equal(cell.classList.contains('warning'), false)
    assert.match(cell.attrs['aria-label'], /Walk does not fit current body type \(m\)/)
    assert.doesNotMatch(cell.attrs['aria-label'], /No source frames/)
    assert.equal(cell.children.length, 0)
    assert.equal(view.itemSupportsMotion(item), false)
    flags.set(item.id, 'missing-animation')
    view.updateCellMotion(cell, slot, item, true)
    assert.equal(cell.classList.contains('danger'), false)
    assert.equal(cell.classList.contains('warning'), true)
    flags.set(item.id, 'supported')
    view.updateCellMotion(cell, slot, item, true)
    assert.equal(cell.classList.contains('danger'), false)
    assert.equal(cell.classList.contains('warning'), false)
    assert.doesNotMatch(cell.attrs['aria-label'], /body type|No source frames/)
})

test('loaded body mismatch keeps inventory name tips and gives equipment an accurate reason', t => {
    const { view } = fixture(t)
    const slot = components[0].slot, item = view.item(components[0].item)
    item.sheets = new Map([['walk', [{ mask: 0, body: 'f' }]]])
    view.body = 'm'
    view.currentMotion = () => ({ id: 'walk', name: 'Walk' })
    let tooltip
    view.bindTip = (cell, content) => { tooltip = content }
    const inventory = view.itemCell(slot, item, false)
    assert.equal(inventory.classList.contains('danger'), true)
    assert.equal(tooltip(), item.name)
    const equipment = view.itemCell(slot, item, true)
    assert.match(tooltip(), /does not fit current body type \(m\)/)
    equipment.dataset.layerConflict = conflict().message
    assert.match(tooltip(), /body type.*Layer 48 conflict/)
    view.body = 'f'
    view.updateCellMotion(equipment, slot, item, true)
    assert.doesNotMatch(tooltip(), /body type/)
    assert.equal(equipment.classList.contains('danger'), true, 'conflict remains independently dangerous')
})

test('an obsolete item ID cannot mark its replacement in the same slot', t => {
    const { view, cells } = fixture(t)
    view.parts[components[0].slot] = null
    view.updateLayerConflicts(conflict())
    assert.equal(cells[0].children.length, 0)
    assert.equal(cells[1].children.length, 1)
})
