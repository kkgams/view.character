import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView } from './character-view-test.mjs'

const flush = () => new Promise(resolve => setImmediate(resolve))

test('only the latest async preview request may render or report a failure', async () => {
    const { ViewCharacter } = evaluateView()
    const view = Object.create(ViewCharacter.prototype)
    view.isConnected = true
    view.updateStatus = () => {}
    view.yieldRender = () => Promise.resolve()
    view.updateLayerConflicts = () => {}
    view.previewRequest = null
    const pending = []
    view.prepareSelectedPacks = () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
    view.currentMotion = () => null
    let rendered = 0, failures = 0
    view.renderPreview = () => rendered++
    view.reportFailure = () => failures++
    view.updatePreview()
    view.updatePreview()
    pending[1].resolve()
    await flush()
    assert.equal(rendered, 1)
    pending[0].reject(Error('stale request'))
    await flush()
    assert.equal(failures, 0)
    view.updatePreview()
    pending[2].reject(Error('current request'))
    await flush()
    assert.equal(failures, 1)
})

test('disconnect/reset invalidation prevents an outstanding preview from publishing', async () => {
    const { ViewCharacter } = evaluateView()
    const view = Object.create(ViewCharacter.prototype)
    view.updateLayerConflicts = () => {}
    view.previewRequest = null
    let finish
    view.isConnected = true
    view.updateStatus = () => {}
    view.yieldRender = () => Promise.resolve()
    view.prepareSelectedPacks = () => new Promise(resolve => { finish = resolve })
    view.currentMotion = () => null
    view.renderPreview = () => { throw Error('obsolete preview published') }
    view.reportFailure = () => { throw Error('obsolete error published') }
    view.updatePreview()
    view.previewRequest = null
    finish()
    await flush()
})

test('a rendering error clears stale playback and success removes its danger state', () => {
    const { ViewCharacter } = evaluateView()
    const view = Object.create(ViewCharacter.prototype)
    view.initializeIcons()
    const status = {}
    view.previewClip = {}
    view.playing = true
    view.required = () => status
    view.parts = { body: 'body/base' }
    view.direction = 'south'
    view.reportFailure(Error('Layer conflict'))
    assert.equal(view.playing, false)
    assert.equal(view.previewClip, null)
    assert.equal(status.className, 'danger')
    assert.match(status.textContent, /Layer conflict/)
    view.updateStatus()
    assert.equal(status.className, '')
    assert.match(status.textContent, /1 parts/)
})
