// macOS-only glyph + shadow-layout regressions against a running preview.
// swift scripts/check-icons-webkit.swift http://127.0.0.1:8820/
import Cocoa
import WebKit

guard CommandLine.arguments.count == 2, let url = URL(string: CommandLine.arguments[1]) else {
    print("Usage: swift scripts/check-icons-webkit.swift <preview-url>")
    exit(2)
}

final class IconProbe: NSObject, WKNavigationDelegate {
    let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 720))
    let window = NSWindow(contentRect: NSRect(x: -3000, y: -3000, width: 1100, height: 720), styleMask: .borderless, backing: .buffered, defer: false)
    init(url: URL) {
        super.init()
        window.contentView = view
        view.navigationDelegate = self
        view.load(URLRequest(url: url))
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("WebKit navigation failed: \(error)")
        exit(1)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let script = #"""
        for (let i = 0; i < 200; i++) {
            const view = document.querySelector('view-character');
            if (view && view.items.size > 0 && view.items.size === view.fixture.items.length && view.shadowRoot.querySelector('[data-field="animation"]')) break;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        const { checkEquipmentIcons } = await import('/__preview__/game-icons.js');
        const { checkCharacterLayout } = await import('/__preview__/character-layout.js');
        const { checkCharacterMotions } = await import('/__preview__/character-motions.js');
        const icons = await checkEquipmentIcons();
        const layout = await checkCharacterLayout();
        const motions = await checkCharacterMotions();
        return JSON.stringify({ icons, layout, motions });
        """#
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): print("WebKit: \(value)"); exit(0)
            case .failure(let error): print("WebKit regression failed: \(error)"); exit(1)
            }
        }
    }
}
let app = NSApplication.shared
let probe = IconProbe(url: url)
Timer.scheduledTimer(withTimeInterval: 60, repeats: false) { _ in print("WebKit regression timed out"); exit(2) }
app.run()
