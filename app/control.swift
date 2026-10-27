import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
func reply(_ object: [String: Any]) { let d = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]); print(String(data: d, encoding: .utf8)!); }
func fail(_ message: String) -> Never { FileHandle.standardError.write(Data(message.utf8)); exit(1) }
guard CommandLine.arguments.count == 2, let data = CommandLine.arguments[1].data(using: .utf8), let a = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let action = a["action"] as? String else { fail("Invalid native-control request") }
if action == "status" { reply(["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess()]); exit(0) }
guard AXIsProcessTrusted() else { fail("Accessibility permission is required. Open RedXDexAiBridge Settings → Accessibility.") }
let source = CGEventSource(stateID: .hidSystemState)
func point(_ x: String = "x", _ y: String = "y") -> CGPoint {
 guard let xval = a[x] as? Double, let yval = a[y] as? Double, xval.isFinite, yval.isFinite, abs(xval) <= 50000, abs(yval) <= 50000 else { fail("Invalid desktop coordinates") }
 return CGPoint(x: xval, y: yval)
}
func postMouse(_ type: CGEventType, _ at: CGPoint, _ button: CGMouseButton = .left, _ count: Int64 = 1) {
 guard let e = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: at, mouseButton: button) else { fail("Could not create mouse event") }
 e.setIntegerValueField(.mouseEventClickState, value: count); e.post(tap: .cghidEventTap)
}
switch action {
 case "move": postMouse(.mouseMoved, point())
 case "click":
  let p=point(), right=(a["button"] as? String)=="right", count=(a["count"] as? Int) ?? 1
  guard count==1 || count==2 else { fail("Click count must be 1 or 2") }
  for n in 1...count { postMouse(right ? .rightMouseDown : .leftMouseDown,p,right ? .right : .left,Int64(n));postMouse(right ? .rightMouseUp : .leftMouseUp,p,right ? .right : .left,Int64(n));usleep(70000) }
 case "drag":
  let p=point(), end=point("toX","toY");postMouse(.leftMouseDown,p)
  for n in 1...20 { let t=Double(n)/20;postMouse(.leftMouseDragged,CGPoint(x:p.x+(end.x-p.x)*t,y:p.y+(end.y-p.y)*t));usleep(12000) }
  postMouse(.leftMouseUp,end)
 case "scroll":
  let dx=(a["dx"] as? Int32) ?? 0,dy=(a["dy"] as? Int32) ?? 0
  guard abs(Int64(dx))<=10000,abs(Int64(dy))<=10000 else {fail("Scroll limit exceeded")}
  CGEvent(scrollWheelEvent2Source:source,units:.pixel,wheelCount:2,wheel1:dy,wheel2:dx,wheel3:0)?.post(tap:.cghidEventTap)
 case "type":
  guard let text=a["text"] as? String,text.utf16.count<=8000 else {fail("Text must contain no more than 8000 UTF-16 units")}
  let chars=Array(text.utf16)
  for start in stride(from:0,to:chars.count,by:20){let chunk=Array(chars[start..<min(start+20,chars.count)]);for down in [true,false]{let e=CGEvent(keyboardEventSource:source,virtualKey:0,keyDown:down)!;chunk.withUnsafeBufferPointer {e.keyboardSetUnicodeString(stringLength:chunk.count,unicodeString:$0.baseAddress)};e.post(tap:.cghidEventTap)}}
 case "key":
  let keys:[String:CGKeyCode] = ["enter":36,"tab":48,"space":49,"backspace":51,"escape":53,"left":123,"right":124,"down":125,"up":126,"delete":117,"home":115,"end":119,"pageup":116,"pagedown":121,"a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,"b":11,"q":12,"w":13,"e":14,"r":15,"y":16,"t":17,"o":31,"u":32,"i":34,"p":35,"l":37,"j":38,"k":40,"n":45,"m":46]
  guard let key=a["key"] as? String,let code=keys[key.lowercased()] else {fail("Unsupported key")}
  let modifiers=(a["modifiers"] as? [String]) ?? [];var flags:CGEventFlags=[]
  for m in modifiers {switch m {case "command":flags.insert(.maskCommand);case "control":flags.insert(.maskControl);case "option":flags.insert(.maskAlternate);case "shift":flags.insert(.maskShift);default:fail("Unsupported modifier")}}
  for down in [true,false]{let e=CGEvent(keyboardEventSource:source,virtualKey:code,keyDown:down)!;e.flags=flags;e.post(tap:.cghidEventTap)}
 default: fail("Unsupported native action")
}
reply(["ok":true,"action":action])
