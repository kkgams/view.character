import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const source = await readFile(new URL('../development-db.js', import.meta.url), 'utf8')
const { splitSqlStatements, reloadDevelopmentDatabase } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

// Real SQLite, without requiring the native Host or third-party Node dependencies.
function database(t) {
    const process = spawn('python3', ['-u', '-c', `
import sys,json,sqlite3
connection=sqlite3.connect(':memory:',isolation_level=None)
for line in sys.stdin:
 try:
  request=json.loads(line)
  cursor=connection.execute(request['query'])
  columns=[column[0] for column in cursor.description] if cursor.description else []
  print(json.dumps({'rows':[dict(zip(columns,row)) for row in cursor.fetchall()]}),flush=True)
 except sqlite3.Error as error:
  print(json.dumps({'error':str(error)}),flush=True)
`])
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

test('splitter preserves quoted semicolons, escaped identifiers, comments and final statements', () => {
    const statements = splitSqlStatements(`-- ; ignored
        CREATE TABLE "a;""b" (value TEXT); /* ; */
        INSERT INTO "a;""b" VALUES ('hello; it''s -- text /* */');
        SELECT [a;b], \`c;d\` FROM "a;""b" -- trailing comment`)
    assert.equal(statements.length, 3)
    assert.match(statements[1], /hello; it''s/)
    assert.deepEqual(splitSqlStatements('-- empty ;\n/* also empty ; */'), [])
    for (const text of ["SELECT 'broken", '/* broken', 'BEGIN; SELECT 1; COMMIT;']) {
        assert.throws(() => splitSqlStatements(text))
    }
})

test('actual development snapshot seeds independent slot/layer registries and replays cleanly', async t => {
    const sql = database(t)
    const snapshot = await readFile(new URL('../development.sql', import.meta.url), 'utf8')
    const view = await readFile(new URL('../index.js', import.meta.url), 'utf8')
    let expectedSlots
    const expectedLayers = JSON.parse(/const DRAW_ORDER = (\[[^\n]+\])/.exec(view)[1])
    for (let replay = 0; replay < 2; replay++) {
        await reloadDevelopmentDatabase(sql, snapshot)
        assert.deepEqual(await sql.queryObjects("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name"),
            ['animations', 'items', 'layers', 'palettes', 'slots', 'sprites'].map(name => ({ name })))
        const slots = await sql.queryObjects('SELECT id, name, icon, "order" FROM slots ORDER BY "order"')
        if (expectedSlots === undefined) expectedSlots = slots
        assert.deepEqual(slots, expectedSlots)
        assert(slots.length > 0 && slots.every(slot => typeof slot.id === 'string' && typeof slot.name === 'string' && typeof slot.icon === 'string' && Number.isInteger(slot.order)))
        assert.deepEqual((await sql.queryObjects('SELECT id FROM layers ORDER BY "order"')).map(row => row.id), expectedLayers)
        assert.deepEqual(await sql.queryObjects('PRAGMA foreign_key_list(slots)'), [])
        assert.deepEqual(await sql.queryObjects('PRAGMA foreign_key_list(layers)'), [])
        await assert.rejects(sql.exec("INSERT INTO layers VALUES ('duplicate', 'Duplicate', 0)"), /UNIQUE/)
        await assert.rejects(sql.exec("INSERT INTO slots VALUES ('body', 'Duplicate', 'person', 999)"), /UNIQUE/)
        await sql.exec("UPDATE slots SET name='debug edit' WHERE id='body'")
    }
})

test('catalog tables enforce references, JSON arrays, blob storage and boolean masks', async t => {
    const sql = database(t)
    await reloadDevelopmentDatabase(sql, await readFile(new URL('../development.sql', import.meta.url), 'utf8'))
    await sql.exec(`INSERT INTO palettes VALUES ('p', '[[255,0,0,255],[0,0,0,0]]')`)
    await sql.exec(`INSERT INTO animations VALUES ('idle', 'Idle')`)
    // Opaque storage probes, not PNG artwork; image decoding belongs to preparation.
    await sql.exec(`INSERT INTO items VALUES ('test', 'Test', 'hair', X'010203', 'p')`)
    await sql.exec(`INSERT INTO sprites (id, item, animation, data) VALUES ('front', 'test', 'idle', X'0405')`)
    await sql.exec(`INSERT INTO sprites VALUES ('mask', 'test', 'idle', 1, X'0607')`)
    await sql.exec(`INSERT INTO sprites VALUES ('back', 'test', 'idle', 0, X'0809')`)
    assert.deepEqual(await sql.queryObjects('SELECT id, mask, typeof(mask) AS storage FROM sprites ORDER BY id'),
        [{ id: 'back', mask: 0, storage: 'integer' }, { id: 'front', mask: 0, storage: 'integer' }, { id: 'mask', mask: 1, storage: 'integer' }])
    assert.deepEqual(await sql.queryObjects('SELECT hex(icon) AS icon FROM items'), [{ icon: '010203' }])
    for (const mask of ['2', '-1', '0.5', 'NULL', "'yes'", "X'01'"]) {
        await assert.rejects(sql.exec(`INSERT INTO sprites VALUES ('bad', 'test', 'idle', ${mask}, X'00')`), /CHECK|NOT NULL/)
    }
    await assert.rejects(sql.exec(`UPDATE sprites SET mask=2 WHERE id='front'`), /CHECK/)
    for (const data of ["'{}'", "'42'", "'null'", "'not json'", "X'5b5d'"]) {
        await assert.rejects(sql.exec(`INSERT INTO palettes VALUES ('bad', ${data})`), /CHECK|JSON/)
    }
    for (const [slot, palette] of [["'missing'", "'p'"], ["'hair'", "'missing'"], ["'hair'", 'NULL']]) {
        await assert.rejects(sql.exec(`INSERT INTO items VALUES ('bad', 'Bad', ${slot}, X'00', ${palette})`), /FOREIGN KEY|NOT NULL/)
    }
    await assert.rejects(sql.exec(`INSERT INTO items VALUES ('bad', 'Bad', 'hair', 'base64 is not a blob', 'p')`), /CHECK/)
    await assert.rejects(sql.exec(`INSERT INTO sprites VALUES ('bad', 'missing', 'idle', 0, X'00')`), /FOREIGN KEY/)
    await assert.rejects(sql.exec(`INSERT INTO sprites VALUES ('bad', 'test', 'missing', 0, X'00')`), /FOREIGN KEY/)
    await assert.rejects(sql.exec(`INSERT INTO sprites VALUES ('bad', 'test', 'idle', 0, 'not bytes')`), /CHECK/)
    await assert.rejects(sql.exec(`DELETE FROM palettes WHERE id='p'`), /FOREIGN KEY/)
    await assert.rejects(sql.exec(`DELETE FROM items WHERE id='test'`), /FOREIGN KEY/)
    await reloadDevelopmentDatabase(sql, await readFile(new URL('../development.sql', import.meta.url), 'utf8'))
    for (const table of ['palettes', 'items', 'animations', 'sprites']) {
        assert.deepEqual(await sql.queryObjects(`SELECT count(*) AS count FROM ${table}`), [{ count: 0 }])
    }
})

test('SQLite triggers with multiple statements and CASE remain intact', async t => {
    const sql = database(t)
    const snapshot = `CREATE TABLE item (id TEXT PRIMARY KEY);
        CREATE TABLE log (message TEXT);
        CREATE TRIGGER audit AFTER INSERT ON item BEGIN
          INSERT INTO log VALUES (CASE WHEN NEW.id = 'a;b' THEN 'yes;' ELSE 'no' END);
          INSERT INTO log VALUES ('done;');
        END;
        INSERT INTO item VALUES ('a;b');`
    assert.equal(splitSqlStatements(snapshot).length, 4)
    await reloadDevelopmentDatabase(sql, snapshot)
    assert.deepEqual(await sql.queryObjects('SELECT message FROM log'), [{ message: 'yes;' }, { message: 'done;' }])
})

test('every replay replaces tables, seeds, views and triggers, without version records', async t => {
    const sql = database(t)
    await reloadDevelopmentDatabase(sql, `CREATE TABLE old (id INTEGER); INSERT INTO old VALUES (1);
        CREATE TABLE sqliteDebug (id INTEGER);
        CREATE VIEW old_view AS SELECT * FROM old;
        CREATE TRIGGER old_trigger AFTER INSERT ON old BEGIN SELECT 1; END;`)
    await reloadDevelopmentDatabase(sql, 'CREATE TABLE fresh (id INTEGER); INSERT INTO fresh VALUES (2);')
    assert.deepEqual(await sql.queryObjects("SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'"), [{ name: 'fresh' }])
    await sql.exec('INSERT INTO fresh VALUES (99)')
    await reloadDevelopmentDatabase(sql, 'CREATE TABLE fresh (id INTEGER); INSERT INTO fresh VALUES (2);')
    assert.deepEqual(await sql.queryObjects('SELECT id FROM fresh'), [{ id: 2 }])
})

test('failed snapshot rolls back both schema reset and partial new data', async t => {
    const sql = database(t)
    await reloadDevelopmentDatabase(sql, 'CREATE TABLE keep (value TEXT); INSERT INTO keep VALUES (\'original\');')
    await assert.rejects(reloadDevelopmentDatabase(sql, 'CREATE TABLE broken (id INTEGER); INSERT INTO missing VALUES (1);'), /missing/)
    assert.deepEqual(await sql.queryObjects('SELECT value FROM keep'), [{ value: 'original' }])
    assert.deepEqual(await sql.queryObjects("SELECT name FROM sqlite_schema WHERE name='broken'"), [])
})

test('foreign-key violations reject the snapshot, and the next replay can succeed', async t => {
    const sql = database(t)
    await assert.rejects(reloadDevelopmentDatabase(sql, 'CREATE TABLE child (id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES (7);'))
    await reloadDevelopmentDatabase(sql, 'CREATE TABLE parent (id INTEGER PRIMARY KEY); INSERT INTO parent VALUES (7); CREATE TABLE child (id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES (7);')
    assert.deepEqual(await sql.queryObjects('PRAGMA foreign_keys'), [{ foreign_keys: 1 }])
    assert.deepEqual(await sql.queryObjects('PRAGMA foreign_key_check'), [])
})
