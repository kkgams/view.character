// Integration regression for the actual View's approved shadow-DOM layout.
export async function checkCharacterLayout() {
    const assert = (condition, message) => { if (!condition) throw Error(message) }
    const view = document.querySelector('view-character')
    assert(view && view.items.size > 0 && view.items.size === view.fixture.items.length, 'LPC View must be loaded')
    const root = view.shadowRoot
    assert(root, 'Actual View must own its shadow DOM')
    await Promise.all(['Game Icons', 'Material Symbols Rounded'].map(family => document.fonts.load(`32px "${family}"`)))
    const before = {
        parts: { ...view.parts }, colors: { ...view.colors }, selectedSlot: view.selectedSlot, search: view.search,
        scale: view.scale, direction: view.direction, playing: view.playing,
    }
    const { sql } = await import('/util/sql.js')
    const probe = '__character_reload_test_' + crypto.randomUUID().replaceAll('-', '')
    await sql.exec(`CREATE TABLE "${probe}" (value TEXT)`)
    let checks = 0, metadataChanged = false
    const sizes = () => {
        assert(view.headerControls.length === 1, 'Header must have one slotted toolbar, not separately slotted groups')
        const toolbar = view.headerControls[0]
        assert(toolbar.parentElement === view.parentElement && toolbar.dataset.element === 'toolbar', 'Toolbar must be mounted in the Area')
        assert(view.parentElement.querySelectorAll(':scope > [slot="header-controls"]').length === 1, 'Reset must not leave duplicate toolbars')
        const groups = [...toolbar.querySelectorAll(':scope > [role="buttongroup"]')]
        assert(groups.length === 1 && !groups[0].hasAttribute('slot') && groups[0].dataset.element === 'tool-actions',
            'Only Randomize/Reset must be grouped')
        assert(groups[0].querySelectorAll(':scope > button').length === 2 && !groups[0].querySelector('select'),
            'Selects must not be inside the button group')
        const controls = [...toolbar.children]
        assert(controls.length === 4 && controls[0] === groups[0] && controls[1].dataset.field === 'direction' &&
            controls[2].dataset.field === 'scale' && controls[3].dataset.action === 'play',
            'Facing, Zoom and Play must be direct toolbar children after Randomize/Reset')
        const grids = [...root.querySelectorAll('table[role="grid"]')]
        assert(grids.length === 2, 'Exactly two actual selectable grids required')
        for (const grid of grids) {
            assert(grid.querySelector(':scope > colgroup'), 'Column sizing must be actual View markup')
            assert(grid.querySelectorAll('[tabindex="0"]').length === 1, 'One Tab stop per grid')
            for (const cell of grid.querySelectorAll('td[aria-selected]')) {
                const rect = cell.getBoundingClientRect()
                assert(Math.abs(rect.width - 64) < 0.1 && Math.abs(rect.height - 64) < 0.1,
                    `${cell.getAttribute('aria-label')}: expected 64×64, got ${rect.width}×${rect.height}`)
                assert(cell.getAttribute('aria-label'), 'Cell needs an accessible name')
                const icon = cell.querySelector(':scope > i')
                if (icon) {
                    const glyph = icon.getBoundingClientRect()
                    assert(getComputedStyle(icon).fontSize === '32px' && Math.abs(glyph.width - 32) < 0.1 && Math.abs(glyph.height - 32) < 0.1,
                        `${cell.getAttribute('aria-label')}: empty/remove icon must be 32×32`)
                    assert(Math.abs((glyph.left + glyph.right - rect.left - rect.right) / 2) < 0.1 &&
                        Math.abs((glyph.top + glyph.bottom - rect.top - rect.bottom) / 2) < 0.1,
                        `${cell.getAttribute('aria-label')}: empty/remove icon must be centered on both axes`)
                }
            }
        }
        const board = view.required('[data-element="equipment"]')
        assert([...board.querySelectorAll('td[data-slot]')].map(cell => cell.dataset.slot).join(',') === view.slots.map(slot => slot.id).join(','),
            'SQL slot order must be left/right pairs, then top to bottom')
        assert(!view.querySelector('table'), 'Cell layout must not live in light DOM')
        assert(!view.required('table[aria-label="Equipment"]').tHead, 'Preview header must stay removed')
        const inventory = view.required('table[aria-label="Available parts"]')
        assert(!inventory.tHead, 'Redundant inventory header must stay removed')
        assert(inventory.querySelectorAll(':scope > colgroup > col').length === 3, 'Inventory must declare three columns')
        const rows = [...inventory.tBodies[0].rows]
        const count = rows.reduce((sum, row) => sum + row.cells.length, 0)
        rows.forEach((row, index) => assert(row.cells.length === Math.min(3, count - index * 3), 'Inventory must pack three cells per row without stretching the final row'))
        assert(inventory.getBoundingClientRect().width <= inventory.parentElement.clientWidth + 0.1, 'Three-column inventory must fit the side panel')
        assert(view.required('table[aria-label="Part palettes"]').tHead, 'Palette header must remain')
        checks++
    }
    const settle = async () => {
        await Promise.all([...root.querySelectorAll('link[rel="stylesheet"]')].map(link => link.sheet ? Promise.resolve() : new Promise((resolve, reject) => {
            link.addEventListener('load', resolve, { once: true })
            link.addEventListener('error', () => reject(Error(`Stylesheet failed: ${link.href}`)), { once: true })
        })))
        await new Promise(resolve => setTimeout(resolve, 0))
    }
    try {
        sizes()
        for (const slot of Object.keys(view.parts)) {
            view.required(`td[data-slot="${slot}"]`).click()
            await settle()
            assert(view.selectedSlot === slot, `${slot}: slot selection must activate`)
            assert(root.activeElement.dataset.slot === slot, `${slot}: selection must restore shadow focus`)
            sizes()
            const remove = view.required('td[data-action="remove"]')
            const required = slot === 'body' || slot === 'head'
            const prior = view.parts[slot]
            remove.click()
            assert(view.parts[slot] === (required ? prior : null), `${slot}: disabled/removal guard failed`)
            sizes()
            view.required('td[data-item]').click()
            sizes()
        }
        const firstSlot = view.slots[0].id, belowSlot = view.slots[2].id
        view.required(`td[data-slot="${firstSlot}"]`).click()
        const key = (name) => root.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }))
        key('ArrowDown')
        assert(root.activeElement.dataset.slot === belowSlot && view.selectedSlot === firstSlot, 'Arrow focus must not activate')
        key('Enter')
        assert(view.selectedSlot === belowSlot && root.activeElement.dataset.slot === belowSlot, 'Keyboard activation must restore shadow focus')
        sizes()
        for (const scale of [1, 2, 3, 4]) {
            const select = view.required('[data-field="scale"]')
            select.value = String(scale)
            select.dispatchEvent(new Event('change', { bubbles: true }))
            sizes()
        }
        for (const direction of ['north', 'west', 'south', 'east']) {
            const select = view.required('[data-field="direction"]')
            select.value = direction
            select.dispatchEvent(new Event('change', { bubbles: true }))
            const clip = view.required('[data-element="character-preview"]').clip
            assert(view.direction === direction && clip.frames.length === 3, `${direction}: three actual idle frames required`)
            const first = clip.frames[0].pixels.data
            assert(clip.frames[2].pixels.data.some((channel, index) => channel !== first[index]), `${direction}: idle head motion must remain visible`)
            sizes()
        }
        const preview = view.required('[data-element="character-preview"]')
        assert(getComputedStyle(preview).overflow === 'auto' && preview.scrollHeight >= preview.clip.height,
            'Preview viewport must retain content without stretching slots')
        const paletteTable = view.required('table[aria-label="Part palettes"]')
        assert(paletteTable.tHead.rows[0].cells.length === 3 && paletteTable.tBodies[0].rows.length === Object.keys(view.colors).length,
            'Palette must have three columns and one row per color role')
        for (const select of root.querySelectorAll('[data-color]')) {
            const role = select.dataset.color
            const prior = { ...view.colors }
            select.value = [...select.options].find(option => option.value !== select.value).value
            select.dispatchEvent(new Event('change', { bubbles: true }))
            assert(view.colors[role] === select.value, `${role}: palette selection must update`)
            for (const other of Object.keys(prior).filter(key => key !== role)) {
                assert(view.colors[other] === prior[other], `${role}: must not change the ${other} palette`)
            }
            const category = role === 'skin' ? 'Skin' : [...view.items.values()].find(item => item.slot === role).ramp_category
            const ramp = view.fixture.palettes[category][select.value]
            const clip = view.required(`[data-palette="${role}"]`).clip
            assert(clip.width === ramp.length * 20 && clip.height === 16, `${role}: color ramp dimensions`)
            ramp.forEach((rgba, index) => {
                const offset = (8 * clip.width + index * 20 + 10) * 4
                assert(rgba.every((channel, i) => clip.frames[0].pixels.data[offset + i] === channel),
                    `${role}: displayed swatch ${index} must match the selected palette`)
            })
            sizes()
        }
        // Prove labels/icons/order are read from SQL, not duplicated JS constants.
        const sqlName = 'SQL hair <&>'
        const firstOrder = Number(await sql.value('SELECT min("order") FROM slots')) - 1
        metadataChanged = true
        await sql.exec('UPDATE slots SET name = ?, icon = ?, "order" = ? WHERE id = ?', [sqlName, 'beard', String(firstOrder), 'hair'])
        await view.loadSlots()
        view.resetState()
        view.parts.hair = null
        view.render()
        assert(view.required('[data-element="equipment"]').querySelector('td[data-slot]').dataset.slot === 'hair', 'SQL order must control the first top-left slot')
        view.required('td[data-slot="hair"]').click()
        const hair = view.required('td[data-slot="hair"]')
        assert(hair.getAttribute('aria-label') === `${sqlName}: Empty` && hair.querySelector('i').textContent === 'beard', 'SQL name/icon must control empty previews')
        assert(view.required('[data-element="picker-title"]').textContent === sqlName, 'Picker title must use the SQL name')
        assert(view.required('[data-color="hair"]').closest('tr').cells[0].textContent === sqlName, 'SQL palette labels must render as text, not HTML')
        hair.dispatchEvent(new Event('pointerenter'))
        await settle()
        assert([...document.querySelectorAll('[data-element="tooltip-tip-text"]')].some(element => element.textContent === `${sqlName} · Empty`), 'Real tooltip service must receive the SQL slot name')
        view.closeTip()
        sizes()
        const lastOrder = Number(await sql.value('SELECT max("order") FROM slots')) + 1
        await sql.exec('INSERT INTO slots (id, name, icon, "order") VALUES (?, ?, ?, ?)', ['sql-test-slot', 'SQL extra slot', 'cloak', String(lastOrder)])
        await view.loadSlots()
        view.resetState()
        view.render()
        await settle()
        view.required('td[data-slot="sql-test-slot"]').click()
        const lastRow = [...view.required('[data-element="equipment"]').rows].at(-1)
        assert(view.parts['sql-test-slot'] === null && lastRow.cells.length === 1 && lastRow.cells[0].dataset.slot === 'sql-test-slot',
            'An odd extra SQL slot must render alone on the last left, with no invented right-hand slot')
        sizes()
        await sql.exec('DELETE FROM slots WHERE id = ?', ['neckwear'])
        await view.loadSlots()
        view.resetState()
        view.render()
        await settle()
        assert(!Object.hasOwn(view.parts, 'neckwear') && !view.required('[data-element="equipment"]').querySelector('td[data-slot="neckwear"]'),
            'A removed SQL slot must disappear instead of being restored from fixture defaults')
        sizes()
        assert(Number(await sql.value('SELECT count(*) FROM sqlite_schema WHERE name = ?', [probe])) === 1,
            'Ordinary selection/palette/zoom updates must not reset SQL')
        await view.reload()
        metadataChanged = false
        await settle()
        assert(Number(await sql.value('SELECT count(*) FROM sqlite_schema WHERE name = ?', [probe])) === 0,
            'View reload must clear the old development schema and replay the snapshot')
        sizes()
        return { passed: checks, slotSize: '64×64', shadowDOM: true, selectedSlots: Object.keys(view.parts).length, zoomLevels: 4, directions: 4, paletteRows: Object.keys(view.colors).length }
    } finally {
        if (metadataChanged) await view.reload()
        await sql.exec(`DROP TABLE IF EXISTS "${probe}"`)
        view.parts = before.parts
        view.colors = before.colors
        view.selectedSlot = before.selectedSlot
        view.search = before.search
        view.scale = before.scale
        view.direction = before.direction
        view.playing = before.playing
        view.render()
    }
}
