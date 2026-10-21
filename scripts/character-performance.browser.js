// Work-count and progressive-icon regressions under the real Host widget/SQL transport.
export async function checkCharacterPerformance() {
    const assert = (ok, message) => { if (!ok) throw Error(message) }
    const view = document.querySelector('view-character')
    assert(view && view.slots.length && view.animations.length, 'Prepared slots and animations required')
    const before = { selectedSlot: view.selectedSlot, search: view.search, direction: view.direction,
        parts: {...view.parts}, colors: {...view.colors}, selectedAnimation: view.selectedAnimation, body: view.body, scale: view.scale, playing: view.playing }
    const shell = view.parentElement, originalWidth = shell.style.width
    const Widget = customElements.get('widget-animation-preview')
    const descriptor = Object.getOwnPropertyDescriptor(Widget.prototype, 'clip')
    const originalSetClipAsync = Widget.prototype.setClipAsync
    const originalCommitClip = Widget.prototype.commitClip
    const { sql } = await import('/util/sql.js')
    const originalQuery = sql.queryObjects
    const writes = [], iconQueries = [], metadataQueries = [], supportQueries = [], clicks = []
    let active = 0, peak = 0, activeSupport = 0, peakSupport = 0, largestIDs = new Set(), previousBatch = [], progressiveChecks = 0
    let coldInventoryProbe = false, firstSupportIconCount = null
    let equipProbe = null
    const originalRenderPreview = view.renderPreview
    const recordWrite = value => writes.push(value === null ? { width: 0, channels: 0 } :
        { width: value.width, channels: value.width * value.height * 4 * value.frames.length })
    if (typeof originalSetClipAsync === 'function') Widget.prototype.setClipAsync = async function(value,...args) {
        const probe = equipProbe, start = performance.now()
        const committed = await originalSetClipAsync.call(this,value,...args)
        if (this.dataset.element === 'character-preview') {
            if (committed) recordWrite(value)
            if (probe !== null) probe.asyncClipUpdates.push({ startMs: start - probe.started,
                durationMs: performance.now() - start, committed })
        }
        return committed
    }
    if (typeof originalCommitClip === 'function') Widget.prototype.commitClip = function(...args) {
        const start = performance.now()
        try { return originalCommitClip.apply(this,args) }
        finally {
            if (equipProbe !== null && this.dataset.element === 'character-preview')
                equipProbe.atomicClipCommits.push({ startMs: start - equipProbe.started, durationMs: performance.now() - start })
        }
    }
    Object.defineProperty(Widget.prototype, 'clip', { ...descriptor, set(value) {
        if (this.dataset.element === 'character-preview') recordWrite(value)
        const start = performance.now()
        descriptor.set.call(this, value)
        if (equipProbe !== null && this.dataset.element === 'character-preview')
            equipProbe.clipSetters.push({ startMs: start - equipProbe.started, durationMs: performance.now() - start })
    } })
    const settle = () => new Promise(resolve => setTimeout(resolve, 20))
    const preview = () => view.required('[data-element="character-preview"]')
    const cells = () => [...view.required('[data-element="choices"]').querySelectorAll('td[data-item]')]
    const loaded = cell => {
        const widget = cell.querySelector('widget-animation-preview')
        return widget !== null && widget.clip !== null
    }
    try {
        const bodySlot = view.slots.find(slot => slot.name === 'body')
        assert(bodySlot, 'Supplied body slot required')
        assert(await view.ensureInventory(bodySlot.id), 'Body inventory demand must complete')
        const samples = await sql.queryObjects('SELECT DISTINCT item FROM sprites WHERE animation = ? AND body LIKE ? AND mask = 0 AND item IN (SELECT id FROM items WHERE slot = ?) ORDER BY item LIMIT 1', ['item'], ['walk', '%m%', bodySlot.id])
        assert(samples.length === 1, 'Performance probe needs one body item supporting walk')
        const item = view.items.get(samples[0].item)
        assert(item && await view.ensureItemMetadata(item) && await view.ensurePalettes(), 'Body metadata and palettes must load on demand')
        const counts = await sql.queryObjects('SELECT slot, COUNT(*) AS count FROM items GROUP BY slot ORDER BY slot', ['slot', 'count'])
        const inventories = view.slots.map(({ id }) => ({ slot: id, count: counts.find(row => row.slot === id)?.count || 0 }))
        const largest = inventories.reduce((best, entry) => entry.count > best.count ? entry : best)
        assert(await view.ensureInventory(largest.slot), 'Largest fixture inventory must load explicitly')
        largest.items = view.inventories.get(largest.slot)
        const empty = inventories.find(entry => entry.count === 0)
        if (empty !== undefined) assert(await view.ensureInventory(empty.slot), 'Empty fixture inventory must load explicitly')
        view.parts = Object.fromEntries(view.slots.map(slot => [slot.id,null]))
        view.parts[item.slot] = item.id
        view.colors[item.slot] = item.palette
        view.selectedAnimation = 'walk'
        view.scale = 1
        if (view.selectedSlot !== null) {
            await view.selectSlot(view.selectedSlot)
            await view.refreshInventorySupport()
            assert(view.inventoryReady(view.selectedSlot), 'Prepared active inventory requires completed icons and support')
        }
        view.update()
        void view.updatePreview()
        for (let i=0;i<500 && view.previewKey === null;i++) await settle()
        assert(view.previewKey !== null, `Controlled nonconflicting animation must load: ${view.required('[data-element="status"]').textContent}`)
        writes.length = 0
        const originalPreview = preview(), playing = view.playing
        sql.queryObjects = async function(query, columns, parameters) {
            if (/^SELECT id, name, slot, palette FROM items WHERE slot = \? (?:AND id > \? )?ORDER BY id LIMIT 512$/.test(query)) {
                assert(columns.join(',') === 'id,name,slot,palette' && parameters.length >= 1 && parameters.length <= 2, 'Inventory demand must use scoped metadata pages')
                metadataQueries.push({ query, parameters: [...parameters] })
                return originalQuery.call(this,query,columns,parameters)
            }
            if (query.startsWith('SELECT i.id, COALESCE(support.supported, 0) AS supported,')) {
                const shape = /^SELECT i\.id, COALESCE\(support\.supported, 0\) AS supported, support\.item IS NOT NULL AS hasAnimation FROM items i LEFT JOIN \(SELECT item, MAX\(instr\(body, \?\) > 0\) AS supported FROM sprites WHERE animation = \? AND mask = 0 AND item IN \((\?(?:,\s*\?)*)\) GROUP BY item\) support ON support\.item = i\.id WHERE i\.slot = \? AND i\.id IN \((\?(?:,\s*\?)*)\) ORDER BY i\.id$/.exec(query)
                assert(shape, 'Compatibility must use a set-based LEFT JOIN with both inner and outer bounded item IDs')
                const count = shape[1].split(',').length, outerCount = shape[2].split(',').length
                const innerIDs = parameters.slice(2, 2 + count), slot = parameters[2 + count], outerIDs = parameters.slice(3 + count)
                assert(columns.join(',') === 'id,supported,hasAnimation' && count >= 1 && count <= 10 && outerCount === count && parameters.length === 3 + count * 2, 'Compatibility requests need id/support/animation flags and at most ten IDs bound twice')
                assert(parameters[0] === view.body && parameters[1] === view.selectedAnimation && slot === view.selectedSlot && JSON.stringify(innerIDs) === JSON.stringify(outerIDs), 'Compatibility bindings must be body, animation, IDs, slot, identical IDs')
                assert(innerIDs.every(id => view.inventories.get(slot).some(item => item.id === id)), 'Compatibility IDs must belong to the demanded inventory')
                assert(cells().every(loaded), 'All demanded inventory icons must decode and publish before compatibility SQL')
                if (coldInventoryProbe && firstSupportIconCount === null) firstSupportIconCount = cells().filter(loaded).length
                supportQueries.push({ query, parameters: [...parameters], count })
                activeSupport++; peakSupport = Math.max(peakSupport, activeSupport)
                try { return await originalQuery.call(this,query,columns,parameters) }
                finally { activeSupport-- }
            }
            assert(/^SELECT id, icon FROM items WHERE id IN /.test(query), `Slot changes must only request scoped inventory metadata, support flags and icons: ${query}`)
            if (coldInventoryProbe) assert(firstSupportIconCount === null, 'All cold inventory icon SQL must precede its first compatibility SQL')
            assert(columns.join(',') === 'id,icon' && parameters.length <= 10, 'Icon requests need at most ten bound IDs')
            if (previousBatch.length) {
                const current = new Map(cells().map(cell => [cell.dataset.item,cell]))
                assert(previousBatch.every(id => current.has(id) && loaded(current.get(id))), 'Publish the previous batch before requesting another')
                progressiveChecks++
            }
            previousBatch = parameters.filter(id => largestIDs.has(id))
            iconQueries.push([...parameters])
            active++; peak = Math.max(peak,active)
            try { return await originalQuery.call(this,query,columns,parameters) }
            finally { active-- }
        }
        for (const { id } of view.slots.slice(0, 4)) {
            const start = performance.now()
            const loading = view.selectSlot(id)
            clicks.push({ slot: id, durationMs: performance.now() - start })
            await loading
            assert(view.selectedSlot === id && view.inventories.has(id), 'Slot activation must await metadata, not icons or compatibility')
            await view.refreshInventorySupport()
            assert(view.inventoryReady(id), 'Explicit refresh must complete compatibility flags')
            assert(preview() === originalPreview && view.playing === playing, 'Slot activation must retain preview and playback')
            const inventory = [...view.items.values()].filter(item => item.slot === id)
            if (!inventory.length) assert(view.required('[data-element="empty"]').textContent === `No catalog items for ${view.slotRecord(id).name}.`, 'Empty slot needs an explicit catalog message')
        }
        assert(writes.length === 0, 'Slot activation must not recompose the character')
        largestIDs = new Set(largest.items.map(item => item.id))
        // Exercise a cold inventory even if another integration probe warmed it.
        view.iconScheduler.invalidate()
        const coldSupportKey = view.supportKey(largest.slot)
        view.inventorySupport.delete(coldSupportKey)
        view.inventorySupportComplete.delete(coldSupportKey)
        view.inventorySupportLoads.delete(coldSupportKey)
        view.inventorySupportErrors.delete(coldSupportKey)
        previousBatch = []
        coldInventoryProbe = true
        view.search = ''
        view.demandIcons('equipment',view.required('[data-element="equipment"]'))
        const inventoryStarted = performance.now()
        await view.selectSlot(largest.slot)
        const immediateMs = performance.now()-inventoryStarted
        assert(!view.inventoryReady(largest.slot) && cells().length === largest.items.length, 'All cells must appear after metadata, before compatibility is ready')
        assert(largest.items.filter(item => item.sheets === null).every(item => view.itemSupportsMotion(item) === null), 'Cold compatibility must initially remain unknown')
        const coldCells = cells()
        assert(coldCells.filter(cell => view.items.get(cell.dataset.item).sheets === null).every(cell => !cell.classList.contains('warning')), 'Unknown compatibility must not show missing-animation warnings')
        assert(cells().every(cell => !loaded(cell)), 'Cold cells must show loading before images arrive')
        let firstIconsMs = null
        while (true) {
            const visible = cells(), count = visible.filter(loaded).length
            if (count && firstIconsMs === null) firstIconsMs = performance.now()-inventoryStarted
            if (count === largest.items.length) break
            assert(performance.now()-inventoryStarted < 15000, 'Progressive inventory loading timed out')
            await settle()
        }
        const largestInventoryMs = performance.now()-inventoryStarted
        await view.refreshInventorySupport()
        assert(view.inventoryReady(largest.slot) && firstSupportIconCount === largest.items.length, 'All icons must publish before the first compatibility batch; refresh must cache every flag')
        assert(cells().every((cell, index) => cell === coldCells[index]), 'Progressive compatibility must retain inventory cells')
        assert(peakSupport === 1, 'Compatibility requests must run sequentially')
        coldInventoryProbe = false
        assert(progressiveChecks > 0 && peak === 1, 'Icons must publish in sequential batches, not one bulk request')
        assert(writes.length === 0 && preview() === originalPreview, 'Icon loading must not recompose the character')
        previousBatch = []
        // Warm support for the empty destination too: metadata alone is insufficient.
        if (empty !== undefined) {
            await view.selectSlot(empty.slot)
            await view.refreshInventorySupport()
            assert(view.inventoryReady(empty.slot), 'Cached revisit needs destination support')
            await view.selectSlot(largest.slot)
            await view.refreshInventorySupport()
        }
        const cachedQueries = iconQueries.length, cachedMetadataQueries = metadataQueries.length, cachedSupportQueries = supportQueries.length
        if (empty !== undefined) {
            await view.selectSlot(empty.slot)
            await view.selectSlot(largest.slot)
        }
        await view.selectSlot(largest.slot)
        await settle()
        assert(iconQueries.length === cachedQueries && metadataQueries.length === cachedMetadataQueries && supportQueries.length === cachedSupportQueries && cells().every(loaded), 'Cached inventory revisit must render without SQL')
        sql.queryObjects = originalQuery
        assert(view.body === 'm', 'Equip probe requires the current male body policy')
        const drawingLayers = candidate => {
            const rows = candidate.sheets.get(view.currentMotion().id) || []
            const first = rows.find(row => row.body.includes(view.body))
            return first === undefined ? null : rows.filter(row => row.body === first.body && !row.mask).map(row => row.layer)
        }
        const bodyLayers = new Set(drawingLayers(item))
        const candidates = await sql.queryObjects('SELECT DISTINCT item FROM sprites WHERE animation = ? AND body LIKE ? AND mask = 0 AND item IN (SELECT id FROM items WHERE slot = ?) ORDER BY item', ['item'], [view.currentMotion().id, '%m%', largest.slot])
        let equipItem = null
        for (const { item: id } of candidates) {
            const candidate = view.items.get(id)
            assert(candidate && await view.ensureItemMetadata(candidate), 'Equip fixture metadata must load on demand')
            const layers = drawingLayers(candidate)
            if (layers !== null && layers.length > 0 && layers.every(layer => !bodyLayers.has(layer))) {
                equipItem = candidate
                break
            }
        }
        assert(equipItem, 'Equip probe needs a nonconflicting largest-inventory item supporting Walk/body m')
        const originalParts = view.parts
        view.parts = {...originalParts, [equipItem.slot]: equipItem.id}
        try { await view.prepareSelectedPacks() }
        finally { view.parts = originalParts }
        const inventoryCell = cells().find(cell => cell.dataset.item === equipItem.id)
        inventoryCell.focus()
        // The standard WK harness is offscreen, where WebKit may suspend rAF.
        // Visible runs use a real rAF/next-task paint opportunity; offscreen runs
        // still enforce yielding to a task before composition rather than hanging.
        const rafAvailable = await new Promise(resolve => {
            const timeout = setTimeout(() => resolve(false),100)
            requestAnimationFrame(() => { clearTimeout(timeout); resolve(true) })
        })
        equipProbe = { item: equipItem.id, inventoryItems: largest.items.length, rafAvailable, started: performance.now(),
            renderCalls: [], clipSetters: [], asyncClipUpdates: [], atomicClipCommits: [], events: [], timerMs: null, rafMs: null, selectionPaintMs: null, peakHeartbeatLagMs: 0 }
        const equip = equipProbe
        view.renderPreview = function(...args) {
            const call = { startMs: performance.now() - equip.started }
            equip.events.push('renderPreview')
            equip.renderCalls.push(call)
            const finish = () => { call.durationMs = performance.now() - equip.started - call.startMs }
            try {
                const result = originalRenderPreview.apply(this,args)
                if (result instanceof Promise) return result.finally(finish)
                finish()
                return result
            } catch (error) { finish(); throw error }
        }
        let heartbeatAt = performance.now()
        const heartbeat = setInterval(() => {
            const now = performance.now()
            equip.peakHeartbeatLagMs = Math.max(equip.peakHeartbeatLagMs, now - heartbeatAt - 10)
            heartbeatAt = now
        },10)
        const timer = new Promise(resolve => setTimeout(() => { equip.timerMs = performance.now() - equip.started; resolve() },0))
        const paint = new Promise(resolve => {
            const afterFrame = () => setTimeout(() => {
                equip.events.push('selectionPaintOpportunity')
                equip.selectionPaintMs = performance.now() - equip.started
                resolve()
            },0)
            if (rafAvailable) requestAnimationFrame(() => {
                equip.rafMs = performance.now() - equip.started
                afterFrame()
            })
            else afterFrame()
        })
        try {
            const clickStart = performance.now()
            inventoryCell.click()
            equip.clickSyncMs = performance.now() - clickStart
            equip.sameInventoryCellImmediately = cells().find(cell => cell.dataset.item === equipItem.id) === inventoryCell
            equip.focusRetainedImmediately = view.shadowRoot.activeElement === inventoryCell
            equip.ariaSelectedImmediately = inventoryCell.getAttribute('aria-selected')
            equip.samePreviewImmediately = preview() === originalPreview
            await Promise.all([timer,paint])
            for (let i=0;i<500 && (writes.length === 0 || !equip.renderCalls.length || equip.renderCalls[0].durationMs === undefined);i++) await settle()
            await settle()
            equip.sameInventoryCell = cells().find(cell => cell.dataset.item === equipItem.id) === inventoryCell
            equip.samePreview = preview() === originalPreview
            equip.renderOutsideClipMs = equip.renderCalls.reduce((sum,call) => sum + call.durationMs,0) -
                [...equip.clipSetters,...equip.asyncClipUpdates].reduce((sum,call) => sum + call.durationMs,0)
            assert(writes.length === 1 && equip.renderCalls.length === 1, 'Cached equip must complete one character clip update')
            console.log('Inventory equip measurement', JSON.stringify(equip))
            const detail = JSON.stringify(equip)
            assert(equip.sameInventoryCellImmediately && equip.sameInventoryCell, `Equip must retain inventory cell identity: ${detail}`)
            assert(equip.focusRetainedImmediately && equip.ariaSelectedImmediately === 'true', `Equip selection/focus must update before click returns: ${detail}`)
            assert(equip.samePreviewImmediately && equip.samePreview, `Equip must retain the main preview widget: ${detail}`)
            assert(equip.clickSyncMs <= 100, `Cached equip handler must finish within 100ms: ${detail}`)
            assert(equip.events.indexOf('selectionPaintOpportunity') < equip.events.indexOf('renderPreview'),
                `Selection needs a paint/task opportunity before composition: ${detail}`)
        } finally {
            clearInterval(heartbeat)
            view.renderPreview = originalRenderPreview
            equipProbe = null
        }
        writes.length = 0
        const widths = [1050, 1250, 1150]
        for (const width of widths) {
            shell.style.width = width + 'px'
            await settle()
            assert(preview() === originalPreview, 'Resize must retain the preview widget')
        }
        assert(writes.length === 0, 'Resize must not recompose animation clips')
        const facing = view.required('[data-field="direction"]')
        facing.value = view.direction === 'north' ? 'south' : 'north'
        facing.dispatchEvent(new Event('change', { bubbles: true }))
        for (let i=0;i<500 && writes.length === 0;i++) await settle()
        assert(writes.length === 1 && writes[0].width === view.currentMotion().frame_width * view.scale, 'Clip width must follow the sprite, not viewport')
        return { passed: 15, clicks, maxClickMs: Math.max(...clicks.map(click => click.durationMs)),
            largestInventory: {slot:largest.slot,items:largest.items.length,immediateMs,firstIconsMs,durationMs:largestInventoryMs},
            inventoryEquip: equip,
            supportQueries:supportQueries.length,maxSupportBatch:Math.max(...supportQueries.map(query => query.count)),peakSupportQueries:peakSupport,firstSupportIconCount,
            iconQueries:iconQueries.length,maxBatch:Math.max(...iconQueries.map(ids => ids.length)),peakIconQueries:peak,
            progressiveChecks,cachedRevisitQueries:0,clipWrites:0,resizeSteps:widths.length,changedClipChannels:writes[0].channels }
    } finally {
        sql.queryObjects = originalQuery
        Object.defineProperty(Widget.prototype, 'clip', descriptor)
        if (typeof originalSetClipAsync === 'function') Widget.prototype.setClipAsync = originalSetClipAsync
        if (typeof originalCommitClip === 'function') Widget.prototype.commitClip = originalCommitClip
        view.renderPreview = originalRenderPreview
        shell.style.width = originalWidth
        Object.assign(view, before)
        view.render()
    }
}
