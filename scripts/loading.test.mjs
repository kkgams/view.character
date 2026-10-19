import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/views/view-character.js', import.meta.url), 'utf8')
const load = new Function('sql', 'HTMLElement', 'customElements',
    source.replace(/^import .*\n/gm, '').replace('export class ', 'class ') + '\nreturn ViewCharacter')

function setup(queryObjects) {
    const View = load({ queryObjects }, class {}, { define(tag) { assert.equal(tag, 'view-character') } })
    const view = Object.create(View.prototype)
    view.items = new Map([['already-loaded-fixture', {}]])
    view.fixturesReady = true
    view.isConnected = true
    view.closeTip = () => {}
    view.resetState = () => {}
    view.render = () => {}
    return view
}

test('reload and Reset only query the existing catalog, including fresh metadata', async () => {
    let name = 'Body', queries = 0, animationName = 'Idle'
    const view = setup(async (query, columns) => {
        queries++
        if (query === 'SELECT id, name FROM animations ORDER BY name COLLATE NOCASE, id') {
            assert.deepEqual(columns, ['id', 'name'])
            return [{ id: 'idle', name: animationName }]
        }
        assert.equal(query, 'SELECT id, name, icon, "order" FROM slots ORDER BY "order"')
        assert.deepEqual(columns, ['id', 'name', 'icon', 'order'])
        return [{ id: 'body', name, icon: 'person', order: 0 }]
    })
    await view.reload()
    assert.equal(view.slotRecord('body').name, 'Body')
    name = 'Edited in SQL'
    animationName = 'Renamed in SQL <&>'
    await view.reload()
    assert.equal(view.slotRecord('body').name, name)
    assert.equal(view.animations[0].name, animationName)
    assert.equal(queries, 4)
    // No runtime FS, SQL exec, require or migration hooks are supplied to this test.
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
