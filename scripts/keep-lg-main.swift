// Waits for a 2nd display to become active, then makes the LG the main display
// (origin 0,0, menu bar), puts the other display to its right, and turns mirroring off.
import CoreGraphics
import Foundation

func active() -> [CGDirectDisplayID] {
    var ids = [CGDirectDisplayID](repeating: 0, count: 8); var n: UInt32 = 0
    CGGetActiveDisplayList(8, &ids, &n); return Array(ids.prefix(Int(n)))
}
let lgVendor: UInt32 = 0x1E6D   // from the LG's EDID
let deadline = Date().addingTimeInterval(3600)
print("waiting for the projector to switch on…"); fflush(stdout)
while Date() < deadline {
    let ds = active()
    if ds.count >= 2, let lg = ds.first(where: { CGDisplayVendorNumber($0) == lgVendor }),
       let proj = ds.first(where: { $0 != lg }) {
        Thread.sleep(forTimeInterval: 1.5)          // let macOS finish its own switch first
        var cfg: CGDisplayConfigRef?
        CGBeginDisplayConfiguration(&cfg)
        CGConfigureDisplayMirrorOfDisplay(cfg, proj, kCGNullDirectDisplay)
        CGConfigureDisplayOrigin(cfg, lg, 0, 0)
        CGConfigureDisplayOrigin(cfg, proj, Int32(CGDisplayPixelsWide(lg)), 0)
        let err = CGCompleteDisplayConfiguration(cfg, .permanently)
        Thread.sleep(forTimeInterval: 1.0)
        print("applied (error \(err.rawValue)); main display is LG: \(CGMainDisplayID() == lg); projector \(CGDisplayPixelsWide(proj))x\(CGDisplayPixelsHigh(proj))")
        exit(0)
    }
    Thread.sleep(forTimeInterval: 0.3)
}
print("timed out — projector never switched on")
