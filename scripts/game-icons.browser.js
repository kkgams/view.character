// Browser-only regression against real Host CSS/font and the production cell renderer.
export async function checkEquipmentIcons() {
    const assert = (condition, message) => { if (!condition) throw new Error(message) }
    const view = document.querySelector('view-character')
    assert(view && view.slots.length > 0, 'LPC slots must be loaded')
    const response = await fetch('/fonts/game-icons.json')
    assert(response.ok, 'Host Game Icons catalogue must be served')
    const catalogue = await response.json()
    const icons = new Map(catalogue.icons.map((item) => [item.ligature, item]))
    const loaded = await document.fonts.load('16px "Game Icons"')
    assert(loaded.length > 0 && loaded.every((face) => face.status === 'loaded'), 'Actual Game Icons font must load')
    const before = JSON.stringify(view.parts)
    const table = document.createElement('table')
    table.setAttribute('role', 'grid')
    table.setAttribute('aria-label', 'Empty-slot font regression')
    const row = table.createTBody().insertRow()
    assert(view.shadowRoot, 'Font probe requires the actual View shadow styles')
    view.required('form').append(table)
    const results = []
    try {
        // Probe every slot without changing the composition.
        for (const slot of Object.keys(view.parts)) {
            const cell = view.itemCell(slot, null, true)
            row.append(cell)
            const icon = cell.querySelector('i.game-icons')
            assert(icon && icon.getAttribute('aria-hidden') === 'true', `${slot}: decorative Game Icon required`)
            assert(cell.getAttribute('aria-label'), `${slot}: accessible cell label required`)
            const entry = icons.get(icon.textContent)
            assert(entry, `${slot}: exact catalogue ligature required`)
            const style = getComputedStyle(icon)
            assert(style.fontFamily.includes('Game Icons'), `${slot}: Host font CSS is missing`)
            const direct = icon.cloneNode()
            direct.textContent = String.fromCodePoint(entry.codepoint)
            cell.append(direct)
            const width = icon.getBoundingClientRect().width
            const directWidth = direct.getBoundingClientRect().width
            direct.remove()
            assert(width > 0 && Math.abs(width - directWidth) < 0.1, `${slot}: ligature is missing or rendered as text rather than one glyph`)
            const canvas = document.createElement('canvas')
            canvas.width = 256; canvas.height = 80
            const context = canvas.getContext('2d')
            assert(context, 'Canvas context required for glyph-ink regression')
            context.font = '32px "Game Icons"'
            context.fillText(entry.ligature, 8, 50)
            const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
            const ink = rgba.filter((value, index) => index % 4 === 3 && value > 0).length
            assert(ink > 0, `${slot}: glyph has no visible pixels`)
            results.push({ slot, ligature: entry.ligature, ink })
        }
        assert(results.length === Object.keys(view.parts).length, 'All empty-slot icons must be checked')
        assert(JSON.stringify(view.parts) === before, 'Font probe must not change the composition')
        return { passed: results.length, font: 'Game Icons', slots: results }
    } finally {
        table.remove()
    }
}
