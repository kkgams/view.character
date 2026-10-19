// Work-count regressions for slot selection and resizing under the real Host widget.
export async function checkCharacterPerformance() {
    const assert = (ok, message) => { if (!ok) throw Error(message) }
    const view = document.querySelector('view-character')
    assert(view && view.items.size, 'Prepared catalog View required')
    const before = { selectedSlot: view.selectedSlot, search: view.search, direction: view.direction }
    const shell = view.parentElement
    const originalWidth = shell.style.width
    const Widget = customElements.get('widget-animation-preview')
    const descriptor = Object.getOwnPropertyDescriptor(Widget.prototype, 'clip')
    const writes = []
    Object.defineProperty(Widget.prototype, 'clip', { ...descriptor, set(value) {
        if (this.dataset.element === 'character-preview') writes.push(value === null ? { width: 0, channels: 0 } : { width: value.width, channels: value.width * value.height * 4 * value.frames.length })
        descriptor.set.call(this, value)
    } })
    const settle = () => new Promise(resolve => setTimeout(resolve, 50))
    const preview = () => view.required('[data-element="character-preview"]')
    const clicks = []
    try {
        await settle()
        writes.length = 0
        const originalPreview = preview(), playing = view.playing
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
        assert(writes.length === 1 && writes[0].width === view.currentMotion().frame_width * view.scale, 'Animation clip width must follow the sprite, not the viewport')
        return { passed: 5, clicks, maxClickMs: Math.max(...clicks.map(click => click.durationMs)), clipWrites: unchangedWrites, resizeSteps: widths.length, changedClipChannels: writes[0].channels }
    } finally {
        Object.defineProperty(Widget.prototype, 'clip', descriptor)
        shell.style.width = originalWidth
        Object.assign(view, before)
        view.update()
    }
}
