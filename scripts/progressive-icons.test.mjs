import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView, viewSource } from './character-view-test.mjs'

function scheduler(database, decode = async bytes => bytes[0]) {
    const source = viewSource.replace(/^import .*\n/gm, '').replace('export class ', 'class ')
    const { IconScheduler } = new Function('HTMLElement', 'customElements', source + '\nreturn { IconScheduler }')(class {}, { define() {} })
    const failures = []
    return { queue: new IconScheduler(database, decode, error => failures.push(error)), failures }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const item = i => ({ id: `slot/opaque-${i}` })
const rows = ids => ids.map(id => ({ id, icon: new Uint8Array([7]) }))
async function drain(queue) {
    while (queue.running || queue.scheduled) await tick()
}

test('item metadata omits icon BLOBs and parsing', () => {
    const load = viewSource.slice(viewSource.indexOf('async function loadCatalog('), viewSource.indexOf('// One pump per View:'))
    assert.match(load, /pagedMetadata\(sql, "items", \["id", "name", "slot", "palette"\], "slot", slot, isCurrent\)/)
    assert.doesNotMatch(load, /bytesOf\(row.icon\)/)
})

test('all accessible item cells mount synchronously as shared loading icons without eager promises or widgets', t => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
    globalThis.document = { createElement(tag) {
        return { tag, dataset: {}, attrs: {}, children: [],
            setAttribute(name, value) { this.attrs[name] = value },
            append(...children) { this.children.push(...children) },
            classList: { toggle() {}, add() {} },
        }
    } }
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, 'document', previous)
        else delete globalThis.document
    })
    const { ViewCharacter } = evaluateView()
    const view = Object.create(ViewCharacter.prototype)
    Object.assign(view, {
        parts: { slot: null }, selectedSlot: 'slot',
        slotRecord: () => ({ name: 'Slot', icon: 'armor' }),
        currentMotion: () => null, bindTip() {},
        colored() { assert.fail('cells must not eagerly request icons') },
    })
    const cells = Array.from({ length: 25 }, (_, i) => view.itemCell('slot', { ...item(i), name: `Item ${i}` }))
    assert.equal(cells.length, 25)
    for (const [index, cell] of cells.entries()) {
        assert.equal(cell.attrs['aria-label'], `Equip Item ${index}`)
        assert.equal(cell.attrs['aria-disabled'], 'false')
        assert.equal(cell.attrs.role, 'gridcell')
        assert.equal(cell.children.length, 1)
        assert.equal(cell.children[0].tag, 'i')
        assert.equal(cell.children[0].textContent, 'hourglass_empty')
    }
})

test('one pump prioritizes equipment, bounds batches to ten, publishes before yielding to next query', async () => {
    const events = [], calls = []
    let release, published
    const gate = new Promise(resolve => { release = resolve })
    const publication = new Promise(resolve => { published = resolve })
    let yielded = false
    const { queue } = scheduler({ async queryObjects(sql, columns, ids) {
        if (calls.length) assert.equal(yielded, true, 'next SQL must wait for a macrotask after publication')
        assert.match(sql, /^SELECT id, icon FROM items WHERE id IN \([?, ]+\) ORDER BY id$/)
        assert.deepEqual(columns, ['id', 'icon'])
        calls.push(ids); events.push('query'); return rows(ids)
    } }, async () => { await gate; return 7 })
    queue.setDemand('inventory', Array.from({ length: 23 }, (_, i) => ({ item: item(i), publish: () => events.push('publish') })))
    queue.setDemand('equipment', [{ item: item(99), publish() {
        events.push('equipment')
        setTimeout(() => { yielded = true }, 0)
        published()
    } }])
    await tick()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].length, 10)
    assert.equal(calls[0][0], item(99).id)
    release()
    await publication
    assert.equal(calls.length, 1, 'publication must precede the next batch')
    assert.equal(yielded, false)
    await drain(queue)
    assert.deepEqual(calls.map(ids => ids.length), [10, 10, 4])
    assert.ok(events.indexOf('equipment') < events.indexOf('query', 1))
    assert.equal(events.filter(event => event === 'publish').length, 23)
    const before = calls.length
    queue.setDemand('inventory', [{ item: item(0), publish: () => events.push('cached') }])
    await drain(queue)
    assert.equal(calls.length, before)
    assert.equal(events.at(-1), 'cached')
})

