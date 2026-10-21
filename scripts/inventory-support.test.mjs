import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { evaluateView } from './character-view-test.mjs'

const state = { animation: 'walk', body: 'm' }
const supportSQL = count => {
    const marks = Array(count).fill('?').join(', ')
    return `SELECT i.id, support.item IS NOT NULL AS supported FROM items i LEFT JOIN (SELECT DISTINCT item FROM sprites WHERE animation = ? AND mask = 0 AND instr(body, ?) > 0 AND item IN (${marks})) support ON support.item = i.id WHERE i.slot = ? AND i.id IN (${marks}) ORDER BY i.id`
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const requested = params => params.slice(2, 2 + (params.length - 3) / 2)
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
    view.inventorySupportQueue = Promise.resolve()
    view.inventorySupportRequest = 0
    view.iconScheduler.setDemand('inventory', [])
    view.yieldRender = async () => {}
    view.updateInventoryStatus = () => {}
    view.updateMotionCells = () => {}
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
    } }, 'body', state, ['body/a', 'body/z'])
    assert.deepEqual(calls, [[supportSQL(2), ['id', 'supported'], ['walk', 'm', 'body/a', 'body/z', 'body', 'body/a', 'body/z']]])
    assert.deepEqual([...flags], [['body/z', false], ['body/a', true]])
})

for (const count of [1, 10]) test(`support binds exactly ${count} IDs without paging or full sprite metadata`, async () => {
    const ids = Array.from({ length: count }, (_, n) => `opaque-${n}`), calls = []
    const { loadInventorySupport } = evaluateView()
    const flags = await loadInventorySupport({ async queryObjects(...args) { calls.push(args); return ids.map(id => row(id)) } }, 'body', state, ids)
    assert.equal(flags.size, count)
    assert.deepEqual(calls, [[supportSQL(count), ['id', 'supported'], ['walk', 'm', ...ids, 'body', ...ids]]])
    assert.doesNotMatch(calls[0][0], /LIMIT|OFFSET|SELECT \*|\b(image|icon|palette)\b/i)
})

for (const ids of [[], Array.from({ length: 11 }, (_, n) => `id-${n}`), ['same', 'same'], [''], ['  '], [1], [null]]) test(`invalid requested IDs ${JSON.stringify(ids)} fail before SQL`, async () => {
    const { loadInventorySupport } = evaluateView()
    let calls = 0
    await assert.rejects(loadInventorySupport({ async queryObjects() { calls++; return [] } }, 'body', state, ids))
    assert.equal(calls, 0)
})

for (const [label, rows] of [
    ['non-array rows', null], ['blank ID', [row('')]], ['whitespace ID', [row('  ')]],
    ['non-string ID', [row(1)]], ['duplicate ID', [row('body/a'), row('body/a')]],
    ['missing ID', []], ['extra ID', [row('body/a'), row('extra')]], ['changed ID', [row('changed')]], ['null row', [null]],
    ...[true, false, null, undefined, '1', -1, 2].map(flag => [`flag ${String(flag)}`, [{ id: 'body/a', supported: flag }]]),
]) test(`support rejects ${label}`, async () => {
    const { loadInventorySupport } = evaluateView()
    await assert.rejects(loadInventorySupport({ async queryObjects() { return rows } }, 'body', state, ['body/a']))
})

