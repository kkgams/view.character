import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView } from './character-view-test.mjs'

const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture(runtimeOverride) {
    const calls = []
    let nextId = 0
    const runtime = { async call(method, input) {
        calls.push({ method, input })
        if (runtimeOverride) return runtimeOverride(method, input)
        return { ok: method.endsWith('progressStart') ? { id: `render-${++nextId}` } : true }
    } }
    const { ViewCharacter } = evaluateView({}, runtime)
    const view = Object.create(ViewCharacter.prototype)
    const failures = [], preparations = []
    Object.assign(view, {
        isConnected: true, previewRequest: null,
        closeTip() {}, iconScheduler: { generation: 0, invalidate() {} },
        updateLayerConflicts() {}, updateStatus() {},
        currentMotion: () => null, yieldRender: async () => {},
        renderPreview: async () => {},
        prepareSelectedPacks: () => new Promise((resolve, reject) => preparations.push({ resolve, reject })),
        reportFailure: error => failures.push(error),
    })
    return { view, calls, preparations, failures }
}

test('rendering opens centered indeterminate progress, keeps footer pending, and completes the same toast', async () => {
    const { view, calls, preparations } = fixture()
    const pending = []
    view.updateStatus = () => pending.push(view.previewPending)
    const running = view.updatePreview()
    assert.equal(view.previewPending, true)
    assert.deepEqual(calls[0], { method: 'ui.toast.progressStart', input: {
        message: 'Rendering character preview…', progress: null, position: 'modal',
    } })
    preparations[0].resolve()
    await running
    assert.deepEqual(calls.map(call => call.method), ['ui.toast.progressStart', 'ui.toast.progressSuccess'])
    assert.equal(calls[1].input.id, 'render-1')
    assert.equal(view.previewPending, false)
    assert.deepEqual(pending, [true, false])
})

test('render failure transitions the existing toast and retains the footer error', async () => {
    const { view, calls, preparations, failures } = fixture()
    const running = view.updatePreview()
    const failure = Error('Layer 48 conflict')
    preparations[0].reject(failure)
    await running
    assert.equal(failures[0], failure)
    assert.equal(calls[1].method, 'ui.toast.progressError')
    assert.equal(calls[1].input.id, 'render-1')
    assert.match(calls[1].input.message, /Layer 48 conflict/)
})

test('superseding a render closes only its own toast, even when progressStart resolves late', async () => {
    const starts = []
    const { view, calls, preparations } = fixture((method) => {
        if (method.endsWith('progressStart')) return new Promise(resolve => starts.push(resolve))
        return { ok: true }
    })
    const old = view.updatePreview()
    const current = view.updatePreview()
    starts[1]({ ok: { id: 'current' } })
    preparations[1].resolve()
    await current
    starts[0]({ ok: { id: 'obsolete' } })
    preparations[0].reject(Error('obsolete failure'))
    await old
    await flush()
    assert.deepEqual(calls.filter(call => !call.method.endsWith('progressStart')), [
        { method: 'ui.toast.progressSuccess', input: { id: 'current', message: 'Character preview rendered', duration: 600 } },
        { method: 'ui.toast.progressClose', input: { id: 'obsolete' } },
    ])
})

for (const action of ['reload', 'disconnectedCallback']) test(`${action} closes progress and suppresses stale completion`, async () => {
    const { view, calls, preparations } = fixture()
    const running = view.updatePreview()
    if (action === 'reload') {
        // loadCatalog uses the deliberately failing SQL transport below.
        const { ViewCharacter } = evaluateView({ async queryObjects() { throw Error('reload failed') } })
        const output = {}
        view.reload = ViewCharacter.prototype.reload
        view.packCache = new Map()
        view.showCatalogLoading = () => {}
        view.required = () => output
        view.shadowRoot = { querySelector: () => output }
    } else {
        view.themeObserver = { disconnect() {} }
        view.destroyGrids = () => {}
        view.headerControls = []
        const old = globalThis.unregisterViewPlugin
        globalThis.unregisterViewPlugin = async () => {}
        try { view.disconnectedCallback() } finally { globalThis.unregisterViewPlugin = old }
    }
    view.closeTip = () => {}
    view.iconScheduler = { generation: 0, invalidate() {} }
    if (action === 'reload') await assert.rejects(view.reload(), /reload failed/)
    preparations[0].resolve()
    await running
    await flush()
    assert.equal(calls.filter(call => call.method === 'ui.toast.progressClose').length, 1)
    assert.equal(calls.some(call => call.method === 'ui.toast.progressSuccess'), false)
})

test('dismissing a progress toast does not cancel rendering', async () => {
    const { view, preparations, failures } = fixture((method, input) => {
        if (method.endsWith('progressStart')) return { ok: { id: 'dismissed' } }
        throw Error(`ui.toast.${method.split('.').at(-1)} references unknown progress id '${input.id}'`)
    })
    const running = view.updatePreview()
    preparations[0].resolve()
    await running
    assert.equal(view.previewPending, false)
    assert.deepEqual(failures, [])
})

test('missing progress API fails visibly without publishing a preview', async () => {
    const { view, preparations, failures } = fixture(() => { throw Error('progressStart unavailable') })
    let rendered = false
    view.renderPreview = async () => { rendered = true }
    const running = view.updatePreview()
    preparations[0].resolve()
    await assert.rejects(running, /progressStart unavailable/)
    assert.equal(rendered, false)
    assert.match(failures[0].message, /progressStart unavailable/)
})

test('unexpected toast failures are not silently ignored', async () => {
    const { view, preparations, failures } = fixture((method) => {
        if (method.endsWith('progressStart')) return { ok: { id: 'render' } }
        throw Error('toast transport failed')
    })
    const running = view.updatePreview()
    preparations[0].resolve()
    await running
    assert.match(failures[0].message, /toast transport failed/)
})
