// Temporary development snapshot replay. No versions, history or migration registry.
// Reset the disposable main schema; this helper owns the transaction.
export function splitSqlStatements(source) {
    const statements = []
    let start = 0, words = [], trigger = false, depth = 0, content = false
    const flush = (end) => {
        if (content) {
            if (['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE'].includes(words[0])) {
                throw Error('Development SQL must not manage transactions')
            }
            statements.push(source.slice(start, end).trim())
        }
        start = end; words = []; trigger = false; depth = 0; content = false
    }
    for (let i = 0; i < source.length;) {
        const char = source[i]
        if (source.startsWith('--', i)) {
            const end = source.indexOf('\n', i + 2)
            i = end < 0 ? source.length : end + 1
        } else if (source.startsWith('/*', i)) {
            const end = source.indexOf('*/', i + 2)
            if (end < 0) throw Error('Unterminated SQL comment')
            i = end + 2
        } else if ("'\"`[".includes(char)) {
            content = true
            const close = char === '[' ? ']' : char
            let closed = false
            for (i++; i < source.length; i++) {
                if (source[i] !== close) continue
                if (close !== ']' && source[i + 1] === close) { i++; continue }
                i++; closed = true; break
            }
            if (!closed) throw Error('Unterminated SQL string/identifier')
        } else if (/[a-zA-Z_]/.test(char)) {
            content = true
            const begin = i++
            while (i < source.length && /[a-zA-Z0-9_$]/.test(source[i])) i++
            const word = source.slice(begin, i).toUpperCase()
            if (words.length < 3) words.push(word)
            trigger = words[0] === 'CREATE' && (words[1] === 'TRIGGER' ||
                (['TEMP', 'TEMPORARY'].includes(words[1]) && words[2] === 'TRIGGER'))
            if (trigger && word === 'BEGIN' && depth === 0) depth = 1
            else if (trigger && depth > 0 && word === 'CASE') depth++
            else if (trigger && depth > 0 && word === 'END') depth--
        } else {
            i++
            if (!/\s/.test(char) && char !== ';') content = true
            if (char === ';' && depth === 0) flush(i)
        }
    }
    if (depth !== 0) throw Error('Unterminated SQL trigger body')
    flush(source.length)
    return statements
}

export async function reloadDevelopmentDatabase(sql, source) {
    // Parse completely before touching the database. Never silently ignore a tail.
    const statements = splitSqlStatements(source)
    await sql.exec('PRAGMA foreign_keys = OFF')
    await sql.exec('BEGIN')
    try {
        const objects = await sql.queryObjects(`SELECT type, name FROM sqlite_schema
            WHERE type IN ('trigger', 'view', 'table') AND name NOT GLOB 'sqlite_*'
            ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'view' THEN 1 ELSE 2 END, rowid`, ['type', 'name'])
        for (const object of objects) {
            const name = '"' + object.name.replaceAll('"', '""') + '"'
            // Virtual-table drops may already remove collected shadow tables.
            await sql.exec(`DROP ${object.type.toUpperCase()} IF EXISTS ${name}`)
        }
        for (const statement of statements) await sql.exec(statement)
        if ((await sql.queryCells('PRAGMA foreign_key_check')).length) throw Error('Development SQL contains broken foreign-key references')
        await sql.exec('COMMIT')
    } catch (error) {
        try { await sql.exec('ROLLBACK') }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], 'SQL replay and rollback both failed') }
        throw error
    } finally {
        await sql.exec('PRAGMA foreign_keys = ON')
    }
    return statements.length
}
