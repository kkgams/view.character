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
    return Object.create(View.prototype)
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
    view.selectedAnimation = 'idle'
    assert.equal(view.canPlayAnimation(), false)
})

test('malformed internal animation records fail loudly', async () => {
    for (const rows of [null, [{ id: '', name: 'Empty ID' }], [{ id: 'bad', name: null }],
        [{ id: 'duplicate', name: 'One' }, { id: 'duplicate', name: 'Two' }]]) {
        await assert.rejects(viewWith(rows).loadAnimations())
    }
})
