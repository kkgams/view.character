import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { evaluateView } from './character-view-test.mjs'

// Optional integration against canonical Host source; standalone CI must not
// require a sibling checkout. Consumer/control tests below always run.
const basePath = new URL('../../gams/cmd/app/src/util/view-canvas-base.js', import.meta.url)
const hasHost = existsSync(basePath)
const baseSource = hasHost ? await readFile(basePath, 'utf8') : null
const Base = hasHost
    ? new Function('HTMLElement', baseSource.replace(/^import .*\n/gm, '').replace('export class ', 'class ') + '\nreturn ViewCanvasBase')(class {})
    : class {}
const { ViewCharacter } = evaluateView(undefined, undefined, { ViewCanvasBase: Base })

function controls() {
    const all = {}
    const boxes = ['wide', 'tall', 'short'].map(value => ({ value, checked: false }))
    const view = Object.assign(Object.create(ViewCharacter.prototype), {
        animations: boxes.map(({ value }) => ({ id: value })), selectedSheets: new Set(['wide']),
        previewControls: { sheets: { querySelector: () => all, querySelectorAll: () => boxes } },
        renders: 0, updatePreview() { this.renders++ },
    })
    return { view, all, boxes }
}

test('select all selects/deselects catalog animations and renders only once per toggle', () => {
    const { view, all, boxes } = controls()
    view.updateSheetSelection()
    assert.equal(all.checked, false)
    assert.equal(all.indeterminate, true)
    assert.deepEqual(boxes.map(b => b.checked), [true, false, false])
    view.selectAllSheets(true)
    assert.deepEqual([...view.selectedSheets], ['wide', 'tall', 'short'])
    assert.equal(all.checked, true)
    assert.equal(all.indeterminate, false)
    assert.ok(boxes.every(b => b.checked))
    assert.equal(view.renders, 1)
    view.selectedSheets.delete('tall')
    view.updateSheetSelection()
    assert.equal(all.checked, false)
    assert.equal(all.indeterminate, true)
    view.selectAllSheets(false)
    assert.equal(view.selectedSheets.size, 0)
    assert.equal(all.checked, false)
    assert.equal(all.indeterminate, false)
    assert.ok(boxes.every(b => !b.checked))
    assert.equal(view.renders, 2)
})

test('empty registry disables select all without marking it checked or partial', () => {
    const { view, all } = controls()
    view.animations = []
    view.selectedSheets.clear()
    view.updateSheetSelection()
    assert.equal(all.disabled, true)
    assert.equal(all.checked, false)
    assert.equal(all.indeterminate, false)
})

test('actual Host base receives completed stacked dimensions and fits replacements of different sizes', {
    skip: hasHost ? false : 'optional canonical sibling Host checkout is not present',
}, t => {
    const previous = globalThis.HTMLCanvasElement
    class Canvas { width = 1200; height = 800 }
    globalThis.HTMLCanvasElement = Canvas
    t.after(() => { globalThis.HTMLCanvasElement = previous })
    const view = Object.assign(Object.create(ViewCharacter.prototype), {
        canvas: new Canvas(), canvasMounted: true, autoFitOnLoad: true,
        previewClip: null, previewTimer: null, playing: false,
        draw() {},
    })
    const clip = (width, height) => ({ width, height, frames: [{ canvas: {}, durationMs: 100 }] })
    const verifyFit = (width, height) => {
        assert.deepEqual(view.contentBounds, { minX: 0, minY: 0, maxX: width, maxY: height })
        const scale = Math.min((1200 - 80) / width, (800 - 80) / height)
        assert.equal(view.scale, scale)
        assert.equal(view.offsetX, 600 - width * scale / 2)
        assert.equal(view.offsetY, 400 - height * scale / 2)
    }
    view.installCanvasClip(clip(64, 64))
    verifyFit(64, 64)
    view.installCanvasClip(clip(1536, 4096))
    verifyFit(1536, 4096)
    view.scale = 0.5
    view.offsetX = 123
    view.offsetY = 234
    view.installCanvasClip(clip(1536, 4096))
    assert.equal(view.scale, 0.5, 'same dimensions preserve manual zoom')
    assert.equal(view.offsetX, 123)
    assert.equal(view.offsetY, 234)
    assert.equal(view.zoomFit(), true)
    verifyFit(1536, 4096)
    view.installCanvasClip(clip(576, 512))
    verifyFit(576, 512)
    view.installCanvasClip(null)
    assert.deepEqual(view.contentBounds, { minX: 0, minY: 0, maxX: 0, maxY: 0 })
})
