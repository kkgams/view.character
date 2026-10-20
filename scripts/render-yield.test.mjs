import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView } from './character-view-test.mjs'

function scheduler(t) {
    const names = ['MessageChannel','requestAnimationFrame','cancelAnimationFrame','setTimeout','clearTimeout']
    const previous = names.map(name => [name,Object.getOwnPropertyDescriptor(globalThis,name)])
    const tasks = [], channels = [], frames = new Map(), timers = new Map()
    let sequence = 0
    globalThis.MessageChannel = class {
        constructor() {
            this.port1 = {onmessage:null,closed:false,close() { this.closed = true }}
            this.port2 = {closed:false,close() { this.closed = true },postMessage:() => tasks.push(() => this.port1.onmessage())}
            channels.push(this)
        }
    }
    globalThis.setTimeout = (callback,delay) => { const id=++sequence;timers.set(id,{callback,delay});return id }
    globalThis.clearTimeout = id => timers.delete(id)
    globalThis.requestAnimationFrame = callback => { const id=++sequence;frames.set(id,callback);return id }
    globalThis.cancelAnimationFrame = id => frames.delete(id)
    t.after(() => {
        for (const [name,descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis,name,descriptor)
            else delete globalThis[name]
        }
    })
    const { ViewCharacter } = evaluateView()
    return {tasks,channels,frames,timers,yield:paint => ViewCharacter.prototype.yieldRender(paint)}
}

test('render continuation uses a message task, not a microtask or chained timer, and closes its ports', async t => {
    const queue = scheduler(t)
    let resolved = false
    const pending = queue.yield().then(() => { resolved = true })
    await Promise.resolve()
    assert.equal(resolved,false)
    assert.equal(queue.timers.size,0)
    assert.equal(queue.frames.size,0)
    assert.equal(queue.tasks.length,1)
    queue.tasks.shift()()
    await pending
    assert(queue.channels.every(channel => channel.port1.closed && channel.port2.closed))
})

test('initial selection waits for a frame and following task before rendering', async t => {
    const queue = scheduler(t)
    const pending = queue.yield(true)
    assert.equal(queue.tasks.length,0)
    const callback = [...queue.frames.values()][0]
    callback()
    assert.equal(queue.tasks.length,0)
    const afterFrame = [...queue.timers.values()].find(timer => timer.delay === 0)
    assert(afterFrame)
    afterFrame.callback()
    queue.tasks.shift()()
    await pending
    assert.equal(queue.timers.size,0)
    assert.equal(queue.frames.size,0)
    assert(queue.channels.every(channel => channel.port1.closed && channel.port2.closed))
})

test('occluded-frame fallback progresses once and cleans up a racing animation callback', async t => {
    const queue = scheduler(t)
    const pending = queue.yield(true)
    const callback = [...queue.frames.values()][0]
    const fallback = [...queue.timers.values()].find(timer => timer.delay === 50)
    fallback.callback()
    callback()
    const afterFrame = [...queue.timers.values()].find(timer => timer.delay === 0)
    afterFrame.callback()
    assert.equal(queue.tasks.length,1)
    queue.tasks.shift()()
    await pending
    assert.equal(queue.timers.size,0)
    assert.equal(queue.frames.size,0)
    assert(queue.channels.every(channel => channel.port1.closed && channel.port2.closed))
})
