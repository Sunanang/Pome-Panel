// Read-only system probes. Never create a capture session, request media access,
// click a sharing control, or change the user's Focus / display settings.
import Foundation
import AppKit
import CoreMediaIO
import CoreGraphics
import AVFoundation
import ApplicationServices
import Intents

typealias Signal = [String: Any]
func known(_ value: Bool) -> Signal { ["active": value, "available": true] }
func unknown(_ error: String) -> Signal { ["active": NSNull(), "available": false, "error": error] }

func cameraState(_ ownLabels: [String]) -> Signal {
    var address = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices),
        mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal), mElement: 0)
    var size: UInt32 = 0
    guard CMIOObjectGetPropertyDataSize(CMIOObjectID(kCMIOObjectSystemObject), &address, 0, nil, &size) == 0 else { return unknown("camera_unavailable") }
    var devices = [CMIOObjectID](repeating: 0, count: Int(size) / MemoryLayout<CMIOObjectID>.size)
    if size == 0 { return known(false) }
    var used: UInt32 = 0
    let result = devices.withUnsafeMutableBytes { CMIOObjectGetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &address, 0, nil, size, &used, $0.baseAddress!) }
    guard result == 0 else { return unknown("camera_unavailable") }
    var uncertain = false
    for device in devices {
        address.mSelector = CMIOObjectPropertySelector(kCMIODevicePropertyDeviceIsRunningSomewhere)
        var running: UInt32 = 0
        if CMIOObjectGetPropertyData(device, &address, 0, nil, 4, &used, &running) != 0 { uncertain = true; continue }
        if running == 0 { continue }
        // Device-wide state has no public owner attribution. If our mirror is
        // open, don't assert another app is capturing the same camera.
        if !ownLabels.isEmpty {
            address.mSelector = CMIOObjectPropertySelector(kCMIOObjectPropertyName)
            var name: Unmanaged<CFString>?
            let nameResult = CMIOObjectGetPropertyData(device, &address, 0, nil, UInt32(MemoryLayout<CFString?>.size), &used, &name)
            let label = name?.takeRetainedValue() as String? ?? ""
            func normalized(_ value: String) -> String {
                value.replacingOccurrences(of: "\\([^)]*\\)", with: "", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            }
            if nameResult != 0 || label.isEmpty || ownLabels.contains(where: { $0 == label || normalized($0) == normalized(label) }) { uncertain = true; continue }
        }
        return known(true)
    }
    return uncertain ? unknown(ownLabels.isEmpty ? "camera_unavailable" : "own_camera_unattributed") : known(false)
}

func mirroredDisplay() -> Bool? {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success else { return nil }
    var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &displays, &count) == .success else { return nil }
    return displays.contains { CGDisplayIsInMirrorSet($0) != 0 }
}

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success ? result : nil
}

// Match actionable stop-sharing controls, never document text or window titles.
// These are best-effort adapters, not a universal screen-recording API.
let stopSharing = Set(["stop sharing", "stop screen sharing", "stop presenting", "停止共享", "停止共享屏幕", "结束共享", "停止分享", "停止分享螢幕", "結束分享",
    "freigabe beenden", "bildschirmfreigabe beenden", "arrêter le partage", "dejar de compartir", "parar compartilhamento", "interromper compartilhamento",
    "共有を停止", "画面共有を停止", "공유 중지", "остановить демонстрацию", "прекратить демонстрацию"])
let sharingApps = ["us.zoom.", "com.tencent.meeting", "com.tencent.wemeet", "com.microsoft.teams", "com.microsoft.edgemac", "com.google.chrome", "org.mozilla.firefox", "com.apple.safari", "com.cisco.webex", "com.larksuite.", "com.bytedance.lark", "com.tinyspeck.slackmacgap"]
func sharingControls() -> Signal {
    guard AXIsProcessTrusted() else { return unknown("accessibility_required") }
    let deadline = Date().addingTimeInterval(1.2)
    var incomplete = false
    let apps = NSWorkspace.shared.runningApplications.filter { app in
        guard let id = app.bundleIdentifier?.lowercased() else { return false }
        return sharingApps.contains { id.hasPrefix($0) }
    }
    for app in apps {
        let root = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(root, 0.05)
        guard let windows = attribute(root, kAXWindowsAttribute) as? [AXUIElement] else { incomplete = true; continue }
        var queue = windows.map { ($0, 0) }, index = 0
        while index < queue.count && index < 650 && Date() < deadline {
            let (element, depth) = queue[index]; index += 1
            let role = attribute(element, kAXRoleAttribute) as? String ?? ""
            // Browser sharing controls sit outside page content. Avoid scanning
            // documents and treating an arbitrary page button as capture state.
            if role == "AXWebArea" { continue }
            if role == kAXButtonRole || role == kAXMenuItemRole {
                let enabled = attribute(element, kAXEnabledAttribute) as? Bool ?? false
                if enabled {
                    for key in [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute] {
                        let label = (attribute(element, key) as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                        if stopSharing.contains(label) { return known(true) }
                    }
                }
            }
            if depth < 10, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
                queue.append(contentsOf: children.map { ($0, depth + 1) })
            }
        }
        if index < queue.count { incomplete = true }
        if Date() >= deadline { incomplete = true; break }
    }
    // A negative AX scan cannot rule out inaccessible tabs / unsupported apps.
    return incomplete ? unknown("sharing_scan_incomplete") : ["active": false, "available": true, "coverage": "supported_controls"]
}

final class FocusReader: @unchecked Sendable {
    private let lock = NSLock()
    private var busy = false
    private var value: Bool?
    private var checkedAt = Date.distantPast
    func read() -> Signal {
        lock.lock()
        if !busy {
            busy = true
            DispatchQueue.global().async {
                let next = INFocusStatusCenter.default.focusStatus.isFocused
                self.lock.lock(); self.value = next; self.checkedAt = Date(); self.busy = false; self.lock.unlock()
            }
        }
        let current = value, fresh = Date().timeIntervalSince(checkedAt) < 10
        lock.unlock()
        return fresh ? current.map(known) ?? unknown("focus_not_shared") : unknown("focus_unavailable")
    }
}
let focusReader = FocusReader()
func sample(_ request: [String: Any]) -> [String: Any] {
    let mirror = mirroredDisplay()
    var sharing = mirror == true ? known(true) : sharingControls()
    if mirror == nil && sharing["active"] as? Bool != true { sharing = unknown("display_unavailable") }
    return ["schemaVersion": 1, "camera": cameraState(request["ownCameraLabels"] as? [String] ?? []), "sharing": sharing, "focus": focusReader.read()]
}
if CommandLine.arguments.contains("--watch") {
    // Keep the main run loop alive so Intents/NSWorkspace can receive state
    // changes between requests. A blocking readLine on main would freeze them.
    DispatchQueue.global().async {
        while let line = readLine() {
            let finished = DispatchSemaphore(value: 0)
            DispatchQueue.main.async {
                autoreleasepool {
                    let request = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] ?? [:]
                    if let data = try? JSONSerialization.data(withJSONObject: sample(request), options: [.sortedKeys]) {
                        FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
                    }
                    finished.signal()
                }
            }
            finished.wait()
        }
        exit(0)
    }
    RunLoop.main.run()
} else {
    // Give the async Focus reader a chance to warm up without blocking capture probes.
    _ = focusReader.read(); Thread.sleep(forTimeInterval: 0.3)
    let data = try JSONSerialization.data(withJSONObject: sample([:]), options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}
