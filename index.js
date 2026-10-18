import "/widgets/animation-preview.js"
import { runtime, unwrap } from "/core/runtime.js"
import { registerViewPlugin, unregisterViewPlugin } from "/util/view-plugin.js"
import { bindSelectableGrid } from "/util/selectable-grid.js"
import { ensureThemeStylesheetLink } from "/util/add-style.js"
import { sql } from "/util/sql.js"
import { require } from "/util/require.js"

// Load through the Host helper: relative ES imports cannot resolve from its blob URLs.
const { reloadDevelopmentDatabase } = await require("development-db.js")
let databaseReload = Promise.resolve()
function readSlotRows() {
    return sql.queryObjects('SELECT id, name, icon, "order" FROM slots ORDER BY "order"', ['id', 'name', 'icon', 'order'])
}
function replayDevelopmentSQL() {
    const replay = async () => {
        assert(runtime.projectConfig.sql === "memory", "development SQL replay requires the disposable memory database")
        const bytes = unwrap(await runtime.invoke("fs/fs::read-file", "development.sql"), "development SQL read")
        await reloadDevelopmentDatabase(sql, new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)))
        return await readSlotRows()
    }
    // Every request reruns the file, including an explicit retry after a failed replay.
    databaseReload = databaseReload.then(replay, replay)
    return databaseReload
}

// Slot metadata/order comes from SQL; assets and painter order remain LPC mocks.
// Painter order is independent of board placement and registry order.
const DRAW_ORDER = ["body", "legs", "feet", "torso", "outerwear", "neckwear", "head", "hair", "beard", "headwear"]
const INVENTORY_COLUMNS = 3
const DEFAULT_PARTS = {
    body: "body",
    head: "head",
    hair: "hair-parted",
    torso: "shirt-long",
    legs: "pants",
    feet: "boots",
    headwear: "helm-norman",
    beard: "beard-trimmed",
    neckwear: "bowtie",
    outerwear: "suspenders",
}
const DEFAULT_COLORS = {
    skin: "Peach",
    headwear: "Steel",
    hair: "Chestnut",
    beard: "Chestnut",
    torso: "Neptune",
    outerwear: "Leather",
    neckwear: "Garnet",
    legs: "Shadow",
    feet: "Leather",
}
const COLOR_CATEGORIES = {
    skin: "Skin",
    headwear: "Metal",
    hair: "Hair",
    beard: "Hair",
    torso: "Clothing",
    outerwear: "Clothing",
    neckwear: "Clothing",
    legs: "Clothing",
    feet: "Clothing",
}
const CREDITS =
    "LPC Revised / justgook/LPC-rework\nStephen Challener (Redshrike), Eliza Wyatt (DeathsDarling),\nDurrani, BenCreating, Salvador Oblea Jr. (joblea);\nPage hair: Johannes Sjölund (Wulax), Eliza Wyatt.\nVerified fixture records: OGA-BY 3.0 · https://static.opengameart.org/OGA-BY-3.0.txt\nLocal facial-hair fixtures: individual attribution/license unresolved; not redistribution clearance.\nHelmets, bowtie, suspenders, cardigan: Eliza Wyatt (DeathsDarling).\nChanges: cropped inventory icons; non-destructive palette previews.\nFull original credits, sources and license: fixtures/lpc/provenance/."

// USER-APPROVED EXCEPTION: View-owned shadow CSS for equipment/inventory cell
// dimensions and the character preview viewport. The user additionally approved
// 32px, centered empty/remove icons and three square inventory columns.
// No theme colors, font-family or selection
// overrides. Any further View-specific CSS requires explicit user approval.
const APPROVED_LAYOUT_CSS = `
table[aria-label="Equipment"] {
    table-layout: fixed;
    flex-shrink: 0;
}
table[aria-label="Equipment"] > colgroup > col:first-child,
table[aria-label="Equipment"] > colgroup > col:last-child,
table[aria-label="Available parts"] > colgroup > col {
    width: 64px;
}
table[role="grid"] > tbody > tr > td[aria-selected] {
    height: 64px;
    box-sizing: border-box;
}
/* User-approved addition: empty equipment icons and inventory remove only. */
table[role="grid"] > tbody > tr > td[aria-selected]:has(> i) {
    vertical-align: middle;
}
table[role="grid"] > tbody > tr > td[aria-selected] > i {
    font-size: 32px;
    line-height: 1;
    display: block;
    width: max-content;
    margin-inline: auto;
}
table[aria-label="Equipment"] > tbody > tr > td[rowspan] {
    position: relative;
}
table[aria-label="Equipment"] > tbody > tr > td[rowspan] > widget-animation-preview {
    position: absolute;
    inset: 4px;
    display: block;
    overflow: auto;
}
table[aria-label="Equipment"] > tbody > tr > td[rowspan] > widget-animation-preview > canvas {
    display: block;
    margin-inline: auto;
    max-width: none;
    max-height: none;
}
table[aria-label="Available parts"] {
    table-layout: fixed;
    /* Fixed column widths plus the theme's own border spacing determine width. */
    width: 0;
}
`

