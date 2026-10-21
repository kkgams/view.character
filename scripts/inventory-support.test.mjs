import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { evaluateView } from './character-view-test.mjs'

const state = { animation: 'walk', body: 'm' }
const supportSQL = 'SELECT i.id, support.item IS NOT NULL AS supported FROM items i LEFT JOIN (SELECT DISTINCT item FROM sprites WHERE animation = ? AND mask = 0 AND instr(body, ?) > 0) support ON support.item = i.id WHERE i.slot = ?'
const row = (id, supported = 1) => ({ id, supported })
function deferred() {
    let resolve, reject
    const promise = new Promise((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
}
function fixture(queryObjects) {
    const { ViewCharacter } = evaluateView({ queryObjects })
    const view = Object.create(ViewCharacter.prototype)
    view.initializeCatalogCaches()
    view.initializeIcons()
    view.loadSlots(['body', 'hair'].map(id => ({ id, name: id, icon: 'person' })))
    view.animations = [{ id: 'walk', name: 'Walk', sequence: [0] }, { id: 'idle', name: 'Idle', sequence: [0] }]
    view.resetState()
    view.isConnected = true
    return view
}
function inventory(view, slot = 'body', ids = ['body/a', 'body/b']) {
    const items = ids.map(id => ({ id, slot, name: id, palette: 'skin', sheets: null }))
    view.inventories.set(slot, items)
    for (const item of items) view.items.set(item.id, item)
    return items
}

test('inventory support binds metadata-only scoped SQL and preserves unsupported SQL order', async () => {
    const calls = []
    const { loadInventorySupport } = evaluateView()
    const flags = await loadInventorySupport({ async queryObjects(...args) {
        calls.push(args)
        return [row('body/z', 0), row('body/a', 1)]
    } }, 'body', state)
    assert.deepEqual(calls, [[`${supportSQL} ORDER BY i.id LIMIT 512`, ['id', 'supported'], ['walk', 'm', 'body']]])
    assert.deepEqual([...flags], [['body/z', false], ['body/a', true]])
})

test('support paging binds the exact last opaque ID after a full 512-row page', async () => {
    const calls = [], rows = Array.from({ length: 512 }, (_, n) => row(`opaque-${n}`, n % 2))
    const { loadInventorySupport } = evaluateView()
    const flags = await loadInventorySupport({ async queryObjects(...args) {
        calls.push(args)
        return calls.length === 1 ? rows : [row('last', 0)]
    } }, 'body', state)
    assert.equal(flags.size, 513)
    assert.deepEqual(calls[1], [`${supportSQL} AND i.id > ? ORDER BY i.id LIMIT 512`, ['id', 'supported'], ['walk', 'm', 'body', 'opaque-511']])
})

for (const [label, rows] of [
    ['non-array rows', null], ['blank ID', [row('')]], ['whitespace ID', [row('  ')]],
    ['non-string ID', [row(1)]], ['duplicate ID', [row('same'), row('same')]],
    ...[true, false, null, undefined, '1', -1, 2].map(flag => [`flag ${String(flag)}`, [{ id: 'body/a', supported: flag }]]),
]) test(`support rejects ${label}`, async () => {
    const { loadInventorySupport } = evaluateView()
    await assert.rejects(loadInventorySupport({ async queryObjects() { return rows } }, 'body', state))
})

test('support rejects duplicates spanning page boundaries', async () => {
    const { loadInventorySupport } = evaluateView()
    let calls = 0
    await assert.rejects(loadInventorySupport({ async queryObjects() {
        return ++calls === 1 ? Array.from({ length: 512 }, (_, n) => row(`id-${n}`)) : [row('id-0')]
    } }, 'body', state), /duplicate/i)
})

test('support cancellation skips SQL before demand and suppresses next page after demand', async () => {
    const { loadInventorySupport } = evaluateView()
    let current = false, calls = 0
    const gate = deferred()
    const sql = { queryObjects() { calls++; return gate.promise } }
    assert.equal(await loadInventorySupport(sql, 'body', state, () => current), null)
    assert.equal(calls, 0)
    current = true
    const pending = loadInventorySupport(sql, 'body', state, () => current)
    current = false
    gate.resolve(Array.from({ length: 512 }, (_, n) => row(`id-${n}`)))
    assert.equal(await pending, null)
    assert.equal(calls, 1)
})

test('actual support SQL matches drawing/body/animation semantics without duplicate items', async () => {
    const { loadInventorySupport } = evaluateView()
    const python = `import json, sqlite3, sys
request = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
db.executescript('CREATE TABLE items (id TEXT, slot TEXT); CREATE TABLE sprites (item TEXT, animation TEXT, mask INTEGER, body TEXT);')
db.executemany('INSERT INTO items VALUES (?, ?)', [(name, 'body') for name in ['absent', 'drawing', 'mask-only', 'other-animation', 'other-body']] + [('foreign-slot', 'hair')])
db.executemany('INSERT INTO sprites VALUES (?, ?, ?, ?)', [('drawing', 'walk', 0, 'mf'), ('drawing', 'walk', 0, 'm'), ('drawing', 'walk', 1, 'm'), ('mask-only', 'walk', 1, 'm'), ('other-animation', 'idle', 0, 'm'), ('other-body', 'walk', 0, 'f'), ('foreign-slot', 'walk', 0, 'm')])
print(json.dumps([dict(row) for row in db.execute(request['query'], request['params'])]))
`
    const flags = await loadInventorySupport({ async queryObjects(query, columns, params) {
        const result = spawnSync('python3', ['-c', python], { input: JSON.stringify({ query, params }), encoding: 'utf8' })
        assert.equal(result.status, 0, result.stderr)
        return JSON.parse(result.stdout)
    } }, 'body', state)
    assert.deepEqual([...flags], [['absent', false], ['drawing', true], ['mask-only', false], ['other-animation', false], ['other-body', false]])
})

test('support demand requires cached inventory before SQL', async () => {
    let calls = 0
    const view = fixture(async () => { calls++; return [] })
    await assert.rejects(view.ensureInventorySupport('body', state), /inventory/i)
    assert.equal(calls, 0)
})

test('support deduplicates demand, caches per slot/animation/body and leaves metadata unloaded', async () => {
    const gate = deferred(), calls = []
    const view = fixture((...args) => { calls.push(args); return gate.promise })
    const items = inventory(view)
    const first = view.ensureInventorySupport('body', state), second = view.ensureInventorySupport('body', { ...state })
    assert.equal(calls.length, 1)
    gate.resolve([row('body/a'), row('body/b', 0)])
    assert.deepEqual(await Promise.all([first, second]), [true, true])
    const key = view.supportKey('body', 'walk', 'm')
    assert.deepEqual([...view.inventorySupport.get(key)], [['body/a', true], ['body/b', false]])
    assert.equal(await view.ensureInventorySupport('body', state), true)
    assert.equal(calls.length, 1)
    assert.ok(items.every(item => item.sheets === null))
    assert.equal(view.palettes.size, 0)
    assert.notEqual(key, view.supportKey('body', 'idle', 'm'))
    assert.notEqual(key, view.supportKey('body', 'walk', 'f'))
    assert.notEqual(key, view.supportKey('hair', 'walk', 'm'))
    assert.equal(key, view.supportKey('body'))
})

for (const [label, rows] of [
    ['missing ID', [row('body/a')]],
    ['extra ID', [row('body/a'), row('body/b'), row('body/c')]],
    ['reordered IDs', [row('body/b'), row('body/a')]],
    ['replaced ID', [row('body/a'), row('body/c')]],
]) test(`support ${label} fails exact inventory matching without partial publication`, async () => {
    let calls = 0
    const view = fixture(async () => { calls++; return rows })
    inventory(view)
    await assert.rejects(view.ensureInventorySupport('body', state))
    const key = view.supportKey('body')
    assert.equal(view.inventorySupport.has(key), false)
    const error = view.inventorySupportErrors.get(key)
    assert.ok(error instanceof Error)
    await assert.rejects(view.ensureInventorySupport('body', state), failure => failure === error)
    assert.equal(calls, 1)
})

for (const cancellation of ['generation', 'disconnect']) {
    for (const fails of [false, true]) test(`${cancellation} suppresses stale support ${fails ? 'failure' : 'publication'}`, async () => {
        const gate = deferred()
        let calls = 0
        const view = fixture(() => { calls++; return gate.promise })
        inventory(view)
        const pending = view.ensureInventorySupport('body', state)
        if (cancellation === 'generation') {
            view.iconScheduler.invalidate(true)
            view.initializeCatalogCaches()
        } else view.isConnected = false
        if (fails) gate.reject(Error('obsolete support SQL'))
        else gate.resolve(Array.from({ length: 512 }, (_, n) => row(`body/${n}`)))
        assert.equal(await pending, false)
        assert.equal(view.inventorySupport.size, 0)
        assert.equal(view.inventorySupportErrors.size, 0)
        assert.equal(calls, 1)
    })
}

test('SQL failure is cached only for the requested support key and propagates unchanged', async () => {
    const error = Error('support query failed')
    let calls = 0
    const view = fixture(async () => { calls++; throw error })
    inventory(view)
    await assert.rejects(view.ensureInventorySupport('body', state), failure => failure === error)
    await assert.rejects(view.ensureInventorySupport('body', state), failure => failure === error)
    assert.equal(view.inventorySupportErrors.get(view.supportKey('body')), error)
    assert.equal(view.inventorySupportErrors.has(view.supportKey('body', 'idle', 'm')), false)
    assert.equal(view.inventorySupport.size, 0)
    assert.equal(calls, 1)
})

test('unloaded motion metadata consults only known per-key flags; loaded sheets are authoritative', () => {
    const view = fixture(async () => [])
    const [yes, no] = inventory(view)
    assert.equal(view.itemSupportsMotion(yes), null)
    view.inventorySupport.set(view.supportKey('body'), new Map([[yes.id, true], [no.id, false]]))
    assert.equal(view.itemSupportsMotion(yes), true)
    assert.equal(view.itemSupportsMotion(no), false)
    assert.equal(view.itemSupportsMotion(yes, view.animations[1]), null)
    view.body = 'f'
    assert.equal(view.itemSupportsMotion(yes), null)
    view.body = 'm'
    yes.sheets = new Map()
    no.sheets = new Map([['walk', [{ mask: 0, body: 'mf' }]]])
    assert.equal(view.itemSupportsMotion(yes), false)
    assert.equal(view.itemSupportsMotion(no), true)
    no.sheets.set('walk', [{ mask: 1, body: 'm' }, { mask: 0, body: 'f' }])
    assert.equal(view.itemSupportsMotion(no), false)
    assert.throws(() => view.itemSupportsMotion({ ...yes, sheets: undefined }), /metadata/i)
})

for (const mounted of [false, true]) test(`support refresh ${mounted ? 'updates mounted cells without rebuilding' : 'mounts first ready picker'}`, async () => {
    const view = fixture(async () => [row('body/a'), row('body/b', 0)])
    inventory(view)
    view.selectedSlot = 'body'
    view.pickerSlot = mounted ? 'body' : null
    view.search = 'retained search'
    const updates = []
    view.updateMotionCells = () => updates.push('cells')
    view.updateInventoryStatus = () => updates.push('status')
    view.updatePicker = () => updates.push('picker')
    view.updatePreview = () => assert.fail('support refresh must not recompose')
    view.render = () => assert.fail('support refresh must not rebuild View')
    await view.refreshInventorySupport()
    assert.deepEqual(updates, mounted ? ['cells', 'status'] : ['picker'])
    assert.equal(view.search, 'retained search')
})

for (const supersession of ['slot', 'animation', 'body', 'generation', 'disconnect']) {
    for (const fails of [false, true]) test(`support refresh suppresses ${supersession}-stale ${fails ? 'failure' : 'UI'}`, async () => {
        const gate = deferred(), updates = []
        const view = fixture(() => gate.promise)
        inventory(view)
        view.selectedSlot = 'body'
        view.pickerSlot = 'body'
        for (const method of ['updateMotionCells', 'updateInventoryStatus', 'updatePicker', 'reportCatalogFailure', 'updatePreview'])
            view[method] = () => updates.push(method)
        const pending = view.refreshInventorySupport()
        // ensureInventory is cached but asynchronous; let support SQL start.
        await new Promise(resolve => setImmediate(resolve))
        if (supersession === 'slot') view.selectedSlot = 'hair'
        else if (supersession === 'animation') view.selectedAnimation = 'idle'
        else if (supersession === 'body') view.body = 'f'
        else if (supersession === 'generation') view.iconScheduler.invalidate(true)
        else view.isConnected = false
        if (fails) gate.reject(Error('superseded support query'))
        else gate.resolve([row('body/a'), row('body/b', 0)])
        await pending
        assert.deepEqual(updates, [])
    })
}

test('cache initialization clears support successes, pending loads and failures', () => {
    const view = fixture(async () => [])
    for (const name of ['inventorySupport', 'inventorySupportLoads', 'inventorySupportErrors']) {
        assert.ok(view[name] instanceof Map)
        view[name].set('old', {})
    }
    view.initializeCatalogCaches()
    for (const name of ['inventorySupport', 'inventorySupportLoads', 'inventorySupportErrors']) assert.equal(view[name].size, 0)
})
