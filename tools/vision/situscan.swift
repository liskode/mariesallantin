// Usage: situscan <liste_photos.txt> <liste_catalogue.txt> <fp-cache> <sortie.json>
// Pour chaque photo : rectangles (tableaux) détectés, personnes, étiquettes de scène,
// et pour chaque tableau découpé les 5 œuvres du catalogue les plus proches.
import Foundation
import Vision
import CoreImage

func lines(_ p: String) -> [String] {
    (try? String(contentsOfFile: p, encoding: .utf8))?.split(separator: "\n").map(String.init) ?? []
}
let a = CommandLine.arguments
let photos = lines(a[1]), listA = lines(a[2])
let cacheDir = URL(fileURLWithPath: a[3])
func key(_ p: String) -> String {
    let size = ((try? FileManager.default.attributesOfItem(atPath: p))?[.size] as? NSNumber)?.intValue ?? 0
    var h: UInt64 = 1469598103934665603
    for b in (p + "|\(size)").utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
    return String(h, radix: 16)
}
let cat: [(String, VNFeaturePrintObservation)] = listA.compactMap { p in
    guard let d = try? Data(contentsOf: cacheDir.appendingPathComponent(key(p))),
          let o = try? NSKeyedUnarchiver.unarchivedObject(ofClass: VNFeaturePrintObservation.self, from: d) else { return nil }
    return (p, o)
}
let ctx = CIContext()
var out: [[String: Any]] = []
for (n, p) in photos.enumerated() {
    autoreleasepool {
        guard var ci = CIImage(contentsOf: URL(fileURLWithPath: p), options: [.applyOrientationProperty: true]) else {
            out.append(["file": p, "error": "lecture impossible"]); return
        }
        // Réduit les très grandes images (analyse plus rapide, même résultat)
        let maxSide = max(ci.extent.width, ci.extent.height)
        if maxSide > 2048 { ci = ci.transformed(by: CGAffineTransform(scaleX: 2048 / maxSide, y: 2048 / maxSide)) }
        let rects = VNDetectRectanglesRequest()
        rects.maximumObservations = 10; rects.minimumSize = 0.1; rects.minimumConfidence = 0.5
        rects.minimumAspectRatio = 0.15; rects.maximumAspectRatio = 1.0; rects.quadratureTolerance = 25
        let humans = VNDetectHumanRectanglesRequest()
        let classify = VNClassifyImageRequest()
        do { try VNImageRequestHandler(ciImage: ci).perform([rects, humans, classify]) } catch {
            out.append(["file": p, "error": "\(error)"]); return
        }
        let W = ci.extent.width, H = ci.extent.height
        var paintings: [[String: Any]] = []
        for r in (rects.results ?? []) {
            let bb = r.boundingBox
            let area = bb.width * bb.height
            if area < 0.02 { continue }
            let crop = ci.applyingFilter("CIPerspectiveCorrection", parameters: [
                "inputTopLeft": CIVector(x: ci.extent.minX + r.topLeft.x * W, y: ci.extent.minY + r.topLeft.y * H),
                "inputTopRight": CIVector(x: ci.extent.minX + r.topRight.x * W, y: ci.extent.minY + r.topRight.y * H),
                "inputBottomLeft": CIVector(x: ci.extent.minX + r.bottomLeft.x * W, y: ci.extent.minY + r.bottomLeft.y * H),
                "inputBottomRight": CIVector(x: ci.extent.minX + r.bottomRight.x * W, y: ci.extent.minY + r.bottomRight.y * H)])
            guard let cg = ctx.createCGImage(crop, from: crop.extent) else { continue }
            let fr = VNGenerateImageFeaturePrintRequest()
            guard (try? VNImageRequestHandler(cgImage: cg).perform([fr])) != nil, let fp = fr.results?.first else { continue }
            var best: [(String, Float)] = cat.map { c in var d: Float = 9; try? fp.computeDistance(&d, to: c.1); return (c.0, d) }
            best.sort { $0.1 < $1.1 }
            paintings.append([
                "box": [bb.minX, bb.minY, bb.width, bb.height], "area": area,
                "matches": best.prefix(5).map { ["a": $0.0, "d": $0.1] },
            ])
        }
        let people = (humans.results ?? []).filter { $0.confidence > 0.5 }.count
        let labels = (classify.results ?? []).filter { $0.confidence > 0.15 }.prefix(8).map { ["l": $0.identifier, "c": $0.confidence] }
        out.append(["file": p, "w": W, "h": H, "people": people, "labels": labels, "paintings": paintings])
    }
    if n % 100 == 0 { FileHandle.standardError.write("\(n)/\(photos.count)\n".data(using: .utf8)!) }
}
try JSONSerialization.data(withJSONObject: out).write(to: URL(fileURLWithPath: a[4]))
FileHandle.standardError.write("terminé\n".data(using: .utf8)!)
