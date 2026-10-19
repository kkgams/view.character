// Real source-frame integration checks against the canonical View and Host widget.
export async function checkCharacterMotions() {
    const assert = (value, message) => { if (!value) throw Error(message) }
    const view = document.querySelector('view-character')
    assert(view && view.clipDefinitions.size === 10 && view.poseDefinitions.size === 7, 'Prepared Project motions required')
    const before = { parts: { ...view.parts }, selectedAnimation: view.selectedAnimation,
        selectedPose: view.selectedPose, direction: view.direction, scale: view.scale, playing: view.playing,
        selectedSlot: view.selectedSlot }
    let count = 0
    const choose = (kind, id) => {
        const select = view.required('[data-field="animation"]')
        select.value = `${kind}:${id}`
        assert(select.value === `${kind}:${id}`, `Missing ${kind} option: ${id}`)
        select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const preview = () => view.required('[data-element="character-preview"]')
    const play = () => view.required('[data-action="play"]')
    try {
        // Exercise complete source geometry without clothing-specific coverage gaps.
        view.parts = Object.fromEntries(Object.entries(view.parts).map(([slot, item]) => [slot,
            slot === 'body' || slot === 'head' ? item : null]))
        view.scale = 1
        view.render()
        for (const animation of view.clipDefinitions.values()) {
            choose('animation', animation.id)
            const clip = preview().clip
            assert(clip && clip.frames.length === animation.preview_sequence.length, `${animation.id}: wrong playback sequence length`)
            assert(clip.frames.every((frame, index) => frame.durationMs === animation.preview_duration_ms[index]), `${animation.id}: wrong source holds`)
            assert(!play().disabled, `${animation.id}: real prepared animation must be playable`)
            if (animation.id === 'climb') {
                assert(view.direction === 'north' && view.required('[data-field="direction"]').disabled, 'Climb must not fabricate other directions')
            }
            count++
        }
        choose('animation', 'walk')
        await new Promise((resolve, reject) => {
            const widget = preview()
            const timeout = setTimeout(() => { widget.removeEventListener('framechange', advanced); reject(Error('Walk did not advance')) }, 5000)
            const advanced = event => {
                if (event.detail.frameIndex === 0) return
                clearTimeout(timeout)
                widget.removeEventListener('framechange', advanced)
                resolve()
            }
            widget.addEventListener('framechange', advanced)
            play().click()
            assert(view.playing && widget.playing, 'Walk must start actual playback')
        })
        play().click()
        view.direction = 'south'
        view.updatePreview()
        const fingerprints = new Set()
        for (const pose of view.poseDefinitions.values()) {
            choose('pose', pose.id)
            const clip = preview().clip
            assert(clip && clip.frames.length === 1 && !view.playing && !preview().playing, `${pose.id}: pose must stay on one frame`)
            assert(play().disabled, `${pose.id}: static poses must disable Play`)
            play().dispatchEvent(new Event('click'))
            assert(!view.playing, `${pose.id}: synthetic Play must be guarded`)
            fingerprints.add(clip.frames[0].pixels.data.join(','))
            count++
        }
        assert(fingerprints.size === 7, 'The seven selected poses must render distinct source cells')
        // Known source variant: clothing Emotes has 3 columns, body/head has 4.
        const limited = [...view.items.values()].find(item => item.sheets.has('emotes') && item.sheets.get('emotes').frames === 3)
        assert(limited, 'Real limited-coverage item required')
        choose('pose', 'emote_3')
        const bowPixels = preview().clip.frames[0].pixels.data.join(',')
        view.parts[limited.slot] = limited.id
        view.selectedSlot = limited.slot
        view.update()
        assert(preview().clip !== null && play().disabled, 'Compatible parts must still render a held pose')
        assert(preview().clip.frames[0].pixels.data.join(',') === bowPixels, 'Missing fourth column must be omitted, not replaced with Idle or another pose')
        const equipment = view.required(`td[data-slot="${limited.slot}"]`)
        const inventory = view.required(`td[data-item="${limited.id}"]`)
        for (const cell of [equipment, inventory]) {
            assert(cell.classList.contains('danger'), 'Missing cells must carry theme danger intent in both grids')
            assert(cell.getAttribute('aria-disabled') === 'false', 'Missing cells must remain interactive')
            assert(cell.getAttribute('aria-label').includes('No source frames'), 'Coverage must have an accessible explanation')
        }
        const dangerBackground = getComputedStyle(equipment).backgroundColor
        assert(view.required('[data-element="animation-status"]').textContent.includes(limited.name), 'Coverage warning must identify the omitted item')
        choose('pose', 'emote_0')
        assert(!equipment.classList.contains('danger') && !inventory.classList.contains('danger'), 'Selecting a supported pose must clear both warnings')
        assert(getComputedStyle(equipment).backgroundColor !== dangerBackground, 'Theme danger must visibly tint the cell')
        const gap = [...view.items.values()].find(item => !item.sheets.has('combat_1h_idle'))
        assert(gap, 'Real missing-combat source required')
        view.parts[gap.slot] = gap.id
        view.update()
        choose('animation', 'combat_1h_idle')
        assert(preview().clip !== null && !play().disabled, 'Missing clothing must not block compatible animation playback')
        assert(view.required(`td[data-slot="${gap.slot}"]`).classList.contains('danger'), 'Combat coverage must update the affected equipment slot')
        play().click()
        assert(view.playing && preview().playing, 'Partial composition must be playable')
        play().click()
        return { passed: count + 10, clips: 10, staticPoses: 7, partialComposition: true, equipmentAndInventoryIntent: true }
    } finally {
        Object.assign(view, before)
        view.render()
    }
}