test('switch drops obsolete inventory needs without cancelling mounted equipment; in-flight results cache once', async () => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    const calls = [], seen = []
    const { queue } = scheduler({ async queryObjects(sql, columns, ids) { calls.push(ids); await gate; return rows(ids) } })
    queue.setDemand('equipment', [{ item: item(90), publish: () => seen.push('equipment') }])
    queue.setDemand('inventory', Array.from({ length: 20 }, (_, i) => ({ item: item(i), publish: () => seen.push('obsolete') })))
    await tick()
    queue.setDemand('inventory', [{ item: item(50), publish: () => seen.push('new') }])
    release(); await drain(queue)
    assert.deepEqual(seen, ['equipment', 'new'])
    assert.deepEqual(calls[1], [item(50).id])
    queue.setDemand('inventory', [{ item: item(0), publish: () => seen.push('cache') }])
    await drain(queue)
    assert.equal(calls.length, 2)
    assert.equal(seen.at(-1), 'cache')
})

for (const stage of ['sql', 'decode']) test(`obsolete inventory ${stage} failure does not stop the new inventory`, async () => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    const calls = [], seen = []
    const { queue, failures } = scheduler({ async queryObjects(sql, columns, ids) {
        calls.push(ids)
        if (calls.length === 1 && stage === 'sql') { await gate; throw Error('obsolete SQL failure') }
        return ids.map(id => ({id,icon:[id === item(0).id ? 1 : 2]}))
    } }, async bytes => {
        if (bytes[0] === 1 && stage === 'decode') { await gate; throw Error('obsolete decode failure') }
        return bytes[0]
    })
    queue.setDemand('inventory', [{item:item(0),publish() { assert.fail('obsolete cell published') }}])
    await tick()
    queue.setDemand('inventory', [{item:item(1),publish:canvas => seen.push(canvas)}])
    release()
    await drain(queue)
    assert.deepEqual(seen,[2])
    assert.equal(queue.failed,false)
    assert.equal(failures.length,0)
    assert.deepEqual(calls,[[item(0).id],[item(1).id]])
})

test('obsolete inventory decode failure does not discard a still-needed equipment image from the same batch', async () => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    const seen = [], calls = []
    const { queue, failures } = scheduler({ async queryObjects(sql, columns, ids) {
        calls.push(ids)
        return ids.map(id => ({id,icon:[id === item(0).id ? 1 : 2]}))
    } }, async bytes => {
        if (bytes[0] === 1) { await gate; throw Error('obsolete inventory image') }
        return bytes[0]
    })
    queue.setDemand('equipment',[{item:item(99),publish:canvas => seen.push(['equipment',canvas])}])
    queue.setDemand('inventory',[{item:item(0),publish() { assert.fail('obsolete image published') }}])
    await tick()
    queue.setDemand('inventory',[{item:item(1),publish:canvas => seen.push(['inventory',canvas])}])
    release()
    await drain(queue)
    assert.deepEqual(seen,[['equipment',2],['inventory',2]])
    assert.equal(failures.length,0)
    assert.equal(queue.cache.has(item(0).id),false)
    assert.deepEqual(calls,[[item(99).id,item(0).id],[item(1).id]])
})

for (const malformed of [[], [{ id: 'changed', icon: [1] }], [{ id: item(0).id, icon: [] }], [{ id: item(0).id, icon: [999] }]]) {
    test(`malformed icon response fails visibly: ${JSON.stringify(malformed)}`, async () => {
        const { queue, failures } = scheduler({ async queryObjects() { return malformed } })
        queue.setDemand('inventory', [{ item: item(0), publish() { assert.fail('invalid published') } }])
        await drain(queue)
        assert.equal(failures.length, 1)
        await assert.rejects(queue.request(item(1)))
    })
}

for (const stage of ['sql', 'decode']) for (const stopped of [false, true]) {
    test(`invalidation suppresses stale ${stage} responses (disconnected=${stopped})`, async () => {
        let release
        const gate = new Promise(resolve => { release = resolve })
        let calls = 0, published = 0
        const { queue, failures } = scheduler({ async queryObjects(sql, columns, ids) { calls++; if (stage === 'sql') await gate; return rows(ids) } }, async () => { if (stage === 'decode') await gate; return 1 })
        queue.setDemand('inventory', Array.from({ length: 20 }, (_, i) => ({ item: item(i), publish() { published++ } })))
        await tick()
        queue.invalidate(stopped)
        release(); await drain(queue)
        assert.equal(calls, 1)
        assert.equal(published, 0)
        assert.equal(queue.cache.size, 0)
        assert.equal(failures.length, 0)
    })
}

test('colored demand shares cached Promise and never performs concurrent icon SQL across reset', async () => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    let active = 0, peak = 0
    const { queue } = scheduler({ async queryObjects(sql, columns, ids) { active++; peak = Math.max(peak, active); await gate; active--; return rows(ids) } })
    const old = queue.request(item(0))
    assert.equal(queue.request(item(0)), old)
    const rejected = assert.rejects(old, /cancelled/)
    await tick()
    queue.invalidate(false)
    const fresh = queue.request(item(1))
    release(); await rejected
    assert.equal(await fresh, 7)
    await drain(queue)
    assert.equal(peak, 1)
    assert.equal(queue.request(item(1)), fresh)
})
