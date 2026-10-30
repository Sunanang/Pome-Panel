import Cocoa
let application = NSApplication.shared
application.setActivationPolicy(.regular)
var owned: [NSWindow] = []
for (index, title) in ["Pome Multi-Space A", "Pome Multi-Space B"].enumerated() {
    let window = NSWindow(contentRect: NSRect(x: 160 + index * 70, y: 240, width: 480, height: 300), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = title
    window.isReleasedWhenClosed = false
    window.collectionBehavior = [.fullScreenPrimary]
    let label = NSTextField(labelWithString: title)
    label.font = NSFont.systemFont(ofSize: 28, weight: .semibold)
    label.frame = NSRect(x: 35, y: 110, width: 420, height: 50)
    window.contentView?.addSubview(label)
    window.makeKeyAndOrderFront(nil)
    owned.append(window)
}
application.activate(ignoringOtherApps: true)
let output = CommandLine.arguments[1]
func writeState() {
    let state: [String: Any] = ["pid": ProcessInfo.processInfo.processIdentifier, "focused": owned.firstIndex(where: { $0.isKeyWindow }) ?? -1, "windows": owned.map { ["title": $0.title, "fullScreen": $0.styleMask.contains(.fullScreen), "number": $0.windowNumber] }]
    if let data = try? JSONSerialization.data(withJSONObject: state) { try? data.write(to: URL(fileURLWithPath: output + "/state.json"), options: .atomic) }
}
Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { _ in
    writeState()
    let commandFile = output + "/command.json"
    if let data = FileManager.default.contents(atPath: commandFile), let command = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let index = command["index"] as? Int, owned.indices.contains(index) {
        try? FileManager.default.removeItem(atPath: commandFile)
        switch command["action"] as? String {
        case "fullscreen": owned[index].toggleFullScreen(nil)
        case "close": owned[index].close()
        case "exit": application.terminate(nil)
        default: break
        }
    }
}
writeState()
application.run()
