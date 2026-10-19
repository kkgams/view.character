// Test-only access to the real single-file View without loading Host modules in Node.
import { readFile } from 'node:fs/promises'

export const viewSource = await readFile(new URL('../src/views/view-character.js', import.meta.url), 'utf8')
export function evaluateView(sql = {}) {
    const source = viewSource.replace(/^import .*\n/gm, '').replace('export class ', 'class ')
    return new Function('sql', 'HTMLElement', 'customElements', source + '\nreturn { ViewCharacter, LAYERS, orderedComponents, parseGpl, decodeIndexedPng, loadCatalog, pixelsForImage, composeFrame }')(
        sql, class {}, { define() {} })
}