function assert(condition, message) {
    if (!condition) throw new Error(`view-character: ${message}`)
}
function htmlText(value) {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
}
function canvasOf(width, height) {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    return canvas
}
function context2d(canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true })
    assert(context, "2D canvas context required")
    context.imageSmoothingEnabled = false
    return context
}
async function pngCanvas(base64, width, height) {
    assert(typeof base64 === "string" && base64.length > 0, "fixture PNG required")
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }))
    assert(bitmap.width === width && bitmap.height === height, "unexpected fixture PNG dimensions")
    const canvas = canvasOf(width, height)
    context2d(canvas).drawImage(bitmap, 0, 0)
    bitmap.close()
    return canvas
}
function clipFrame(canvas) {
    return {
        durationMs: 250,
        pixels: {
            width: canvas.width,
            height: canvas.height,
            data: Array.from(context2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data),
        },
    }
}
function setPreview(element, canvases) {
    assert(canvases.length > 0, "preview needs frames")
    element.clip = {
        width: canvases[0].width,
        height: canvases[0].height,
        direction: "forward",
        repeat: 0,
        frames: canvases.map(clipFrame),
    }
}

export class ViewCharacter extends HTMLElement {
    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        this.themeObserver = new MutationObserver(() => this.syncThemeStylesheet())
        this.headerControls = []
        this.equipmentGrid = null
        this.inventoryGrid = null
        this.items = new Map()
        this.slots = []
        this.slotsById = new Map()
        this.fixtureLoad = null
        this.coloredCache = new Map()
        this.tipToken = null
        this.tipId = null
        this.resizeObserver = new ResizeObserver(() => this.updatePreview())
        this.resetState()
    }
    resetState() {
        this.parts = Object.fromEntries(this.slots.map(({ id }) => [id, Object.hasOwn(DEFAULT_PARTS, id) ? DEFAULT_PARTS[id] : null]))
        this.colors = Object.fromEntries(this.paletteRoles().map(([role]) => [role, DEFAULT_COLORS[role]]))
        this.selectedSlot = Object.hasOwn(this.parts, "torso") ? "torso" : this.slots.length ? this.slots[0].id : null
        this.search = ""
        this.direction = "south"
        this.playing = false
        this.scale = 3
    }
    connectedCallback() {
        this.style.display = "contents"
        registerViewPlugin(this)
        const theme = document.getElementById("theme-stylesheet")
        assert(theme instanceof HTMLLinkElement, "Host theme stylesheet link required")
        this.themeObserver.observe(theme, { attributes: true, attributeFilter: ["href"] })
        this.setContent('<form><output class="info">Loading character development data…</output></form>')
        void this.reload()
    }
    syncThemeStylesheet() {
        const link = ensureThemeStylesheetLink(this.shadowRoot)
        assert(link && link.getAttribute("href"), "Host theme stylesheet source required")
    }
    setContent(markup) {
        this.shadowRoot.innerHTML = `<link rel="stylesheet" href="/css/reset.css">
            <link rel="stylesheet" href="/css/base.css">
            <style>${APPROVED_LAYOUT_CSS}</style>${markup}`
        this.syncThemeStylesheet()
    }
    destroyGrids() {
        if (this.equipmentGrid !== null) this.equipmentGrid.destroy()
        if (this.inventoryGrid !== null) this.inventoryGrid.destroy()
        this.equipmentGrid = null
        this.inventoryGrid = null
    }
    disconnectedCallback() {
        this.themeObserver.disconnect()
        this.destroyGrids()
        this.resizeObserver.disconnect()
        this.closeTip()
        for (const control of this.headerControls) control.remove()
        this.headerControls = []
        void unregisterViewPlugin(this)
    }
    slotRecord(id) {
        const record = this.slotsById.get(id)
        assert(record, `unknown editor slot ${id}`)
        return record
    }
    paletteRoles() {
        return Object.entries(COLOR_CATEGORIES).filter(([role]) => role === "skin"
            ? this.slotsById.has("body") || this.slotsById.has("head") : this.slotsById.has(role))
    }
    async loadSlots(records) {
        if (records === undefined) records = await readSlotRows()
        assert(Array.isArray(records) && records.length > 0, "slot registry must not be empty")
        for (const record of records) {
            for (const key of ["id", "name", "icon"]) assert(typeof record[key] === "string" && record[key].trim().length > 0, `slot ${key} required`)
            record.order = Number(record.order)
            assert(Number.isSafeInteger(record.order), `invalid slot order for ${record.id}`)
        }
        const byId = new Map(records.map(record => [record.id, record]))
        assert(byId.size === records.length, "duplicate slot ids")
        assert(new Set(records.map(record => record.order)).size === records.length, "duplicate slot sort order")
        this.slots = records
        this.slotsById = byId
    }
    async loadFixtures() {
        const bytes = unwrap(
            await runtime.invoke("fs/fs::read-file", "fixtures/lpc/mock-catalog.json"),
            "LPC fixture read",
        )
        this.fixture = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)))
        assert(this.fixture.frame_size === 64 && this.fixture.idle_frames === 3, "unexpected fixture frame map")
        assert(Array.isArray(this.fixture.items) && this.fixture.items.length > 0, "fixture items required")
        assert(this.fixture.palettes && this.fixture.direction_rows, "fixture palettes and directions required")
        const records = await Promise.all(
            this.fixture.items.map(async (item) => {
                assert(DRAW_ORDER.includes(item.slot), `unsupported fixture render role ${item.slot}`)
                assert(typeof item.id === "string" && typeof item.name === "string", "fixture identity required")
                const [sheet, icon] = await Promise.all([
                    pngCanvas(item.sheet_base64, 192, 256),
                    pngCanvas(item.icon_base64, 32, 32),
                ])
                return { ...item, sheet, icon }
            }),
        )
        for (const item of records) {
            assert(!this.items.has(item.id), `duplicate fixture ${item.id}`)
            this.items.set(item.id, item)
        }
        for (const [slot, id] of Object.entries(DEFAULT_PARTS))
            assert(this.item(id).slot === slot, `bad default ${slot}`)
        assert(
            new Set(DRAW_ORDER).size === DRAW_ORDER.length,
            "painter order must contain every slot exactly once",
        )
    }
    item(id) {
        const item = this.items.get(id)
        assert(item, `missing fixture ${id}`)
        return item
    }
    required(selector) {
        const element =
            this.shadowRoot.querySelector(selector) ||
            this.headerControls.map((control) => control.querySelector(selector)).find(Boolean)
        assert(element, `missing DOM ${selector}`)
        return element
    }
    async reload() {
        this.closeTip()
        try {
            await this.loadSlots(await replayDevelopmentSQL())
            if (!this.items.size) {
                if (this.fixtureLoad === null) this.fixtureLoad = this.loadFixtures()
                try { await this.fixtureLoad }
                finally { this.fixtureLoad = null }
            }
            this.resetState()
            if (this.isConnected) this.render()
        } catch (error) {
            if (this.isConnected) {
                const output = this.shadowRoot.querySelector('[data-element="status"]') || this.required('output')
                output.textContent = `Character reload failed: ${error.message}`
                output.className = "danger"
            }
            throw error
        }
    }
    role(slot) {
        return slot === "body" || slot === "head" ? "skin" : slot
    }
    colored(item, icon = false) {
        const palette = this.colors[this.role(item.slot)]
        const key = `${item.id}:${palette}:${icon}`
        if (this.coloredCache.has(key)) return this.coloredCache.get(key)
        const ramps = this.fixture.palettes[item.ramp_category]
        assert(ramps && ramps[item.source_ramp] && ramps[palette], `missing ramp for ${item.id}`)
        const replacements = new Map(
            ramps[item.source_ramp].map((rgba, index) => [rgba.slice(0, 3).join(","), ramps[palette][index]]),
        )
        const source = icon ? item.icon : item.sheet
        const canvas = canvasOf(source.width, source.height),
            c = context2d(canvas)
        c.drawImage(source, 0, 0)
        const pixels = c.getImageData(0, 0, canvas.width, canvas.height)
        for (let i = 0; i < pixels.data.length; i += 4) {
            if (pixels.data[i + 3] === 0) continue
            const replacement = replacements.get(`${pixels.data[i]},${pixels.data[i + 1]},${pixels.data[i + 2]}`)
            if (replacement) pixels.data.set(replacement.slice(0, 3), i)
        }
        c.putImageData(pixels, 0, 0)
        this.coloredCache.set(key, canvas)
        return canvas
    }
    showTip(button, content) {
        this.closeTip()
        const token = {}
        this.tipToken = token
        const rect = button.getBoundingClientRect()
        void runtime
            .call("ui.tooltip.tip", {
                content,
                minWidth: 120,
                anchor: { kind: "aabb", x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                closeWhenPointerLeavesTrack: true,
            })
            .then((result) => {
                const { id } = unwrap(result, "ui.tooltip.tip")
                assert(Number.isInteger(id), "tooltip service did not return an id")
                if (this.tipToken === token) this.tipId = id
                else void runtime.call("ui.tooltip.close", { id, reason: "stale-character-tip" })
            })
    }
    closeTip() {
        this.tipToken = null
        if (this.tipId !== null)
            void runtime.call("ui.tooltip.close", { id: this.tipId, reason: "character-tip-ended" })
        this.tipId = null
    }
    bindTip(button, content) {
        button.addEventListener("pointerenter", () => this.showTip(button, content))
        button.addEventListener("pointerleave", () => this.closeTip())
        button.addEventListener("focus", () => this.showTip(button, content))
        button.addEventListener("blur", () => this.closeTip())
        button.addEventListener("click", () => this.closeTip())
    }
    render() {
        this.destroyGrids()
        this.resizeObserver.disconnect()
        this.closeTip()
        for (const control of this.headerControls) control.remove()
        this.headerControls = []
        this.setContent(`
            <div slot="header-controls" data-element="toolbar">
                <div role="buttongroup" data-element="tool-actions">
                    <button type="button" data-action="randomize" aria-label="Randomize"><i aria-hidden="true">casino</i></button>
                    <button type="button" data-action="reset" aria-label="Reset"><i aria-hidden="true">restart_alt</i></button>
                </div>
                <select data-field="direction" aria-label="Facing"><option value="south">Front</option><option value="west">Left</option><option value="north">Back</option><option value="east">Right</option></select>
                <select data-field="scale" aria-label="Preview zoom"><option value="1">1×</option><option value="2">2×</option><option value="3">3×</option><option value="4">4×</option></select>
                <button type="button" data-action="play" aria-label="Play idle" aria-pressed="false"><i aria-hidden="true">play_arrow</i></button>
            </div>
            <form aria-label="LPC character">
                <table role="grid" data-layout="separate" aria-label="Equipment"><colgroup><col><col><col></colgroup><tbody data-element="equipment"></tbody></table>
                <fieldset><legend>Palette</legend><table aria-label="Part palettes"><thead><tr><th scope="col">Name</th><th scope="col">Palette</th><th scope="col">Colors</th></tr></thead><tbody>${this.paletteRoles()
                    .map(
                        ([role, category]) =>
                            `<tr><th scope="row">${role === "skin" ? "Skin" : htmlText(this.slotRecord(role).name)}</th><td><select data-color="${role}" aria-label="${role} palette">${Object.keys(
                                this.fixture.palettes[category],
                            )
                                .map((name) => `<option>${name}</option>`)
                                .join(
                                    "",
                                )}</select></td><td><widget-animation-preview data-palette="${role}" aria-hidden="true"></widget-animation-preview></td></tr>`,
                    )
                    .join("")}</tbody></table></fieldset>
            </form>
            <aside aria-label="Part browser">
                <fieldset><legend data-element="picker-title"></legend>
                    <input type="search" data-field="search" aria-label="Search parts" placeholder="Search parts…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
                    <table role="grid" data-layout="separate" aria-label="Available parts"><colgroup>${"<col>".repeat(INVENTORY_COLUMNS)}</colgroup><tbody data-element="choices"></tbody></table>
                    <output data-element="empty"></output>
                </fieldset>
            </aside>
            <footer><output data-element="status" aria-live="polite"></output><button type="button" data-action="credits">Credits · LPC Revised</button></footer>
        `)
        this.required("form").addEventListener("submit", (event) => event.preventDefault())
        this.required('[data-field="direction"]').value = this.direction
        this.required('[data-field="scale"]').value = String(this.scale)
        this.required('[data-field="search"]').value = this.search
        this.required('[data-field="direction"]').addEventListener("change", (event) => {
            this.direction = event.target.value
            this.updatePreview()
        })
        this.required('[data-field="scale"]').addEventListener("change", (event) => {
            this.scale = Number(event.target.value)
            this.updatePreview()
        })
        this.required('[data-action="play"]').addEventListener("click", () => {
            this.playing = !this.playing
            this.updatePlayback()
        })
        this.required('[data-action="reset"]').addEventListener("click", () => this.reload())
        this.required('[data-action="randomize"]').addEventListener("click", () => {
            for (const { id: slot } of this.slots) {
                const choices = [...this.items.values()].filter((item) => item.slot === slot)
                this.parts[slot] = choices.length ? choices[Math.floor(Math.random() * choices.length)].id : null
            }
            this.update()
        })
        this.required('[data-field="search"]').addEventListener("input", (event) => {
            this.search = event.target.value
            this.updatePicker()
        })
        this.shadowRoot.querySelectorAll("[data-color]").forEach((element) => {
            element.value = this.colors[element.dataset.color]
            element.addEventListener("change", () => {
                this.colors[element.dataset.color] = element.value
                this.update()
            })
        })
        for (const [action, text] of [
            ["randomize", "Randomize parts"],
            ["reset", "Reset session"],
            ["play", "Play / pause idle"],
            ["credits", CREDITS],
        ]) {
            this.bindTip(this.required(`[data-action="${action}"]`), text)
        }
        this.required('[data-action="credits"]').addEventListener("click", (event) =>
            this.showTip(event.currentTarget, CREDITS),
        )
        assert(this.parentElement, "View must be mounted in an Area")
        this.headerControls = Array.from(this.shadowRoot.querySelectorAll('[slot="header-controls"]'))
        this.parentElement.append(...this.headerControls)
        this.equipmentGrid = bindSelectableGrid(this.required('[role="grid"][aria-label="Equipment"]'), {
            activate: (cell) => {
                this.slotRecord(cell.dataset.slot)
                this.selectedSlot = cell.dataset.slot
                this.search = ""
                this.required('[data-field="search"]').value = ""
                this.update()
            },
        })
        this.inventoryGrid = bindSelectableGrid(this.required('[role="grid"][aria-label="Available parts"]'), {
            activate: (cell) => {
                const slot = this.selectedSlot
                if (cell.dataset.action === "remove") {
                    assert(slot !== "body" && slot !== "head", "base parts are required in this sample")
                    this.parts[slot] = null
                } else {
                    const item = this.item(cell.dataset.item)
                    assert(item.slot === slot, "inventory item belongs to another slot")
                    this.parts[slot] = item.id
                }
                this.update()
            },
        })
        this.update()
        this.resizeObserver.observe(this.required("form"))
    }
    itemCell(slot, item, equippedSlot = false) {
        const { name: label, icon: symbol } = this.slotRecord(slot)
        const cell = document.createElement("td")
        cell.setAttribute("role", "gridcell")
        const remove = !equippedSlot && item === null
        if (equippedSlot) cell.dataset.slot = slot
        else if (remove) cell.dataset.action = "remove"
        else cell.dataset.item = item.id
        const name = item === null ? "Empty" : item.name
        cell.setAttribute(
            "aria-label",
            equippedSlot ? `${label}: ${name}` : remove ? `Unequip ${label}` : `Equip ${name}`,
        )
        cell.setAttribute(
            "aria-selected",
            String(equippedSlot ? this.selectedSlot === slot : this.parts[slot] === (item === null ? null : item.id)),
        )
        cell.setAttribute("aria-disabled", String(remove && (slot === "body" || slot === "head")))
        if (item === null) {
            const icon = document.createElement("i")
            icon.textContent = remove ? "remove_circle_outline" : symbol
            if (!remove) icon.classList.add("game-icons")
            icon.setAttribute("aria-hidden", "true")
            cell.append(icon)
        } else {
            const preview = document.createElement("widget-animation-preview")
            preview.setAttribute("aria-hidden", "true")
            setPreview(preview, [this.colored(item, true)])
            cell.append(preview)
        }
        this.bindTip(cell, remove ? `Unequip ${label}` : `${label} · ${name}`)
        return cell
    }
    updateBoard() {
        const body = this.required('[data-element="equipment"]')
        const focus = body.contains(this.shadowRoot.activeElement)
        body.replaceChildren()
        const preview = document.createElement("widget-animation-preview")
        preview.dataset.element = "character-preview"
        preview.setAttribute("aria-label", "LPC character preview")
        const rowCount = Math.ceil(this.slots.length / 2)
        for (let i = 0; i < rowCount; i++) {
            const row = body.insertRow()
            const appendSlot = ({ id: slot }) => {
                const id = this.parts[slot]
                row.append(this.itemCell(slot, id === null ? null : this.item(id), true))
            }
            appendSlot(this.slots[i * 2])
            if (i === 0) {
                const cell = row.insertCell()
                cell.setAttribute("role", "gridcell")
                cell.rowSpan = rowCount
                cell.append(preview)
            }
            const right = this.slots[i * 2 + 1]
            if (right !== undefined) appendSlot(right)
        }
        this.equipmentGrid.refresh({ focus })
    }
    updatePreview() {
        const row = this.fixture.direction_rows[this.direction]
        assert(Number.isInteger(row), "unknown fixture direction")
        const preview = this.required('[data-element="character-preview"]')
        assert(preview.parentElement, "preview cell required")
        const width = Math.max(1, Math.floor(preview.parentElement.getBoundingClientRect().width) - 12)
        const size = 64 * this.scale
        const height = Math.max(size, preview.clientHeight)
        const frames = Array.from({ length: 3 }, (_, index) => {
            const canvas = canvasOf(width, height),
                c = context2d(canvas)
            // This reviewed subset uses prealigned 64x64 cells; no inferred offsets.
            for (const slot of DRAW_ORDER) {
                if (!Object.hasOwn(this.parts, slot)) continue
                const id = this.parts[slot]
                if (id === null) continue
                c.drawImage(
                    this.colored(this.item(id)),
                    index * 64,
                    row * 64,
                    64,
                    64,
                    Math.floor((width - size) / 2),
                    Math.floor((height - size) / 2),
                    size,
                    size,
                )
            }
            return canvas
        })
        setPreview(this.required('[data-element="character-preview"]'), frames)
        this.updatePlayback()
    }
    updatePlayback() {
        this.required('[data-element="character-preview"]').playing = this.playing
        const button = this.required('[data-action="play"]')
        button.setAttribute("aria-pressed", String(this.playing))
        button.setAttribute("aria-label", this.playing ? "Pause idle" : "Play idle")
        button.querySelector("i").textContent = this.playing ? "pause" : "play_arrow"
        this.updateStatus()
    }
    updatePicker() {
        this.closeTip()
        const slot = this.selectedSlot
        this.required('[data-element="picker-title"]').textContent = this.slotRecord(slot).name
        const choices = [...this.items.values()].filter(
            (item) => item.slot === slot && item.name.toLowerCase().includes(this.search.toLowerCase()),
        )
        const body = this.required('[data-element="choices"]')
        const focus = body.contains(this.shadowRoot.activeElement)
        body.replaceChildren()
        const entries = [null, ...choices]
        for (let i = 0; i < entries.length; i += INVENTORY_COLUMNS) {
            const row = body.insertRow()
            for (const item of entries.slice(i, i + INVENTORY_COLUMNS)) row.append(this.itemCell(slot, item))
        }
        this.inventoryGrid.refresh({ focus })
        this.required('[data-element="empty"]').textContent = choices.length ? "" : "No matching parts"
    }
    updatePalettes() {
        for (const [role, category] of this.paletteRoles()) {
            const name = this.colors[role]
            const ramp = this.fixture.palettes[category][name]
            assert(Array.isArray(ramp) && ramp.length > 0, `missing ${role} palette ${name}`)
            const canvas = canvasOf(ramp.length * 20, 16),
                context = context2d(canvas)
            ramp.forEach(([red, green, blue, alpha], index) => {
                context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`
                context.fillRect(index * 20, 0, 20, 16)
            })
            const preview = this.required(`[data-palette="${role}"]`)
            setPreview(preview, [canvas])
            assert(preview.parentElement instanceof HTMLTableCellElement, "palette color cell required")
            const colors = ramp.map(
                (rgba) => `#${rgba.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`,
            )
            preview.parentElement.setAttribute("aria-label", `${name}: ${colors.join(", ")}`)
        }
    }
    updateStatus() {
        this.required('[data-element="status"]').textContent =
            `LPC sample · ${Object.values(this.parts).filter((id) => id !== null).length} parts · ${this.direction} · ${this.scale}× · session only`
    }
    update() {
        this.closeTip()
        this.updatePalettes()
        this.updateBoard()
        this.updatePreview()
        this.updatePicker()
    }
}

customElements.define("view-character", ViewCharacter)
