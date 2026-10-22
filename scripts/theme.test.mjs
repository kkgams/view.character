import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateView } from './character-view-test.mjs'

test('View accepts a Host theme link without a selected stylesheet', () => {
    const root = {}, link = { getAttribute() { return null } }
    const { ViewCharacter } = evaluateView({}, {}, {
        ensureThemeStylesheetLink(target) { assert.equal(target, root); return link },
    })
    const view = Object.assign(Object.create(ViewCharacter.prototype), { shadowRoot: root })
    assert.doesNotThrow(() => view.syncThemeStylesheet())
})

test('View still rejects a missing Host theme link', () => {
    const { ViewCharacter } = evaluateView({}, {}, { ensureThemeStylesheetLink() { return null } })
    const view = Object.assign(Object.create(ViewCharacter.prototype), { shadowRoot: {} })
    assert.throws(() => view.syncThemeStylesheet(), /Host theme stylesheet link required/)
})
