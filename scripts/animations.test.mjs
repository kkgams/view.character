import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/views/view-character.js', import.meta.url), 'utf8')
const View = new Function('ViewCanvasBase', 'customElements',
    source.replace(/^import .*\n/gm, '').replace('export class ', 'class ') + '\nreturn ViewCharacter')(
        class {}, { define() {} })
const animation = { id: 'walk', name: 'Walk', frame_width: 64, frame_height: 64,
    frame_count: 8, directions: 'NESW', sequence: [0, 1, 2, 3, 4, 5, 6, 7], durations_ms: Array(8).fill(100) }
function viewWith(animations = [animation]) {
    const view = Object.create(View.prototype)
    view.animations = animations
    view.selectedAnimation = animations.length ? animations[0].id : null
    view.parts = { body: 'body/one', head: null }
    view.direction = 'south'
    view.body = 'm'
    view.slots = [{ id: 'body', name: 'Body' }, { id: 'head', name: 'Head' }]
    view.items = new Map([['body/one', { id: 'body/one', name: 'Body', slot: 'body', palette: 'skin',
        sheets: new Map([['walk', [{ mask: 0, layer: 10, body: 'm' }]]]) }]])
    view.palettes = new Map([['skin', { id: 'skin', colors: [[0, 0, 0, 0], [1, 2, 3, 255]] }]])
    return view
}

test('facing controls use compass labels matching their direction values', () => {
    const select = source.match(/<select data-field="direction"[^>]*>(.*?)<\/select>/s)
    assert.ok(select, 'facing select exists')
    const options = [...select[1].matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)]
    assert.deepEqual(options.map(([, value, label]) => [value, label]), [
        ['south', 'South'], ['west', 'West'], ['north', 'North'], ['east', 'East'],
    ])
})

test('selected animation uses the supplied normalized playback settings', () => {
    const view = viewWith()
    assert.equal(view.currentMotion(), animation)
    assert.deepEqual(view.motionAvailability().sequence, animation.sequence)
    assert.equal(view.canPlayAnimation(), true)
})

test('empty or unselected registry never substitutes another animation', () => {
    const view = viewWith([])
    assert.equal(view.currentMotion(), null)
    assert.equal(view.canPlayAnimation(), false)
    view.selectedAnimation = 'missing'
    assert.throws(() => view.currentMotion(), /unknown selected animation/)
})

test('missing sprites omit only the unsupported item without an Idle fallback', () => {
    const view = viewWith()
    const head = { id: 'head/one', name: 'Head', slot: 'head', sheets: new Map() }
    view.items.set(head.id, head)
    view.parts.head = head.id
    assert.deepEqual(view.motionAvailability().supported, ['body/one'])
    assert.deepEqual(view.motionAvailability().missing, ['Head'])
    assert.equal(view.canPlayAnimation(), true)
    view.items.get('body/one').sheets.delete('walk')
    assert.equal(view.canPlayAnimation(), false)
    assert.match(view.motionAvailability().reason, /Body, Head/)
})

test('empty composition disables playback and mask-only components are not drawings', () => {
    const view = viewWith()
    view.parts.body = null
    assert.equal(view.canPlayAnimation(), false)
    assert.match(view.motionAvailability().reason, /No equipped parts/)
    view.parts.body = 'body/one'
    view.items.get('body/one').sheets.set('walk', [{ mask: 1, layer: 10 }])
    assert.equal(view.canPlayAnimation(), false)
})

test('startup and reset leave slots empty without selecting or loading an inventory', () => {
    const view = viewWith()
    view.resetState()
    assert.deepEqual(view.parts, { body: null, head: null })
    assert.deepEqual(view.colors, {})
    assert.equal(view.selectedSlot, null)
    assert.equal(view.selectedAnimation, 'walk')
    assert.equal(view.playing, false)
})

test('palette alternatives require matching index counts, without inferred material categories', () => {
    const view = viewWith()
    view.palettes.set('other', { id: 'other', colors: [[0, 0, 0, 0], [4, 5, 6, 255]] })
    view.palettes.set('wrong-size', { id: 'wrong-size', colors: [[0, 0, 0, 0], [4, 5, 6, 255], [7, 8, 9, 255]] })
    assert.deepEqual(view.compatiblePalettes(view.items.get('body/one')).map(palette => palette.id), ['skin', 'other'])
})

test('slot selection awaits inventory readiness without recomposing the preview', async () => {
    const view = viewWith()
    view.slotsById = new Map(view.slots.map(slot => [slot.id, slot]))
    view.search = 'old search'
    const search = { value: 'old search' }, cells = view.slots.map(slot => ({
        dataset: { slot: slot.id }, attributes: {},
        setAttribute(name, value) { this.attributes[name] = value },
    }))
    let inventoryUpdates = 0, refreshed = false
    view.required = selector => selector.includes('search') ? search : { querySelectorAll: () => cells }
    view.equipmentGrid = { refresh(options) { refreshed = options.focus } }
    view.inventories = new Map()
    view.iconScheduler = { generation: 0 }
    view.isConnected = true
    view.updatePalettePanel = () => {}
    view.refreshInventorySupport = async () => {}
    view.updatePicker = () => { inventoryUpdates++ }
    view.updatePreview = view.updateBoard = () => { throw Error('must not rebuild preview or board') }
    const demands = []
    let ready
    view.ensureInventory = slot => {
        demands.push(slot)
        return new Promise(resolve => { ready = resolve })
    }
    const selection = view.selectSlot('head')
    assert.deepEqual(demands, ['head'])
    assert.equal(inventoryUpdates, 1, 'picker immediately shows inventory loading state')
    ready(true)
    await selection
    assert.equal(view.selectedSlot, 'head')
    assert.equal(view.search, '')
    assert.equal(search.value, '')
    assert.deepEqual(cells.map(cell => cell.attributes['aria-selected']), ['false', 'true'])
    assert.equal(inventoryUpdates, 2)
    assert.equal(refreshed, true)
})

test('unchanged composition does not replace the canvas clip', () => {
    const view = viewWith()
    view.colors = { body: 'skin' }
    view.previewClip = {}
    view.installCanvasClip = () => { throw Error('unchanged clip must not be installed') }
    view.previewKey = JSON.stringify(['walk', 'south', 3, 'm', [['body/one', 'skin']]])
    view.previewScale = 3
    view.required = () => ({ options: [], value: '' })
    view.updateMotionCells = () => {}
    let updates = 0
    view.updatePlayback = () => { updates++ }
    view.renderPreview(new Map())
    assert.equal(updates, 1)
})
