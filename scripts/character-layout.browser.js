// Read-only integration probe for a supplied catalog and the actual shadow layout.
export async function checkCharacterLayout() {
    const assert = (value, message) => { if (!value) throw Error(message) }
    const view = document.querySelector('view-character')
    assert(view && view.slots.length > 0 && view.animations.length > 0, 'Supplied slots and animations must be loaded')
    const root = view.shadowRoot
    assert(root, 'Actual View must own its shadow DOM')
    assert(view.items.size === 0 && view.inventories.size === 0 && view.palettes.size === 0 && view.selectedSlot === null, 'Startup must not load inventories or palettes or activate a slot')
    assert(Object.values(view.parts).every(item => item === null) && !root.querySelector('[data-element="recolor"]'), 'Startup equipment must be empty without recolor controls')
    const before = Object.fromEntries(['selectedSlot', 'search', 'scale', 'offsetX', 'offsetY', 'direction', 'body', 'playing', 'selectedAnimation'].map(key => [key, view[key]]))
    before.parts = { ...view.parts }; before.colors = { ...view.colors }
    const { sql } = await import('/util/sql.js')
    let checks = 0
    const wait = async (ready, label) => {
        const deadline = performance.now() + 10000
        while (!ready()) {
            assert(performance.now() < deadline, `${label}: timed out; ${view.required('[data-element="status"]').textContent}`)
            await new Promise(resolve => setTimeout(resolve, 20))
        }
    }
    const sizes = () => {
        assert(view.headerControls.length === 1, 'One slotted toolbar required')
        const toolbar = view.headerControls[0]
        assert(toolbar.parentElement === view.parentElement && toolbar.dataset.element === 'toolbar', 'Toolbar must be mounted in the Area')
        assert(view.parentElement.querySelectorAll(':scope > [slot="header-controls"]').length === 1, 'No duplicate toolbars')
        const controls = [...toolbar.children]
        assert(controls.length === 4 && controls[0].dataset.element === 'tool-actions' && controls[1].dataset.field === 'direction' && controls[2].dataset.field === 'scale' && controls[3].dataset.element === 'view-actions', 'Header must contain actions, Facing, preview scale and viewport controls')
        assert(['zoom-in', 'zoom-fit', 'zoom-out'].every(action => controls[3].querySelector(`[data-action="${action}"]`)), 'Viewport needs Zoom in, Fit and Zoom out')
        const canvas = view.canvas, equipment = view.required('table[aria-label="Equipment"]')
        assert(canvas instanceof HTMLCanvasElement && canvas === view.required('form > canvas[data-element="canvas"]'), 'Main preview must use the View-owned canvas')
        assert(canvas.parentElement === equipment.parentElement && canvas.nextElementSibling === equipment, 'Canvas and equipment table must remain adjacent siblings')
        const form = canvas.parentElement, viewport = canvas.getBoundingClientRect(), board = equipment.getBoundingClientRect()
        assert(getComputedStyle(form).display === 'grid' && Math.abs(viewport.top - form.getBoundingClientRect().top) < 1 && Math.abs(viewport.top - board.top - form.scrollTop) < 1, 'Shared Host CSS must overlap canvas and equipment while the table scrolls')
        assert(Math.abs(viewport.width - form.clientWidth) < 1 && Math.abs(viewport.height - form.clientHeight) < 1, 'Canvas must fill the main viewport')
        assert(Number(getComputedStyle(equipment).zIndex) > Number(getComputedStyle(canvas).zIndex), 'Equipment table must remain above the canvas')
        assert(controls[0].querySelectorAll(':scope > button').length === 3 && controls[0].querySelector('[data-action="clear-slots"]') && !toolbar.querySelector('[data-action="play"]'), 'Three toolbar actions must include Clear; playback belongs in the side panel')
        const animation = view.required('[data-field="animation"]'), play = view.required('[data-action="play"]')
        assert(animation.closest('aside') && play.parentElement === animation.parentElement && !animation.closest('table'), 'Animation and Play must share a side-panel control row')
        const a = animation.getBoundingClientRect(), b = play.getBoundingClientRect()
        assert(b.left >= a.right && b.top < a.bottom && b.bottom > a.top, 'Animation and Play must be side by side')
        const grids = [...root.querySelectorAll('table[role="grid"]')]
        assert(grids.length === 2, 'Two selectable grids required')
        for (const grid of grids) {
            assert(grid.querySelector(':scope > colgroup') && grid.querySelectorAll('[tabindex="0"]').length + Number(grid.tabIndex === 0) === 1, 'Grid needs columns and one Tab stop')
            for (const cell of grid.querySelectorAll('td[aria-selected]')) {
                const rect = cell.getBoundingClientRect()
                assert(Math.abs(rect.width - 64) < 0.1 && Math.abs(rect.height - 64) < 0.1, `${cell.getAttribute('aria-label')}: expected 64×64, got ${rect.width}×${rect.height}`)
                assert(cell.getAttribute('aria-label'), 'Cell needs an accessible name')
                const icon = cell.querySelector(':scope > i')
                if (icon) {
                    const glyph = icon.getBoundingClientRect()
                    assert(getComputedStyle(icon).fontSize === '32px' && Math.abs(glyph.width - 32) < 0.1 && Math.abs(glyph.height - 32) < 0.1, 'Empty/remove icons must be 32×32')
                    assert(Math.abs((glyph.left + glyph.right - rect.left - rect.right) / 2) < 0.1 && Math.abs((glyph.top + glyph.bottom - rect.top - rect.bottom) / 2) < 0.1, 'Empty/remove icons must be centered')
                }
            }
        }
        assert(!view.querySelector('table') && !view.required('table[aria-label="Equipment"]').tHead, 'Equipment must stay in shadow DOM without a header')
        const inventory = view.required('table[aria-label="Available parts"]')
        assert(!inventory.tHead && inventory.querySelectorAll(':scope > colgroup > col').length === 3, 'Inventory needs three columns and no header')
        const rows = [...inventory.tBodies[0].rows], count = rows.reduce((sum, row) => sum + row.cells.length, 0)
        rows.forEach((row, index) => assert(row.cells.length === Math.min(3, count - index * 3), 'Inventory must pack three cells per row'))
        assert(inventory.getBoundingClientRect().width <= inventory.parentElement.clientWidth + 0.1, 'Inventory must fit its panel')
        checks++
    }
    try {
        await wait(() => getComputedStyle(view.required('form')).display === 'grid', 'Shared layout stylesheet')
        sizes() // Includes the empty inventory's table-owned Tab stop.
        const bodySlot = view.slots.find(slot => slot.name === 'body')
        assert(bodySlot, 'Supplied body slot required')
        view.selectedAnimation = 'walk'
        await view.selectSlot(bodySlot.id)
        assert(view.inventories.has(bodySlot.id) && !view.inventoryReady(bodySlot.id), 'Slot activation must mount metadata without awaiting support')
        const initialCells = [...root.querySelectorAll('td[data-item]')]
        assert(initialCells.length === view.inventories.get(bodySlot.id).length && initialCells.every(cell => !cell.classList.contains('warning')), 'Pending support must mount every cell without unsupported warnings')
        assert(view.inventories.get(bodySlot.id).every(item => view.itemSupportsMotion(item) === null), 'Initial compatibility must remain unknown, not unsupported')
        await view.refreshInventorySupport()
        assert(view.inventoryReady(bodySlot.id), 'Explicit refresh must await icons and all compatibility flags')
        assert([...root.querySelectorAll('td[data-item]')].every((cell, index) => cell === initialCells[index]), 'Compatibility completion must retain mounted inventory cells')
        const supportedRows = await sql.queryObjects("SELECT DISTINCT item FROM sprites WHERE animation = ? AND mask = 0 AND (? = 'body-z12' OR instr(body, ?) > 0) AND item IN (SELECT id FROM items WHERE slot = ?) ORDER BY item", ['item'], ['walk', bodySlot.id, view.body, bodySlot.id])
        const supported = new Set(supportedRows.map(row => row.item))
        const inventory = view.inventories.get(bodySlot.id)
        const mounted = [...root.querySelectorAll('td[data-item]')]
        assert(mounted.length === inventory.length && inventory.every(item => item.sheets === null), 'Every inventory cell must mount before equipping without full sprite metadata')
        assert(view.palettes.size === 0 && !root.querySelector('[data-element="recolor"]'), 'Pre-equip availability must not load palettes or recolor controls')
        for (const item of inventory) {
            assert(view.itemSupportsMotion(item) === supported.has(item.id), `${item.id}: pre-equip support must match supplied drawing metadata`)
            const cell = mounted.find(cell => cell.dataset.item === item.id)
            assert(cell.classList.contains('warning') === (view.itemMotionStatus(item) === 'missing-animation') && cell.classList.contains('danger') === (view.itemMotionStatus(item) === 'body-mismatch'), `${item.id}: pre-equip intent must distinguish animation and body support`)
        }
        checks += 3
        const samples = await sql.queryObjects('SELECT DISTINCT item FROM sprites WHERE animation = ? AND body LIKE ? AND mask = 0 AND item IN (SELECT id FROM items WHERE slot = ?) ORDER BY item LIMIT 1', ['item'], ['walk', '%m%', bodySlot.id])
        assert(samples.length === 1, 'A supplied body Walk fixture is required')
        const body = view.items.get(samples[0].item)
        assert(body && await view.ensureItemMetadata(body) && await view.ensurePalettes(), 'Body metadata and palettes must load on demand')
        assert(view.itemSupportsMotion(body, view.animations.find(animation => animation.id === 'walk')) && view.body === 'm', 'A compatible body Walk sample and temporary body m are required')
        view.parts = Object.fromEntries(view.slots.map(({ id }) => [id, id === body.slot ? body.id : null]))
        view.colors[body.slot] = body.palette
        view.selectedAnimation = 'walk'; view.direction = 'south'; view.playing = false; view.search = ''; view.selectedSlot = body.slot
        await view.refreshInventorySupport()
        assert(view.inventoryReady(body.slot), 'Direct fixture rendering requires completed icons and support')
        view.previewKey = null
        view.render()
        await wait(() => view.previewKey !== null && JSON.parse(view.previewKey)[0] === 'walk' && JSON.parse(view.previewKey)[1] === 'south' && JSON.parse(view.previewKey)[3].length === 1 && JSON.parse(view.previewKey)[3][0][0] === body.id && view.previewClip !== null, 'Body-only preview')
        await Promise.all([...root.querySelectorAll('link[rel="stylesheet"]')].map(link => link.sheet ? Promise.resolve() : new Promise((resolve, reject) => {
            link.addEventListener('load', resolve, { once: true }); link.addEventListener('error', () => reject(Error(`Stylesheet failed: ${link.href}`)), { once: true })
        })))
        await Promise.all(['Game Icons', 'Material Symbols Rounded'].map(family => document.fonts.load(`32px "${family}"`)))
        const slots = await sql.queryObjects('SELECT id, name, icon FROM slots ORDER BY "order", id', ['id', 'name', 'icon'])
        assert(JSON.stringify(view.slots) === JSON.stringify(slots), 'All slot metadata must match SQL order, without order-value assumptions')
        assert(JSON.stringify([...view.required('[data-element="equipment"]').querySelectorAll('td[data-slot]')].map(cell => cell.dataset.slot)) === JSON.stringify(slots.map(slot => slot.id)), 'All SQL slots must appear in equipment order')
        const animations = await sql.queryObjects('SELECT id, name FROM animations ORDER BY "order", id', ['id', 'name'])
        assert(JSON.stringify(view.animations.map(({ id, name }) => ({ id, name }))) === JSON.stringify(animations), 'Animation metadata must match SQL id/name records')
        assert(JSON.stringify([...view.required('[data-field="animation"]').options].filter(option => option.value.startsWith('animation:')).map(option => ({ id: option.value.slice(10), name: option.textContent }))) === JSON.stringify(animations), 'Animation options must display SQL names in SQL order')
        const items = await sql.queryObjects('SELECT id, name, slot, palette FROM items WHERE slot = ? ORDER BY id', ['id', 'name', 'slot', 'palette'], [body.slot])
        assert(JSON.stringify([...view.items.values()].map(({ id, name, slot, palette }) => ({ id, name, slot, palette }))) === JSON.stringify(items), 'Only demanded body inventory metadata must match scoped SQL')
        const palettes = await sql.queryObjects('SELECT id, name, data FROM palettes ORDER BY id', ['id', 'name', 'data'])
        assert(JSON.stringify([...view.palettes.values()].map(({ id, name, data }) => ({ id, name, data }))) === JSON.stringify(palettes), 'Palette names and original GPL text must match SQL')
        checks += 5
        for (const slot of slots) {
            if (slot.id !== body.slot) {
                const cell = view.required(`td[data-slot="${slot.id}"]`)
                assert(cell.getAttribute('aria-label') === `${slot.name}: Empty` && cell.querySelector('i').textContent === slot.icon, `${slot.id}: SQL name/icon must control empty cells`)
            }
        }
        sizes()
        view.required(`td[data-slot="${body.slot}"]`).click()
        assert(view.selectedSlot === body.slot && root.activeElement.dataset.slot === body.slot, 'Slot selection must retain focus')
        assert(view.required('[data-element="picker-title"]').textContent === view.slotRecord(body.slot).name, 'Picker must display SQL slot name')
        assert(JSON.stringify([...root.querySelectorAll('td[data-item]')].map(cell => cell.dataset.item)) === JSON.stringify(items.filter(item => item.slot === body.slot).map(item => item.id)), 'Body inventory must follow SQL item order')
        assert(view.required('td[data-action="remove"]').getAttribute('aria-disabled') === 'false', 'Body slot may unequip')
        const search = view.required('[data-field="search"]')
        search.value = '__no_catalog_match__'; search.dispatchEvent(new Event('input', { bubbles: true }))
        assert(root.querySelectorAll('td[data-item]').length === 0 && view.required('[data-element="empty"]').textContent === 'No matching parts', 'Search must distinguish no matches')
        search.value = body.name; search.dispatchEvent(new Event('input', { bubbles: true }))
        assert([...root.querySelectorAll('td[data-item]')].some(cell => cell.dataset.item === body.id), 'Search must match SQL item names')
        const promise = view.colored(body)
        assert(promise instanceof Promise && view.colored(body) === promise, 'Icons must cache a decoding Promise')
        assert(!Object.hasOwn(body, 'icon'), 'Item metadata must not contain image bytes')
        const source = await sql.queryObjects('SELECT icon FROM items WHERE id = ?', ['icon'], [body.id])
        assert(source.length === 1, 'Native icon comparison needs the selected SQL row')
        const canvas = await promise, image = new Image(), url = URL.createObjectURL(new Blob([new Uint8Array(source[0].icon)]))
        try {
            image.src = url; await image.decode()
            assert(canvas instanceof HTMLCanvasElement && canvas.width === image.naturalWidth && canvas.height === image.naturalHeight, 'Icon canvas must preserve supplied native dimensions')
        } finally { URL.revokeObjectURL(url) }
        await wait(() => {
            const widget = [...root.querySelectorAll('td[data-item]')].find(cell => cell.dataset.item === body.id).querySelector('widget-animation-preview')
            return widget !== null && widget.clip !== null
        }, 'Body inventory icon')
        const iconClip = [...root.querySelectorAll('td[data-item]')].find(cell => cell.dataset.item === body.id).querySelector('widget-animation-preview').clip
        assert(iconClip.width === canvas.width && iconClip.height === canvas.height, 'Inventory widget must retain native icon size')
        const recolor = view.required('[data-element="recolor"]')
        const inventoryTable = view.required('table[aria-label="Available parts"]')
        assert(recolor.closest('aside') === inventoryTable.closest('aside') && Boolean(recolor.compareDocumentPosition(inventoryTable) & Node.DOCUMENT_POSITION_FOLLOWING), 'Recolor must be in the aside above inventory')
        const selects = [...recolor.querySelectorAll('[data-color]')]
        assert(selects.length === 1 && selects[0].dataset.color === body.slot, 'Only the active equipped item may have recolor controls')
        assert(JSON.stringify([...selects[0].options].map(option => ({ id: option.value, name: option.textContent }))) === JSON.stringify(view.compatiblePalettes(body).map(({ id, name }) => ({ id, name }))), 'Palette options must display compatible SQL names')
        const mainCanvas = view.canvas
        const viewportScale = view.scale
        assert(view.previewClip.width === view.currentMotion().frame_width && view.previewClip.height === view.currentMotion().frame_height, 'Preview frames must retain native sprite dimensions')
        sizes()
        const clip = view.previewClip
        view.required('[data-action="zoom-in"]').click()
        assert(view.scale > viewportScale && view.previewClip === clip && view.canvas === mainCanvas, 'Viewport zoom must not recompose or replace the preview')
        view.required('[data-action="zoom-fit"]').click()
        assert(view.previewClip === clip, 'Viewport Fit must retain the clip')
        checks += 6
        return { passed: checks, slots: slots.length, slotSize: '64×64', shadowDOM: true, readOnlyCatalog: true, nativeIcons: true }
    } finally {
        view.closeTip()
        Object.assign(view, before)
        view.render()
    }
}
