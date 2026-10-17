#!/usr/bin/env python3
"""Loopback visual harness: canonical Host CSS/fonts/widgets and the98 theme.
Only runtime/FS and Area chrome are stubbed; the tooltip service is real.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
from pathlib import Path
from urllib.parse import urlsplit

PROJECT = Path(__file__).resolve().parent.parent
HTML = b'''<!doctype html><html lang="en"><meta charset="utf-8">
<title>Character visual prototype (stub runtime)</title>
<link rel="stylesheet" href="/css/reset.css"><link rel="stylesheet" href="/css/base.css">
<link id="theme-stylesheet" data-theme-stylesheet rel="stylesheet" href="/themes/the98.css">
<prototype-area></prototype-area>
<script type="module">
// Outer harness sizing only; the View itself has no custom CSS.
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
await import('/index.js');
document.querySelector('prototype-area').append(document.createElement('view-character'));
</script></html>'''
RUNTIME = b'''
const plugins = new Map();
export const runtime = {
  register(plugin) { if (plugins.has(plugin.id)) throw Error('Duplicate plugin'); plugins.set(plugin.id, plugin); },
  async unregister(id) { if (!plugins.delete(id)) throw Error('Unknown plugin'); },
  async call(method, input) {
    if (method === 'ui.context.activateView' && plugins.has(input)) return {ok: true};
    const dot = method.lastIndexOf('.');
    const plugin = plugins.get(method.slice(0, dot));
    if (!plugin || typeof plugin.methods[method.slice(dot + 1)] !== 'function') throw Error(`Preview has no API: ${method}`);
    return plugin.methods[method.slice(dot + 1)](input);
  },
  async invoke(method, path) {
    if (method !== 'fs/fs::read-file' || path !== 'fixtures/lpc/mock-catalog.json') throw Error(`Preview has no FS API: ${method} ${path}`);
    const response = await fetch('/' + path);
    if (!response.ok) throw Error(`Fixture read failed: ${response.status}`);
    return {ok: Array.from(new Uint8Array(await response.arrayBuffer()))};
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
    args = parser.parse_args()
    host = (args.host / 'cmd/app/src').resolve()
    theme = (args.theme / 'src/themes/the98.css').resolve()
    tooltip = (args.tooltip / 'src/ui-plugins/tooltip.js').resolve()
    arrows = (args.theme / 'test/select-arrows.browser.js').resolve()
    routes = {
        '/index.js': PROJECT / 'index.js',
        '/themes/the98.css': theme,
        '/__preview__/tooltip.js': tooltip,
        '/__preview__/select-arrows.js': arrows,
        '/__preview__/game-icons.js': PROJECT / 'scripts/game-icons.browser.js',
        '/__preview__/character-layout.js': PROJECT / 'scripts/character-layout.browser.js',
        '/fixtures/lpc/mock-catalog.json': PROJECT / 'fixtures/lpc/mock-catalog.json',
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
            if path == '/core/runtime.js':
                return self.send_bytes(RUNTIME, 'text/javascript')
            if path == '/favicon.ico':
                self.send_response(204)
                self.end_headers()
                return
            if path in routes:
                file = routes[path]
            elif path.startswith(('/css/', '/util/', '/widgets/', '/fonts/')):
                file = (host / path.lstrip('/')).resolve()
                if not file.is_relative_to(host):
                    return self.send_error(404)
            else:
                return self.send_error(404)
            if not file.is_file():
                return self.send_error(404)
            mime = 'font/woff2' if file.suffix == '.woff2' else mimetypes.guess_type(file.name)[0]
            self.send_bytes(file.read_bytes(), mime or 'application/octet-stream')

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
