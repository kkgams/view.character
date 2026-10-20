// Read-only integration probe for a supplied catalog and the actual shadow layout.
export async function checkCharacterLayout() {
    const assert = (value, message) => { if (!value) throw Error(message) }
    const view = document.querySelector('view-character')
    assert(view && view.items.size > 0, 'Supplied database catalog must be loaded')
    const root = view.shadowRoot
    assert(root, 'Actual View must own its shadow DOM')
    const before = Object.fromEntries(['selectedSlot', 'search', 'scale', 'direction', 'body', 'playing', 'selectedAnimation'].map(key => [key, view[key]]))
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
        assert(controls.length === 3 && controls[0].dataset.element === 'tool-actions' && controls[1].dataset.field === 'direction' && controls[2].dataset.field === 'scale', 'Header must contain actions, Facing and Zoom')
        assert(controls[0].querySelectorAll(':scope > button').length === 2 && !toolbar.querySelector('[data-action="play"]'), 'Playback belongs in the side panel')
        const animation = view.required('[data-field="animation"]'), play = view.required('[data-action="play"]')
        assert(animation.closest('aside') && play.parentElement === animation.parentElement && !animation.closest('table'), 'Animation and Play must share a side-panel control row')
        const a = animation.getBoundingClientRect(), b = play.getBoundingClientRect()
        assert(b.left >= a.right && b.top < a.bottom && b.bottom > a.top, 'Animation and Play must be side by side')
        const grids = [...root.querySelectorAll('table[role="grid"]')]
        assert(grids.length === 2, 'Two selectable grids required')
        for (const grid of grids) {
            assert(grid.querySelector(':scope > colgroup') && grid.querySelectorAll('[tabindex="0"]').length === 1, 'Grid needs columns and one Tab stop')
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
        // Initial first-item selections can legitimately conflict (e.g. both earrings).
        // Exercise a controlled composition, never edit the supplied database.
        const body = [...view.items.values()].find(item => item.slot === 'body' && view.itemSupportsMotion(item, view.animations.find(animation => animation.id === 'walk')))
        assert(body && view.body === 'm', 'A compatible body Walk sample and temporary body m are required')
        view.parts = Object.fromEntries(view.slots.map(({ id }) => [id, id === body.slot ? body.id : null]))
        view.colors.body = body.palette
        view.selectedAnimation = 'walk'; view.direction = 'south'; view.playing = false; view.search = ''; view.scale = 1; view.selectedSlot = body.slot
        view.previewKey = null
        view.render()
        await wait(() => view.previewKey !== null && JSON.parse(view.previewKey)[0] === 'walk' && JSON.parse(view.previewKey)[1] === 'south' && JSON.parse(view.previewKey)[4].length === 1 && JSON.parse(view.previewKey)[4][0][0] === body.id && view.required('[data-element="character-preview"]').clip !== null, 'Body-only preview')
        await Promise.all([...root.querySelectorAll('link[rel="stylesheet"]')].map(link => link.sheet ? Promise.resolve() : new Promise((resolve, reject) => {
            link.addEventListener('load', resolve, { once: true }); link.addEventListener('error', () => reject(Error(`Stylesheet failed: ${link.href}`)), { once: true })
        })))
        await Promise.all(['Game Icons', 'Material Symbols Rounded'].map(family => document.fonts.load(`32px "${family}"`)))
        const slots = await sql.queryObjects('SELECT id, name, icon FROM slots ORDER BY "order", id', ['id', 'name', 'icon'])
        assert(JSON.stringify(view.slots) === JSON.stringify(slots), 'All slot metadata must match SQL order, without order-value assumptions')
        assert(JSON.stringify([...view.required('[data-element="equipment"]').querySelectorAll('td[data-slot]')].map(cell => cell.dataset.slot)) === JSON.stringify(slots.map(slot => slot.id)), 'All SQL slots must appear in equipment order')
        const animations = await sql.queryObjects('SELECT id, name FROM animations ORDER BY name COLLATE NOCASE, id', ['id', 'name'])
        assert(JSON.stringify(view.animations.map(({ id, name }) => ({ id, name }))) === JSON.stringify(animations), 'Animation metadata must match SQL id/name records')
        assert(JSON.stringify([...view.required('[data-field="animation"]').options].filter(option => option.value.startsWith('animation:')).map(option => ({ id: option.value.slice(10), name: option.textContent }))) === JSON.stringify(animations), 'Animation options must display SQL names in SQL order')
        const items = await sql.queryObjects('SELECT id, name, slot, palette FROM items ORDER BY id', ['id', 'name', 'slot', 'palette'])
        assert(JSON.stringify([...view.items.values()].map(({ id, name, slot, palette }) => ({ id, name, slot, palette }))) === JSON.stringify(items), 'Item metadata must match SQL')
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
        view.required('td[data-slot="body"]').click()
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
        for (const [slot] of view.paletteRoles()) {
            const select = view.required(`[data-color="${slot}"]`)
            assert(JSON.stringify([...select.options].map(option => ({ id: option.value, name: option.textContent }))) === JSON.stringify(view.compatiblePalettes(view.paletteItem(slot)).map(({ id, name }) => ({ id, name }))), `${slot}: palette options must display compatible SQL names`)
        }
        for (const scale of [1, 2, 3, 4]) {
            const select = view.required('[data-field="scale"]')
            select.value = String(scale); select.dispatchEvent(new Event('change', { bubbles: true }))
            await wait(() => view.previewKey !== null && JSON.parse(view.previewKey)[2] === scale, `Zoom ${scale}`)
            sizes()
        }
        checks += 4
        return { passed: checks, slots: slots.length, slotSize: '64×64', shadowDOM: true, zoomLevels: 4, readOnlyCatalog: true, nativeIcons: true }
    } finally {
        view.closeTip()
        Object.assign(view, before)
        view.render()
    }
}
