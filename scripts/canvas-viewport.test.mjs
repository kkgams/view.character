import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView, viewSource } from './character-view-test.mjs'

const { ViewCharacter } = evaluateView()

test('shadow canvas adapter reuses base listeners, resize observation and initial fit', t => {
    const previous = globalThis.HTMLCanvasElement
    class Canvas { getContext() { return context } }
    const context = {}
    globalThis.HTMLCanvasElement = Canvas
    t.after(() => { globalThis.HTMLCanvasElement = previous })
    const canvas = new Canvas(), events = []
    const view = Object.assign(Object.create(ViewCharacter.prototype), {
        canvasMounted: false, previewClip: null, previewTimer: null,
        required(selector) { assert.equal(selector, 'form > canvas[data-element="canvas"]'); return canvas },
        _addEventListeners() { events.push('listen') },
        _removeEventListeners() { events.push('unlisten') },
        _resizeObserver: {
            observe(target) { assert.equal(target, canvas); events.push('observe') },
            disconnect() { events.push('disconnect') },
        },
        setData(data) { assert.equal(data, null); assert.equal(this._hasAutoFitted, false); events.push('fit') },
    })
    view.mountCanvas()
    assert.equal(view.canvas, canvas)
    assert.equal(view.ctx, context)
    assert.equal(context.imageSmoothingEnabled, false)
    assert.throws(() => view.mountCanvas(), /already mounted/)
    view.spacePressed = view.isDragging = true
    view.unmountCanvas()
    view.unmountCanvas()
    assert.deepEqual(events, ['listen', 'observe', 'fit', 'disconnect', 'unlisten'])
    assert.equal(view.canvasMounted, false)
    assert.equal(view.canvas, null)
    assert.equal(view.ctx, null)
    assert.equal(view.spacePressed, false)
    assert.equal(view.isDragging, false)
})

test('header view actions expose the standard canvas zoom controls in order', () => {
    const group = viewSource.match(/<div role="buttongroup" data-element="view-actions">(.*?)<\/div>/s)
    assert.ok(group)
    const buttons = [...group[1].matchAll(/data-action="([^"]+)" aria-label="([^"]+)"><i aria-hidden="true">([^<]+)<\/i>/g)]
    assert.deepEqual(buttons.map(([, action, label, icon]) => [action, label, icon]), [
        ['zoom-in', 'Zoom in', 'zoom_in'],
        ['zoom-fit', 'Fit', 'fit_screen'],
        ['zoom-out', 'Zoom out', 'zoom_out'],
    ])
})

test('preview Reset does not overwrite canvas viewport zoom', () => {
    const view = Object.assign(Object.create(ViewCharacter.prototype), { slots: [], animations: [], scale: 0.75 })
    view.resetState()
    assert.equal(view.scale, 0.75)
})

test('canvas draws the current complete frame in clip world bounds, without recomposition', () => {
    const calls = [], first = {}, second = {}
    const context = { drawImage: (...args) => calls.push(args) }
    const clip = { width: 64, height: 128, frames: [{ canvas: first }, { canvas: second }] }
    const view = Object.assign(Object.create(ViewCharacter.prototype), { previewFrameIndex: 1 })
    view.drawContent(context, null)
    assert.deepEqual(calls, [])
    view.drawContent(context, clip)
    assert.deepEqual(view.calculateContentBounds(null), { minX: 0, minY: 0, maxX: 0, maxY: 0 })
    assert.deepEqual(view.calculateContentBounds(clip), { minX: 0, minY: 0, maxX: 64, maxY: 128 })
    assert.deepEqual(calls, [[second, 0, 0]])
    assert.equal(context.imageSmoothingEnabled, false)
    view.previewFrameIndex = 2
    assert.throws(() => view.drawContent(context, clip), /missing character frame/)
})
