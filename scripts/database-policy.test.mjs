import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Evaluate only the canonical consumer. No Host, artwork, producer or database is needed.
const source = (await readFile(new URL('../src/views/view-character.js', import.meta.url), 'utf8'))
    .replace(/^import .*\n/gm, '').replace('export class ', 'class ')
function policy(database = {}) {
    return new Function('sql', 'HTMLElement', 'customElements', source +
        '\nreturn { animationSettings, selectAnimationPack, orderedComponents, loadCatalog, loadInventory, loadSpriteMetadata, loadPalettes }')(
        database, class {}, { define() {} })
}
const spriteColumns = ['id', 'item', 'animation', 'layer', 'mask', 'body', 'data']
const packQuery = count => `SELECT id, item, animation, layer, mask, body, data FROM sprites WHERE item = ? AND animation = ? AND body = ? AND id IN (${Array(count).fill('?').join(', ')}) ORDER BY id`
const item = { id: 'body/base' }
const state = { animation: 'walk', body: 'm' }
const withRows = rows => ({ ...item, sheets: new Map([['walk', rows]]) })
const sprite = (id, body, layer = 10, mask = 0) => ({
    id, item: 'body/base', animation: state.animation, layer, mask, body, data: [1, 2, 3],
})
function selectionDatabase(rows) {
    const calls = []
    return {
        calls,
        async queryObjects(...args) {
            calls.push(args)
            const first = rows.find(row => row.body.includes(state.body))
            const pack = rows.filter(row => row.body === first.body)
            assert.deepEqual(args, [packQuery(pack.length), spriteColumns, ['body/base', state.animation, first.body, ...pack.map(row => row.id)]])
            return pack
        },
    }
}

test('walk settings are local explicit 64×64 NESW geometry and nine 100ms frames', () => {
    const settings = policy().animationSettings('walk')
    for (const [key, expected] of Object.entries({ frame_width: 64, frame_height: 64,
        frame_count: 9, directions: 'NESW', sequence: Array.from({ length: 9 }, (_, i) => i),
        durations_ms: Array(9).fill(100) })) assert.deepEqual(settings[key], expected, key)
    for (const unknown of ['unknown', '', undefined, null]) {
        assert.throws(() => policy().animationSettings(unknown))
    }
})

test('climb and hurt explicitly use south-only geometry rather than invented NESW rows', () => {
    const { animationSettings } = policy()
    for (const animation of ['climb', 'hurt']) {
        const settings = animationSettings(animation)
        assert.equal(settings.directions, 'S')
        assert.equal(settings.frame_width, 64)
        assert.equal(settings.frame_height, 64)
        assert.equal(settings.frame_count, 6)
        assert.deepEqual(settings.sequence, [0, 1, 2, 3, 4, 5])
        assert.deepEqual(settings.durations_ms, Array(6).fill(100))
    }
})

test('pack query is parameterized and selects the first compatible body, not a preferred body', async () => {
    const rows = [sprite('01', 'f'), sprite('02', 'mf', 20), sprite('03', 'm', 10),
        sprite('04', 'mf', 999), sprite('05', 'mf', 120, 1)]
    const database = selectionDatabase(rows)
    const result = await policy().selectAnimationPack(withRows(rows), state, database)
    assert.deepEqual(result, [rows[1], rows[3], rows[4]], 'keep the whole exact body pack, including its masks')
    assert.equal(database.calls.length, 1)
    assert.deepEqual(rows.map(row => row.id), ['01', '02', '03', '04', '05'], 'do not reorder query results')
})

test('first compatible SQL row determines the pack even when a later body has more members', async () => {
    const rows = [sprite('01', 'm'), sprite('02', 'mf', 20), sprite('03', 'mf', 120)]
    assert.deepEqual(await policy().selectAnimationPack(withRows(rows), state, selectionDatabase(rows)), [rows[0]])
})

test('body pack identity is exact, not another includes match or a normalized body string', async () => {
    const rows = [sprite('01', 'fm'), sprite('02', 'mf', 20), sprite('03', 'fm', 120, 1)]
    assert.deepEqual(await policy().selectAnimationPack(withRows(rows), state, selectionDatabase(rows)), [rows[0], rows[2]])
})

test('selection uses injected SQL by default and returns [] for empty or incompatible results', async () => {
    for (const rows of [[], [sprite('01', 'ftclp')]]) {
        const database = selectionDatabase(rows)
        assert.deepEqual(await policy(database).selectAnimationPack(withRows(rows), state), [])
        assert.equal(database.calls.length, 0)
    }
})

test('missing item, animation, state and invalid body fail before querying', async () => {
    let queries = 0
    const database = { async queryObjects() { queries++; return [] } }
    const { selectAnimationPack } = policy(database)
    for (const invalidItem of [undefined, null, '', ' ', 0, {}, { id: '' }, { id: ' ' }, { id: 7 }]) {
        await assert.rejects(async () => selectAnimationPack(invalidItem, state))
    }
    for (const invalid of [undefined, null, {}, { body: 'm' }, { animation: '', body: 'm' },
        { animation: ' ', body: 'm' }, { animation: 7, body: 'm' }]) {
        await assert.rejects(async () => selectAnimationPack(item, invalid))
    }
    for (const body of [undefined, null, '', ' ', 'mf', 'M', 'x', 0, ['m']]) {
        await assert.rejects(async () => selectAnimationPack(item, { animation: state.animation, body }))
    }
    assert.equal(queries, 0, 'required state is validated before any SQL call')
})

