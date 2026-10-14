// Usage: featureprints <liste_A.txt> <liste_B.txt> <sortie.json> [<dossier_cache>]
// A = catalogue existant, B = export. Calcule l'empreinte Vision de chaque image (cache disque),
// puis pour chaque image B : les 3 œuvres A les plus proches, et les voisines B à distance < 0.6.
import Foundation
import Vision

func lines(_ p: String) -> [String] {
    (try? String(contentsOfFile: p, encoding: .utf8))?.split(separator: "\n").map(String.init) ?? []
}
let args = CommandLine.arguments
let listA = lines(args[1]), listB = lines(args[2])
let cacheDir = args.count > 4
    ? URL(fileURLWithPath: args[4])
    : URL(fileURLWithPath: args[3]).deletingLastPathComponent().appendingPathComponent("fp-cache")
try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)

func key(_ p: String) -> String {
    let attrs = try? FileManager.default.attributesOfItem(atPath: p)
    let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
    var h: UInt64 = 1469598103934665603
    for b in (p + "|\(size)").utf8 { h = (h ^ UInt64(b)) &* 1099511628211 }
    return String(h, radix: 16)
}
func featurePrint(_ p: String) -> VNFeaturePrintObservation? {
    let c = cacheDir.appendingPathComponent(key(p))
    if let d = try? Data(contentsOf: c),
       let o = try? NSKeyedUnarchiver.unarchivedObject(ofClass: VNFeaturePrintObservation.self, from: d) { return o }
    let h = VNImageRequestHandler(url: URL(fileURLWithPath: p))
    let r = VNGenerateImageFeaturePrintRequest()
    do { try h.perform([r]) } catch { FileHandle.standardError.write("ERREUR \(p): \(error)\n".data(using: .utf8)!); return nil }
    guard let o = r.results?.first else { return nil }
    if let d = try? NSKeyedArchiver.archivedData(withRootObject: o, requiringSecureCoding: true) { try? d.write(to: c) }
    return o
}
func compute(_ list: [String], _ label: String) -> [VNFeaturePrintObservation?] {
    var out: [VNFeaturePrintObservation?] = []
    for (i, p) in list.enumerated() {
        autoreleasepool { out.append(featurePrint(p)) }
        if i % 100 == 0 { FileHandle.standardError.write("\(label) \(i)/\(list.count)\n".data(using: .utf8)!) }
    }
    return out
}
let fa = compute(listA, "catalogue"), fb = compute(listB, "export")
func dist(_ x: VNFeaturePrintObservation?, _ y: VNFeaturePrintObservation?) -> Float {
    guard let x = x, let y = y else { return 99 }
    var d: Float = 99; try? x.computeDistance(&d, to: y); return d
}
var result: [[String: Any]] = []
for (i, b) in fb.enumerated() {
    var near: [(Int, Float)] = fa.enumerated().map { ($0.offset, dist(b, $0.element)) }
    near.sort { $0.1 < $1.1 }
    var sib: [[String: Any]] = []
    for (j, c) in fb.enumerated() where j != i {
        let d = dist(b, c)
        if d < 0.6 { sib.append(["i": j, "d": d]) }
    }
    result.append([
        "file": listB[i],
        "nearest": near.prefix(3).map { ["a": listA[$0.0], "d": $0.1] },
        "siblings": sib,
    ])
}
let data = try JSONSerialization.data(withJSONObject: result)
try data.write(to: URL(fileURLWithPath: args[3]))
FileHandle.standardError.write("terminé\n".data(using: .utf8)!)
