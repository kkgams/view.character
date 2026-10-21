import test from 'node:test'
import assert from 'node:assert/strict'
import { viewSource } from './character-view-test.mjs'

test('inventory status appears directly below search and above the item grid', () => {
    assert.match(viewSource, /<input type="search" data-field="search"[^>]*>\s*<output data-element="empty"><\/output>\s*<table role="grid" data-layout="separate" aria-label="Available parts">/)
    assert.equal((viewSource.match(/<output data-element="empty">/g) || []).length, 1)
})
