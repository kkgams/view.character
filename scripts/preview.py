#!/usr/bin/env python3
"""Loopback visual harness: canonical Host CSS/fonts/widgets and the98 theme.
Only SQL runtime transport and Area chrome are stubbed; the tooltip service is real.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
import json
import sqlite3
from threading import Lock
from pathlib import Path
from urllib.parse import urlsplit

PROJECT = Path(__file__).resolve().parent.parent
HTML = b'''<!doctype html><html lang="en"><meta charset="utf-8">
<title>Character visual prototype (stub runtime)</title>
<link rel="stylesheet" href="/css/reset.css"><link rel="stylesheet" href="/css/base.css">
<link id="theme-stylesheet" data-theme-stylesheet rel="stylesheet" href="/themes/the98.css">
<prototype-area></prototype-area>
<script type="module">
// Outer harness sizing only; the View owns its approved shadow layout.
customElements.define('prototype-area', class extends HTMLElement {
  constructor() {
    super(); this.style.cssText = 'display:grid;width:100vw;height:100vh;overflow:hidden';
    this.attachShadow({mode:'open'}).innerHTML = `
      <link rel="stylesheet" href="/css/reset.css"><link rel="stylesheet" href="/css/base.css">
      <link rel="stylesheet" href="/themes/the98.css">
      <header><select aria-label="View"><option>Character (prototype)</option></select><slot name="header-controls"></slot></header>
      <main><slot></slot></main>`;
  }
});
const { runtime } = await import('/core/runtime.js');
await import('/__preview__/tooltip.js');
const manager = document.createElement('tooltip-manager');
document.body.append(manager);
runtime.register({ id: 'ui.tooltip', methods: manager.api });
await import('/src/views/view-character.js');
document.querySelector('prototype-area').append(document.createElement('view-character'));
</script></html>'''
RUNTIME = b'''
const plugins = new Map();
const resources = new Map();
const projectConfig = await fetch('/gams.json').then(response => response.json());
function resource(kind, value) {
  const result = {$resource: 'wasi:sql/types', id: crypto.randomUUID()};
  resources.set(result.id, {kind, value}); return {ok: result};
}
function resolve(handle, kind) {
  const record = resources.get(handle.id);
  if (!record || record.kind !== kind) throw Error(`Invalid preview SQL ${kind} resource`);
  return record.value;
}
export const runtime = {
  projectConfig,
  async releaseResource(handle) {
    if (!resources.delete(handle.id)) throw Error('Unknown preview SQL resource');
  },
  register(plugin) { if (plugins.has(plugin.id)) throw Error('Duplicate plugin'); plugins.set(plugin.id, plugin); },
  async unregister(id) { if (!plugins.delete(id)) throw Error('Unknown plugin'); },
  async call(method, input) {
    if (method === 'ui.context.activateView' && plugins.has(input)) return {ok: true};
    const dot = method.lastIndexOf('.');
    const plugin = plugins.get(method.slice(0, dot));
    if (!plugin || typeof plugin.methods[method.slice(dot + 1)] !== 'function') throw Error(`Preview has no API: ${method}`);
    return plugin.methods[method.slice(dot + 1)](input);
  },
  async invoke(method, ...args) {
    if (method === 'sql/types::[static]connection.open') {
      if (args[0] !== projectConfig.sql) throw Error('Preview SQL must use the configured catalog');
      return resource('connection', args[0]);
    }
    if (method === 'sql/types::[static]statement.prepare') return resource('statement', {query: args[0], params: args[1]});
    if (method === 'sql/readwrite::exec' || method === 'sql/readwrite::query') {
      resolve(args[0], 'connection');
      const statement = resolve(args[1], 'statement');
      const response = await fetch('/__preview__/sql', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(statement)
      });
      const result = await response.json();
      if (!response.ok) throw Error(`Preview SQLite: ${result.error}`);
      return {ok: method.endsWith('::query') ? result.rows : result.changes};
    }
    throw Error(`Preview has no API: ${method}`);
  }
};
export function unwrap(result, label) {
  if (result && Object.hasOwn(result, 'ok')) return result.ok;
  throw Error(`${label}: invalid or failed result`);
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', type=Path, default=PROJECT.parent / 'gams')
    parser.add_argument('--theme', type=Path, default=PROJECT.parent / 'theme.the98')
    parser.add_argument('--tooltip', type=Path, default=PROJECT.parent / 'ui-service.tooltip')
    parser.add_argument('--port', type=int, default=8820)
    parser.add_argument('--database', type=Path, help='Explicit test catalog; does not modify gams.json or the native Project')
    args = parser.parse_args()
    host = (args.host / 'cmd/app/src').resolve()
    theme = (args.theme / 'src/themes/the98.css').resolve()
    tooltip = (args.tooltip / 'src/ui-plugins/tooltip.js').resolve()
    arrows = (args.theme / 'test/select-arrows.browser.js').resolve()
    project_config = json.loads((PROJECT / 'gams.json').read_text())
    if args.database is not None:
        project_config['sql'] = str(args.database.resolve())
    database_name = project_config['sql']
    database_path = (PROJECT / database_name).resolve()
    if not database_path.is_file():
        parser.error(f'Missing catalog: {database_path}; run make database first')
    # mode=rw refuses to silently create an empty database if the file disappears.
    database = sqlite3.connect(database_path.as_uri() + '?mode=rw', uri=True,
                               check_same_thread=False, isolation_level=None)
    database.execute('PRAGMA foreign_keys = ON')
    database_lock = Lock()
    routes = {
        '/src/views/view-character.js': PROJECT / 'src/views/view-character.js',
        '/gams.json': PROJECT / 'gams.json',
        '/themes/the98.css': theme,
        '/__preview__/tooltip.js': tooltip,
        '/__preview__/select-arrows.js': arrows,
        '/__preview__/game-icons.js': PROJECT / 'scripts/game-icons.browser.js',
        '/__preview__/character-layout.js': PROJECT / 'scripts/character-layout.browser.js',
        '/__preview__/character-motions.js': PROJECT / 'scripts/character-motions.browser.js',
        '/__preview__/character-performance.js': PROJECT / 'scripts/character-performance.browser.js',
    }
    for required in [host / 'css/base.css', host / 'widgets/animation-preview.js',
                     host / 'util/selectable-grid.js', host / 'fonts/game-icons.woff2',
                     host / 'fonts/game-icons.json', *routes.values()]:
        if not required.is_file():
            parser.error(f'Missing canonical dependency: {required}')

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlsplit(self.path).path
            if path == '/':
                return self.send_bytes(HTML, 'text/html')
            if path == '/gams.json':
                return self.send_bytes(json.dumps(project_config).encode(), 'application/json')
            if path == '/core/runtime.js':
                return self.send_bytes(RUNTIME, 'text/javascript')
            if path == '/favicon.ico':
                self.send_response(204)
                self.end_headers()
                return
            if path in routes:
                file = routes[path]
            elif path.startswith(('/css/', '/util/', '/widgets/', '/fonts/', '/core/')):
                file = (host / path.lstrip('/')).resolve()
                if not file.is_relative_to(host):
                    return self.send_error(404)
            else:
                return self.send_error(404)
            if not file.is_file():
                return self.send_error(404)
            mime = 'font/woff2' if file.suffix == '.woff2' else mimetypes.guess_type(file.name)[0]
            self.send_bytes(file.read_bytes(), mime or 'application/octet-stream')

        def do_POST(self):
            if self.path != '/__preview__/sql':
                return self.send_error(404)
            if self.headers.get('Content-Type') != 'application/json':
                return self.send_error(415)
            size = int(self.headers['Content-Length'])
            if not 0 < size <= 16 * 1024 * 1024:
                return self.send_error(413)
            request = json.loads(self.rfile.read(size))
            try:
                with database_lock:
                    cursor = database.execute(request['query'], request['params'])
                    columns = [column[0] for column in cursor.description] if cursor.description else []
                    rows = []
                    for row in cursor.fetchall():
                        for name, value in zip(columns, row):
                            if value is None:
                                cell = {'case': 'null'}
                            elif isinstance(value, bytes):
                                cell = {'case': 'binary', 'value': list(value)}
                            else:
                                kind = {int: 'int64', float: 'double', str: 'str'}[type(value)]
                                cell = {'case': kind, 'value': value}
                            rows.append({'field-name': name, 'value': cell})
                    changes = database.execute('SELECT changes()').fetchone()[0]
                result = {'rows': rows, 'changes': changes}
            except sqlite3.Error as error:
                self.send_response(400)
                data = json.dumps({'error': str(error)}).encode()
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            self.send_bytes(json.dumps(result).encode(), 'application/json')

        def send_bytes(self, data, mime):
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

    print(f'Visual prototype: http://127.0.0.1:{args.port} (stub runtime, real Host CSS/fonts)', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
