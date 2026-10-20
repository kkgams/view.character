// Work-count regressions for slot selection and resizing under the real Host widget.
export async function checkCharacterPerformance() {
    const assert = (ok, message) => { if (!ok) throw Error(message) }
    const view = document.querySelector('view-character')
    assert(view && view.items.size, 'Prepared catalog View required')
    const before = { selectedSlot: view.selectedSlot, search: view.search, direction: view.direction,
        parts: {...view.parts}, selectedAnimation: view.selectedAnimation, body: view.body, scale: view.scale, playing: view.playing }
    const shell = view.parentElement
    const originalWidth = shell.style.width
    const Widget = customElements.get('widget-animation-preview')
    const descriptor = Object.getOwnPropertyDescriptor(Widget.prototype, 'clip')
    const { runtime } = await import('/core/runtime.js')
    const originalInvoke = runtime.invoke
    let slotSqlCalls = 0
    const writes = []
    Object.defineProperty(Widget.prototype, 'clip', { ...descriptor, set(value) {
        if (this.dataset.element === 'character-preview') writes.push(value === null ? { width: 0, channels: 0 } : { width: value.width, channels: value.width * value.height * 4 * value.frames.length })
        descriptor.set.call(this, value)
    } })
    const settle = () => new Promise(resolve => setTimeout(resolve, 50))
    const preview = () => view.required('[data-element="character-preview"]')
    const clicks = []
    try {
        const item = [...view.items.values()].find(item => item.slot === 'body' &&
            (item.sheets.get('walk') || []).some(row => !row.mask && row.body.includes(view.body)))
        assert(item, 'Performance probe needs one body item supporting walk')
        view.parts = Object.fromEntries(view.slots.map(slot => [slot.id,null]))
        view.parts[item.slot] = item.id
        view.selectedAnimation = 'walk'
        view.scale = 1
        view.update()
        await view.updatePreview()
        for (let i=0;i<200 && view.previewKey === null;i++) await settle()
        assert(view.previewKey !== null, 'Controlled nonconflicting animation must load')
        writes.length = 0
        const originalPreview = preview(), playing = view.playing
        runtime.invoke = function(target, ...args) {
            if (target.startsWith('sql/')) slotSqlCalls++
            return originalInvoke.call(this,target,...args)
        }
        for (const { id } of view.slots.slice(0, 4)) {
            const start = performance.now()
            view.required(`td[data-slot="${id}"]`).click()
            clicks.push({ slot: id, durationMs: performance.now() - start })
            assert(view.selectedSlot === id, 'Slot activation must update the inventory')
            assert(preview() === originalPreview, 'Slot activation must retain the main preview widget')
            assert(view.playing === playing, 'Slot activation must preserve playback')
            const inventory = [...view.items.values()].filter(item => item.slot === id)
            if (!inventory.length) assert(view.required('[data-element="empty"]').textContent === `No catalog items for ${view.slotRecord(id).name}.`, 'Empty slot needs an explicit catalog message, not a failed-search message')
        }
        assert(writes.length === 0, `Slot activation rebuilt ${writes.length} unchanged animation clips`)
        const largest = view.slots.map(slot => ({slot:slot.id,items:[...view.items.values()].filter(item => item.slot === slot.id)}))
            .reduce((best,entry) => entry.items.length > best.items.length ? entry : best)
        const inventoryStarted = performance.now()
        view.required(`td[data-slot="${largest.slot}"]`).click()
        await Promise.all(largest.items.map(item => view.colored(item)))
        const largestInventoryMs = performance.now()-inventoryStarted
        assert(largestInventoryMs < 10000, `Largest inventory blocked for ${largestInventoryMs}ms`)
        assert(slotSqlCalls === 0, `Equipment slot selection made ${slotSqlCalls} SQL calls`)
        assert(writes.length === 0, 'Largest inventory must not recompose the character')
        runtime.invoke = originalInvoke
        const widths = [1050, 1250, 1150]
        for (const width of widths) {
            shell.style.width = width + 'px'
            await settle()
            assert(preview() === originalPreview, 'Resize must retain the preview widget')
        }
        assert(writes.length === 0, `Resize rebuilt ${writes.length} animation clips`)
        const unchangedWrites = writes.length
        const facing = view.required('[data-field="direction"]')
        facing.value = view.direction === 'north' ? 'south' : 'north'
        facing.dispatchEvent(new Event('change', { bubbles: true }))
        for (let i=0;i<200 && writes.length === 0;i++) await settle()
        assert(writes.length === 1 && writes[0].width === view.currentMotion().frame_width * view.scale, 'Animation clip width must follow the sprite, not the viewport')
        return { passed: 7, clicks, maxClickMs: Math.max(...clicks.map(click => click.durationMs)), largestInventory: {slot:largest.slot,items:largest.items.length,durationMs:largestInventoryMs}, slotSqlCalls, clipWrites: unchangedWrites, resizeSteps: widths.length, changedClipChannels: writes[0].channels }
    } finally {
        runtime.invoke = originalInvoke
        Object.defineProperty(Widget.prototype, 'clip', descriptor)
        shell.style.width = originalWidth
        Object.assign(view, before)
        view.render()
    }
}
