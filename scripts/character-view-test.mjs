// Test-only access to the real single-file View without loading Host modules in Node.
import { readFile } from 'node:fs/promises'

export const viewSource = await readFile(new URL('../src/views/view-character.js', import.meta.url), 'utf8')
export function evaluateView(sql = {}, runtime = { async call(method) {
    return { ok: method === 'ui.toast.progressStart' ? { id: 'test-progress' } : true }
} }) {
    const source = viewSource.replace(/^import .*\n/gm, '').replace('export class ', 'class ')
    return new Function('sql', 'runtime', 'unwrap', 'HTMLElement', 'customElements', source + '\nreturn { ViewCharacter, animationSettings, selectAnimationPack, orderedComponents, parseGpl, decodeIndexedPng, decodeSourceImage, decodeSprite, sourcePixels, validateMask, loadCatalog, loadInventory, loadInventorySupport, loadSpriteMetadata, loadPalettes, pixelsForImage, composeFrame }')(
        sql, runtime, (result, label) => {
            if (result && Object.hasOwn(result, 'ok')) return result.ok
            throw Error(`${label}: ${result?.err ?? 'expected WIT result object'}`)
        }, class {}, { define() {} })
}
