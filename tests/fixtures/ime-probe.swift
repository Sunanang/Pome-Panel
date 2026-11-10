import Cocoa
import Carbon
func property(_ source: TISInputSource, _ key: CFString) -> String {
 guard let value = TISGetInputSourceProperty(source, key) else { return "" }
 return Unmanaged<CFString>.fromOpaque(value).takeUnretainedValue() as String
}
let args = CommandLine.arguments
let sources = TISCreateInputSourceList(nil, false).takeRetainedValue() as! [TISInputSource]
if args[1] == "current" {
 print(property(TISCopyCurrentKeyboardInputSource().takeRetainedValue(), kTISPropertyInputSourceID))
} else if args[1] == "select" {
 if let source = sources.first(where: { property($0, kTISPropertyInputSourceID) == args[2] }) { print(TISSelectInputSource(source)) } else { exit(2) }
} else if args[1] == "type" || args[1] == "key" {
 let keys: [CGKeyCode] = args[1] == "type" ? [45,34,4,0,31] : [CGKeyCode(args[2])!]
 for key in keys {
  CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: true)?.post(tap: .cghidEventTap)
  CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: false)?.post(tap: .cghidEventTap)
  usleep(80000)
 }
 print(AXIsProcessTrusted())
} else if args[1] == "windows" {
 let pids = Set(args[2].split(separator: ",").compactMap { Int($0) })
 let rows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
 let result = rows.filter { pids.contains($0[kCGWindowOwnerPID as String] as? Int ?? -1) || ($0[kCGWindowOwnerName as String] as? String ?? "").contains("SCIM") || ($0[kCGWindowOwnerName as String] as? String ?? "").contains("输入") }.map { row in
  ["pid": row[kCGWindowOwnerPID as String] ?? 0, "owner": row[kCGWindowOwnerName as String] ?? "", "number":row[kCGWindowNumber as String] ?? 0, "layer":row[kCGWindowLayer as String] ?? 0, "bounds":row[kCGWindowBounds as String] ?? [:]] as [String:Any]
 }
 let data = try! JSONSerialization.data(withJSONObject:result); print(String(data:data,encoding:.utf8)!)
}
