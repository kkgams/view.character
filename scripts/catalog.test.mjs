import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

function database(t) {
    const process = spawn('python3', ['-u', '-c', `
import sys,json,sqlite3,tempfile,runpy
from pathlib import Path
temporary=tempfile.TemporaryDirectory()
builder=runpy.run_path(sys.argv[1])
path=Path(temporary.name)/'catalog.sqlite'
builder['build_database'](builder['ROOT']/'scripts/catalog.sql', path)
connection=sqlite3.connect(path,isolation_level=None)
connection.execute('PRAGMA foreign_keys=ON')
for line in sys.stdin:
 try:
  request=json.loads(line)
  cursor=connection.execute(request['query'])
  columns=[column[0] for column in cursor.description] if cursor.description else []
  print(json.dumps({'rows':[dict(zip(columns,row)) for row in cursor.fetchall()]}),flush=True)
 except sqlite3.Error as error:
  print(json.dumps({'error':str(error)}),flush=True)
connection.close()
temporary.cleanup()
`, fileURLToPath(new URL('./build-database.py', import.meta.url))])
    const pending = []
    createInterface({ input: process.stdout }).on('line', line => {
        const result = JSON.parse(line), request = pending.shift()
        if (result.error) request.reject(Error(result.error))
        else request.resolve(result.rows)
    })
    process.on('error', error => { for (const request of pending.splice(0)) request.reject(error) })
    process.stderr.on('data', data => { throw Error(data.toString()) })
    t.after(() => new Promise(resolve => { process.once('exit', resolve); process.stdin.end() }))
    const call = query => new Promise((resolve, reject) => {
        pending.push({ resolve, reject }); process.stdin.write(JSON.stringify({ query }) + '\n')
    })
    return { exec: call, queryObjects: call, queryCells: call }
}

test('built catalog contains slots and animations, without a layers table', async t => {
    const sql = database(t)
    assert.deepEqual(await sql.queryObjects("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name"),
        ['animations', 'items', 'palettes', 'slots', 'sprites'].map(name => ({ name })))
    const slots = await sql.queryObjects('SELECT id, name, icon, "order" FROM slots ORDER BY "order"')
    assert(slots.length > 0 && slots.every(slot => typeof slot.id === 'string' && typeof slot.name === 'string' && typeof slot.icon === 'string' && Number.isInteger(slot.order)))
    assert.deepEqual(await sql.queryObjects('PRAGMA foreign_key_list(slots)'), [])
    const reference = JSON.parse(await readFile(new URL('./lpc-animations.json', import.meta.url), 'utf8'))
    assert.deepEqual(await sql.queryObjects('SELECT id, name FROM animations ORDER BY id'),
        reference.animations.map(({ id, name }) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id)))
    await assert.rejects(sql.exec("INSERT INTO slots VALUES ('body', 'Duplicate', 'person', 999)"), /UNIQUE/)
})

test('catalog tables enforce references, JSON arrays, blob storage and boolean masks', async t => {
    const sql = database(t)
    await sql.exec(`INSERT INTO palettes VALUES ('p', '[[255,0,0,255],[0,0,0,0]]')`)
    // Opaque storage probes, not PNG artwork; image decoding belongs to preparation.
    await sql.exec(`INSERT INTO items VALUES ('test', 'Test', 'hair', X'010203', 'p')`)
    await sql.exec(`INSERT INTO sprites (id, item, animation, layer, data) VALUES ('front', 'test', 'idle', 35, X'0405')`)
    await sql.exec(`INSERT INTO sprites VALUES ('mask', 'test', 'idle', 35, 1, X'0607')`)
    await sql.exec(`INSERT INTO sprites VALUES ('back', 'test', 'idle', 9, 0, X'0809')`)
    assert.deepEqual(await sql.queryObjects('SELECT id, mask, typeof(mask) AS storage FROM sprites ORDER BY id'),
        [{ id: 'back', mask: 0, storage: 'integer' }, { id: 'front', mask: 0, storage: 'integer' }, { id: 'mask', mask: 1, storage: 'integer' }])
    assert.deepEqual(await sql.queryObjects('SELECT hex(icon) AS icon FROM items'), [{ icon: '010203' }])
    for (const mask of ['2', '-1', '0.5', 'NULL', "'yes'", "X'01'"]) {
        await assert.rejects(sql.exec(`INSERT INTO sprites VALUES ('bad', 'test', 'idle', 35, ${mask}, X'00')`), /CHECK|NOT NULL/)
    }
    await assert.rejects(sql.exec(`UPDATE sprites SET mask=2 WHERE id='front'`), /CHECK/)
    for (const layer of ['0', '-1', '1.5', 'NULL', "'unknown'"]) {
        await assert.rejects(sql.exec(`INSERT INTO sprites VALUES ('bad', 'test', 'idle', ${layer}, 0, X'00')`), /CHECK|NOT NULL/)
    }
    await assert.rejects(sql.exec(`INSERT INTO sprites (id,item,animation,data) VALUES ('bad','test','idle',X'00')`), /NOT NULL/)
    for (const data of ["'{}'", "'42'", "'null'", "'not json'", "X'5b5d'"]) {
        await assert.rejects(sql.exec(`INSERT INTO palettes VALUES ('bad', ${data})`), /CHECK|JSON/)
    }
    for (const [slot, palette] of [["'missing'", "'p'"], ["'hair'", "'missing'"], ["'hair'", 'NULL']]) {
        await assert.rejects(sql.exec(`INSERT INTO items VALUES ('bad', 'Bad', ${slot}, X'00', ${palette})`), /FOREIGN KEY|NOT NULL/)
    }
    await assert.rejects(sql.exec(`INSERT INTO items VALUES ('bad', 'Bad', 'hair', 'base64 is not a blob', 'p')`), /CHECK/)
    await assert.rejects(sql.exec(`INSERT INTO sprites VALUES ('bad', 'missing', 'idle', 35, 0, X'00')`), /FOREIGN KEY/)
    await assert.rejects(sql.exec(`INSERT INTO sprites VALUES ('bad', 'test', 'missing', 35, 0, X'00')`), /FOREIGN KEY/)
    await assert.rejects(sql.exec(`INSERT INTO sprites VALUES ('bad', 'test', 'idle', 35, 0, 'not bytes')`), /CHECK/)
    await assert.rejects(sql.exec(`DELETE FROM palettes WHERE id='p'`), /FOREIGN KEY/)
    await assert.rejects(sql.exec(`DELETE FROM items WHERE id='test'`), /FOREIGN KEY/)
})
