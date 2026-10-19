// Real SQL PNG/GPL BLOB playback through the canonical View and Host widget.
export async function checkCharacterMotions() {
    const assert = (value, message) => { if (!value) throw Error(message) }
    const view = document.querySelector('view-character')
    assert(view && view.items.size > 0, 'Prepared database catalog required')
    const before = { parts: { ...view.parts }, colors: { ...view.colors }, selectedAnimation: view.selectedAnimation,
        direction: view.direction, scale: view.scale, playing: view.playing, selectedSlot: view.selectedSlot }
    const { sql } = await import('/util/sql.js')
    let transactionOpen = false, count = 0
    const choose = id => {
        const select = view.required('[data-field="animation"]')
        select.value = 'animation:' + id
        assert(select.value === 'animation:' + id, `Missing animation option: ${id}`)
        select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const preview = () => view.required('[data-element="character-preview"]')
    const play = () => view.required('[data-action="play"]')
    try {
        await sql.exec('BEGIN'); transactionOpen = true
        const body = [...view.items.values()].find(item => item.slot === 'body')
        assert(body && body.sheets.has('walk'), 'Real normalized body Walk sample required')
        view.parts = Object.fromEntries(view.slots.map(({ id }) => [id, id === body.slot ? body.id : null]))
        view.scale = 1; view.playing = false; view.render()
        choose('walk')
        const animation = view.currentMotion()
        assert(animation.frame_width === 64 && animation.frame_height === 64 && animation.frame_count === 8 && animation.directions === 'NESW',
            'Walk must use full normalized SQL geometry')
        assert(animation.sequence.join(',') === '0,1,2,3,4,5,6,7', 'Real Walk has eight authored frames')
        const fingerprints = new Set()
        for (const direction of ['north', 'east', 'south', 'west']) {
            const select = view.required('[data-field="direction"]')
            select.value = direction; select.dispatchEvent(new Event('change', { bubbles: true }))
            assert(!select.disabled && [...select.options].every(option => !option.disabled), 'All NESW directions must be selectable')
            const clip = preview().clip
            assert(clip && clip.frames.length === 8, `${direction}: eight Walk frames required`)
            assert(clip.frames.every((frame, index) => frame.durationMs === animation.durations_ms[index]), `${direction}: SQL durations required`)
            assert(clip.frames[0].pixels.data.some((value, index) => index % 4 === 3 && value > 0), `${direction}: real PNG must contain visible pixels`)
            assert(new Set(clip.frames.map(frame => frame.pixels.data.join(','))).size > 1, `${direction}: PNG frames must actually differ`)
            fingerprints.add(clip.frames[0].pixels.data.join(','))
            const coverage = view.motionAvailability()
            assert(coverage.available && coverage.supported.includes(body.id) && coverage.missing.length === 0 && coverage.sheetId === 'walk',
                `${direction}: catalog coverage must use actual drawing components`)
            count++
        }
        assert(fingerprints.size === 4, 'NESW rows must render four distinct source facings')
        await new Promise((resolve, reject) => {
            const widget = preview()
            const timeout = setTimeout(() => { widget.removeEventListener('framechange', advanced); reject(Error('Walk did not advance')) }, 5000)
            const advanced = event => {
                if (event.detail.frameIndex === 0) return
                clearTimeout(timeout); widget.removeEventListener('framechange', advanced); resolve()
            }
            widget.addEventListener('framechange', advanced)
            play().click()
            assert(view.playing && widget.playing, 'Walk must start real widget playback')
        })
        play().click()
        assert(!view.playing && !preview().playing, 'Pause must stop playback')
        count++
        // Change real animation metadata, not fixture preview policy.
        const sequence = [7, 5, 3, 1], durations = [70, 130, 190, 250]
        await sql.exec('UPDATE animations SET name=?,frame_width=?,frame_height=?,frame_count=?,directions=?,sequence=?,durations_ms=? WHERE id=?',
            ['SQL Walk <&>', '64', '64', '8', 'NESW', JSON.stringify(sequence), JSON.stringify(durations), 'walk'])
        await view.reload(); choose('walk')
        assert(view.currentMotion().name === 'SQL Walk <&>' && view.currentMotion().sequence.join(',') === sequence.join(','),
            'Reload must preserve edited animation metadata without reseeding')
        assert(preview().clip.frames.length === 4 && preview().clip.frames.every((frame, index) => frame.durationMs === durations[index]),
            'Edited SQL sequence and durations must control actual widget clip')
        assert([...view.required('[data-field="animation"]').options].some(option => option.textContent === 'SQL Walk <&>'), 'SQL animation name must render literally')
        view.required('td[data-slot="body"]').click()
        view.required('td[data-action="remove"]').click()
        assert(view.parts.body === null && !view.motionAvailability().available && preview().clip === null && play().disabled,
            'Removing body is allowed and empty composition cannot play')
        count += 3
        return { passed: count, frames: 8, directions: 'NESW', SQLDurations: true, realBlobPlayback: true }
    } finally {
        if (transactionOpen) await sql.exec('ROLLBACK')
        await view.reload()
        Object.assign(view, before)
        view.render()
    }
}
