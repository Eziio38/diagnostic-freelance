import Foundation

struct Transcript: Identifiable, Codable {
    let id: UUID
    var title: String
    var text: String
    var segments: [TranscriptSegment]
    let createdAt: Date
    var sourceType: SourceType

    enum SourceType: String, Codable {
        case file, recording, url
    }

    init(
        id: UUID = UUID(),
        title: String,
        text: String,
        segments: [TranscriptSegment] = [],
        createdAt: Date = Date(),
        sourceType: SourceType
    ) {
        self.id = id
        self.title = title
        self.text = text
        self.segments = segments
        self.createdAt = createdAt
        self.sourceType = sourceType
    }
}

struct TranscriptSegment: Codable {
    let start: Double
    let end: Double
    let text: String
}
