import "/widgets/animation-preview.js"
import { runtime, unwrap } from "/core/runtime.js"
import { registerViewPlugin, unregisterViewPlugin } from "/util/view-plugin.js"
import { bindSelectableGrid } from "/util/selectable-grid.js"
import { ensureThemeStylesheetLink } from "/util/add-style.js"
import { sql } from "/util/sql.js"
import { ViewCanvasBase } from "/util/view-canvas-base.js"

const BODY_SLOT_ID = "body-z12"
const DEFAULT_BODY_TYPE = "m"

// Catalog decoding and composition stay in this file: GAMS loads Views as standalone modules.
// Temporary, explicitly authored playback policy; catalog IDs/names remain SQL-owned.
function animationSettings(animationId) {
    const settings = {
        "1h_backslash": [64, 13],
        "1h_halfslash": [64, 6],
        "1h_slash": [64, 13],
        backslash_128: [128, 13],
        climb: [64, 6, "S"],
        combat: [64, 2],
        emote: [64, 3],
        halfslash_128: [128, 6],
        hurt: [64, 6, "S"],
        idle: [64, 2],
        jump: [64, 5],
        run: [64, 8],
        shoot: [64, 13],
        sit: [64, 3],
        slash: [64, 6],
        slash_128: [128, 6],
        slash_oversize: [192, 6],
        slash_reverse_oversize: [192, 6],
        spellcast: [64, 7],
        thrust: [64, 8],
        thrust_oversize: [192, 8],
        tool_axe: [128, 6],
        tool_hammer: [128, 6],
        tool_rod: [128, 13],
        tool_whip: [192, 8],
        walk: [64, 9],
        walk_128: [128, 13],
        wheelchair: [64, 2],
    }
    assert(Object.hasOwn(settings, animationId), `Missing animation settings: ${animationId}`)
    const [size, count, directions = "NESW"] = settings[animationId]
    return {
        frame_width: size,
        frame_height: size,
        frame_count: count,
        directions,
        sequence: Array.from({ length: count }, (_, i) => i),
        durations_ms: Array(count).fill(animationId === "idle" ? 400 : 100),
    }
}
async function selectAnimationPack(item, characterState, database = sql) {
    text(item.id, "selected item ID")
    text(characterState.animation, "selected animation")
    assert(
        typeof characterState.body === "string" && /^[mftclp]$/.test(characterState.body),
        "character body must be one body code",
    )
    assert(item.sheets instanceof Map, "selected item requires catalog sprite metadata")
    const metadata = item.sheets.get(characterState.animation)
    if (metadata === undefined) return []
    const first = metadata.find((row) => row.body.includes(characterState.body))
    if (first === undefined) return []
    const pack = metadata.filter((row) => row.body === first.body),
        result = []
    // Exact, opaque primary keys avoid rescanning the entire sprite table for
    // every equipped item. Body policy still follows metadata's SQL id order.
    for (let offset = 0; offset < pack.length; offset += 256) {
        const ids = pack.slice(offset, offset + 256).map((row) => row.id)
        const rows = await database.queryObjects(
            `SELECT id, item, animation, layer, mask, body, data FROM sprites WHERE item = ? AND animation = ? AND body = ? AND id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`,
            ["id", "item", "animation", "layer", "mask", "body", "data"],
            [item.id, characterState.animation, first.body, ...ids],
        )
        assert(
            rows.length === ids.length &&
                rows.every(
                    (row, index) =>
                        row.id === ids[index] &&
                        row.item === item.id &&
                        row.animation === characterState.animation &&
                        row.body === first.body,
                ),
            "selected sprite pack changed; reload catalog",
        )
        result.push(...rows)
    }
    return result
}
class LayerConflictError extends Error {
    constructor(layer, animation, previous, current) {
        super(
            `view-character: Layer ${layer} conflict (${animation}): ${previous.slot}/${previous.item} and ${current.slot}/${current.item}`,
        )
        this.name = "LayerConflictError"
        this.components = [previous, current].map(({ slot, item }) => ({ slot, item }))
    }
}
function orderedComponents(components, animation) {
    const occupied = new Map()
    for (const c of components) {
        positive(c.layer, `layer for ${c.slot}/${c.item} (${animation})`)
        assert(c.mask === 0 || c.mask === 1, "component mask must be 0 or 1")
        if (c.mask) continue
        const previous = occupied.get(c.layer)
        if (previous) throw new LayerConflictError(c.layer, animation, previous, c)
        occupied.set(c.layer, c)
    }
    return [...components].sort((a, b) => a.layer - b.layer)
}
function parseGpl(text) {
    assert(typeof text === "string", "GPL must be text")
    const lines = text.split(/\r\n|\n|\r/)
    assert(lines.shift() === "GIMP Palette", "expected GIMP Palette header")
    let name, columns
    const colors = [[0, 0, 0, 0]],
        colorNames = ["Transparent"]
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        if (/^(Name|Columns):/.test(trimmed)) {
            assert(colors.length === 1, "GPL metadata must precede colors")
            const colon = trimmed.indexOf(":"),
                key = trimmed.slice(0, colon),
                value = trimmed.slice(colon + 1).trim()
            if (key === "Name") {
                assert(name === undefined && value, "GPL Name must occur once and be nonempty")
                name = value
            } else {
                assert(columns === undefined && /^\d+$/.test(value) && Number(value) <= 256, "invalid GPL Columns")
                columns = Number(value)
            }
            continue
        }
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)(?:\s+(.*))?$/.exec(line)
        assert(match, "GPL expected RGB integers and optional color name")
        const rgb = match.slice(1, 4).map(Number)
        assert(
            rgb.every((n) => n <= 255),
            "GPL RGB must be 0..255",
        )
        colors.push([...rgb, 255])
        colorNames.push((match[4] || "").trim())
        assert(colors.length <= 256, "GPL supports at most 255 visible colors")
    }
    assert(name !== undefined && colors.length > 1, "GPL requires Name and colors")
    return { name, colors, colorNames }
}
function crc32(bytes) {
    let crc = 0xffffffff
    for (const byte of bytes) {
        crc ^= byte
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    return (crc ^ 0xffffffff) >>> 0
}
function bytesOf(blob) {
    if (blob instanceof Uint8Array) return blob
    if (blob instanceof ArrayBuffer) return new Uint8Array(blob)
    assert(
        Array.isArray(blob) && blob.every((v) => Number.isInteger(v) && v >= 0 && v <= 255),
        "image BLOB must contain bytes",
    )
    return new Uint8Array(blob)
}
async function decodeIndexedPng(blob, label = "PNG") {
    const bytes =
        typeof Blob !== "undefined" && blob instanceof Blob ? new Uint8Array(await blob.arrayBuffer()) : bytesOf(blob)
    const check = (ok, message) => assert(ok, `${label}: ${message}`)
    check(
        bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v),
        "invalid PNG signature",
    )
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        compressed = [],
        seen = new Set()
    let offset = 8,
        width,
        height,
        depth,
        palette,
        transparency,
        ended = false,
        idatClosed = false
    while (offset < bytes.length) {
        check(offset + 12 <= bytes.length, "truncated chunk")
        const length = view.getUint32(offset),
            start = offset + 8,
            end = start + length
        check(length <= 0x7fffffff && end + 4 <= bytes.length, "invalid chunk length")
        const type = String.fromCharCode(...bytes.subarray(offset + 4, start)),
            data = bytes.subarray(start, end)
        check(/^[A-Za-z]{4}$/.test(type) && type[2] === type[2].toUpperCase(), "invalid chunk type")
        check(crc32(bytes.subarray(offset + 4, end)) === view.getUint32(end), `${type} CRC mismatch`)
        check(seen.has("IHDR") || type === "IHDR", "IHDR must be first")
        if (type !== "IDAT" && compressed.length) idatClosed = true
        if (type === "IHDR") {
            check(!seen.has(type) && length === 13, "invalid IHDR")
            width = view.getUint32(start)
            height = view.getUint32(start + 4)
            depth = data[8]
            check(
                width > 0 &&
                    height > 0 &&
                    width <= 0x7fffffff &&
                    height <= 0x7fffffff &&
                    Number.isSafeInteger(width * height),
                "invalid dimensions",
            )
            check([1, 2, 4, 8].includes(depth) && data[9] === 3, "expected indexed PNG (depth 1/2/4/8), not RGBA")
            check(data[10] === 0 && data[11] === 0 && data[12] === 0, "unsupported compression/filter/interlace")
        } else if (type === "PLTE") {
            check(
                !seen.has(type) &&
                    !seen.has("tRNS") &&
                    !compressed.length &&
                    length > 0 &&
                    length % 3 === 0 &&
                    length / 3 <= 2 ** depth,
                "invalid PLTE",
            )
            palette = Array.from({ length: length / 3 }, (_, i) => [...data.subarray(i * 3, i * 3 + 3), 255])
        } else if (type === "tRNS") {
            check(
                palette && !seen.has(type) && !compressed.length && length > 0 && length <= palette.length,
                "invalid tRNS",
            )
            transparency = data
        } else if (type === "IDAT") {
            check(palette && !idatClosed, "IDAT requires PLTE and consecutive chunks")
            compressed.push(data)
        } else if (type === "IEND") {
            check(length === 0 && compressed.length > 0 && end + 4 === bytes.length, "invalid IEND or trailing data")
            ended = true
        } else check(type[0] === type[0].toLowerCase(), `unknown critical chunk ${type}`)
        seen.add(type)
        offset = end + 4
    }
    check(ended, "missing IEND")
    if (transparency)
        transparency.forEach((alpha, i) => {
            palette[i][3] = alpha
        })
    const stride = Math.ceil((width * depth) / 8),
        expected = (stride + 1) * height
    check(Number.isSafeInteger(expected), "invalid raster size")
    const reader = new Blob(compressed).stream().pipeThrough(new DecompressionStream("deflate")).getReader(),
        chunks = []
    let size = 0
    try {
        while (true) {
            const { value, done } = await reader.read()
            if (done) break
            size += value.length
            if (size > expected) {
                await reader.cancel()
                check(false, "excess decompressed data")
            }
            chunks.push(value)
        }
    } catch (error) {
        throw new Error(`${label}: PNG decompression failed: ${error.message}`)
    }
    check(size === expected, "incorrect decompressed length")
    const raw = new Uint8Array(size)
    let position = 0
    for (const chunk of chunks) {
        raw.set(chunk, position)
        position += chunk.length
    }
    const indices = new Uint8Array(width * height)
    let previous = new Uint8Array(stride)
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)],
            row = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1))
        check(filter <= 4, `invalid PNG filter ${filter}`)
        for (let x = 0; x < stride; x++) {
            const left = x ? row[x - 1] : 0,
                up = previous[x],
                upperLeft = x ? previous[x - 1] : 0
            let predictor = 0
            if (filter === 1) predictor = left
            if (filter === 2) predictor = up
            if (filter === 3) predictor = Math.floor((left + up) / 2)
            if (filter === 4) {
                const p = left + up - upperLeft,
                    a = Math.abs(p - left),
                    b = Math.abs(p - up),
                    c = Math.abs(p - upperLeft)
                predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft
            }
            row[x] = (row[x] + predictor) & 255
        }
        for (let x = 0; x < width; x++) {
            const index = (row[Math.floor((x * depth) / 8)] >>> (8 - depth - ((x * depth) % 8))) & ((1 << depth) - 1)
            check(index < palette.length, `palette index ${index} out of range`)
            indices[y * width + x] = index
        }
        previous = row
    }
    return { width, height, indices, palette }
}
const ID = /^[a-z][a-z0-9_-]*(?![\s\S])/
function text(v, label) {
    assert(typeof v === "string" && v.trim().length > 0, `${label} must be nonempty text`)
}
function id(v, label) {
    assert(typeof v === "string" && ID.test(v), `invalid ${label}: ${v}`)
}
function positive(v, label) {
    assert(Number.isSafeInteger(v) && v > 0, `${label} must be a positive integer`)
}
function unique(map, row, label) {
    assert(!map.has(row.id), `duplicate ${label} ${row.id}`)
    map.set(row.id, row)
}
function validateColors(colors, label) {
    assert(Array.isArray(colors) && colors.length >= 2 && colors.length <= 256, `${label}: invalid palette count`)
    colors.forEach((color, index) => {
        assert(
            Array.isArray(color) && color.length === 4 && color.every((v) => Number.isInteger(v) && v >= 0 && v <= 255),
            `${label}: invalid RGBA`,
        )
        assert(color[3] === (index === 0 ? 0 : 255), `${label}: expected transparent index 0 and opaque visible colors`)
    })
}
function validateMask(image, label) {
    const pixels = sourcePixels(image, null)
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 0) continue
        assert(
            pixels[i + 3] === 255 &&
                [0, 255].includes(pixels[i]) &&
                pixels[i] === pixels[i + 1] &&
                pixels[i] === pixels[i + 2],
            `${label}: mask must contain binary black/white pixels`,
        )
    }
}
function validateAnimation(row) {
    text(row.id, "animation ID")
    text(row.name, "animation name")
    for (const key of ["frame_width", "frame_height", "frame_count"]) positive(row[key], key)
    assert(typeof row.directions === "string" && /^(NESW|S)$/.test(row.directions), `${row.id}: invalid directions`)
    assert(
        Array.isArray(row.sequence) &&
            row.sequence.length > 0 &&
            row.sequence.every((n) => Number.isSafeInteger(n) && n >= 0 && n < row.frame_count),
        `${row.id}: invalid sequence`,
    )
    assert(
        Array.isArray(row.durations_ms) &&
            row.durations_ms.length === row.sequence.length &&
            row.durations_ms.every((n) => Number.isSafeInteger(n) && n > 0 && n % 10 === 0),
        `${row.id}: invalid durations_ms`,
    )
    assert(
        Number.isSafeInteger(row.frame_width * row.frame_count) &&
            Number.isSafeInteger(row.frame_height * row.directions.length),
        `${row.id}: invalid sheet geometry`,
    )
}
async function catalogQuery(sql, table, columns, order) {
    const rows = await sql.queryObjects(`SELECT ${columns.join(", ")} FROM ${table} ORDER BY ${order}`, columns)
    assert(Array.isArray(rows), `${table}: expected rows`)
    return rows.map((row) => ({ ...row }))
}
async function pagedMetadata(sql, table, columns, field, value, isCurrent) {
    const records = []
    let cursor = null
    while (isCurrent()) {
        const rows = await sql.queryObjects(
            `SELECT ${columns.join(", ")} FROM ${table} WHERE ${field} = ?${cursor === null ? "" : " AND id > ?"} ORDER BY id LIMIT 512`,
            columns,
            cursor === null ? [value] : [value, cursor],
        )
        if (!isCurrent()) return null
        assert(Array.isArray(rows), `${table}: expected rows`)
        records.push(...rows.map((row) => ({ ...row })))
        if (rows.length < 512) return records
        cursor = rows[rows.length - 1].id
        text(cursor, `${table} page cursor`)
    }
    return null // Reset/disconnect cancelled this demand; never publish a partial page set.
}
async function loadCatalog(sql) {
    const slotRows = await sql.queryObjects(
        'SELECT id, name, icon, (SELECT json_group_array(item) FROM "item-slots" WHERE slot = slots.id) AS requiredItems FROM slots ORDER BY "order", id',
        ["id", "name", "icon", "requiredItems"],
    )
    assert(Array.isArray(slotRows), "slots: expected rows")
    const slots = slotRows.map((row) => ({ ...row }))
    assert(slots.length > 0, "catalog requires nonempty slots")
    const slotMap = new Map()
    for (const row of slots) {
        id(row.id, "slot ID")
        text(row.name, "slot name")
        text(row.icon, "slot icon")
        assert(!["palettes", "provenance"].includes(row.id), "reserved slot ID")
        row.requiredItems = JSON.parse(row.requiredItems)
        assert(Array.isArray(row.requiredItems), `${row.id}: required slot items must be an array`)
        for (const item of row.requiredItems) text(item, `${row.id}: required item ID`)
        assert(new Set(row.requiredItems).size === row.requiredItems.length, `${row.id}: duplicate required item`)
        unique(slotMap, row, "slot")
    }
    const animations = (await catalogQuery(sql, "animations", ["id", "name"], '"order", id')).map(
            (row) => ({
                ...row,
                ...animationSettings(row.id),
            }),
        ),
        animationMap = new Map()
    for (const row of animations) {
        validateAnimation(row)
        unique(animationMap, row, "animation")
    }
    return { slots, animations }
}
async function loadPalettes(sql) {
    const palettes = new Map()
    for (const row of await catalogQuery(sql, "palettes", ["id", "name", "data"], "id")) {
        id(row.id, "palette ID")
        text(row.name, "palette name")
        const parsed = parseGpl(row.data)
        assert(parsed.name === row.name, `${row.id}: stored GPL Name mismatch`)
        unique(palettes, { ...row, colors: parsed.colors, colorNames: parsed.colorNames }, "palette")
    }
    return palettes
}
async function loadInventory(sql, slot, isCurrent = () => true) {
    const rows = await pagedMetadata(sql, "items", ["id", "name", "slot", "palette"], "slot", slot, isCurrent)
    if (rows === null) return null
    const items = new Map()
    for (const row of rows) {
        text(row.name, "item name")
        id(row.slot, "item slot")
        id(row.palette, "item palette")
        assert(
            typeof row.id === "string" &&
                row.id.startsWith(`${row.slot}/`) &&
                ID.test(row.id.slice(row.slot.length + 1)),
            `invalid item ID ${row.id}`,
        )
        assert(row.slot === slot, `${row.id}: unexpected slot reference`)
        unique(items, { ...row, sheets: null }, "item")
    }
    return [...items.values()]
}
async function loadInventorySupport(sql, slot, state, ids, isCurrent = () => true) {
    text(state.animation, "inventory animation")
    assert(typeof state.body === "string" && /^[mftclp]$/.test(state.body), "inventory body must be one body code")
    assert(Array.isArray(ids) && ids.length > 0 && ids.length <= 10, "inventory support needs 1–10 item IDs")
    for (const id of ids) text(id, "inventory support item ID")
    assert(new Set(ids).size === ids.length, "duplicate requested inventory support item")
    if (!isCurrent()) return null
    const placeholders = ids.map(() => "?").join(", ")
    const matchBody = slot !== BODY_SLOT_ID
    // The body selector offers all shapes; other slots match the current shape.
    // Restrict both sides to this batch; never scan separately for each item or
    // fetch a sprite row/BLOB just to determine drawing availability.
    const rows = await sql.queryObjects(
        `SELECT i.id, COALESCE(support.supported, 0) AS supported, support.item IS NOT NULL AS hasAnimation FROM items i LEFT JOIN (SELECT item, MAX(${matchBody ? "instr(body, ?) > 0" : "1"}) AS supported FROM sprites WHERE animation = ? AND mask = 0 AND item IN (${placeholders}) GROUP BY item) support ON support.item = i.id WHERE i.slot = ? AND i.id IN (${placeholders}) ORDER BY i.id`,
        ["id", "supported", "hasAnimation"],
        [...(matchBody ? [state.body] : []), state.animation, ...ids, slot, ...ids],
    )
    if (!isCurrent()) return null
    assert(Array.isArray(rows) && rows.length === ids.length, "inventory support items changed; reload catalog")
    const expected = new Set(ids),
        support = new Map()
    for (const row of rows) {
        assert(expected.delete(row.id), `unexpected or duplicate inventory support item ${row.id}`)
        assert(row.supported === 0 || row.supported === 1, `${row.id}: invalid inventory support flag`)
        assert(row.hasAnimation === 0 || row.hasAnimation === 1, `${row.id}: invalid inventory animation flag`)
        assert(row.supported <= row.hasAnimation, `${row.id}: supported item must have animation drawings`)
        support.set(row.id, row.supported === 1 ? "supported" : row.hasAnimation === 1 ? "body-mismatch" : "missing-animation")
    }
    return support
}
async function loadSpriteMetadata(sql, item, animations, isCurrent = () => true) {
    const rows = await pagedMetadata(
        sql,
        "sprites",
        ["id", "item", "animation", "layer", "mask", "body"],
        "item",
        item.id,
        isCurrent,
    )
    if (rows === null) return null
    const animationMap = new Map(animations.map((animation) => [animation.id, animation]))
    const spriteIDs = new Set(),
        sheets = new Map()
    for (const row of rows) {
        assert(row.item === item.id && animationMap.has(row.animation), `${row.id}: unknown item/animation reference`)
        positive(row.layer, `${row.id}: layer`)
        assert(row.mask === 0 || row.mask === 1, `${row.id}: mask must be 0 or 1`)
        text(row.id, "sprite ID")
        text(row.body, "sprite body")
        assert(!spriteIDs.has(row.id), `duplicate sprite ID ${row.id}`)
        spriteIDs.add(row.id)
        if (!sheets.has(row.animation)) sheets.set(row.animation, [])
        sheets.get(row.animation).push({ ...row, slot: item.slot })
    }
    return sheets
}
// One pump per View: mounted equipment wins over current inventory, then explicit
// colored() callers. Replacing one group's demand never cancels the other group.
class IconScheduler {
    constructor(database, decode, fail) {
        this.database = database
        this.decode = decode
        this.fail = fail
        this.cache = new Map()
        this.promises = new Map()
        this.requests = new Map()
        this.groups = new Map()
        this.groupVersions = new Map()
        this.groupWaiters = new Set()
        this.generation = 0
        this.running = false
        this.scheduled = false
        this.stopped = false
        this.failed = false
        this.error = null
    }
    invalidate(stopped = false) {
        this.generation++
        this.stopped = stopped
        this.failed = false
        this.error = null
        this.groups.clear()
        this.cache.clear()
        this.promises.clear()
        for (const request of this.requests.values()) request.reject(new Error("Icon request cancelled"))
        this.requests.clear()
        this.settleGroupWaiters()
        // Native SQL/decode cannot be aborted. Keep running until it settles so
        // even Reset cannot start a second concurrent icon SQL request.
    }
    setDemand(group, entries) {
        assert(group === "equipment" || group === "inventory", "unknown icon demand group")
        this.groupVersions.set(group, (this.groupVersions.get(group) || 0) + 1)
        this.groups.set(group, entries)
        this.publish()
        this.schedule()
    }
    isGroupReady(group) {
        assert(this.groups.has(group), `missing icon demand group ${group}`)
        return !this.stopped && !this.failed && this.groups.get(group).length === 0
    }
    whenGroupReady(group) {
        if (this.stopped || this.failed) return Promise.resolve(false)
        if (this.isGroupReady(group)) return Promise.resolve(true)
        return new Promise((resolve) =>
            this.groupWaiters.add({
                group,
                resolve,
                generation: this.generation,
                version: this.groupVersions.get(group),
            }),
        )
    }
    settleGroupWaiters() {
        for (const waiter of this.groupWaiters) {
            const cancelled =
                this.stopped ||
                this.failed ||
                waiter.generation !== this.generation ||
                waiter.version !== this.groupVersions.get(waiter.group)
            if (!cancelled && !this.isGroupReady(waiter.group)) continue
            this.groupWaiters.delete(waiter)
            waiter.resolve(!cancelled)
        }
    }
    request(item) {
        if (this.promises.has(item.id)) return this.promises.get(item.id)
        if (this.stopped) return Promise.reject(new Error("Icon request cancelled"))
        if (this.failed) return Promise.reject(this.error)
        const promise = this.cache.has(item.id)
            ? Promise.resolve(this.cache.get(item.id))
            : new Promise((resolve, reject) => this.requests.set(item.id, { resolve, reject }))
        this.promises.set(item.id, promise)
        this.schedule()
        return promise
    }
    publish() {
        for (const [group, entries] of this.groups) {
            const pending = []
            for (const entry of entries) {
                if (this.cache.has(entry.item.id)) entry.publish(this.cache.get(entry.item.id))
                else pending.push(entry)
            }
            this.groups.set(group, pending)
        }
        for (const [id, request] of this.requests) {
            if (!this.cache.has(id)) continue
            request.resolve(this.cache.get(id))
            this.requests.delete(id)
        }
        this.settleGroupWaiters()
    }
    batch() {
        const ids = new Set()
        for (const group of ["equipment", "inventory"])
            if (this.groups.has(group))
                for (const { item } of this.groups.get(group)) if (!this.cache.has(item.id)) ids.add(item.id)
        for (const id of this.requests.keys()) if (!this.cache.has(id)) ids.add(id)
        return [...ids].slice(0, 10)
    }
    hasDemand(ids) {
        return ids.some(
            (id) =>
                this.requests.has(id) ||
                [...this.groups.values()].some((entries) => entries.some((entry) => entry.item.id === id)),
        )
    }
    schedule() {
        if (this.running || this.scheduled || this.stopped || this.failed) return
        this.scheduled = true
        queueMicrotask(() => {
            this.scheduled = false
            void this.pump()
        })
    }
    async pump() {
        if (this.running || this.stopped || this.failed) return
        this.running = true
        try {
            while (!this.stopped && !this.failed) {
                const ids = this.batch()
                if (!ids.length) break
                const generation = this.generation
                try {
                    const rows = await this.database.queryObjects(
                        `SELECT id, icon FROM items WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`,
                        ["id", "icon"],
                        ids,
                    )
                    if (generation !== this.generation) continue
                    assert(
                        Array.isArray(rows) && rows.length === ids.length,
                        "Selected item icons changed; Reset required",
                    )
                    const expected = new Set(ids)
                    const sources = rows.map((row) => {
                        assert(expected.delete(row.id), "Selected item icon ID changed; Reset required")
                        const bytes = bytesOf(row.icon)
                        assert(bytes.length > 0, `${row.id}: empty icon; Reset required`)
                        return { id: row.id, bytes }
                    })
                    // All decoders must settle before another batch (or generation)
                    // starts, including when a decoder rejects. The shared cap is 8.
                    const decoded = await Promise.allSettled(sources.map(({ bytes }) => this.decode(bytes)))
                    if (generation !== this.generation) continue
                    const failure = decoded.find(
                        (result, index) => result.status === "rejected" && this.hasDemand([sources[index].id]),
                    )
                    if (failure !== undefined) throw failure.reason
                    sources.forEach(({ id }, index) => {
                        if (decoded[index].status === "fulfilled") this.cache.set(id, decoded[index].value)
                    })
                    this.publish()
                    // Publish the completed batch before allowing another SQL call;
                    // a macrotask gives the Host a chance to paint and handle input.
                    await new Promise((resolve) => setTimeout(resolve, 0))
                } catch (error) {
                    if (generation !== this.generation || !this.hasDemand(ids)) continue
                    this.failed = true
                    this.error = error
                    for (const request of this.requests.values()) request.reject(error)
                    this.requests.clear()
                    this.settleGroupWaiters()
                    this.fail(error)
                }
            }
        } finally {
            this.running = false
        }
    }
}
function validateImage(image) {
    positive(image.width, "image width")
    positive(image.height, "image height")
    assert(
        image.indices instanceof Uint8Array && image.indices.length === image.width * image.height,
        "invalid indexed image raster",
    )
    assert(
        Array.isArray(image.palette) && image.indices.every((index) => index < image.palette.length),
        "invalid image palette indices",
    )
}
// Browsers can reject valid images when hundreds decode at once (large inventories).
let activeImageDecoders = 0
const imageDecodeWaiters = []
async function decodeSourceImage(blob) {
    if (activeImageDecoders >= 8) await new Promise((resolve) => imageDecodeWaiters.push(resolve))
    else activeImageDecoders++
    try {
        return await decodeImageBytes(blob)
    } finally {
        if (imageDecodeWaiters.length) imageDecodeWaiters.shift()()
        else activeImageDecoders--
    }
}
// Browser decoder accepts the supplied image format/size without palette inference.
async function decodeImageBytes(blob) {
    const url = URL.createObjectURL(new Blob([bytesOf(blob)]))
    const image = document.createElement("img")
    try {
        image.src = url
        await image.decode()
        const canvas = canvasOf(image.naturalWidth, image.naturalHeight)
        context2d(canvas).drawImage(image, 0, 0)
        return {
            width: canvas.width,
            height: canvas.height,
            pixels: context2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data,
        }
    } finally {
        URL.revokeObjectURL(url)
    }
}
async function decodeSprite(blob, label) {
    const bytes = bytesOf(blob)
    // Preserve genuine indexed PNG roles; never reconstruct indices from RGB.
    if (bytes.length > 25 && bytes[0] === 137 && bytes[25] === 3) return decodeIndexedPng(bytes, label)
    return decodeSourceImage(bytes)
}
function sourcePixels(image, replacement) {
    if (image.pixels !== undefined) {
        assert(image.pixels.length === image.width * image.height * 4, "invalid RGBA raster")
        return image.pixels
    }
    validateImage(image)
    const colors = replacement === null ? image.palette : replacement
    assert(Array.isArray(colors) && colors.length === image.palette.length, "replacement palette count mismatch")
    const pixels = new Uint8ClampedArray(image.width * image.height * 4)
    image.indices.forEach((index, i) => pixels.set(colors[index], i * 4))
    return pixels
}
function pixelsForImage(image, paletteColors) {
    validateImage(image)
    validateColors(image.palette, "image")
    validateColors(paletteColors, "replacement")
    assert(paletteColors.length === image.palette.length, "replacement palette count mismatch")
    const pixels = new Uint8ClampedArray(image.indices.length * 4)
    image.indices.forEach((index, i) => pixels.set(paletteColors[index], i * 4))
    return pixels
}
function composeFrame(components, animation, direction, column, paletteForItem) {
    validateAnimation(animation)
    const code = { north: "N", east: "E", south: "S", west: "W" }[direction]
    const row = animation.directions.indexOf(code)
    assert(code !== undefined && row >= 0, "invalid direction")
    assert(Number.isSafeInteger(column) && column >= 0 && column < animation.frame_count, "invalid frame column")
    assert(paletteForItem instanceof Map, "paletteForItem must be a Map")
    const ordered = orderedComponents(components, animation.id),
        layers = new Map(),
        width = animation.frame_width,
        height = animation.frame_height
    for (const c of ordered) {
        assert(c.animation === animation.id, "component animation mismatch")
        assert(
            c.image.width === width * animation.frame_count && c.image.height === height * animation.directions.length,
            `${c.id}: component geometry mismatch`,
        )
        if (c.mask) continue
        assert(paletteForItem.has(c.item), `missing palette selection for ${c.item}`)
        const pixels = sourcePixels(c.image, paletteForItem.get(c.item))
        const buffer = new Uint8ClampedArray(width * height * 4)
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const offset = ((row * height + y) * c.image.width + column * width + x) * 4
                buffer.set(pixels.subarray(offset, offset + 4), (y * width + x) * 4)
            }
        layers.set(c.layer, buffer)
    }
    for (const c of ordered) {
        if (!c.mask || !layers.has(c.layer)) continue
        const buffer = layers.get(c.layer)
        const pixels = sourcePixels(c.image, null)
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const offset = ((row * height + y) * c.image.width + column * width + x) * 4
                if (
                    pixels[offset + 3] &&
                    pixels[offset] === 255 &&
                    pixels[offset + 1] === 255 &&
                    pixels[offset + 2] === 255
                )
                    buffer.fill(0, (y * width + x) * 4, (y * width + x + 1) * 4)
            }
    }
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (const layer of [...layers.keys()].sort((a, b) => a - b)) {
        const buffer = layers.get(layer)
        for (let i = 0; i < buffer.length; i += 4) {
            const alpha = buffer[i + 3] / 255,
                under = pixels[i + 3] / 255,
                out = alpha + under * (1 - alpha)
            if (!out) continue
            for (let channel = 0; channel < 3; channel++)
                pixels[i + channel] = (buffer[i + channel] * alpha + pixels[i + channel] * under * (1 - alpha)) / out
            pixels[i + 3] = out * 255
        }
    }
    return { width, height, pixels }
}

