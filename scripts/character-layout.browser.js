// Integration regression for the actual database-backed View and approved layout.
export async function checkCharacterLayout() {
    const assert = (condition, message) => { if (!condition) throw Error(message) }
    const view = document.querySelector('view-character')
    assert(view && view.items.size > 0, 'Database catalog must be loaded')
    const root = view.shadowRoot
    assert(root, 'Actual View must own its shadow DOM')
    await Promise.all(['Game Icons', 'Material Symbols Rounded'].map(family => document.fonts.load(`32px "${family}"`)))
    const before = Object.fromEntries(['selectedSlot', 'search', 'scale', 'direction', 'playing', 'selectedAnimation'].map(key => [key, view[key]]))
    before.parts = { ...view.parts }; before.colors = { ...view.colors }
    const { sql } = await import('/util/sql.js')
    const probe = 'character_reload_test_' + crypto.randomUUID().replaceAll('-', '')
    let checks = 0, transactionOpen = false
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
        assert(controls.length === 3 && controls[0] === groups[0] && controls[1].dataset.field === 'direction' &&
            controls[2].dataset.field === 'scale' && !toolbar.querySelector('[data-action="play"]'),
            'Only Facing and Zoom must follow Randomize/Reset in the header')
        const animationSelect = view.required('[data-field="animation"]'), play = view.required('[data-action="play"]')
        assert(animationSelect.closest('aside') && play.parentElement === animationSelect.parentElement && !animationSelect.closest('table'),
            'Animation selector and Play must share a plain control row, without a table')
        const selectBounds = animationSelect.getBoundingClientRect(), playBounds = play.getBoundingClientRect()
        assert(playBounds.left >= selectBounds.right && playBounds.top < selectBounds.bottom && playBounds.bottom > selectBounds.top,
            'Animation selector and Play must remain side by side')
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
        await sql.exec('BEGIN')
        transactionOpen = true
        sizes()
        const animationSelect = () => view.required('[data-field="animation"]')
        const records = await sql.queryObjects('SELECT id, name FROM animations ORDER BY name COLLATE NOCASE, id', ['id', 'name'])
        assert(JSON.stringify([...animationSelect().options].filter(option => option.value.startsWith('animation:')).map(option => ({ id: option.value.slice(10), name: option.textContent }))) === JSON.stringify(records),
            'Animation options must match database IDs/names in query order')
        assert(!animationSelect().querySelector('optgroup[label="Poses"]'), 'No fixture pose options allowed')
        checks++
        // New records include all required geometry/playback fields; no schema fallback.
        await sql.exec('INSERT INTO animations (id,name,frame_width,frame_height,frame_count,directions,sequence,durations_ms) VALUES (?,?,?,?,?,?,?,?)',
            [probe, 'SQL <&>', '64', '64', '8', 'NESW', '[0,1,2,3,4,5,6,7]', '[100,110,120,130,140,150,160,170]'])
        await view.reload(); await settle()
        const option = [...animationSelect().options].find(option => option.value === 'animation:' + probe)
        assert(option && option.textContent === 'SQL <&>', 'Reload must display SQL names as literal text')
        animationSelect().value = 'animation:' + probe
        animationSelect().dispatchEvent(new Event('change', { bubbles: true }))
        assert(view.currentMotion().frame_count === 8 && view.required('[data-action="play"]').disabled,
            'Unconnected SQL animation metadata must load without substituting Walk')
        view.required('[data-action="play"]').dispatchEvent(new Event('click'))
        assert(!view.playing, 'Unavailable synthetic playback must be guarded')
        const equipped = Object.values(view.parts).find(id => id !== null)
        const unsupported = view.item(equipped)
        view.required(`td[data-slot="${unsupported.slot}"]`).click()
        for (const cell of [view.required(`td[data-slot="${unsupported.slot}"]`), view.required(`td[data-item="${equipped}"]`)]) {
            assert(cell.classList.contains('danger') && cell.getAttribute('aria-disabled') === 'false', 'Unsupported items remain interactive with theme danger intent')
            assert(cell.getAttribute('aria-label').includes('No source frames'), 'Missing source coverage needs accessible explanation')
        }
        assert(view.motionAvailability().missing.includes(unsupported.name), 'Unavailable motion must identify missing item names')
        checks++
        await view.reload(); await settle()
        for (const { id: slot } of view.slots) {
            view.required(`td[data-slot="${slot}"]`).click()
            await settle()
            assert(view.selectedSlot === slot && root.activeElement.dataset.slot === slot, `${slot}: selection must restore focus`)
            sizes()
            const remove = view.required('td[data-action="remove"]')
            assert(remove.getAttribute('aria-disabled') === 'false', `${slot}: every slot may be unequipped`)
            remove.click()
            assert(view.parts[slot] === null, `${slot}: removal failed`)
            const inventory = [...view.items.values()].filter(item => item.slot === slot)
            if (inventory.length) {
                view.required('td[data-item]').click()
                assert(view.parts[slot] !== null, `${slot}: item must equip`)
            } else {
                assert(root.querySelectorAll('td[data-item]').length === 0, `${slot}: empty inventory must not invent items`)
                assert(view.required('[data-element="empty"]').textContent, `${slot}: empty inventory needs a message`)
            }
            sizes()
        }
        const firstSlot = view.slots[0].id, belowSlot = view.slots[2].id
        view.required(`td[data-slot="${firstSlot}"]`).click()
        const key = name => root.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }))
        key('ArrowDown')
        assert(root.activeElement.dataset.slot === belowSlot && view.selectedSlot === firstSlot, 'Arrow focus must not activate')
        key('Enter')
        assert(view.selectedSlot === belowSlot && root.activeElement.dataset.slot === belowSlot, 'Keyboard activation must retain focus')
        key('Home')
        checks++
        const body = [...view.items.values()].find(item => item.slot === 'body')
        assert(body, 'Prepared body-only sample required')
        view.required('td[data-slot="body"]').click()
        const search = view.required('[data-field="search"]')
        search.value = '__no_catalog_match__'; search.dispatchEvent(new Event('input', { bubbles: true }))
        assert(root.querySelectorAll('td[data-item]').length === 0, 'Search must filter inventory')
        search.value = body.name; search.dispatchEvent(new Event('input', { bubbles: true }))
        assert(root.querySelectorAll('td[data-item]').length === 1, 'Search must match SQL item name')
        view.required('td[data-item]').click()
        for (const scale of [1, 2, 3, 4]) {
            const select = view.required('[data-field="scale"]')
            select.value = String(scale); select.dispatchEvent(new Event('change', { bubbles: true }))
            assert(view.scale === scale, 'Scale must update')
            sizes()
        }
        for (const direction of ['north', 'east', 'south', 'west']) {
            const select = view.required('[data-field="direction"]')
            select.value = direction; select.dispatchEvent(new Event('change', { bubbles: true }))
            assert(view.direction === direction && !select.disabled, `${direction}: NESW facing must remain available`)
            sizes()
        }
        const paletteTable = view.required('table[aria-label="Part palettes"]')
        assert(paletteTable.tHead.rows[0].cells.length === 3 && paletteTable.tBodies[0].rows.length === view.paletteRoles().length,
            'Palette rows must correspond only to populated inventory slots')
        for (const [slot, role] of view.paletteRoles()) assert(slot === role, 'Palette roles must use slot IDs')
        checks++
        // Edit both GPL content and SQL name. A valid same-count GPL must drive reload.
        const palette = view.palettes.get(body.palette)
        assert(palette && palette.colors[0].every(channel => channel === 0), 'GPL palette needs transparent index zero')
        const paletteName = 'SQL palette <&>'
        const editedGPL = palette.data.replace(/^Name:.*$/m, 'Name: ' + paletteName)
        const alternativeGPL = editedGPL.replace(/^Name:.*$/m, 'Name: Alternative <&>').replace(/^(\s*)\d+\s+\d+\s+\d+(.*)$/m, '$1 17  31  47$2')
        assert(editedGPL !== palette.data, 'Real GPL data must be edited')
        await sql.exec('INSERT INTO palettes (id,name,data) VALUES (?,?,?)', [probe, 'Alternative <&>', alternativeGPL])
        await sql.exec('UPDATE palettes SET name=?, data=? WHERE id=?', [paletteName, editedGPL, palette.id])
        await sql.exec('UPDATE items SET name=? WHERE id=?', ['SQL body <&>', body.id])
        const sqlName = 'SQL hair <&>'
        const firstOrder = Number(await sql.value('SELECT min("order") FROM slots')) - 1
        await sql.exec('UPDATE slots SET name=?, icon=?, "order"=? WHERE id=?', [sqlName, 'beard', String(firstOrder), 'hair'])
        await view.reload(); await settle()
        assert(view.palettes.get(palette.id).data === editedGPL && view.palettes.get(palette.id).name === paletteName,
            'Reload must retain GPL text and read edited palette name')
        assert(view.palettes.get(probe).colors[1].join(',') === '17,31,47,255', 'Reload must decode alternative GPL colors')
        assert(view.item(body.id).name === 'SQL body <&>', 'Reload must not reseed item metadata')
        assert([...root.querySelectorAll('[data-color="body"] option')].some(option => option.textContent === paletteName), 'Palette name must render literally')
        const paletteSelect = view.required('[data-color="body"]')
        assert(view.compatiblePalettes(view.item(body.id)).some(record => record.id === probe), 'Same-count GPL must be compatible')
        paletteSelect.value = probe
        paletteSelect.dispatchEvent(new Event('change', { bubbles: true }))
        assert(view.colors.body === probe, 'Palette selection must update the slot')
        const swatch = view.required('[data-palette="body"]').clip
        const ramp = view.palettes.get(probe).colors.slice(1)
        assert(swatch.width === ramp.length * 20 && swatch.height === 16, 'Swatch must show visible GPL entries only')
        ramp.forEach((rgba, index) => {
            const offset = (8 * swatch.width + index * 20 + 10) * 4
            assert(rgba.every((channel, component) => swatch.frames[0].pixels.data[offset + component] === channel), 'Swatch pixels must match GPL colors')
        })
        checks++
        view.required('td[data-slot="hair"]').click()
        const hair = view.required('td[data-slot="hair"]')
        assert(view.required('[data-element="equipment"]').querySelector('td[data-slot]').dataset.slot === 'hair', 'SQL order must control first slot')
        assert(hair.getAttribute('aria-label') === `${sqlName}: Empty` && hair.querySelector('i').textContent === 'beard', 'SQL name/icon must control empty previews')
        assert(view.required('[data-element="picker-title"]').textContent === sqlName, 'Picker must display SQL name literally')
        hair.dispatchEvent(new Event('pointerenter')); await settle()
        assert([...document.querySelectorAll('[data-element="tooltip-tip-text"]')].some(element => element.textContent === `${sqlName} · Empty`), 'Real tooltip must receive SQL name')
        view.closeTip()
        sizes()
        const lastOrder = Number(await sql.value('SELECT max("order") FROM slots')) + 1
        await sql.exec('INSERT INTO slots (id,name,icon,"order") VALUES (?,?,?,?)', [probe, 'SQL extra slot', 'cloak', String(lastOrder)])
        await sql.exec('DELETE FROM slots WHERE id=?', ['neckwear'])
        await view.reload(); await settle()
        assert(!Object.hasOwn(view.parts, 'neckwear') && view.parts[probe] === null, 'Slot additions/removals must survive reload without fallback')
        sizes()
        // Missing drawing BLOBs omit the catalog item rather than using fixtures.
        await sql.exec('DELETE FROM sprites WHERE item=?', [body.id])
        await view.reload(); await settle()
        assert(view.items.has(body.id) && view.parts.body === body.id && view.item(body.id).sheets.size === 0,
            'Missing sprite must stay unsupported without fixture fallback')
        assert(!view.motionAvailability().available && view.required('[data-action="play"]').disabled,
            'Item without sprite must be omitted from playback')
        assert(view.required('td[data-slot="body"]').classList.contains('danger'), 'Missing sprite must remain visible as unavailable equipment')
        await sql.exec('DELETE FROM animations')
        await view.reload(); await settle()
        assert(view.currentMotion() === null && animationSelect().disabled && view.required('[data-action="play"]').disabled,
            'Empty animation registry must explicitly disable selection/playback')
        checks += 4
        return { passed: checks, slotSize: '64×64', shadowDOM: true, zoomLevels: 4, directions: 4, databaseReload: true }
    } finally {
        if (transactionOpen) await sql.exec('ROLLBACK')
        await view.reload()
        Object.assign(view, before)
        view.render()
    }
}
