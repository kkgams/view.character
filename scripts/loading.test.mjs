import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView, viewSource as source } from './character-view-test.mjs'

function setup(queryObjects) {
    const { ViewCharacter } = evaluateView({ queryObjects })
    const view = Object.create(ViewCharacter.prototype)
    view.initializeIcons()
    view.coloredCache.set('old-pixels', {})
    view.packCache = new Map([['old-pack', {}]])
    view.isConnected = true
    view.closeTip = () => {}
    view.resetState = () => {}
    view.render = () => {}
    return view
}

test('reload refreshes the complete database catalog and invalidates decoded previews', async () => {
    let name = 'Body', queries = 0
    const view = setup(async query => {
        queries++
        assert(query.startsWith('SELECT '), 'reload must only read SQL')
        const table = /FROM (\w+)/.exec(query)[1]
        return {
            slots: [{ id: 'body', name, icon: 'person', order: 0 }],
            animations: [{ id: 'walk', name, frame_width: 64, frame_height: 64, frame_count: 8,
                directions: 'NESW', sequence: '[0,1]', durations_ms: '[100,100]' }],
            palettes: [{ id: 'skin', name, data: `GIMP Palette\nName: ${name}\n1 2 3 Shade\n` }],
            items: [], sprites: [],
        }[table]
    })
    await view.reload()
    const previousItems = view.items
    assert.equal(view.slotRecord('body').name, 'Body')
    assert.equal(view.coloredCache.size, 0)
    assert.equal(view.packCache.size, 0)
    name = 'Edited in SQL'
    await view.reload()
    assert.equal(view.slotRecord('body').name, name)
    assert.equal(view.animations[0].name, name)
    assert.equal(view.palettes.get('skin').name, name)
    assert.notEqual(view.items, previousItems)
    assert.equal(queries, 10)
})

test('missing catalog/schema fails visibly without creating or rebuilding it', async () => {
    const error = Error('no such table: slots')
    const view = setup(async () => { throw error })
    const status = {}
    view.shadowRoot = { querySelector() { return status } }
    await assert.rejects(view.reload(), failure => failure === error)
    assert.equal(status.textContent, 'Character reload failed: no such table: slots')
    assert.equal(status.className, 'danger')
})

test('View has no fixture reads, pose registry, RGB color matching or hardcoded outfit', () => {
    assert(!source.includes('fs/fs::read-file'))
    assert(!source.includes('mock-catalog') && !source.includes('motion-catalog'))
    assert(!source.includes('DEFAULT_PARTS') && !source.includes('COLOR_CATEGORIES'))
    assert(!source.includes('poseDefinitions'))
    assert(source.includes('Loading character catalog…'))
})
