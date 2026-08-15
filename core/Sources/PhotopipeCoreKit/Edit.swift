import Foundation

public struct CurvePoint: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

/// Normalized crop in the unit square with a top-left origin, crs-style:
/// `left`/`top`/`right`/`bottom` are fractions of the full frame.
public struct CropRect: Codable, Equatable, Sendable {
    public let left: Double
    public let top: Double
    public let right: Double
    public let bottom: Double

    public init(left: Double, top: Double, right: Double, bottom: Double) {
        self.left = left
        self.top = top
        self.right = right
        self.bottom = bottom
    }
}

/// Every per-photo adjustment. Curve points live in the unit square with an
/// empty array meaning the identity ramp. `temperature`/`tint` are Kelvin and
/// green–magenta offset for raw files (nil = as shot), incremental -100..100
/// for embedded formats where the as-shot neutral is unknowable.
/// `cropAngle` is degrees, positive rotating the photo clockwise on screen
/// about the photo's center while the crop rect stays axis-aligned.
/// `rotation` is a whole-photo turn in clockwise degrees (0/90/180/270) on
/// top of the file's own orientation; the crop rect is defined against the
/// turned frame.
public struct Edit: Codable, Equatable, Sendable {
    public var exposure: Double
    public var highlights: Double
    public var shadows: Double
    public var temperature: Double?
    public var tint: Double?
    public var vibrance: Double
    public var saturation: Double
    public var curveRGB: [CurvePoint]
    public var curveRed: [CurvePoint]
    public var curveGreen: [CurvePoint]
    public var curveBlue: [CurvePoint]
    public var crop: CropRect?
    public var cropAngle: Double
    public var rotation: Int

    public static let identity = Edit()

    enum CodingKeys: String, CodingKey {
        case exposure, highlights, shadows, temperature, tint, vibrance, saturation
        case curveRGB, curveRed, curveGreen, curveBlue, crop, cropAngle, rotation
    }

    public init(
        exposure: Double = 0, highlights: Double = 0, shadows: Double = 0,
        temperature: Double? = nil, tint: Double? = nil,
        vibrance: Double = 0, saturation: Double = 0,
        curveRGB: [CurvePoint] = [], curveRed: [CurvePoint] = [],
        curveGreen: [CurvePoint] = [], curveBlue: [CurvePoint] = [],
        crop: CropRect? = nil, cropAngle: Double = 0, rotation: Int = 0
    ) {
        self.exposure = exposure
        self.highlights = highlights
        self.shadows = shadows
        self.temperature = temperature
        self.tint = tint
        self.vibrance = vibrance
        self.saturation = saturation
        self.curveRGB = curveRGB
        self.curveRed = curveRed
        self.curveGreen = curveGreen
        self.curveBlue = curveBlue
        self.crop = crop
        self.cropAngle = cropAngle
        self.rotation = rotation
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        exposure = try container.decodeIfPresent(Double.self, forKey: .exposure) ?? 0
        highlights = try container.decodeIfPresent(Double.self, forKey: .highlights) ?? 0
        shadows = try container.decodeIfPresent(Double.self, forKey: .shadows) ?? 0
        temperature = try container.decodeIfPresent(Double.self, forKey: .temperature)
        tint = try container.decodeIfPresent(Double.self, forKey: .tint)
        vibrance = try container.decodeIfPresent(Double.self, forKey: .vibrance) ?? 0
        saturation = try container.decodeIfPresent(Double.self, forKey: .saturation) ?? 0
        curveRGB = try container.decodeIfPresent([CurvePoint].self, forKey: .curveRGB) ?? []
        curveRed = try container.decodeIfPresent([CurvePoint].self, forKey: .curveRed) ?? []
        curveGreen = try container.decodeIfPresent([CurvePoint].self, forKey: .curveGreen) ?? []
        curveBlue = try container.decodeIfPresent([CurvePoint].self, forKey: .curveBlue) ?? []
        crop = try container.decodeIfPresent(CropRect.self, forKey: .crop)
        cropAngle = try container.decodeIfPresent(Double.self, forKey: .cropAngle) ?? 0
        rotation = try container.decodeIfPresent(Int.self, forKey: .rotation) ?? 0
    }

    /// Crop fields are omitted at their defaults so uncropped edits keep the
    /// cache keys (and sidecar JSON) they had before crop existed.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(exposure, forKey: .exposure)
        try container.encode(highlights, forKey: .highlights)
        try container.encode(shadows, forKey: .shadows)
        try container.encodeIfPresent(temperature, forKey: .temperature)
        try container.encodeIfPresent(tint, forKey: .tint)
        try container.encode(vibrance, forKey: .vibrance)
        try container.encode(saturation, forKey: .saturation)
        try container.encode(curveRGB, forKey: .curveRGB)
        try container.encode(curveRed, forKey: .curveRed)
        try container.encode(curveGreen, forKey: .curveGreen)
        try container.encode(curveBlue, forKey: .curveBlue)
        try container.encodeIfPresent(crop, forKey: .crop)
        if cropAngle != 0 {
            try container.encode(cropAngle, forKey: .cropAngle)
        }
        if rotation != 0 {
            try container.encode(rotation, forKey: .rotation)
        }
    }

    public var isIdentity: Bool {
        self == .identity
    }

    public var hasCropComponent: Bool {
        crop != nil || cropAngle != 0
    }

    /// 0/90/180/270 clockwise; anything else from a hostile source becomes 0.
    public var normalizedRotation: Int {
        [90, 180, 270].contains(rotation) ? rotation : 0
    }

    public var hasToneComponent: Bool {
        highlights != 0 || shadows != 0 || !Curve.isIdentity(curveRGB)
            || !Curve.isIdentity(curveRed) || !Curve.isIdentity(curveGreen)
            || !Curve.isIdentity(curveBlue)
    }

    /// Deterministic representation for render cache keys.
    public var cacheKey: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = (try? encoder.encode(self)) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}

