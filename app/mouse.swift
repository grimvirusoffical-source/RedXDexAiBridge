import Foundation
import CoreGraphics
import ApplicationServices

// Run only following macOS Accessibility permission approval.
let args = CommandLine.arguments
if args.count != 4 { fputs("Usage: mouse x y click|move\n", stderr); exit(2) }
guard let x = Double(args[1]), let y = Double(args[2]), x.isFinite, y.isFinite,
      x >= 0, y >= 0, x <= 20000, y <= 20000,
      args[3] == "click" || args[3] == "move" else {
  fputs("Invalid mouse arguments\n", stderr); exit(2)
}
guard AXIsProcessTrusted() else { fputs("macOS Accessibility permission required\n", stderr); exit(3) }
let point = CGPoint(x: x, y: y)
let source = CGEventSource(stateID: .hidSystemState)
func post(_ type: CGEventType) {
  CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}
post(.mouseMoved)
if args[3] == "click" { post(.leftMouseDown); usleep(30000); post(.leftMouseUp) }
