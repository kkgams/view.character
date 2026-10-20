import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView } from './character-view-test.mjs'

// Exercise the canonical consumer with synthetic SQL records only: no database,
// artwork, producer checkout, Host modules or schema builder is needed.
const { selectAnimationPack, loadCatalog } = evaluateView()
const metadataColumns = ['id', 'item', 'animation', 'layer', 'mask', 'body']
const blobColumns = [...metadataColumns, 'data']
const state = { animation: 'walk', body: 'm' }
const metadata = (id, body = 'mf', layer = 999, mask = 0) => ({
    id, item: 'body/base', animation: 'walk', layer, mask, body,
})
const selectedItem = rows => ({ id: 'body/base', sheets: new Map([['walk', rows]]) })
const withData = row => ({ ...row, data: [7, 8, 9] })

function packDatabase(rows, transform = result => result) {
    const calls = []
    return { calls, async queryObjects(query, columns, parameters) {
        assert.deepEqual(columns, blobColumns)
        assert.ok(Array.isArray(parameters))
        const ids = parameters.slice(3)
        assert.ok(ids.length > 0 && ids.length <= 256, 'BLOB requests contain 1–256 explicit IDs')
        assert.equal(query.replace(/,\s*/g, ', '), 'SELECT id, item, animation, layer, mask, body, data FROM sprites ' +
            'WHERE item = ? AND animation = ? AND body = ? AND id IN (' + ids.map(() => '?').join(', ') + ') ORDER BY id',
        'never scan every BLOB for an item/animation or infer a sprite ID prefix')
        assert.deepEqual(parameters.slice(0, 3), ['body/base', 'walk', 'mf'])
        calls.push({ query, columns, parameters: [...parameters] })
        const matches = rows.filter(row => row.item === parameters[0] && row.animation === parameters[1] &&
            row.body === parameters[2] && ids.includes(row.id))
        return transform(matches.map(withData))
    } }
}

test('pack BLOB query fetches only opaque IDs belonging to the first compatible exact metadata body', async () => {
    // IDs intentionally lie about both body and animation: only metadata has meaning.
    const rows = [metadata('00/unrelated.m', 'f'), metadata('01/not-walk.f'),
        metadata('02/tempting.m', 'm'), metadata('03/no-suffix', 'mf', 120, 1),
        metadata('04/another.mf', 'fm'), metadata('05/anything.f', 'mf', 10)]
    const database = packDatabase(rows)
    const result = await selectAnimationPack(selectedItem(rows), state, database)
    const expected = [rows[1], rows[3], rows[5]]
    assert.deepEqual(result, expected.map(withData))
    assert.deepEqual(database.calls.map(call => call.parameters), [
        ['body/base', 'walk', 'mf', ...expected.map(row => row.id)],
    ])
})

test('absent animation metadata or no compatible metadata returns [] without SQL', async () => {
    let queries = 0
    const database = { async queryObjects() { queries++; throw new Error('unexpected BLOB fetch') } }
    for (const item of [
        { id: 'body/base', sheets: new Map() },
        selectedItem([]),
        selectedItem([metadata('opaque', 'ftclp')]),
        { id: 'body/base', sheets: new Map([['idle', [metadata('other-animation')]]]) },
    ]) assert.deepEqual(await selectAnimationPack(item, state, database), [])
    assert.equal(queries, 0)
})

test('pack selection requires a sheets Map instead of falling back to an unbounded SQL scan', async () => {
    let queries = 0
    const database = { async queryObjects() { queries++; return [] } }
    for (const sheets of [undefined, null, {}, []]) {
        await assert.rejects(async () => selectAnimationPack({ id: 'body/base', sheets }, state, database))
    }
    assert.equal(queries, 0)
})

test('large exact-body packs use 256-ID chunks and retain SQL ID order across chunks', async () => {
    const rows = Array.from({ length: 600 }, (_, index) => metadata(`opaque/${String(index).padStart(4, '0')}.f`))
    // Other compatible bodies and incompatible rows must never enter the BLOB requests.
    const all = rows.flatMap((row, index) => [row, metadata(`opaque/${String(index).padStart(4, '0')}.m`, 'm')])
    const database = packDatabase(all)
    assert.deepEqual(await selectAnimationPack(selectedItem(all), state, database), rows.map(withData))
    assert.deepEqual(database.calls.map(call => call.parameters.length - 3), [256, 256, 88])
    assert.deepEqual(database.calls.flatMap(call => call.parameters.slice(3)), rows.map(row => row.id))
})