/// Monotone cubic interpolation (Fritsch–Carlson) through curve points.
/// Shape-preserving: no overshoot between points, flat outside the outermost
/// points. The TypeScript curve editor mirrors this exactly; the shared
/// fixtures in fixtures/curve-samples.json keep the two in lockstep.
public enum Curve {
    public static func isIdentity(_ points: [CurvePoint]) -> Bool {
        let sorted = normalized(points)
        guard sorted.count >= 2 else { return true }
        return sorted.allSatisfy { abs($0.y - $0.x) < 1e-9 }
    }

    static func normalized(_ points: [CurvePoint]) -> [CurvePoint] {
        var seen: Set<Double> = []
        return
            points
            .map { CurvePoint(x: min(max($0.x, 0), 1), y: min(max($0.y, 0), 1)) }
            .sorted { $0.x < $1.x }
            .filter { seen.insert($0.x).inserted }
    }

    public static func evaluate(_ points: [CurvePoint], at x: Double) -> Double {
        let pts = normalized(points)
        guard pts.count >= 2 else { return min(max(x, 0), 1) }
        guard x > pts[0].x else { return pts[0].y }
        guard x < pts[pts.count - 1].x else { return pts[pts.count - 1].y }

        let tangents = Self.tangents(pts)
        let i = pts.lastIndex { $0.x <= x } ?? 0
        let segment = min(i, pts.count - 2)
        let x0 = pts[segment].x
        let x1 = pts[segment + 1].x
        let h = x1 - x0
        let t = (x - x0) / h
        let t2 = t * t
        let t3 = t2 * t
        let y =
            (2 * t3 - 3 * t2 + 1) * pts[segment].y
            + (t3 - 2 * t2 + t) * h * tangents[segment]
            + (-2 * t3 + 3 * t2) * pts[segment + 1].y
            + (t3 - t2) * h * tangents[segment + 1]
        return min(max(y, 0), 1)
    }

    public static func sample(_ points: [CurvePoint], count: Int) -> [Double] {
        (0..<count).map { evaluate(points, at: Double($0) / Double(count - 1)) }
    }

    private static func tangents(_ pts: [CurvePoint]) -> [Double] {
        let n = pts.count
        var delta = [Double](repeating: 0, count: n - 1)
        for i in 0..<(n - 1) {
            delta[i] = (pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x)
        }
        var m = [Double](repeating: 0, count: n)
        m[0] = delta[0]
        m[n - 1] = delta[n - 2]
        for i in 1..<(n - 1) {
            m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2
        }
        for i in 0..<(n - 1) {
            if delta[i] == 0 {
                m[i] = 0
                m[i + 1] = 0
                continue
            }
            let a = m[i] / delta[i]
            let b = m[i + 1] / delta[i]
            let s = a * a + b * b
            if s > 9 {
                let t = 3 / s.squareRoot()
                m[i] = t * a * delta[i]
                m[i + 1] = t * b * delta[i]
            }
        }
        return m
    }
}

/// Highlights/shadows and the user curves folded into one per-channel lookup
/// table, applied by a single CIColorCurves.
public enum ToneLUT {
    public static let resolution = 256

    public static func samples(for edit: Edit) -> [Float]? {
        guard edit.hasToneComponent else { return nil }

        // Parametric highlights/shadows: smooth bumps peaking at 1/3 and 2/3
        // of the range, forced monotone so extreme slider values cannot fold
        // the tone scale back on itself.
        let s = edit.shadows / 100 * 0.25
        let h = edit.highlights / 100 * 0.25
        var tone = (0..<resolution).map { i -> Double in
            let v = Double(i) / Double(resolution - 1)
            let shadowWeight = v * (1 - v) * (1 - v) * 6.75
            let highlightWeight = v * v * (1 - v) * 6.75
            return min(max(v + s * shadowWeight + h * highlightWeight, 0), 1)
        }
        for i in 1..<resolution {
            tone[i] = max(tone[i], tone[i - 1])
        }

        var interleaved = [Float](repeating: 0, count: resolution * 3)
        let channels = [edit.curveRed, edit.curveGreen, edit.curveBlue]
        for i in 0..<resolution {
            let base = Curve.evaluate(edit.curveRGB, at: tone[i])
            for (c, channelPoints) in channels.enumerated() {
                interleaved[i * 3 + c] = Float(Curve.evaluate(channelPoints, at: base))
            }
        }
        return interleaved
    }
}