const INVENTORY_COLUMNS = 3
const CREDITS =
    "Character catalog loaded from the Project SQLite database. Source credits, licenses and preparation changes are retained with the catalog provenance and generated animation reference. A working catalog does not establish permission to redistribute its artwork."

// USER-APPROVED EXCEPTION: View-owned shadow CSS for equipment/inventory cell
// dimensions and the character preview viewport. The user additionally approved
// 32px, centered empty/remove icons, three square inventory columns, and
// small top-right conflict badges (color uses the shared warning token).
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
table[role="grid"] > tbody > tr > td[aria-selected] > i:not([data-element="layer-conflict"]) {
    font-size: 32px;
    line-height: 1;
    display: block;
    width: max-content;
    margin-inline: auto;
}
/* User-approved addition: decorative conflict badges in equipment corners. */
table[aria-label="Equipment"] > tbody > tr > td[aria-selected],
table[aria-label="Equipment"] > tbody > tr > td[rowspan] {
    position: relative;
}
table[aria-label="Equipment"] > tbody > tr > td > i[data-element="layer-conflict"] {
    position: absolute;
    top: 2px;
    right: 2px;
    font-size: 16px;
    line-height: 1;
    color: var(--warning);
    pointer-events: none;
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
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;")
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
function rgbaCanvas(width, height, pixels) {
    const canvas = canvasOf(width, height)
    const context = context2d(canvas)
    const image = context.createImageData(width, height)
    image.data.set(pixels)
    context.putImageData(image, 0, 0)
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

export class ViewCharacter extends ViewCanvasBase {
    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        this.canvasMounted = false
        this.themeObserver = new MutationObserver(() => this.syncThemeStylesheet())
        this.headerControls = []
        this.equipmentGrid = null
        this.inventoryGrid = null
        this.initializeCatalogCaches()
        this.inventorySupportQueue = Promise.resolve()
        this.slots = []
        this.slotsById = new Map()
        this.animations = []
        this.initializeIcons()
        this.packCache = new Map()
        this.previewRequest = null
        this.previewPending = false
        this.tipToken = null
        this.tipId = null
        this.previewCache = null
        this.previewClip = null
        this.previewFrameIndex = 0
        this.previewTimer = null
        this.previewKey = null
        this.resetState()
    }
    initializeCatalogCaches() {
        this.items = new Map()
        this.palettes = new Map()
        this.inventories = new Map()
        this.inventoryLoads = new Map()
        this.inventoryErrors = new Map()
        this.inventorySupport = new Map()
        this.inventorySupportLoads = new Map()
        this.inventorySupportComplete = new Set()
        this.inventorySupportRequest = null
        this.inventorySupportErrors = new Map()
        this.pickerSlot = null
        this.metadataLoads = new Map()
        this.paletteLoad = null
        this.randomizeRequest = null
    }
    resetState() {
        this.parts = Object.fromEntries(this.slots.map(({ id }) => [id, null]))
        this.colors = {}
        this.selectedSlot = null
        this.search = ""
        this.direction = "south"
        this.body = DEFAULT_BODY_TYPE
        this.playing = false
        this.selectedAnimation = this.animations.length ? this.animations[0].id : null
        this.previewMode = "animation"
        this.selectedSheets = new Set(this.selectedAnimation === null ? [] : [this.selectedAnimation])
    }
    connectedCallback() {
        this.style.display = "contents"
        registerViewPlugin(this)
        const theme = document.getElementById("theme-stylesheet")
        assert(theme instanceof HTMLLinkElement, "Host theme stylesheet link required")
        this.themeObserver.observe(theme, { attributes: true, attributeFilter: ["href"] })
        void this.reload()
    }
    syncThemeStylesheet() {
        const link = ensureThemeStylesheetLink(this.shadowRoot)
        assert(link, "Host theme stylesheet link required")
    }
    setContent(markup) {
        this.unmountCanvas()
        this.shadowRoot.innerHTML = `<link rel="stylesheet" href="/css/reset.css">
            <link rel="stylesheet" href="/css/base.css">
            <style>${APPROVED_LAYOUT_CSS}</style>${markup}`
        this.syncThemeStylesheet()
    }
    // Temporary adapter for the base's light-DOM-only connectedCallback.
    // Reuse its viewport mechanics without creating a second canvas, moving
    // header controls, or registering the View twice.
    mountCanvas() {
        assert(!this.canvasMounted, "canvas already mounted")
        this.canvas = this.required('form > canvas[data-element="canvas"]')
        assert(this.canvas instanceof HTMLCanvasElement, "viewport canvas required")
        this.ctx = context2d(this.canvas)
        this.canvasMounted = true
        this._addEventListeners()
        this._resizeObserver.observe(this.canvas)
        this._hasAutoFitted = false
        this.setData(this.previewClip)
        this.syncCanvasPlayback()
    }
    unmountCanvas() {
        this.stopCanvasPlayback()
        if (!this.canvasMounted) return
        this._resizeObserver.disconnect()
        if (this._resizeFrame) cancelAnimationFrame(this._resizeFrame)
        this._resizeFrame = 0
        this._pendingCanvasSize = null
        this._removeEventListeners()
        this.spacePressed = false
        this.isDragging = false
        this.canvasMounted = false
        this.canvas = null
        this.ctx = null
    }
    _onKeyDown(event) {
        // Space belongs to grid activation / text inputs outside the viewport.
        if (event.composedPath()[0] !== this.canvas) return
        super._onKeyDown(event)
    }
    _onKeyUp(event) {
        if (this.spacePressed) super._onKeyUp(event)
    }
    calculateContentBounds(clip) {
        return { minX: 0, minY: 0, maxX: clip === null ? 0 : clip.width, maxY: clip === null ? 0 : clip.height }
    }
    drawContent(ctx, clip) {
        if (clip === null) return
        const frame = clip.frames[this.previewFrameIndex]
        assert(frame, `missing character frame ${this.previewFrameIndex}`)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(frame.canvas, 0, 0)
    }
    stopCanvasPlayback() {
        if (this.previewTimer != null) clearTimeout(this.previewTimer)
        this.previewTimer = null
    }
    syncCanvasPlayback() {
        if (!this.playing || !this.canvasMounted || !this.isConnected || this.previewClip === null) {
            this.stopCanvasPlayback()
            return
        }
        if (this.previewTimer !== null) return
        const clip = this.previewClip
        const frame = clip.frames[this.previewFrameIndex]
        assert(frame, `missing playback frame ${this.previewFrameIndex}`)
        const timer = setTimeout(() => {
            if (this.previewTimer !== timer) return
            this.previewTimer = null
            if (!this.playing || !this.canvasMounted || !this.isConnected || this.previewClip !== clip) return
            this.previewFrameIndex = (this.previewFrameIndex + 1) % clip.frames.length
            this.draw()
            this.dispatchEvent(new CustomEvent("framechange", {
                bubbles: true, detail: { frameIndex: this.previewFrameIndex },
            }))
            this.syncCanvasPlayback()
        }, frame.durationMs)
        this.previewTimer = timer
    }
    installCanvasClip(clip) {
        const autoFit = clip !== null && (this.previewClip === null ||
            this.previewClip.width !== clip.width || this.previewClip.height !== clip.height)
        this.stopCanvasPlayback()
        this.previewClip = clip
        this.previewFrameIndex = 0
        if (this.canvasMounted) this.setData(clip, { autoFit })
        this.syncCanvasPlayback()
    }
    destroyGrids() {
        if (this.equipmentGrid !== null) this.equipmentGrid.destroy()
        if (this.inventoryGrid !== null) this.inventoryGrid.destroy()
        this.equipmentGrid = null
        this.inventoryGrid = null
    }
    disconnectedCallback() {
        this.playing = false
        this.unmountCanvas()
        this.previewClip = null
        this.previewCache = null
        this.previewKey = null
        this.data = null
        this.iconScheduler.invalidate(true)
        this.themeObserver.disconnect()
        if (this.previewRequest !== null) void this.finishPreviewProgress(this.previewRequest, "progressClose")
        this.previewRequest = null
        this.previewPending = false
        this.destroyGrids()
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
    paletteItem(slot) {
        const id = this.parts[slot]
        assert(id !== null, `palette slot has no equipped item: ${slot}`)
        return this.item(id)
    }
    compatiblePalettes(item) {
        const original = this.palettes.get(item.palette)
        assert(original, `missing default palette ${item.palette}`)
        return [...this.palettes.values()].filter((palette) => palette.colors.length === original.colors.length)
    }
    loadSlots(records) {
        assert(Array.isArray(records) && records.length > 0, "slot registry must not be empty")
        for (const record of records) {
            for (const key of ["id", "name", "icon"])
                assert(typeof record[key] === "string" && record[key].trim().length > 0, `slot ${key} required`)
        }
        for (const record of records)
            assert(Array.isArray(record.requiredItems), `slot ${record.id}: requiredItems must be an array`)
        const byId = new Map(records.map((record) => [record.id, record]))
        assert(byId.size === records.length, "duplicate slot ids")
        this.slots = records
        this.slotsById = byId
    }
    visibleSlots(parts = this.parts) {
        // Expand from unconditional roots: retained equipment in hidden slots
        // must not keep dependent slots (or dependency cycles) visible.
        const visible = new Set(), equipped = new Set()
        let changed = true
        while (changed) {
            changed = false
            for (const slot of this.slots) {
                if (visible.has(slot.id)) continue
                if (slot.requiredItems.length && !slot.requiredItems.some((item) => equipped.has(item))) continue
                visible.add(slot.id)
                if (parts[slot.id] !== null) equipped.add(parts[slot.id])
                changed = true
            }
        }
        return this.slots.filter((slot) => visible.has(slot.id))
    }
    activeParts() {
        return this.visibleSlots().map(({ id }) => this.parts[id]).filter((id) => id !== null)
    }
    syncSlotVisibility(previous) {
        const visible = this.visibleSlots()
        if (previous.length === visible.length && previous.every((slot, i) => slot.id === visible[i].id)) return false
        if (this.selectedSlot !== null && !visible.some(({ id }) => id === this.selectedSlot)) {
            this.selectedSlot = null
            this.inventorySupportRequest = null
            this.updatePicker()
            this.updatePalettePanel()
        }
        this.updateBoard()
        return true
    }
    currentMotion() {
        if (this.selectedAnimation === null) return null
        const animation = this.animations.find((record) => record.id === this.selectedAnimation)
        assert(animation, "unknown selected animation")
        return animation
    }
    itemSupportsMotion(item, motion = this.currentMotion()) {
        const status = this.itemMotionStatus(item, motion)
        return status === null ? null : status === "supported"
    }
    itemMotionStatus(item, motion = this.currentMotion()) {
        if (motion === null) return "missing-animation"
        if (item.sheets === null) {
            const support = this.inventorySupport.get(this.supportKey(item.slot, motion.id))
            if (support === undefined) return null // Pending is not unsupported.
            if (support.has(item.id)) {
                const status = support.get(item.id)
                assert(["supported", "missing-animation", "body-mismatch"].includes(status), `invalid inventory support for ${item.id}`)
                return status
            }
            assert(
                !this.inventorySupportComplete.has(this.supportKey(item.slot, motion.id)),
                `missing inventory support for ${item.id}`,
            )
            return null // A later compatibility batch has not reached this item.
        }
        assert(item.sheets instanceof Map, `missing sprite metadata state: ${item.id}`)
        const components = item.sheets.get(motion.id)
        if (components === undefined || !components.some((component) => component.mask === 0)) return "missing-animation"
        return components.some((component) =>
            component.mask === 0 && (item.slot === BODY_SLOT_ID || component.body.includes(this.body)))
            ? "supported" : "body-mismatch"
    }
    itemMotionDetails(status, motion) {
        if (status === "missing-animation") return `No source frames for ${motion.name} (${this.direction}); omitted from preview`
        if (status === "body-mismatch") return `${motion.name} does not fit current body type (${this.body}); omitted from preview`
        return ""
    }
    previewMotions() {
        if (this.previewMode === "spritesheet")
            return this.animations.filter((motion) => this.selectedSheets.has(motion.id))
        const motion = this.currentMotion()
        return motion === null ? [] : [motion]
    }
    motionAvailability(motion = this.currentMotion()) {
        if (motion === null) return { available: false, reason: "No animation selected." }
        const missing = [],
            supported = []
        for (const id of this.activeParts()) {
            const item = this.item(id)
            const support = this.itemSupportsMotion(item, motion)
            if (support === true) supported.push(id)
            else if (support === false) missing.push(item.name)
        }
        return {
            available: supported.length > 0,
            sheetId: motion.id,
            sequence: motion.sequence,
            motion,
            supported,
            missing,
            reason: supported.length
                ? ""
                : missing.length
                  ? `${motion.name} unavailable for equipped parts: ${missing.join(", ")}.`
                  : "No equipped parts to render.",
        }
    }
    canPlayAnimation() {
        return this.previewMode !== "spritesheet" && this.currentMotion() !== null && this.motionAvailability().available
    }
    item(id) {
        const item = this.items.get(id)
        assert(item, `missing catalog item ${id}`)
        return item
    }
    required(selector) {
        const element =
            this.shadowRoot.querySelector(selector) ||
            this.headerControls.map((control) => control.querySelector(selector)).find(Boolean)
        assert(element, `missing DOM ${selector}`)
        return element
    }
    showCatalogLoading() {
        this.destroyGrids()
        for (const control of this.headerControls) control.remove()
        this.headerControls = []
        this.setContent('<form><output class="info">Loading character catalog…</output></form>')
    }
    async reload() {
        if (this.previewRequest !== null) void this.finishPreviewProgress(this.previewRequest, "progressClose")
        this.previewRequest = null
        this.previewPending = false
        this.playing = false
        this.installCanvasClip(null)
        this.previewCache = null
        this.previewKey = null
        this.closeTip()
        this.iconScheduler.invalidate(true)
        const generation = this.iconScheduler.generation
        this.initializeCatalogCaches()
        this.packCache.clear()
        this.showCatalogLoading()
        try {
            const catalog = await loadCatalog(sql)
            if (generation !== this.iconScheduler.generation || !this.isConnected) return
            this.loadSlots(catalog.slots)
            this.animations = catalog.animations
            this.iconScheduler.stopped = false
            this.iconScheduler.groups.clear()
            this.previewRequest = null
            this.previewCache = null
            this.previewKey = null
            this.resetState()
            if (this.isConnected) this.render()
        } catch (error) {
            if (generation !== this.iconScheduler.generation || !this.isConnected) return
            if (this.isConnected) {
                const output = this.shadowRoot.querySelector('[data-element="status"]') || this.required("output")
                output.textContent = `Character reload failed: ${error.message}`
                output.className = "danger"
            }
            throw error
        }
    }
    async ensureInventory(slot) {
        this.slotRecord(slot)
        if (this.inventories.has(slot)) return true
        if (this.inventoryLoads.has(slot)) return this.inventoryLoads.get(slot)
        const generation = this.iconScheduler.generation
        const isCurrent = () => this.isConnected && generation === this.iconScheduler.generation
        const loading = loadInventory(sql, slot, isCurrent)
            .then((items) => {
                if (!isCurrent()) return false
                assert(items !== null, "current inventory load was cancelled")
                for (const item of items) {
                    assert(!this.items.has(item.id), `duplicate catalog item ${item.id}`)
                    this.items.set(item.id, item)
                }
                this.inventories.set(slot, items)
                return true
            })
            .catch((error) => {
                if (!isCurrent()) return false
                this.inventoryErrors.set(slot, error)
                throw error
            })
        this.inventoryLoads.set(slot, loading)
        return loading
    }
    supportKey(slot, animation = this.selectedAnimation, body = this.body) {
        return JSON.stringify([slot, animation, body])
    }
    inventoryReady(slot) {
        return (
            this.inventories.has(slot) &&
            (this.currentMotion() === null || this.inventorySupportComplete.has(this.supportKey(slot)))
        )
    }
    async queryInventorySupportBatch(slot, state, ids, isCurrent) {
        // Preserve this queue across Reset: an unabortable old SQL request must
        // settle before another compatibility request may enter the transport.
        assert(this.inventorySupportQueue instanceof Promise, "inventory support queue required")
        const previous = this.inventorySupportQueue
        let release
        this.inventorySupportQueue = new Promise((resolve) => {
            release = resolve
        })
        try {
            await previous
            while (isCurrent()) {
                if (!(await this.iconScheduler.whenGroupReady("inventory"))) {
                    if (!isCurrent() || this.iconScheduler.failed || this.iconScheduler.stopped) return null
                    continue // Search changed demand; wait for the new icons.
                }
                if (!isCurrent()) return null
                this.updateInventoryStatus()
                await this.yieldRender(true) // Publish/paint all demanded icons before compatibility SQL.
                if (!isCurrent()) return null
                if (!this.iconScheduler.isGroupReady("inventory")) continue
                return await loadInventorySupport(sql, slot, state, ids, isCurrent)
            }
            return null
        } finally {
            release()
        }
    }
    async ensureInventorySupport(slot, state, keepCurrent = () => true) {
        assert(this.inventories.has(slot), `inventory metadata required for ${slot}`)
        const generation = this.iconScheduler.generation
        const isCurrent = () => this.isConnected && generation === this.iconScheduler.generation && keepCurrent()
        if (!isCurrent()) return false
        const key = this.supportKey(slot, state.animation, state.body)
        if (this.inventorySupportComplete.has(key)) return true
        if (this.inventorySupportErrors.has(key)) throw this.inventorySupportErrors.get(key)
        if (this.inventorySupportLoads.has(key)) {
            const ready = await this.inventorySupportLoads.get(key)
            // A superseded job may have owned this key. Resume its valid partial
            // cache rather than retaining a cancelled Promise on a quick revisit.
            if (!ready && isCurrent() && !this.iconScheduler.failed && !this.iconScheduler.stopped)
                return this.ensureInventorySupport(slot, state, keepCurrent)
            return ready
        }
        const inventory = this.inventories.get(slot)
        let support = this.inventorySupport.get(key)
        if (support === undefined) {
            support = new Map()
            this.inventorySupport.set(key, support)
        }
        let loading
        loading = (async () => {
            const pending = inventory.filter((item) => !support.has(item.id))
            for (let offset = 0; offset < pending.length; offset += 10) {
                const ids = pending.slice(offset, offset + 10).map((item) => item.id)
                const batch = await this.queryInventorySupportBatch(slot, state, ids, isCurrent)
                if (!isCurrent() || batch === null) return false
                for (const [id, supported] of batch) support.set(id, supported)
                this.updateMotionCells()
                this.updateInventoryStatus()
                await this.yieldRender()
                if (!isCurrent()) return false
            }
            if (!isCurrent()) return false
            assert(
                support.size === inventory.length && inventory.every((item) => support.has(item.id)),
                "inventory support items changed; reload catalog",
            )
            this.inventorySupportComplete.add(key)
            this.updateInventoryStatus()
            return true
        })()
            .catch((error) => {
                if (!isCurrent()) return false
                this.inventorySupportErrors.set(key, error)
                throw error
            })
            .finally(() => {
                if (this.inventorySupportLoads.get(key) === loading) this.inventorySupportLoads.delete(key)
            })
        this.inventorySupportLoads.set(key, loading)
        return loading
    }
    async refreshInventorySupport() {
        const request = {}
        this.inventorySupportRequest = request
        const slot = this.selectedSlot
        if (slot === null) return
        const animation = this.selectedAnimation,
            body = this.body
        const generation = this.iconScheduler.generation
        const isActive = () =>
            this.isConnected &&
            generation === this.iconScheduler.generation &&
            this.inventorySupportRequest === request &&
            this.selectedSlot === slot &&
            this.selectedAnimation === animation &&
            this.body === body
        try {
            if (!(await this.ensureInventory(slot)) || !isActive()) return
            if (this.pickerSlot !== slot) this.updatePicker() // Metadata is enough to mount cells/start icons.
            if (animation !== null && !(await this.ensureInventorySupport(slot, { animation, body }, isActive))) return
            if (!isActive()) return
            this.updateMotionCells()
            this.updateInventoryStatus()
        } catch (error) {
            if (isActive()) {
                this.updateInventoryStatus()
                this.reportCatalogFailure(error)
            }
        }
    }
    async ensureItemMetadata(item) {
        if (item.sheets instanceof Map) return true
        assert(item.sheets === null, `missing sprite metadata state: ${item.id}`)
        if (this.metadataLoads.has(item.id)) return this.metadataLoads.get(item.id)
        const generation = this.iconScheduler.generation
        const isCurrent = () => this.isConnected && generation === this.iconScheduler.generation
        const loading = loadSpriteMetadata(sql, item, this.animations, isCurrent).then((sheets) => {
            if (!isCurrent()) return false
            assert(sheets !== null, "current sprite metadata load was cancelled")
            item.sheets = sheets
            return true
        })
        this.metadataLoads.set(item.id, loading)
        return loading
    }
    async ensurePalettes() {
        if (this.paletteLoad !== null) return this.paletteLoad
        const generation = this.iconScheduler.generation
        const loading = loadPalettes(sql).then((palettes) => {
            if (!this.isConnected || generation !== this.iconScheduler.generation) return false
            this.palettes = palettes
            return true
        })
        this.paletteLoad = loading
        return loading
    }
    initializeIcons() {
        this.iconScheduler = new IconScheduler(
            sql,
            async (bytes) => {
                const image = await decodeSourceImage(bytes)
                return rgbaCanvas(image.width, image.height, image.pixels)
            },
            (error) => {
                if (this.isConnected) this.reportFailure(error)
            },
        )
        this.coloredCache = this.iconScheduler.promises
    }
    // Promise<canvas> API for explicit callers; item metadata carries no bytes.
    // Mounted cells use grouped demand instead of creating uncancellable requests.
    colored(item) {
        return this.iconScheduler.request(item)
    }
    demandIcons(group, body) {
        const entries = [...body.querySelectorAll("td[data-icon-item]")].map((cell) => ({
            item: this.item(cell.dataset.iconItem),
            publish: (canvas) => {
                if (!cell.isConnected) return
                const preview = document.createElement("widget-animation-preview")
                preview.setAttribute("aria-hidden", "true")
                setPreview(preview, [canvas])
                const badge = cell.querySelector('[data-element="layer-conflict"]')
                cell.replaceChildren(preview)
                if (badge !== null) cell.append(badge)
                delete cell.dataset.iconItem
            },
        }))
        this.iconScheduler.setDemand(group, entries)
    }
    packKey(item, motion) {
        return JSON.stringify([item.id, motion.id, this.body])
    }
    async prepareSelectedPacks(request = this.previewRequest) {
        const selected = this.activeParts().map((id) => this.item(id))
        const needed = selected.filter((item) => item.sheets === null)
        if (needed.length || selected.some((item) => !this.palettes.has(item.palette))) {
            const ready = await Promise.all([
                this.ensurePalettes(),
                ...needed.map((item) => this.ensureItemMetadata(item)),
            ])
            if (ready.includes(false) || this.previewRequest !== request || !this.isConnected) return
            for (const item of selected)
                assert(this.palettes.has(item.palette), `${item.id}: unknown palette reference`)
            this.updatePalettePanel()
            this.updateMotionCells()
        }
        if (this.previewRequest !== request || !this.isConnected) return
        const bodyItem = selected.find((item) => item.slot === BODY_SLOT_ID)
        if (bodyItem !== undefined) {
            assert(bodyItem.sheets instanceof Map, `${bodyItem.id}: body item requires sprite metadata`)
            const types = new Set([...bodyItem.sheets.values()].flat().map((row) => row.body))
            assert(types.size === 1, `${bodyItem.id}: body item must define exactly one body type`)
            const [body] = types
            assert(
                typeof body === "string" && /^[mftclp]$/.test(body),
                `${bodyItem.id}: body item must define one body code`,
            )
            if (this.body !== body) {
                this.body = body
                this.updateMotionCells()
                void this.refreshInventorySupport()
            }
        }
        for (const motion of this.previewMotions()) {
            if (this.previewRequest !== request || !this.isConnected) return
            await this.prepareMotionPacks(motion)
        }
    }
    async prepareMotionPacks(motion) {
        const state = { animation: motion.id, body: this.body }
        await Promise.all(
            this.motionAvailability(motion).supported.map((id) => {
                const item = this.item(id),
                    key = this.packKey(item, motion)
                if (!this.packCache.has(key))
                    this.packCache.set(
                        key,
                        (async () => {
                            const rows = await selectAnimationPack(item, state)
                            return Promise.all(
                                rows.map(async (row) => {
                                    const image = await decodeSprite(row.data, row.id)
                                    if (row.mask) validateMask(image, row.id)
                                    return { ...row, slot: item.slot, image }
                                }),
                            )
                        })(),
                    )
                return this.packCache.get(key)
            }),
        )
    }
    reportFailure(error) {
        this.playing = false
        this.installCanvasClip(null)
        this.previewKey = null
        const output = this.required('[data-element="status"]')
        output.textContent = `Character rendering failed: ${error.message}`
        output.className = "danger"
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
        const tip = () => this.showTip(button, typeof content === "function" ? content() : content)
        button.addEventListener("pointerenter", tip)
        button.addEventListener("pointerleave", () => this.closeTip())
        button.addEventListener("focus", tip)
        button.addEventListener("blur", () => this.closeTip())
        button.addEventListener("click", () => this.closeTip())
    }
    render() {
        this.destroyGrids()
        this.closeTip()
        for (const control of this.headerControls) control.remove()
        this.headerControls = []
        this.setContent(`
            <div slot="header-controls" data-element="toolbar">
                <div role="buttongroup" data-element="tool-actions">
                    <button type="button" data-action="clear-slots" aria-label="Clear all slots"><i aria-hidden="true">clear_all</i></button>
                    <button type="button" data-action="randomize" aria-label="Randomize"><i aria-hidden="true">casino</i></button>
                    <button type="button" data-action="reset" aria-label="Reset"><i aria-hidden="true">restart_alt</i></button>
                </div>
                <div role="buttongroup" data-element="view-actions">
                    <button type="button" data-action="zoom-in" aria-label="Zoom in"><i aria-hidden="true">zoom_in</i></button>
                    <button type="button" data-action="zoom-fit" aria-label="Fit"><i aria-hidden="true">fit_screen</i></button>
                    <button type="button" data-action="zoom-out" aria-label="Zoom out"><i aria-hidden="true">zoom_out</i></button>
                </div>
            </div>
            <form aria-label="LPC character">
                <canvas data-element="canvas" tabindex="0" aria-label="Character preview: wheel to pan, Control or Command and wheel to zoom, Space and drag to pan"></canvas>
                <table role="grid" data-layout="separate" aria-label="Equipment"><colgroup><col><col><col></colgroup><tbody data-element="equipment"></tbody></table>
            </form>
            <aside aria-label="Part browser">
                <fieldset><legend>Animation</legend>
                    <label><input type="radio" name="preview-mode" data-field="preview-mode" value="animation"> Animation</label>
                    <label><input type="radio" name="preview-mode" data-field="preview-mode" value="spritesheet"> Spritesheet</label>
                    <fieldset data-element="sheet-selection"><legend>Animations to include</legend>
                        <label><input type="checkbox" data-field="all-sheet-animations"> Select all</label>
                    </fieldset>
                    <div role="buttongroup" data-element="animation-controls">
                        <select data-field="animation" aria-label="Animation"></select>
                        <button type="button" data-action="play" aria-label="Play animation" aria-pressed="false"><i aria-hidden="true">play_arrow</i></button>
                    </div>
                    <select data-field="direction" aria-label="Facing"><option value="south">South</option><option value="west">West</option><option value="north">North</option><option value="east">East</option></select>
                    <output data-element="animation-status"></output>
                </fieldset>
                <fieldset data-element="inventory"><legend data-element="picker-title"></legend>
                    <input type="search" data-field="search" aria-label="Search parts" placeholder="Search parts…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
                    <output data-element="empty"></output>
                    <table role="grid" data-layout="separate" aria-label="Available parts"><colgroup>${"<col>".repeat(INVENTORY_COLUMNS)}</colgroup><tbody data-element="choices"></tbody></table>
                </fieldset>
            </aside>
            <footer><output data-element="status" aria-live="polite"></output><button type="button" data-action="credits">Catalog information</button></footer>
        `)
        this.mountCanvas()
        this.required("form").addEventListener("submit", (event) => event.preventDefault())
        this.required('[data-field="direction"]').value = this.direction
        this.required('[data-field="search"]').value = this.search
        const animationSelect = this.required('[data-field="animation"]')
        const placeholder = document.createElement("option")
        placeholder.value = ""
        placeholder.textContent = this.animations.length ? "Choose preview" : "No previews"
        animationSelect.append(placeholder)
        for (const record of this.animations) {
            const option = document.createElement("option")
            option.value = "animation:" + record.id
            option.textContent = record.name
            animationSelect.append(option)
        }
        for (const radio of this.shadowRoot.querySelectorAll('[data-field="preview-mode"]')) {
            radio.checked = radio.value === this.previewMode
            radio.addEventListener("change", () => {
                if (!radio.checked) return
                this.previewMode = radio.value
                this.playing = false
                this.updatePreviewMode()
                this.updatePlayback()
                this.updatePreview()
            })
        }
        const sheetSelection = this.required('[data-element="sheet-selection"]')
        for (const motion of this.animations) {
            const label = document.createElement("label")
            const checkbox = document.createElement("input")
            checkbox.type = "checkbox"
            checkbox.dataset.field = "sheet-animation"
            checkbox.value = motion.id
            checkbox.checked = this.selectedSheets.has(motion.id)
            label.append(checkbox, document.createTextNode(` ${motion.name}`))
            sheetSelection.append(label)
            checkbox.addEventListener("change", () => {
                if (checkbox.checked) this.selectedSheets.add(motion.id)
                else this.selectedSheets.delete(motion.id)
                this.updateSheetSelection()
                this.updatePreview()
            })
        }
        this.previewControls = {
            sheets: sheetSelection,
            animation: this.required('[data-element="animation-controls"]'),
            facing: this.required('[data-field="direction"]'),
        }
        sheetSelection.querySelector('[data-field="all-sheet-animations"]').addEventListener("change", (event) => {
            this.selectAllSheets(event.target.checked)
        })
        this.updateSheetSelection()
        animationSelect.disabled = this.animations.length === 0
        animationSelect.value = this.selectedAnimation === null ? "" : "animation:" + this.selectedAnimation
        animationSelect.addEventListener("change", () => {
            const value = animationSelect.value
            if (value === "") this.selectedAnimation = null
            else {
                assert(value.startsWith("animation:"), "unknown animation selection")
                const id = value.slice(10)
                assert(
                    this.animations.some((animation) => animation.id === id),
                    "unknown animation selection",
                )
                this.selectedAnimation = id
            }
            this.playing = false
            this.updateMotionCells()
            this.updateInventoryStatus()
            void this.refreshInventorySupport()
            this.updatePreview()
        })
        this.required('[data-field="direction"]').addEventListener("change", (event) => {
            this.direction = event.target.value
            this.updatePreview()
        })
        this.required('[data-action="play"]').addEventListener("click", () => {
            if (!this.canPlayAnimation()) return
            this.playing = !this.playing
            this.updatePlayback()
        })
        this.required('[data-action="zoom-in"]').addEventListener("click", () => this.zoomIn())
        this.required('[data-action="zoom-fit"]').addEventListener("click", () => this.zoomFit())
        this.required('[data-action="zoom-out"]').addEventListener("click", () => this.zoomOut())
        this.required('[data-action="clear-slots"]').addEventListener("click", () => this.clearSlots())
        this.required('[data-action="reset"]').addEventListener("click", () => this.reload())
        this.required('[data-action="randomize"]').addEventListener("click", () => {
            void this.randomize()
        })
        this.required('[data-field="search"]').addEventListener("input", (event) => {
            this.search = event.target.value
            this.updatePicker()
            void this.refreshInventorySupport()
        })
        for (const [action, text] of [
            ["clear-slots", "Clear all slots"],
            ["randomize", "Randomize parts"],
            ["reset", "Reset session"],
            ["zoom-in", "Zoom in"],
            ["zoom-fit", "Fit"],
            ["zoom-out", "Zoom out"],
            ["play", "Play / pause the selected database animation. Missing equipment sprites are never substituted."],
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
                this.selectSlot(cell.dataset.slot)
            },
        })
        this.inventoryGrid = bindSelectableGrid(this.required('[role="grid"][aria-label="Available parts"]'), {
            activate: (cell) => {
                this.selectItem(cell.dataset.action === "remove" ? null : cell.dataset.item)
            },
        })
        this.updatePreviewMode()
        this.update()
    }
    selectSlot(slot) {
        this.slotRecord(slot)
        assert(this.visibleSlots().some(({ id }) => id === slot), `cannot activate hidden slot ${slot}`)
        this.inventorySupportRequest = null
        this.selectedSlot = slot
        this.search = ""
        this.required('[data-field="search"]').value = ""
        for (const cell of this.required('[data-element="equipment"]').querySelectorAll("td[data-slot]"))
            cell.setAttribute("aria-selected", String(cell.dataset.slot === slot))
        this.equipmentGrid.refresh({ focus: true })
        this.updatePicker()
        this.updatePalettePanel()
        if (this.inventories.has(slot)) {
            if (!this.inventoryReady(slot)) void this.refreshInventorySupport()
            return Promise.resolve()
        }
        const generation = this.iconScheduler.generation
        return this.ensureInventory(slot)
            .then((ready) => {
                if (
                    !ready ||
                    !this.isConnected ||
                    generation !== this.iconScheduler.generation ||
                    this.selectedSlot !== slot
                )
                    return
                if (this.pickerSlot !== slot) this.updatePicker()
                void this.refreshInventorySupport()
            })
            .catch((error) => {
                if (this.isConnected && generation === this.iconScheduler.generation && this.selectedSlot === slot) {
                    this.updateInventoryStatus()
                    this.reportCatalogFailure(error)
                }
            })
    }
    async randomize() {
        const generation = this.iconScheduler.generation
        const request = {}
        this.randomizeRequest = request
        try {
            const previous = this.visibleSlots(), visited = new Set()
            const parts = { ...this.parts }, colors = { ...this.colors }
            while (true) {
                const pending = this.visibleSlots(parts).filter(({ id }) => !visited.has(id))
                if (!pending.length) break
                const ready = await Promise.all(pending.map(({ id }) => this.ensureInventory(id)))
                if (
                    ready.includes(false) ||
                    generation !== this.iconScheduler.generation ||
                    !this.isConnected ||
                    this.randomizeRequest !== request
                ) return
                for (const { id: slot } of pending) {
                    visited.add(slot)
                    if (!this.visibleSlots(parts).some(({ id }) => id === slot)) continue
                    const choices = this.inventories.get(slot)
                    parts[slot] = choices.length ? choices[Math.floor(Math.random() * choices.length)].id : null
                    if (choices.length) colors[slot] = this.item(parts[slot]).palette
                    else delete colors[slot]
                }
            }
            this.parts = parts
            this.colors = colors
            this.syncSlotVisibility(previous)
            this.render()
        } catch (error) {
            if (generation === this.iconScheduler.generation && this.isConnected && this.randomizeRequest === request)
                this.reportCatalogFailure(error)
        }
    }
    reportCatalogFailure(error) {
        const output = this.required('[data-element="status"]')
        output.textContent = `Character catalog failed: ${error.message}`
        output.className = "danger"
    }
    clearSlots() {
        this.randomizeRequest = null
        const previous = this.visibleSlots()
        this.colors = {}
        for (const { id: slot } of this.slots) this.parts[slot] = null
        this.syncSlotVisibility(previous)
        for (const { id: slot } of this.visibleSlots()) {
            if (slot === this.selectedSlot) continue
            this.updateEquipmentSlot(slot)
        }
        if (this.selectedSlot !== null) this.selectItem(null)
        else {
            this.updatePalettePanel()
            void this.updatePreview()
        }
    }
    selectItem(id) {
        this.randomizeRequest = null
        const slot = this.selectedSlot
        this.slotRecord(slot)
        if (id !== null) {
            const item = this.item(id)
            assert(item.slot === slot, "inventory item belongs to another slot")
            this.colors[slot] = item.palette
        }
        const previous = this.visibleSlots()
        this.parts[slot] = id
        if (id === null) delete this.colors[slot]
        this.closeTip()
        // Keep the inventory cells (and their loaded icons/focus) in place.
        for (const cell of this.required('[data-element="choices"]').querySelectorAll("td[aria-selected]"))
            cell.setAttribute(
                "aria-selected",
                String(id === null ? cell.dataset.action === "remove" : cell.dataset.item === id),
            )
        this.inventoryGrid.refresh({ focus: false })
        this.refreshPaletteControls(slot)
        this.updatePalettes(slot)
        if (!this.syncSlotVisibility(previous)) this.updateEquipmentSlot(slot)
        this.updatePreview()
    }
    updateEquipmentSlot(slot) {
        const body = this.required('[data-element="equipment"]')
        const cell = this.required(`td[data-slot="${slot}"]`)
        const id = this.parts[slot]
        cell.replaceWith(this.itemCell(slot, id === null ? null : this.item(id), true))
        this.equipmentGrid.refresh({ focus: false })
        this.demandIcons("equipment", body)
    }
    itemCell(slot, item, equippedSlot = false) {
        const { name: label, icon: symbol } = this.slotRecord(slot)
        const cell = document.createElement("td")
        cell.setAttribute("role", "gridcell")
        const remove = !equippedSlot && item === null
        if (equippedSlot) cell.dataset.slot = slot
        else if (remove) cell.dataset.action = "remove"
        else cell.dataset.item = item.id
        cell.setAttribute(
            "aria-selected",
            String(equippedSlot ? this.selectedSlot === slot : this.parts[slot] === (item === null ? null : item.id)),
        )
        cell.setAttribute("aria-disabled", "false")
        if (item === null) {
            const icon = document.createElement("i")
            icon.textContent = remove ? "remove_circle_outline" : symbol
            if (!remove) icon.classList.add("game-icons")
            icon.setAttribute("aria-hidden", "true")
            cell.append(icon)
        } else {
            cell.dataset.iconItem = item.id
            const loading = document.createElement("i")
            loading.textContent = "hourglass_empty"
            loading.setAttribute("aria-hidden", "true")
            cell.append(loading)
        }
        this.updateCellMotion(cell, slot, item, equippedSlot)
        this.bindTip(cell, () => {
            if (!equippedSlot && item !== null) return `${item.name}\nID: ${item.id}`
            const text = remove ? `Unequip ${label}` : `${label} · ${item === null ? "Empty" : item.name}`
            const motion = this.currentMotion()
            const issue = item !== null && motion !== null ? this.itemMotionDetails(this.itemMotionStatus(item, motion), motion) : ""
            const details = issue ? `${text} · ${issue}` : text
            return cell.dataset.layerConflict ? `${details} · ${cell.dataset.layerConflict}` : details
        })
        return cell
    }
    updateCellMotion(cell, slot, item, equippedSlot) {
        const label = this.slotRecord(slot).name
        const motion = this.currentMotion()
        const status = item !== null && motion !== null ? this.itemMotionStatus(item, motion) : null
        const name = equippedSlot
            ? `${label}: ${item === null ? "Empty" : item.name}`
            : item === null
              ? `Unequip ${label}`
              : `Equip ${item.name}`
        const conflict = Boolean(cell.dataset.layerConflict)
        cell.classList.toggle("warning", status === "missing-animation" && !conflict)
        cell.classList.toggle("danger", conflict || status === "body-mismatch")
        const issue = this.itemMotionDetails(status, motion)
        const details = issue ? `${name} · ${issue}` : name
        cell.setAttribute(
            "aria-label",
            cell.dataset.layerConflict ? `${details} · ${cell.dataset.layerConflict}` : details,
        )
    }
    updateLayerConflicts(error = null) {
        for (const cell of this.required('[data-element="equipment"]').querySelectorAll("td[data-slot]")) {
            const slot = cell.dataset.slot,
                id = this.parts[slot]
            const badge = cell.querySelector('[data-element="layer-conflict"]')
            if (badge !== null) badge.remove()
            delete cell.dataset.layerConflict
            if (
                error !== null &&
                error.components.some((component) => component.slot === slot && component.item === id)
            ) {
                cell.dataset.layerConflict = error.message
                const icon = document.createElement("i")
                icon.dataset.element = "layer-conflict"
                icon.className = "warning"
                icon.textContent = "warning"
                icon.setAttribute("aria-hidden", "true")
                cell.append(icon)
            }
            this.updateCellMotion(cell, slot, id === null ? null : this.item(id), true)
        }
    }
    updateMotionCells() {
        for (const cell of this.shadowRoot.querySelectorAll("td[data-slot], td[data-item]")) {
            const equippedSlot = cell.hasAttribute("data-slot")
            const slot = equippedSlot ? cell.dataset.slot : this.item(cell.dataset.item).slot
            const id = equippedSlot ? this.parts[slot] : cell.dataset.item
            this.updateCellMotion(cell, slot, id === null ? null : this.item(id), equippedSlot)
        }
    }
    updateBoard() {
        const body = this.required('[data-element="equipment"]')
        const focus = body.contains(this.shadowRoot.activeElement)
        body.replaceChildren()
        const slots = this.visibleSlots()
        const rowCount = Math.ceil(slots.length / 2)
        for (let i = 0; i < rowCount; i++) {
            const row = body.insertRow()
            const appendSlot = ({ id: slot }) => {
                const id = this.parts[slot]
                row.append(this.itemCell(slot, id === null ? null : this.item(id), true))
            }
            appendSlot(slots[i * 2])
            if (i === 0) {
                const cell = row.insertCell()
                cell.setAttribute("role", "gridcell")
                cell.rowSpan = rowCount
                cell.setAttribute("aria-label", "Canvas opening")
            }
            const right = slots[i * 2 + 1]
            if (right !== undefined) appendSlot(right)
        }
        this.equipmentGrid.refresh({ focus })
        this.demandIcons("equipment", body)
    }
    yieldRender(paint = false) {
        // Message tasks yield without hidden-WebView nested-timer clamping.
        // Only the initial selection needs an explicit paint opportunity.
        return new Promise((resolve) => {
            const channel = new MessageChannel()
            let frame = 0,
                timer = 0,
                afterFrame = 0,
                posted = false
            const post = () => {
                if (posted) return
                posted = true
                channel.port2.postMessage(null)
            }
            channel.port1.onmessage = () => {
                clearTimeout(timer)
                clearTimeout(afterFrame)
                cancelAnimationFrame(frame)
                channel.port1.close()
                channel.port2.close()
                resolve()
            }
            if (paint) {
                timer = setTimeout(post, 50)
                frame = requestAnimationFrame(() => {
                    afterFrame = setTimeout(post, 0)
                })
            } else post()
        })
    }
    async finishPreviewProgress(request, method, message) {
        if (request.progressFinished) return
        request.progressFinished = true
        const id = await request.progress
        const input = { id }
        if (method !== "progressClose") {
            input.message = message
            input.duration = method === "progressSuccess" ? 600 : 3000
        }
        try {
            unwrap(await runtime.call(`ui.toast.${method}`, input), `ui.toast.${method}`)
        } catch (error) {
            // The service removes user-dismissed progress IDs. Dismissal only
            // hides the notification; it must not cancel or fail the render.
            if (error.message !== `ui.toast.${method} references unknown progress id '${id}'`) throw error
        }
    }
    updatePreview() {
        this.updateLayerConflicts()
        const previous = this.previewRequest
        const request = { progressFinished: false }
        this.previewRequest = request
        if (previous !== null) void this.finishPreviewProgress(previous, "progressClose")
        this.previewPending = true
        this.updateStatus()
        request.progress = runtime
            .call("ui.toast.progressStart", {
                message: "Rendering character preview…",
                progress: null,
                position: "modal",
            })
            .then((result) => {
                const { id } = unwrap(result, "ui.toast.progressStart")
                assert(typeof id === "string" && id.length > 0, "preview progress toast requires an id")
                return id
            })
        return Promise.all([request.progress, this.prepareSelectedPacks(request)])
            .then(async () => {
                if (this.previewRequest !== request || !this.isConnected) return
                if (this.previewMode === "spritesheet") {
                    await this.yieldRender(true)
                    if (this.previewRequest !== request || !this.isConnected) return
                    await this.renderSpritesheet(request)
                } else {
                    const motion = this.currentMotion(),
                        packs = new Map()
                    if (motion !== null)
                        for (const id of this.motionAvailability().supported)
                            packs.set(id, await this.packCache.get(this.packKey(this.item(id), motion)))
                    await this.yieldRender(true)
                    if (this.previewRequest !== request || !this.isConnected) return
                    await this.renderPreview(packs, request)
                }
                if (this.previewRequest === request && this.isConnected) {
                    this.previewPending = false
                    this.updateStatus()
                    await this.finishPreviewProgress(request, "progressSuccess", "Character preview rendered")
                }
            })
            .catch(async (error) => {
                if (this.previewRequest === request && this.isConnected) {
                    this.previewPending = false
                    if (error instanceof LayerConflictError) this.updateLayerConflicts(error)
                    this.reportFailure(error)
                    await this.finishPreviewProgress(
                        request,
                        "progressError",
                        `Character rendering failed: ${error.message}`,
                    )
                }
            })
    }
    async publishPreview(clip, request) {
        await this.yieldRender()
        if (this.previewRequest !== request || !this.isConnected) return false
        this.installCanvasClip(clip)
        return true
    }
    async renderPreview(packs, request = this.previewRequest) {
        const motion = this.currentMotion()
        const facing = this.required('[data-field="direction"]')
        for (const option of facing.options)
            option.disabled =
                motion !== null &&
                !motion.directions.includes({ north: "N", east: "E", south: "S", west: "W" }[option.value])
        if (
            motion !== null &&
            !motion.directions.includes({ north: "N", east: "E", south: "S", west: "W" }[this.direction])
        )
            this.direction = { N: "north", E: "east", S: "south", W: "west" }[motion.directions[0]]
        facing.disabled = motion === null
        facing.value = this.direction
        this.updateMotionCells()
        const availability = this.motionAvailability()
        if (!availability.available) {
            this.installCanvasClip(null)
            this.previewKey = null
            this.playing = false
            this.updatePlayback()
            return
        }
        const key = JSON.stringify([
            motion.id,
            this.direction,
            this.body,
            availability.supported.map((id) => [id, this.colors[this.item(id).slot]]),
        ])
        if (this.previewClip !== null && this.previewKey === key) {
            this.updatePlayback()
            return
        }
        if (this.previewCache !== null && this.previewCache.key === key) {
            if (!(await this.publishPreview(this.previewCache.clip, request))) return
            if (this.previewRequest !== request || !this.isConnected) return
            this.previewKey = key
            this.updatePlayback()
            return
        }
        const components = orderedComponents(
            availability.supported.flatMap((id) => {
                assert(packs.has(id), `missing selected pack for ${id}`)
                return packs.get(id)
            }),
            motion.id,
        )
        const palettes = new Map(
            availability.supported.map((id) => {
                const item = this.item(id)
                const palette = this.palettes.get(this.colors[item.slot])
                assert(palette, `missing palette for ${item.id}`)
                return [id, this.colors[item.slot] === item.palette ? null : palette.colors]
            }),
        )
        const direction = this.direction
        const width = motion.frame_width
        const height = motion.frame_height
        const frames = []
        for (const [index, column] of motion.sequence.entries()) {
            if (index > 0) await this.yieldRender()
            if (this.previewRequest !== request || !this.isConnected) return
            const result = composeFrame(components, motion, direction, column, palettes)
            const canvas = rgbaCanvas(result.width, result.height, result.pixels)
            frames.push({ canvas, durationMs: motion.durations_ms[index] })
        }
        const clip = { width, height, frames }
        if (!(await this.publishPreview(clip, request))) return
        if (this.previewRequest !== request || !this.isConnected) return
        this.previewCache = { key, clip }
        this.previewKey = key
        this.updatePlayback()
    }
    selectAllSheets(checked) {
        this.selectedSheets = new Set(checked ? this.animations.map((motion) => motion.id) : [])
        this.updateSheetSelection()
        this.updatePreview()
    }
    updateSheetSelection() {
        const container = this.previewControls.sheets
        const all = container.querySelector('[data-field="all-sheet-animations"]')
        assert(all, "missing spritesheet select-all checkbox")
        all.disabled = this.animations.length === 0
        all.checked = this.animations.length > 0 && this.selectedSheets.size === this.animations.length
        all.indeterminate = this.selectedSheets.size > 0 && !all.checked
        for (const checkbox of container.querySelectorAll('[data-field="sheet-animation"]'))
            checkbox.checked = this.selectedSheets.has(checkbox.value)
    }
    updatePreviewMode() {
        const { sheets, animation, facing } = this.previewControls
        // Shared form styles override native [hidden]. Mount only the active
        // controls instead of introducing View-local visibility CSS.
        sheets.remove()
        animation.remove()
        facing.remove()
        const status = this.required('[data-element="animation-status"]')
        if (this.previewMode === "spritesheet") status.before(sheets)
        else status.before(animation, facing)
    }
    async renderSpritesheet(request) {
        const motions = this.previewMotions()
        this.playing = false
        if (motions.length === 0 || !motions.some((motion) => this.motionAvailability(motion).available)) {
            if (!(await this.publishPreview(null, request))) return
            this.previewKey = null
            this.updatePlayback()
            return
        }
        const width = Math.max(...motions.map((motion) => motion.frame_width * motion.frame_count))
        const height = motions.reduce((sum, motion) => sum + motion.frame_height * motion.directions.length, 0)
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const ctx = context2d(canvas)
        let top = 0
        for (const motion of motions) {
            const availability = this.motionAvailability(motion)
            const packs = await Promise.all(availability.supported.map((id) => {
                const key = this.packKey(this.item(id), motion)
                assert(this.packCache.has(key), `missing selected pack for ${id}`)
                return this.packCache.get(key)
            }))
            if (this.previewRequest !== request || !this.isConnected) return
            const components = orderedComponents(packs.flat(), motion.id)
            const palettes = new Map(availability.supported.map((id) => {
                const item = this.item(id)
                const palette = this.palettes.get(this.colors[item.slot])
                assert(palette, `missing palette for ${item.id}`)
                return [id, this.colors[item.slot] === item.palette ? null : palette.colors]
            }))
            for (const [row, code] of [...motion.directions].entries()) {
                const direction = { N: "north", E: "east", S: "south", W: "west" }[code]
                for (let column = 0; column < motion.frame_count; column++) {
                    await this.yieldRender()
                    if (this.previewRequest !== request || !this.isConnected) return
                    const result = composeFrame(components, motion, direction, column, palettes)
                    ctx.drawImage(rgbaCanvas(result.width, result.height, result.pixels),
                        column * motion.frame_width, top + row * motion.frame_height)
                }
            }
            top += motion.frame_height * motion.directions.length
        }
        const clip = { width, height, frames: [{ canvas, durationMs: 100 }] }
        if (!(await this.publishPreview(clip, request))) return
        this.previewKey = null
        this.updatePlayback()
    }
    updatePlayback() {
        if (this.previewMode === "spritesheet") {
            this.playing = false
            this.syncCanvasPlayback()
            this.required('[data-element="animation-status"]').textContent = this.selectedSheets.size
                ? `${this.selectedSheets.size} spritesheet(s) selected · all source frames and directions.`
                : "Select animations to render."
            this.updateStatus()
            return
        }
        const availability = this.motionAvailability()
        const motion = this.currentMotion()
        const playable = this.canPlayAnimation()
        if (!playable) this.playing = false
        this.syncCanvasPlayback()
        const button = this.required('[data-action="play"]')
        button.disabled = !playable
        button.setAttribute("aria-pressed", String(this.playing))
        button.setAttribute(
            "aria-label",
            `${this.playing ? "Pause" : "Play"} ${motion === null ? "animation" : motion.name}`,
        )
        button.querySelector("i").textContent = this.playing ? "pause" : "play_arrow"
        const skipped =
            availability.available && availability.missing.length
                ? ` Omitted from preview: ${availability.missing.join(", ")}.`
                : ""
        this.required('[data-element="animation-status"]').textContent =
            (!availability.available
                ? availability.reason
                : `${motion.name} · ${motion.frame_count} source frames / ${motion.sequence.length} playback steps · ${motion.directions}.`) +
            skipped
        this.updateStatus()
    }
    updateInventoryStatus() {
        const slot = this.selectedSlot
        const output = this.required('[data-element="empty"]')
        const error = this.inventoryErrors.get(slot) || this.inventorySupportErrors.get(this.supportKey(slot))
        output.className = error ? "danger" : "info"
        if (slot === null) output.textContent = "Select an equipment slot."
        else if (error) output.textContent = `Inventory loading failed: ${error.message}`
        else if (!this.inventories.has(slot)) output.textContent = "Loading inventory…"
        else if (!this.inventoryReady(slot))
            output.textContent = this.iconScheduler.isGroupReady("inventory")
                ? "Checking animation support…"
                : "Loading item icons…"
        else {
            output.className = ""
            const inventory = this.inventories.get(slot)
            output.textContent = inventory.some((item) => item.name.toLowerCase().includes(this.search.toLowerCase()))
                ? ""
                : inventory.length
                  ? "No matching parts"
                  : `No catalog items for ${this.slotRecord(slot).name}.`
        }
    }
    updatePicker() {
        this.closeTip()
        const slot = this.selectedSlot
        // Metadata alone mounts cells. Icons and then compatibility decorate
        // those same cells asynchronously, without blocking search or selection.
        const showItems = slot !== null && this.inventories.has(slot)
        const body = this.required('[data-element="choices"]')
        const focus = body.contains(this.shadowRoot.activeElement)
        body.replaceChildren()
        this.pickerSlot = null
        this.required('[data-element="picker-title"]').textContent =
            slot === null ? "Parts" : this.slotRecord(slot).name
        this.required('[data-field="search"]').disabled = !showItems
        if (showItems) {
            this.pickerSlot = slot
            const inventory = this.inventories.get(slot)
            const choices = inventory.filter((item) => item.name.toLowerCase().includes(this.search.toLowerCase()))
            const entries = [null, ...choices]
            for (let i = 0; i < entries.length; i += INVENTORY_COLUMNS) {
                const row = body.insertRow()
                for (const item of entries.slice(i, i + INVENTORY_COLUMNS)) row.append(this.itemCell(slot, item))
            }
        }
        this.inventoryGrid.refresh({ focus })
        this.demandIcons("inventory", body)
        this.updateInventoryStatus()
    }
    updatePalettePanel() {
        const previous = this.shadowRoot.querySelector('[data-element="recolor"]')
        if (previous !== null) previous.remove()
        const slot = this.selectedSlot
        if (slot === null || this.parts[slot] === null) return
        const item = this.paletteItem(slot)
        const panel = document.createElement("fieldset")
        panel.dataset.element = "recolor"
        const name = this.slotRecord(slot).name
        if (!this.palettes.has(item.palette)) {
            panel.innerHTML = '<legend>Recolor</legend><output class="info">Loading palettes…</output>'
        } else {
            const choices = this.compatiblePalettes(item)
            assert(
                choices.some((palette) => palette.id === this.colors[slot]),
                "unknown selected palette",
            )
            panel.innerHTML = `<legend>Recolor</legend><table aria-label="Part palettes"><thead><tr><th scope="col">Palette</th><th scope="col">Colors</th></tr></thead><tbody>
                <tr><td><select data-color="${htmlText(slot)}" aria-label="${htmlText(name)} palette">${choices
                    .map((palette) => `<option value="${htmlText(palette.id)}">${htmlText(palette.name)}</option>`)
                    .join("")}</select></td>
                <td><widget-animation-preview data-palette="${htmlText(slot)}" aria-hidden="true"></widget-animation-preview></td></tr>
                </tbody></table>`
            const select = panel.querySelector("select")
            select.value = this.colors[slot]
            select.addEventListener("change", () => {
                assert(
                    this.compatiblePalettes(this.paletteItem(slot)).some((palette) => palette.id === select.value),
                    "incompatible palette selection",
                )
                this.colors[slot] = select.value
                this.updatePalettes(slot)
                void this.updatePreview()
            })
        }
        const inventory = this.required('[data-element="inventory"]')
        inventory.before(panel)
        this.updatePalettes(slot)
    }
    refreshPaletteControls(onlySlot = null) {
        if (onlySlot === null || onlySlot === this.selectedSlot) this.updatePalettePanel()
    }
    updatePalettes(onlySlot = null) {
        const slot = this.selectedSlot
        if (slot === null || this.parts[slot] === null || (onlySlot !== null && slot !== onlySlot)) return
        if (!this.palettes.has(this.paletteItem(slot).palette)) return // The panel explicitly shows loading.
        const palette = this.palettes.get(this.colors[slot])
        assert(palette, `missing ${slot} palette`)
        const ramp = palette.colors.slice(1)
        const canvas = canvasOf(ramp.length * 20, 16),
            context = context2d(canvas)
        ramp.forEach(([red, green, blue, alpha], index) => {
            context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`
            context.fillRect(index * 20, 0, 20, 16)
        })
        const preview = this.required(`[data-palette="${slot}"]`)
        setPreview(preview, [canvas])
        assert(preview.parentElement instanceof HTMLTableCellElement, "palette color cell required")
        const colors = ramp.map(
            (rgba) =>
                `#${rgba
                    .slice(0, 3)
                    .map((channel) => channel.toString(16).padStart(2, "0"))
                    .join("")}`,
        )
        preview.parentElement.setAttribute("aria-label", `${palette.name}: ${colors.join(", ")}`)
    }
    updateStatus() {
        if (this.iconScheduler.failed) {
            const output = this.required('[data-element="status"]')
            output.className = "danger"
            output.textContent = `Character icons failed: ${this.iconScheduler.error.message}`
            return
        }
        if (this.previewPending) {
            const output = this.required('[data-element="status"]')
            output.className = "info"
            output.textContent = "Rendering character preview…"
            return
        }
        this.required('[data-element="status"]').className = ""
        this.required('[data-element="status"]').textContent =
            `Character catalog · ${this.activeParts().length} parts · ${this.direction} · session only`
    }
    update() {
        this.closeTip()
        this.updatePalettePanel()
        this.updateBoard()
        if (Object.values(this.parts).some((id) => id !== null)) void this.updatePreview()
        else void this.renderPreview(new Map())
        this.updatePicker()
        if (this.selectedSlot !== null && !this.inventoryReady(this.selectedSlot)) void this.refreshInventorySupport()
    }
}

customElements.define("view-character", ViewCharacter)
