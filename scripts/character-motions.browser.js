// Read-only supplied-BLOB playback through the canonical View and Host widget.
export async function checkCharacterMotions() {
    const assert = (value, message) => { if (!value) throw Error(message) }
    const view = document.querySelector('view-character')
    assert(view && view.slots.length > 0 && view.animations.length > 0, 'Supplied slots and animations required')
    const before = Object.fromEntries(['selectedAnimation', 'direction', 'body', 'scale', 'playing', 'selectedSlot', 'search'].map(key => [key, view[key]]))
    before.parts = { ...view.parts }; before.colors = { ...view.colors }
    const { sql } = await import('/util/sql.js')
    let count = 0
    const preview = () => view.required('[data-element="character-preview"]')
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
        JSON.parse(view.previewKey)[0] === animation && JSON.parse(view.previewKey)[1] === direction && preview().clip !== null, `${animation}/${direction}`)
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
        view.scale = 1; view.direction = 'south'; view.playing = false; view.selectedAnimation = 'walk'; view.selectedSlot = body.slot; view.search = ''
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
        const fingerprints = new Set()
        for (const direction of ['north', 'east', 'south', 'west']) {
            const select = view.required('[data-field="direction"]')
            select.value = direction; select.dispatchEvent(new Event('change', { bubbles: true }))
            await rendered('walk', direction)
            assert(!select.disabled && [...select.options].every(option => !option.disabled), 'NESW facings must all be selectable')
            const clip = preview().clip
            assert(clip.frames.length === 9 && clip.frames.every(frame => frame.durationMs === 100), `${direction}: nine 100ms Walk frames required`)
            assert(clip.frames[0].pixels.data.some((value, index) => index % 4 === 3 && value > 0), `${direction}: source pixels must be visible`)
            assert(new Set(clip.frames.map(frame => frame.pixels.data.join(','))).size > 1, `${direction}: source frames must differ`)
            fingerprints.add(clip.frames[0].pixels.data.join(','))
            const coverage = view.motionAvailability()
            assert(coverage.available && coverage.supported.length === 1 && coverage.supported[0] === body.id && coverage.missing.length === 0 && coverage.sheetId === 'walk', 'Coverage must describe the controlled body-only composition')
            assert(view.packCache.get(key) === promise, 'Facing changes must reuse the selected pack Promise')
            count++
        }
        assert(fingerprints.size === 4, 'NESW must render four distinct source facings')
        await new Promise((resolve, reject) => {
            const widget = preview()
            const cleanup = () => { clearTimeout(timeout); widget.removeEventListener('framechange', advanced) }
            const advanced = event => {
                if (event.detail.frameIndex === 0) return
                cleanup(); resolve()
            }
            const timeout = setTimeout(() => { cleanup(); reject(Error('Walk did not advance')) }, 5000)
            widget.addEventListener('framechange', advanced)
            play().click()
            if (!view.playing || !widget.playing) { cleanup(); reject(Error('Walk must start real widget playback')) }
        })
        play().click()
        assert(!view.playing && !preview().playing, 'Pause must stop playback')
        count++
        for (const id of ['climb', 'hurt']) {
            const motion = view.animations.find(animation => animation.id === id)
            assert(motion && view.itemSupportsMotion(body, motion), `Body ${id} sample required`)
            choose(id)
            await rendered(id, 'south')
            const select = view.required('[data-field="direction"]')
            assert(view.currentMotion().directions === 'S' && view.direction === 'south' && select.value === 'south', `${id}: facing must normalize to South`)
            assert([...select.options].every(option => option.disabled === (option.value !== 'south')), `${id}: only South may be selected`)
            assert(preview().clip.frames.length === motion.sequence.length && preview().clip.frames.every(frame => frame.durationMs === 100), `${id}: explicit 100ms policy required`)
            count++
        }
        const idle = view.animations.find(animation => animation.id === 'idle')
        assert(idle && idle.durations_ms.every(ms => ms === 400), 'Explicit Idle policy must use 400ms steps')
        view.required(`td[data-slot="${body.slot}"]`).click()
        view.required('td[data-action="remove"]').click()
        await wait(() => view.previewKey === null && preview().clip === null && play().disabled, 'Empty composition')
        assert(view.parts[body.slot] === null && !view.motionAvailability().available, 'Every slot may unequip; empty composition cannot play')
        count += 2
        return { passed: count, frames: 9, durationMs: 100, directions: 'NESW', southOnly: ['climb', 'hurt'], readOnlyCatalog: true, realBlobPlayback: true }
    } finally {
        view.closeTip()
        Object.assign(view, before)
        view.render()
    }
}