test('each documented single body code is accepted', async () => {
    for (const body of 'mftclp') {
        const rows = [sprite('01', body)]
        const database = { async queryObjects(query, columns, parameters) {
            assert.equal(query, packQuery(1))
            assert.deepEqual(columns, spriteColumns)
            assert.deepEqual(parameters, ['body/base', state.animation, body, '01'])
            return rows
        } }
        assert.deepEqual(await policy().selectAnimationPack(withRows(rows), { ...state, body }, database), rows)
    }
})

const component = (item, layer, mask = 0) => ({ slot: 'body', item, layer, mask })
test('numeric drawing order accepts arbitrary positive safe layers without mutating input', () => {
    const components = [component('high', 999), component('low', 1), component('max', Number.MAX_SAFE_INTEGER)]
    const result = policy().orderedComponents(components, state.animation)
    assert.deepEqual(result.map(row => row.layer), [1, 999, Number.MAX_SAFE_INTEGER])
    assert.deepEqual(components.map(row => row.layer), [999, 1, Number.MAX_SAFE_INTEGER])
})

test('new numeric layers still reject invalid values and conflicting drawing occupancy', () => {
    const { orderedComponents } = policy()
    for (const layer of [undefined, null, 0, -1, 1.5, '999', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => orderedComponents([component('one', layer)], state.animation))
    }
    assert.throws(() => orderedComponents([component('one', 999), component('two', 999)], state.animation), /Layer 999 conflict/)
    assert.equal(orderedComponents([component('one', 999), component('two', 999, 1), component('three', 999, 1)], state.animation).length, 3)
    assert.throws(() => orderedComponents([component('one', 999, 2)], state.animation), /mask/)
})

function catalogRecords() {
    return {
        // Returned SQL order is authoritative; deliberately duplicate nonnumeric order values.
        slots: [{ id: 'body', name: 'Body', icon: 'person', order: 'external' },
            { id: 'hair', name: 'Hair', icon: 'person', order: 'external' }],
        animations: [{ id: 'walk', name: 'Walking' }],
        palettes: [{ id: 'skin', name: 'Skin', data: 'GIMP Palette\nName: Skin\n1 2 3 visible\n' }],
        // Not a PNG: loading metadata must not decode icons or sprite BLOBs.
        items: [{ id: 'body/base', name: 'Base', slot: 'body', palette: 'skin', icon: [7, 8, 9] }],
        sprites: [{ id: 'body/base/walk_999', item: 'body/base', animation: 'walk', layer: 999, mask: 0, body: 'mf' }],
    }
}
function catalogDatabase(records) {
    const calls = []
    return { calls, async queryObjects(query, columns, parameters = []) {
        const table = / FROM (\w+)/.exec(query)?.[1]
        assert.ok(Object.hasOwn(records, table), `unexpected query: ${query}`)
        const order = table === 'slots' ? '"order", id' : table === 'animations' ? 'name COLLATE NOCASE, id' : 'id'
        const filter = table === 'items' ? 'slot' : table === 'sprites' ? 'item' : null
        assert.equal(query, `SELECT ${columns.join(', ')} FROM ${table}${filter ? ` WHERE ${filter} = ?` : ''} ORDER BY ${order}${filter ? ' LIMIT 512' : ''}`)
        assert.deepEqual(parameters, filter ? [filter === 'slot' ? 'body' : 'body/base'] : [])
        if (table === 'slots') assert.deepEqual(columns, ['id', 'name', 'icon'], 'slot order belongs to SQL, not runtime validation')
        if (table === 'animations') assert.deepEqual(columns, ['id', 'name'])
        if (table === 'sprites') assert.deepEqual(columns, spriteColumns.slice(0, -1), 'availability needs metadata, never eager BLOBs')
        calls.push(table)
        return records[table].map(row => Object.fromEntries(columns.map(column => [column, structuredClone(row[column])])) )
    } }
}

test('catalog keeps SQL slot ordering and augments animation IDs without fetching images', async () => {
    const records = catalogRecords(), before = structuredClone(records), database = catalogDatabase(records)
    const { loadCatalog, animationSettings } = policy()
    const catalog = await loadCatalog(database)
    assert.deepEqual(catalog.slots.map(row => row.id), ['body', 'hair'])
    assert.deepEqual(catalog.animations, [{ ...records.animations[0], ...animationSettings('walk') }])
    assert.deepEqual(Object.keys(catalog).sort(), ['animations', 'slots'])
    assert.deepEqual(database.calls, ['slots', 'animations'])
    const { loadInventory, loadSpriteMetadata, loadPalettes } = policy()
    const [item] = await loadInventory(database, 'body')
    assert.equal(Object.hasOwn(item, 'icon'), false)
    assert.equal(item.sheets, null)
    const sheets = await loadSpriteMetadata(database, item, catalog.animations)
    assert.equal(sheets.get('walk').length, 1)
    assert.equal(sheets.get('walk')[0].body, 'mf')
    assert.equal(sheets.get('walk')[0].image, undefined)
    const palettes = await loadPalettes(database)
    assert.equal(palettes.get('skin').data, records.palettes[0].data)
    assert.deepEqual(palettes.get('skin').colors, [[0, 0, 0, 0], [1, 2, 3, 255]])
    assert.deepEqual(database.calls, ['slots', 'animations', 'items', 'sprites', 'palettes'])
    assert.deepEqual(records, before, 'loading must not rewrite database records')
})

test('catalog rejects unknown animation IDs rather than trusting database geometry', async () => {
    const records = catalogRecords()
    records.animations = [{ id: 'unknown64x64', name: 'Unknown', frame_width: 64, frame_height: 64,
        frame_count: 9, directions: 'NESW', sequence: '[0]', durations_ms: '[100]' }]
    await assert.rejects(policy().loadCatalog(catalogDatabase(records)))
})