for (const [label, transform] of [
    ['missing row', rows => rows.slice(1)],
    ['unexpected ID with unchanged count', rows => [{ ...rows[0], id: 'unselected/opaque' }, ...rows.slice(1)]],
    ['duplicate ID with unchanged count', rows => [rows[0], rows[0]]],
    ['extra row', rows => [...rows, { ...rows[0], id: 'unexpected/extra' }]],
]) test(`changed selected pack fails visibly: ${label}`, async () => {
    const rows = [metadata('opaque-one'), metadata('opaque-two', 'mf', 120, 1)]
    const database = packDatabase(rows, transform)
    await assert.rejects(selectAnimationPack(selectedItem(rows), state, database),
        /selected sprite pack changed; reload catalog/)
    assert.equal(database.calls.length, 1)
})

function catalogRecords(itemCount = 1, spriteCount = 1025) {
    const items = Array.from({ length: itemCount }, (_, index) => ({
        id: index === 0 ? 'body/base' : `body/item-${String(index).padStart(4, '0')}`,
        name: `Item ${index}`, slot: 'body', palette: 'skin', icon: [7, 8, 9],
    }))
    return {
        slots: [{ id: 'body', name: 'Body', icon: 'person' }],
        animations: [{ id: 'walk', name: 'Walking' }],
        palettes: [{ id: 'skin', name: 'Skin', data: 'GIMP Palette\nName: Skin\n1 2 3 visible\n' }],
        items,
        sprites: Array.from({ length: spriteCount }, (_, index) =>
            metadata(`opaque/${String(index * 3 + 11).padStart(6, '0')}.f`)),
    }
}

const catalogColumns = {
    slots: ['id', 'name', 'icon'],
    animations: ['id', 'name'],
    palettes: ['id', 'name', 'data'],
    items: ['id', 'name', 'slot', 'icon', 'palette'],
    sprites: metadataColumns,
}
function pagedDatabase(records) {
    const calls = []
    return { calls, async queryObjects(query, columns, parameters = []) {
        const table = / FROM (\w+)/.exec(query)?.[1]
        assert.ok(Object.hasOwn(records, table), `unexpected SQL: ${query}`)
        assert.deepEqual(columns, catalogColumns[table], `${table}: exact consumer columns`)
        const select = `SELECT ${columns.join(', ')} FROM ${table}`
        const previous = calls.filter(call => call.table === table)
        if (table === 'items' || table === 'sprites') {
            assert.equal(columns.includes('data'), false, 'metadata paging must not fetch sprite BLOBs')
            assert.equal(query, `${select}${previous.length ? ' WHERE id > ?' : ''} ORDER BY id LIMIT 512`)
            assert.deepEqual(parameters, previous.length ? [previous.at(-1).rows.at(-1).id] : [],
                'each keyset cursor is the last SQL ID actually returned by the previous page')
        } else {
            assert.equal(query, `${select} ORDER BY ${table === 'slots' ? '"order", id' : table === 'animations' ? 'name COLLATE NOCASE, id' : 'id'}`)
            assert.deepEqual(parameters, [])
            assert.equal(previous.length, 0, 'small tables retain their original single SELECT')
        }
        const rows = (table === 'items' || table === 'sprites')
            ? records[table].filter(row => !parameters.length || row.id > parameters[0]).slice(0, 512)
            : records[table]
        calls.push({ table, query, parameters: [...parameters], rows })
        return structuredClone(rows)
    } }
}

for (const itemCount of [1, 1025]) test(`catalog keyset-pages metadata with ${itemCount} items and 1025 sprites`, async () => {
    const records = catalogRecords(itemCount), before = structuredClone(records)
    const database = pagedDatabase(records)
    const catalog = await loadCatalog(database)
    assert.deepEqual([...catalog.items.keys()], records.items.map(row => row.id), 'keep SQL item order')
    const sheets = catalog.items.get('body/base').sheets.get('walk')
    assert.deepEqual(sheets.map(row => row.id), records.sprites.map(row => row.id), 'keep SQL metadata order across all pages')
    assert.ok(sheets.every(row => !Object.hasOwn(row, 'data') && !Object.hasOwn(row, 'image')))
    const spriteCalls = database.calls.filter(call => call.table === 'sprites')
    assert.deepEqual(spriteCalls.slice(0, 3).map(call => call.rows.length), [512, 512, 1])
    assert.deepEqual(spriteCalls.slice(0, 3).map(call => call.parameters), [[], [records.sprites[511].id], [records.sprites[1023].id]])
    const itemCalls = database.calls.filter(call => call.table === 'items')
    assert.deepEqual(itemCalls.slice(0, itemCount === 1 ? 1 : 3).map(call => call.rows.length), itemCount === 1 ? [1] : [512, 512, 1])
    assert.deepEqual(records, before, 'catalog loading never rewrites source records')
})