test('support cancellation skips SQL before demand and ignores stale malformed results', async () => {
    const { loadInventorySupport } = evaluateView()
    let current = false, calls = 0
    const gate = deferred()
    const sql = { queryObjects() { calls++; return gate.promise } }
    assert.equal(await loadInventorySupport(sql, 'body', state, ['body/a'], () => current), null)
    assert.equal(calls, 0)
    current = true
    const pending = loadInventorySupport(sql, 'body', state, ['body/a'], () => current)
    current = false
    gate.resolve(null)
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
    } }, 'body', state, ['absent', 'drawing', 'mask-only', 'other-animation', 'other-body'])
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
    await tick()
    assert.equal(calls.length, 1)
    gate.resolve([row('body/a'), row('body/b', 0)])
    assert.deepEqual(await Promise.all([first, second]), [true, true])
    const key = view.supportKey('body', 'walk', 'm')
    assert.deepEqual([...view.inventorySupport.get(key)], [['body/a', true], ['body/b', false]])
    assert.equal(view.inventorySupportComplete.has(key), true)
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
    ['replaced ID', [row('body/a'), row('body/c')]],
]) test(`support ${label} fails exact inventory matching without partial publication`, async () => {
    let calls = 0
    const view = fixture(async () => { calls++; return rows })
    inventory(view)
    await assert.rejects(view.ensureInventorySupport('body', state))
    const key = view.supportKey('body')
    assert.equal(view.inventorySupport.get(key)?.size ?? 0, 0)
    assert.equal(view.inventorySupportComplete.has(key), false)
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
        await tick()
        if (cancellation === 'generation') {
            view.iconScheduler.invalidate(true)
            view.initializeCatalogCaches()
        } else view.isConnected = false
        if (fails) gate.reject(Error('obsolete support SQL'))
        else gate.resolve(Array.from({ length: 512 }, (_, n) => row(`body/${n}`)))
        assert.equal(await pending, false)
        assert.equal([...view.inventorySupport.values()].reduce((n, flags) => n + flags.size, 0), 0)
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
    assert.equal(view.inventorySupportComplete.size, 0)
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
    if (mounted) {
        assert.ok(updates.includes('cells'))
        assert.ok(updates.includes('status'))
        assert.equal(updates.includes('picker'), false)
    } else assert.ok(updates.includes('picker'))
    assert.equal(view.search, 'retained search')
})

for (const supersession of ['slot', 'animation', 'body', 'generation', 'disconnect']) {
    for (const fails of [false, true]) test(`support refresh suppresses ${supersession}-stale ${fails ? 'failure' : 'UI'}`, async () => {
        const gate = deferred(), updates = [], ids = Array.from({ length: 23 }, (_, n) => `body/${n}`)
        let calls = 0
        const view = fixture(() => { calls++; return gate.promise })
        inventory(view, 'body', ids)
        view.selectedSlot = 'body'
        view.pickerSlot = 'body'
        for (const method of ['updateMotionCells', 'updateInventoryStatus', 'updatePicker', 'reportCatalogFailure', 'updatePreview'])
            view[method] = () => updates.push(method)
        const pending = view.refreshInventorySupport()
        // ensureInventory is cached but asynchronous; let support SQL start.
        await tick()
        updates.length = 0
        if (supersession === 'slot') view.selectedSlot = 'hair'
        else if (supersession === 'animation') view.selectedAnimation = 'idle'
        else if (supersession === 'body') view.body = 'f'
        else if (supersession === 'generation') view.iconScheduler.invalidate(true)
        else view.isConnected = false
        if (fails) gate.reject(Error('superseded support query'))
        else gate.resolve(ids.slice(0, 10).map(id => row(id)))
        await pending
        assert.deepEqual(updates, [])
        assert.equal(calls, 1, 'stale refresh must not request another batch')
        assert.equal(view.inventorySupportComplete.size, 0)
        assert.equal(view.inventorySupportErrors.size, 0)
        assert.equal([...view.inventorySupport.values()].reduce((n, flags) => n + flags.size, 0), 0)
    })
}

test('each support batch waits for icons and paint, publishes flags, then yields before the next query', async () => {
    const ids = Array.from({ length: 23 }, (_, n) => `body/${n}`), calls = [], gate = deferred()
    let ready = 0, paints = 0, yields = 0, cells = 0
    const view = fixture(async (query, columns, params) => {
        const batch = requested(params)
        assert.equal(ready, calls.length + 1)
        assert.equal(paints, calls.length + 1)
        if (calls.length) {
            assert.ok(yields >= calls.length)
            assert.ok(cells >= calls.length)
            assert.equal(view.inventorySupport.get(view.supportKey('body')).size, calls.flat().length)
            assert.equal(view.itemSupportsMotion(view.items.get(ids[0])), false)
            assert.equal(view.itemSupportsMotion(view.items.get(batch[0])), null)
            assert.equal(view.inventorySupportComplete.has(view.supportKey('body')), false)
        }
        assert.equal(query, supportSQL(batch.length))
        assert.deepEqual(columns, ['id', 'supported'])
        assert.deepEqual(params, ['walk', 'm', ...batch, 'body', ...batch])
        calls.push(batch)
        return batch.map(id => row(id, 0))
    })
    inventory(view, 'body', ids)
    view.selectedSlot = view.pickerSlot = 'body'
    view.iconScheduler.whenGroupReady = async group => { assert.equal(group, 'inventory'); ready++; if (ready === 1) await gate.promise; return true }
    view.yieldRender = async paint => { if (paint) paints++; else yields++ }
    view.updateMotionCells = () => { cells++ }
    const pending = view.ensureInventorySupport('body', state)
    await tick()
    assert.equal(calls.length, 0)
    assert.equal(paints, 0)
    gate.resolve()
    assert.equal(await pending, true)
    assert.deepEqual(calls, [ids.slice(0, 10), ids.slice(10, 20), ids.slice(20)])
    assert.equal(view.inventorySupportComplete.has(view.supportKey('body')), true)
})

