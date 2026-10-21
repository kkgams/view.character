import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView } from './character-view-test.mjs'

const { ViewCharacter } = evaluateView()
const clip = () => ({ width: 64, height: 64, frames: [
    { canvas: {}, durationMs: 100 }, { canvas: {}, durationMs: 400 },
] })

function fixture(t) {
    const originals = ['setTimeout', 'clearTimeout', 'CustomEvent'].map(name => [name, globalThis[name]])
    const timers = new Map(), draws = [], events = [], installs = []
    let next = 0
    globalThis.setTimeout = (callback, delay) => { const id = ++next; timers.set(id, { callback, delay }); return id }
    globalThis.clearTimeout = id => timers.delete(id)
    globalThis.CustomEvent = class { constructor(type, input) { this.type = type; this.detail = input.detail } }
    t.after(() => { for (const [name, value] of originals) globalThis[name] = value })
    const view = Object.assign(Object.create(ViewCharacter.prototype), {
        isConnected: true, canvasMounted: true, playing: true, previewClip: null,
        previewFrameIndex: 0, previewTimer: null, scale: 2, offsetX: 7, offsetY: 9,
        setData(data, options) { this.data = data; installs.push({ data, options }); this.draw() },
        draw() { draws.push(this.previewFrameIndex) },
        dispatchEvent(event) { events.push(event) },
    })
    const advance = () => {
        assert.equal(timers.size, 1)
        const [id, timer] = [...timers][0]
        timers.delete(id)
        timer.callback()
        return timer.delay
    }
    return { view, timers, draws, events, installs, advance }
}

test('canvas playback honors each duration, loops, and pauses without replacing the clip', t => {
    const f = fixture(t), value = clip()
    f.view.installCanvasClip(value)
    assert.equal(f.advance(), 100)
    assert.equal(f.view.previewFrameIndex, 1)
    assert.equal(f.advance(), 400)
    assert.equal(f.view.previewFrameIndex, 0)
    assert.deepEqual(f.events.map(event => event.detail.frameIndex), [1, 0])
    assert.equal(f.installs.length, 1, 'playback must redraw, not reinstall/recompose')
    f.view.playing = false
    f.view.syncCanvasPlayback()
    assert.equal(f.timers.size, 0)
    assert.equal(f.view.previewClip, value)
    f.view.playing = true
    f.view.syncCanvasPlayback()
    f.view.syncCanvasPlayback()
    assert.equal(f.timers.size, 1, 'repeated updates must not duplicate timers')
})

test('replacement resets frame atomically, preserves viewport, and rejects stale timer callbacks', t => {
    const f = fixture(t)
    f.view.installCanvasClip(clip())
    const stale = [...f.timers.values()][0].callback
    f.advance()
    const replacement = clip()
    f.view.installCanvasClip(replacement)
    const currentTimer = f.view.previewTimer
    stale()
    assert.equal(f.view.previewTimer, currentTimer)
    assert.equal(f.view.previewFrameIndex, 0)
    assert.equal(f.view.previewClip, replacement)
    assert.equal(f.installs[0].options.autoFit, true)
    assert.equal(f.installs[1].options.autoFit, false)
    assert.deepEqual([f.view.scale, f.view.offsetX, f.view.offsetY], [2, 7, 9])
    f.view.installCanvasClip(null)
    assert.equal(f.timers.size, 0)
    assert.equal(f.view.data, null)
})

test('pending publication retains the complete old clip; stale work cannot install or restart playback', async t => {
    const f = fixture(t), old = clip(), replacement = clip(), request = {}
    f.view.installCanvasClip(old)
    f.view.previewRequest = request
    let release
    f.view.yieldRender = () => new Promise(resolve => { release = resolve })
    const running = f.view.publishPreview(replacement, request)
    assert.equal(f.view.previewClip, old)
    f.view.previewRequest = {}
    release()
    assert.equal(await running, false)
    assert.equal(f.view.previewClip, old)
    assert.equal(f.installs.length, 1)
    f.view.isConnected = false
    f.advance()
    assert.equal(f.timers.size, 0)
    assert.equal(f.view.previewFrameIndex, 0)
})
