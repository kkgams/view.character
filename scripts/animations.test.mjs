import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/views/view-character.js', import.meta.url), 'utf8')
const load = new Function('sql', 'HTMLElement', 'customElements',
    source.replace(/^import .*\n/gm, '').replace('export class ', 'class ') + '\nreturn ViewCharacter')

function viewWith(rows) {
    const View = load({ async queryObjects(query, columns) {
        assert.equal(query, 'SELECT id, name FROM animations ORDER BY name COLLATE NOCASE, id')
        assert.deepEqual(columns, ['id', 'name'])
        return rows
    } }, class {}, { define() {} })
    const view = Object.create(View.prototype)
    view.selectedPose = null
    view.parts = { body: 'body' }
    view.direction = 'south'
    view.items = new Map([['body', { id: 'body', name: 'Body', sheets: new Map([
        ['idle', { frames: 3, directions: ['north', 'west', 'south', 'east'] }],
        ['walk', { frames: 8, directions: ['north', 'west', 'south', 'east'] }],
        ['emotes', { frames: 3, directions: ['north', 'west', 'south', 'east'] }],
    ]) }]])
    view.clipDefinitions = new Map([
        ['idle', { id: 'idle', frames: 3, directions: ['north', 'west', 'south', 'east'], preview_sequence: [0, 1, 2, 1] }],
        ['walk', { id: 'walk', frames: 8, directions: ['north', 'west', 'south', 'east'], preview_sequence: [0, 1, 2, 3, 4, 5, 6, 7] }],
    ])
    view.poseDefinitions = new Map([
        ['emote_0', { id: 'emote_0', name: 'Pose 1', sheet: 'emotes', column: 0 }],
        ['emote_3', { id: 'emote_3', name: 'Bow', sheet: 'emotes', column: 3 }],
    ])
    return view
}

test('animation names/IDs come from SQLite without a fixed UI list', async () => {
    const records = [{ id: 'custom-id', name: 'Custom <&> name' }, { id: 'idle', name: 'Rest' }]
    const view = viewWith(records)
    await view.loadAnimations()
    assert.deepEqual(view.animations, records)
    view.selectedAnimation = 'idle'
    assert.equal(view.canPlayAnimation(), true)
    view.selectedAnimation = 'custom-id'
    assert.equal(view.canPlayAnimation(), false)
})

test('an empty animation registry is expected and not replaced with hardcoded names', async () => {
    const view = viewWith([])
    await view.loadAnimations()
    assert.deepEqual(view.animations, [])
    view.selectedAnimation = null
    assert.equal(view.canPlayAnimation(), false)
})

test('malformed internal animation records fail loudly', async () => {
    for (const rows of [null, [{ id: '', name: 'Empty ID' }], [{ id: 'bad', name: null }],
        [{ id: 'duplicate', name: 'One' }, { id: 'duplicate', name: 'Two' }]]) {
        await assert.rejects(viewWith(rows).loadAnimations())
    }
})

test('prepared non-Idle clips use their own source sequence', async () => {
    const view = viewWith([{ id: 'walk', name: 'Walk' }])
    await view.loadAnimations()
    view.selectedAnimation = 'walk'
    assert.equal(view.canPlayAnimation(), true)
    assert.equal(view.motionAvailability().sheetId, 'walk')
    assert.deepEqual(view.motionAvailability().sequence, [0, 1, 2, 3, 4, 5, 6, 7])
})

test('poses are held source columns, not playable animations', () => {
    const view = viewWith([])
    view.selectedPose = 'emote_0'
    view.selectedAnimation = null
    assert.equal(view.currentMotion().kind, 'pose')
    assert.equal(view.canPlayAnimation(), false)
    assert.deepEqual(view.motionAvailability().sequence, [0])
})

test('missing item sheets and pose columns never substitute Idle or another pose', async () => {
    const view = viewWith([{ id: 'walk', name: 'Walk' }])
    await view.loadAnimations()
    view.selectedAnimation = null
    view.selectedPose = 'emote_3'
    assert.equal(view.motionAvailability().available, false)
    assert.match(view.motionAvailability().reason, /Body/)
    view.selectedPose = null
    view.selectedAnimation = 'walk'
    view.items.get('body').sheets.delete('walk')
    assert.equal(view.canPlayAnimation(), false)
    assert.equal(view.motionAvailability().available, false)
})

test('missing equipment does not block compatible parts or playback', async () => {
    const view = viewWith([{ id: 'walk', name: 'Walk' }])
    await view.loadAnimations()
    view.selectedAnimation = 'walk'
    const boots = { id: 'boots', name: 'Boots', sheets: new Map() }
    view.items.set(boots.id, boots)
    view.parts.feet = boots.id
    assert.equal(view.motionAvailability().available, true)
    assert.equal(view.canPlayAnimation(), true)
    assert.deepEqual(view.motionAvailability().supported, ['body'])
    assert.deepEqual(view.motionAvailability().missing, ['Boots'])
    assert.equal(view.itemSupportsMotion(boots), false)
    view.items.get('body').sheets.delete('walk')
    assert.equal(view.motionAvailability().available, false)
    assert.equal(view.canPlayAnimation(), false)
})

test('source-facing availability is checked per equipped item', async () => {
    const view = viewWith([{ id: 'walk', name: 'Walk' }])
    await view.loadAnimations()
    view.selectedAnimation = 'walk'
    view.items.get('body').sheets.get('walk').directions = ['north']
    assert.equal(view.canPlayAnimation(), false)
    view.direction = 'north'
    assert.equal(view.canPlayAnimation(), true)
})