test('cancelled partial load resumes only missing IDs without poisoning the job cache', async () => {
    const ids = Array.from({ length: 23 }, (_, n) => `body/${n}`), calls = []
    let current = true
    const view = fixture(async (query, columns, params) => { const batch = requested(params); calls.push(batch); return batch.map(id => row(id)) })
    inventory(view, 'body', ids)
    view.yieldRender = async paint => { if (!paint) current = false }
    assert.equal(await view.ensureInventorySupport('body', state, () => current), false)
    const key = view.supportKey('body')
    assert.deepEqual(calls, [ids.slice(0, 10)])
    assert.equal(view.inventorySupport.get(key).size, 10)
    assert.equal(view.inventorySupportComplete.has(key), false)
    assert.equal(view.inventorySupportErrors.size, 0)
    current = true
    view.yieldRender = async () => {}
    assert.equal(await view.ensureInventorySupport('body', state, () => current), true)
    assert.deepEqual(calls, [ids.slice(0, 10), ids.slice(10, 20), ids.slice(20)])
    assert.equal(view.inventorySupportComplete.has(key), true)
})

test('missing partial flags stay pending; only completed keys require every item ID', () => {
    const view = fixture(async () => [])
    const [yes, pending] = inventory(view), key = view.supportKey('body')
    view.inventorySupport.set(key, new Map([[yes.id, true]]))
    assert.equal(view.itemSupportsMotion(yes), true)
    assert.equal(view.itemSupportsMotion(pending), null)
    view.inventorySupportComplete.add(key)
    assert.throws(() => view.itemSupportsMotion(pending), /support/i)
})

test('empty inventory completes without support SQL', async () => {
    const view = fixture(async () => assert.fail('empty inventory needs no SQL'))
    inventory(view, 'body', [])
    assert.equal(await view.ensureInventorySupport('body', state), true)
    assert.equal(view.inventorySupport.get(view.supportKey('body')).size, 0)
    assert.equal(view.inventorySupportComplete.has(view.supportKey('body')), true)
})

test('real icon scheduler readiness waits for decode and publication, and invalidation cancels waiters', async () => {
    const gate = deferred(), started = deferred(), published = []
    const view = fixture(async (query, columns, ids) => { started.resolve(); return ids.map(id => ({ id, icon: [7] })) })
    const [item] = inventory(view)
    view.iconScheduler.decode = async () => { await gate.promise; return 7 }
    view.iconScheduler.setDemand('inventory', [{ item, publish: image => published.push(image) }])
    assert.equal(view.iconScheduler.isGroupReady('inventory'), false)
    let resolved = false
    const pending = view.iconScheduler.whenGroupReady('inventory').then(value => { resolved = true; return value })
    await started.promise
    await tick()
    assert.equal(resolved, false)
    gate.resolve()
    assert.equal(await pending, true)
    assert.equal(published.length, 1)
    assert.equal(view.iconScheduler.isGroupReady('inventory'), true)
    view.iconScheduler.setDemand('inventory', [{ item: { id: 'uncached' }, publish() {} }])
    const cancelled = view.iconScheduler.whenGroupReady('inventory')
    view.iconScheduler.invalidate(true)
    assert.equal(await cancelled, false)
})

test('cache initialization clears support successes, pending loads and failures', () => {
    const view = fixture(async () => [])
    for (const name of ['inventorySupport', 'inventorySupportLoads', 'inventorySupportErrors']) {
        assert.ok(view[name] instanceof Map)
        view[name].set('old', {})
    }
    assert.ok(view.inventorySupportComplete instanceof Set)
    view.inventorySupportComplete.add('old')
    view.initializeCatalogCaches()
    for (const name of ['inventorySupport', 'inventorySupportLoads', 'inventorySupportErrors', 'inventorySupportComplete']) assert.equal(view[name].size, 0)
})
