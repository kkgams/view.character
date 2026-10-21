import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { evaluateView } from './character-view-test.mjs'

const bodySlot = 'body-z12'
const state = { animation: 'walk', body: 'm' }

for (const slot of [bodySlot, 'hair']) {
    test(`${slot}: SQL availability ignores body only for the body selector`, async () => {
        const { loadInventorySupport } = evaluateView()
        const flags = await loadInventorySupport({ async queryObjects(query, columns, params) {
            const python = `import json, sqlite3, sys
r = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
db.executescript('CREATE TABLE items (id TEXT, slot TEXT); CREATE TABLE sprites (item TEXT, animation TEXT, mask INTEGER, body TEXT);')
db.executemany('INSERT INTO items VALUES (?, ?)', [(id, r['slot']) for id in ['female', 'male', 'mask-only', 'idle-only', 'absent']])
db.executemany('INSERT INTO sprites VALUES (?, ?, ?, ?)', [('female', 'walk', 0, 'f'), ('male', 'walk', 0, 'm'), ('mask-only', 'walk', 1, 'f'), ('idle-only', 'idle', 0, 'f')])
print(json.dumps([dict(row) for row in db.execute(r['query'], r['params'])]))
`
            const result = spawnSync('python3', ['-c', python], {
                input: JSON.stringify({ query, params, slot }), encoding: 'utf8',
            })
            assert.equal(result.status, 0, result.stderr)
            assert.deepEqual(columns, ['id', 'supported', 'hasAnimation'])
            if (slot === bodySlot) {
                assert.doesNotMatch(query, /instr\(body/)
                assert.deepEqual(params, ['walk', 'female', 'male', 'mask-only', 'idle-only', 'absent', slot,
                    'female', 'male', 'mask-only', 'idle-only', 'absent'])
            }
            return JSON.parse(result.stdout)
        } }, slot, state, ['female', 'male', 'mask-only', 'idle-only', 'absent'])
        assert.deepEqual([...flags], [
            ['absent', 'missing-animation'], ['female', slot === bodySlot ? 'supported' : 'body-mismatch'], ['idle-only', 'missing-animation'], ['male', 'supported'], ['mask-only', 'missing-animation'],
        ])
    })

    test(`${slot}: loaded metadata uses the same animation/body rules`, () => {
        const { ViewCharacter } = evaluateView()
        const view = Object.create(ViewCharacter.prototype)
        view.body = 'm'
        const item = { id: 'female', slot, sheets: new Map([['walk', [{ mask: 0, body: 'f' }]]]) }
        const walk = { id: 'walk' }
        assert.equal(view.itemSupportsMotion(item, walk), slot === bodySlot)
        assert.equal(view.itemSupportsMotion(item, { id: 'idle' }), false)
        item.sheets.set('walk', [{ mask: 1, body: 'f' }])
        assert.equal(view.itemSupportsMotion(item, walk), false)
        item.sheets = null
        view.inventorySupport = new Map([[view.supportKey(slot, 'walk'), new Map([['female', slot === bodySlot ? 'supported' : 'body-mismatch']])]])
        assert.equal(view.itemSupportsMotion(item, walk), slot === bodySlot)
    })
}
