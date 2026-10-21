import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const root = new URL('../src/views/', import.meta.url)
test('character View is one deployable file with only Host-owned imports', async () => {
    assert.deepEqual((await readdir(root)).filter(name => name.endsWith('.js')).sort(), ['view-character.js'])
    const source = await readFile(new URL('view-character.js', root), 'utf8')
    const imports = [...source.matchAll(/^import\s+(?:.*?\s+from\s+)?["']([^"']+)["']/gm)].map(match => match[1])
    assert(imports.length > 0)
    assert(imports.every(path => /^\/(?:core|util|widgets)\//.test(path)), `View-local import is not deployable: ${imports.join(', ')}`)
    assert(!/\bimport\s*\(/.test(source), 'View must not dynamically import companion files')
})

test('character View derives from the Host canvas base', async () => {
    const source = await readFile(new URL('view-character.js', root), 'utf8')
    assert.match(source, /^import \{ ViewCanvasBase \} from "\/util\/view-canvas-base\.js"$/m)
    assert.match(source, /export class ViewCharacter extends ViewCanvasBase/)
})

test('experimental main form places a canvas immediately before the equipment table', async () => {
    const source = await readFile(new URL('view-character.js', root), 'utf8')
    assert.match(source, /<form aria-label="LPC character">\s*<canvas data-element="canvas" tabindex="0" aria-label="[^"]+"><\/canvas>\s*<table role="grid" data-layout="separate" aria-label="Equipment">/)
})

test('standalone View loads from a base-URL-free module once Host imports are supplied', async () => {
    const source = await readFile(new URL('view-character.js', root), 'utf8')
    // GAMS supplies Host imports; leave any View-local import intact so it fails
    // exactly as it would when the View has no relative module URL.
    const standalone = source.replace(/^import\s+.*["']\/(?:core|util|widgets)\/[^"']+["']\s*\n/gm, '')
    const module = 'const ViewCanvasBase = class {}; const customElements = { define() {} };\n' + standalone
    const loaded = await import('data:text/javascript;base64,' + Buffer.from(module).toString('base64'))
    assert.equal(typeof loaded.ViewCharacter, 'function')
})
