import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView } from './character-view-test.mjs'

const item = (id, category, name = id) => ({ id: `body/${id}`, name, slot: 'body', palette: 'skin', category })

function picker(t, inventory, search = '') {
    const previous = globalThis.document
    globalThis.document = { createElement(tag) { return { tag } } }
    t.after(() => { globalThis.document = previous })
    const body = {
        rows: [], contains() { return false }, replaceChildren() { this.rows = [] },
        insertRow() {
            const row = { cells: [], append(cell) { this.cells.push(cell) } }
            this.rows.push(row)
            return row
        },
    }
    const { ViewCharacter } = evaluateView()
    const view = Object.create(ViewCharacter.prototype)
    const controls = {
        '[data-element="choices"]': body,
        '[data-element="picker-title"]': {},
        '[data-field="search"]': {},
    }
    Object.assign(view, {
        selectedSlot: 'body', inventories: new Map([['body', inventory]]), search,
        shadowRoot: { activeElement: null }, required: selector => controls[selector],
        closeTip() {}, slotRecord() { return { name: 'Body' } },
        itemCell(slot, record) { assert.equal(slot, 'body'); return record === null ? 'remove' : record.id },
        inventoryGrid: { refresh(options) { assert.deepEqual(options, { focus: false }) } },
        demandIcons(group, target) { assert.equal(group, 'inventory'); assert.equal(target, body) },
        updateInventoryStatus() {},
    })
    view.updatePicker()
    return { view, body }
}

test('categories span all three columns, retain SQL order, and precede uncategorized items', t => {
    const { body } = picker(t, [
        item('a', null), item('b', 'Human'), item('c', 'Fantasy'), item('d', 'Human'),
        item('e', ''), item('f', 'Human'), item('g', 'Human'),
    ])
    assert.deepEqual(body.rows.map(row => row.cells), [
        ['remove'], [{ tag: 'th', colSpan: 3, textContent: 'Human' }],
        ['body/b', 'body/d', 'body/f'], ['body/g'],
        [{ tag: 'th', colSpan: 3, textContent: 'Fantasy' }], ['body/c'],
        ['body/a', 'body/e'],
    ])
})

test('search omits empty category headings and uses text content for catalog labels', t => {
    const category = '<img src=x onerror=alert(1)>'
    const { view, body } = picker(t, [item('a', 'Hidden', 'Other'), item('b', category, 'Match')], 'MATCH')
    assert.deepEqual(body.rows.map(row => row.cells), [
        ['remove'], [{ tag: 'th', colSpan: 3, textContent: category }], ['body/b'],
    ])
    view.search = 'no matches'
    view.updatePicker()
    assert.deepEqual(body.rows.map(row => row.cells), [['remove']])
})

test('uncategorized inventories still use three-column item rows without headings', t => {
    const { body } = picker(t, ['a', 'b', 'c', 'd'].map(id => item(id, null)))
    assert.deepEqual(body.rows.map(row => row.cells), [['remove'], ['body/a', 'body/b', 'body/c'], ['body/d']])
})

test('inventory metadata requires nullable text category without loading images', async () => {
    const { loadInventory } = evaluateView()
    for (const category of [null, '', 'Human']) {
        const rows = await loadInventory({ async queryObjects(query, columns, params) {
            assert.equal(query, 'SELECT id, name, slot, palette, category FROM items WHERE slot = ? ORDER BY id LIMIT 512')
            assert.deepEqual(columns, ['id', 'name', 'slot', 'palette', 'category'])
            assert.deepEqual(params, ['body'])
            return [item('a', category)]
        } }, 'body')
        assert.equal(rows[0].category, category)
        assert.equal(rows[0].sheets, null)
        assert.equal(Object.hasOwn(rows[0], 'icon'), false)
    }
    for (const category of [undefined, 42, [], {}]) {
        await assert.rejects(loadInventory({ async queryObjects() { return [item('a', category)] } }, 'body'), /invalid item category/)
    }
    await assert.rejects(loadInventory({ async queryObjects() { throw Error('no such column: category') } }, 'body'), /no such column: category/)
})
