// Read-only supplied-BLOB playback through the canonical View-owned canvas.
export async function checkCharacterMotions() {
    const assert = (value, message) => { if (!value) throw Error(message) }
    const view = document.querySelector('view-character')
    assert(view && view.slots.length > 0 && view.animations.length > 0, 'Supplied slots and animations required')
    const before = Object.fromEntries(['selectedAnimation', 'direction', 'body', 'scale', 'offsetX', 'offsetY', 'playing', 'selectedSlot', 'search'].map(key => [key, view[key]]))
    before.parts = { ...view.parts }; before.colors = { ...view.colors }
    const { sql } = await import('/util/sql.js')
    let count = 0
    const pixels = frame => frame.canvas.getContext('2d').getImageData(0, 0, frame.canvas.width, frame.canvas.height).data
    const play = () => view.required('[data-action="play"]')
    const wait = async (ready, label) => {
        const deadline = performance.now() + 10000
        while (!ready()) {
            assert(performance.now() < deadline, `${label}: timed out; ${view.required('[data-element="status"]').textContent}`)
            await new Promise(resolve => setTimeout(resolve, 20))
        }
    }
    // UI event handlers do not await rendering; wait for the requested rendered key.
    const rendered = (animation, direction) => wait(() => view.previewKey !== null &&
        JSON.parse(view.previewKey)[0] === animation && JSON.parse(view.previewKey)[1] === direction && view.previewClip !== null, `${animation}/${direction}`)
    const choose = id => {
        const select = view.required('[data-field="animation"]')
        select.value = 'animation:' + id
        assert(select.value === 'animation:' + id, `Missing animation option: ${id}`)
        select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    try {
        const walk = view.animations.find(animation => animation.id === 'walk')
        assert(walk && view.body === 'm', 'Walk settings and temporary body m required')
        const bodySlot = view.slots.find(slot => slot.name === 'body')
        assert(bodySlot, 'Supplied body slot required')
        assert(await view.ensureInventory(bodySlot.id), 'Body inventory demand must complete')
        const samples = await sql.queryObjects('SELECT item FROM sprites WHERE mask = 0 AND body LIKE ? AND animation IN (?, ?, ?) AND item IN (SELECT id FROM items WHERE slot = ?) GROUP BY item HAVING COUNT(DISTINCT animation) = 3 ORDER BY item LIMIT 1', ['item'], ['%m%', 'walk', 'climb', 'hurt', bodySlot.id])
        assert(samples.length === 1, 'Compatible body Walk/Climb/Hurt fixture required')
        const body = view.items.get(samples[0].item)
        assert(body && await view.ensureItemMetadata(body) && await view.ensurePalettes(), 'Body metadata and palettes must load on demand')
        assert(view.itemSupportsMotion(body, walk), 'Compatible body Walk sample required')
        // First items in every slot may legitimately conflict; test only the body.
        view.parts = Object.fromEntries(view.slots.map(({ id }) => [id, id === body.slot ? body.id : null]))
        view.colors[body.slot] = body.palette
        view.direction = 'south'; view.playing = false; view.selectedAnimation = 'walk'; view.selectedSlot = body.slot; view.search = ''
        await view.selectSlot(body.slot)
        await view.refreshInventorySupport()
        assert(view.inventoryReady(body.slot), 'Direct fixture rendering requires completed icons and support')
        view.previewKey = null
        view.render()
        await rendered('walk', 'south')
        const animation = view.currentMotion()
        assert(animation.frame_width === 64 && animation.frame_height === 64 && animation.frame_count === 9 && animation.directions === 'NESW', 'Explicit Walk settings must use 64px, nine frames and NESW')
        assert(animation.sequence.join(',') === '0,1,2,3,4,5,6,7,8' && animation.durations_ms.every(ms => ms === 100), 'Walk policy must use nine 100ms steps')
        const rows = await sql.queryObjects('SELECT id, item, animation, layer, mask, body FROM sprites WHERE item = ? AND animation = ? ORDER BY id', ['id', 'item', 'animation', 'layer', 'mask', 'body'], [body.id, 'walk'])
        const first = rows.find(row => row.body.includes(view.body))
        assert(first, 'Body-compatible SQL pack required')
        const expected = rows.filter(row => row.body === first.body)
        const key = view.packKey(body, animation), promise = view.packCache.get(key)
        assert(promise instanceof Promise, 'Selected pack must cache a lazy Promise')
        const pack = await promise
        assert(JSON.stringify(pack.map(({ id, item, animation, layer, mask, body }) => ({ id, item, animation, layer, mask, body }))) === JSON.stringify(expected), 'Pack must keep all rows with the first compatible exact body, in SQL id order')
        assert(pack.every(row => row.image && row.data), 'Selected pack must lazily fetch and decode sprite BLOBs')
        count += 3
        const mainCanvas = view.canvas
        assert(mainCanvas instanceof HTMLCanvasElement, 'View-owned preview canvas required')
        const fingerprints = new Set()
        for (const direction of ['north', 'east', 'south', 'west']) {
            const select = view.required('[data-field="direction"]')
            select.value = direction; select.dispatchEvent(new Event('change', { bubbles: true }))
            await rendered('walk', direction)
            assert(!select.disabled && [...select.options].every(option => !option.disabled), 'NESW facings must all be selectable')
            assert(view.canvas === mainCanvas, 'Facing changes must retain the main canvas')
            const clip = view.previewClip
            assert(clip.frames.length === 9 && clip.frames.every(frame => frame.durationMs === 100), `${direction}: nine 100ms Walk frames required`)
            assert(pixels(clip.frames[0]).some((value, index) => index % 4 === 3 && value > 0), `${direction}: source pixels must be visible`)
            assert(new Set(clip.frames.map(frame => pixels(frame).join(','))).size > 1, `${direction}: source frames must differ`)
            fingerprints.add(pixels(clip.frames[0]).join(','))
            const coverage = view.motionAvailability()
            assert(coverage.available && coverage.supported.length === 1 && coverage.supported[0] === body.id && coverage.missing.length === 0 && coverage.sheetId === 'walk', 'Coverage must describe the controlled body-only composition')
            assert(view.packCache.get(key) === promise, 'Facing changes must reuse the selected pack Promise')
            count++
        }
        assert(fingerprints.size === 4, 'NESW must render four distinct source facings')
        await new Promise((resolve, reject) => {
            const cleanup = () => { clearTimeout(timeout); view.removeEventListener('framechange', advanced) }
            const advanced = event => {
                if (event.detail.frameIndex === 0) return
                assert(event.detail.frameIndex === view.previewFrameIndex && view.canvas === mainCanvas, 'View framechange must report the current canvas playback index')
                cleanup(); resolve()
            }
            const timeout = setTimeout(() => { cleanup(); reject(Error('Walk did not advance')) }, 5000)
            view.addEventListener('framechange', advanced)
            play().click()
            if (!view.playing || view.previewTimer === null) { cleanup(); reject(Error('Walk must start real canvas playback')) }
        })
        play().click()
        const pausedIndex = view.previewFrameIndex
        await new Promise(resolve => setTimeout(resolve, 150))
        assert(!view.playing && view.previewTimer === null && view.previewFrameIndex === pausedIndex, 'Pause must stop canvas playback')
        count++
        const search = view.required('[data-field="search"]')
        search.value = body.name; search.dispatchEvent(new Event('input', { bubbles: true }))
        await wait(() => [...view.shadowRoot.querySelectorAll('td[data-item]')].every(cell => {
            const widget = cell.querySelector('widget-animation-preview')
            return widget !== null && widget.clip !== null
        }), 'Filtered inventory icons')
        const sheetsBefore = new Map(view.inventories.get(body.slot).map(item => [item.id, item.sheets]))
        const inventoryNodes = [...view.shadowRoot.querySelectorAll('td[data-item]')]
        const iconWidgets = inventoryNodes.map(cell => cell.querySelector('widget-animation-preview'))
        const iconPromises = inventoryNodes.map(cell => view.colored(view.items.get(cell.dataset.item)))
        const focused = inventoryNodes.find(cell => cell.dataset.item === body.id)
        assert(focused, 'Filtered equipped body cell required')
        focused.focus()
        for (const id of ['climb', 'hurt']) {
            const motion = view.animations.find(animation => animation.id === id)
            assert(motion && view.itemSupportsMotion(body, motion), `Body ${id} sample required`)
            choose(id)
            const pendingNodes = [...view.shadowRoot.querySelectorAll('td[data-item]')]
            assert(pendingNodes.every((cell, index) => cell === inventoryNodes[index]), `${id}: pending compatibility must retain inventory cells`)
            assert(view.inventories.get(body.slot).filter(item => item.sheets === null).every(item => view.itemSupportsMotion(item, motion) === null), `${id}: uncached compatibility must initially be unknown`)
            assert(pendingNodes.filter(cell => view.items.get(cell.dataset.item).sheets === null).every(cell => !cell.classList.contains('warning')), `${id}: unknown compatibility must not show unsupported warnings`)
            await view.refreshInventorySupport()
            await rendered(id, 'south')
            await wait(() => view.inventoryReady(body.slot) && view.required('[data-element="empty"]').textContent !== 'Checking animation support…', `${id} inventory support`)
            const nodes = [...view.shadowRoot.querySelectorAll('td[data-item]')]
            assert(nodes.length === inventoryNodes.length && nodes.every((cell, index) => cell === inventoryNodes[index]), `${id}: support refresh must retain inventory nodes`)
            assert(view.shadowRoot.activeElement === focused && search.value === body.name && view.search === body.name, `${id}: support refresh must retain focus and search`)
            assert(nodes.every((cell, index) => cell.querySelector('widget-animation-preview') === iconWidgets[index] && view.colored(view.items.get(cell.dataset.item)) === iconPromises[index]), `${id}: support refresh must retain decoded icons`)
            const supportedRows = await sql.queryObjects("SELECT DISTINCT item FROM sprites WHERE animation = ? AND mask = 0 AND (? = 'body-z12' OR instr(body, ?) > 0) AND item IN (SELECT id FROM items WHERE slot = ?) ORDER BY item", ['item'], [id, body.slot, view.body, body.slot])
            const supported = new Set(supportedRows.map(row => row.item))
            assert(view.inventories.get(body.slot).every(item => view.itemSupportsMotion(item, motion) === supported.has(item.id) && item.sheets === sheetsBefore.get(item.id)), `${id}: every item needs accurate support without loading unselected metadata`)
            for (const cell of nodes) {
                const item = view.items.get(cell.dataset.item), status = view.itemMotionStatus(item, motion)
                const issue = view.itemMotionDetails(status, motion)
                assert(cell.classList.contains('warning') === (status === 'missing-animation') && cell.classList.contains('danger') === (status === 'body-mismatch') && cell.getAttribute('aria-label') === `Equip ${item.name}${issue ? ` · ${issue}` : ''}`, `${id}: intents and accessible names must follow refreshed support`)
            }
            count += 4
            const select = view.required('[data-field="direction"]')
            assert(view.currentMotion().directions === 'S' && view.direction === 'south' && select.value === 'south', `${id}: facing must normalize to South`)
            assert([...select.options].every(option => option.disabled === (option.value !== 'south')), `${id}: only South may be selected`)
            assert(view.previewClip.frames.length === motion.sequence.length && view.previewClip.frames.every(frame => frame.durationMs === 100), `${id}: explicit 100ms policy required`)
            count++
        }
        const idle = view.animations.find(animation => animation.id === 'idle')
        assert(idle && idle.durations_ms.every(ms => ms === 400), 'Explicit Idle policy must use 400ms steps')
        view.required(`td[data-slot="${body.slot}"]`).click()
        view.required('td[data-action="remove"]').click()
        await wait(() => view.previewKey === null && view.previewClip === null && play().disabled, 'Empty composition')
        assert(view.parts[body.slot] === null && !view.motionAvailability().available, 'Every slot may unequip; empty composition cannot play')
        count += 2
        return { passed: count, frames: 9, durationMs: 100, directions: 'NESW', southOnly: ['climb', 'hurt'], readOnlyCatalog: true, realBlobPlayback: true }
    } finally {
        view.closeTip()
        Object.assign(view, before)
        view.render()
    }
}
