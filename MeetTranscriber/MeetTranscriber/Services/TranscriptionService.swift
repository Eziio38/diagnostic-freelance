import Foundation

enum TranscriptionError: LocalizedError {
    case noAPIKey
    case fileTooLarge(sizeMB: Double)
    case networkError(Error)
    case apiError(statusCode: Int, message: String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .noAPIKey:
            return "Clé API manquante. Configurez-la dans les Réglages."
        case .fileTooLarge(let size):
            return String(format: "Fichier trop grand (%.1f Mo). La limite est 25 Mo.", size)
        case .networkError(let error):
            return "Erreur réseau : \(error.localizedDescription)"
        case .apiError(let code, let message):
            return "Erreur API (\(code)) : \(message)"
        case .invalidResponse:
            return "Réponse invalide de l'API."
        }
    }
}

private struct WhisperVerboseResponse: Decodable {
    let text: String
    let segments: [WhisperSegment]?

    struct WhisperSegment: Decodable {
        let start: Double
        let end: Double
        let text: String
    }
}

private struct OpenAIErrorResponse: Decodable {
    struct ErrorBody: Decodable { let message: String }
    let error: ErrorBody
}

actor TranscriptionService {
    static let shared = TranscriptionService()

    private let maxBytes: Int64 = 25 * 1024 * 1024
    private let endpoint = URL(string: "https://api.openai.com/v1/audio/transcriptions")!

    func transcribe(fileURL: URL, language: String? = nil) async throws -> (text: String, segments: [TranscriptSegment]) {
        guard let apiKey = KeychainHelper.load(account: KeychainHelper.apiKeyAccount),
              !apiKey.isEmpty
        else {
            throw TranscriptionError.noAPIKey
        }

        let attrs = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        let size = (attrs[.size] as? Int64) ?? 0
        if size > maxBytes {
            throw TranscriptionError.fileTooLarge(sizeMB: Double(size) / 1_048_576)
        }

        let fileData = try Data(contentsOf: fileURL)
        let boundary = "Boundary-\(UUID().uuidString)"

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = buildBody(
            fileData: fileData,
            filename: fileURL.lastPathComponent,
            mimeType: mimeType(for: fileURL),
            language: language,
            boundary: boundary
        )

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw TranscriptionError.networkError(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw TranscriptionError.invalidResponse
        }
        guard http.statusCode == 200 else {
            let msg = (try? JSONDecoder().decode(OpenAIErrorResponse.self, from: data))?.error.message
                ?? String(data: data, encoding: .utf8)
                ?? "Erreur inconnue"
            throw TranscriptionError.apiError(statusCode: http.statusCode, message: msg)
        }

        let parsed = try JSONDecoder().decode(WhisperVerboseResponse.self, from: data)
        let segments = (parsed.segments ?? []).map {
            TranscriptSegment(start: $0.start, end: $0.end, text: $0.text.trimmingCharacters(in: .whitespaces))
        }
        return (parsed.text, segments)
    }

    // MARK: – Multipart helpers

    private func buildBody(fileData: Data, filename: String, mimeType: String, language: String?, boundary: String) -> Data {
        var body = Data()
        body.appendField("model", value: "whisper-1", boundary: boundary)
        body.appendField("response_format", value: "verbose_json", boundary: boundary)
        if let lang = language, !lang.isEmpty {
            body.appendField("language", value: lang, boundary: boundary)
        }
        body.appendFilePart(name: "file", filename: filename, mimeType: mimeType, data: fileData, boundary: boundary)
        body.append("--\(boundary)--\r\n")
        return body
    }

    private func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "mp3": return "audio/mpeg"
        case "mp4", "m4v": return "video/mp4"
        case "m4a": return "audio/mp4"
        case "wav": return "audio/wav"
        default: return "application/octet-stream"
        }
    }
}

// MARK: – Data convenience

private extension Data {
    mutating func append(_ string: String) {
        if let d = string.data(using: .utf8) { append(d) }
    }

    mutating func appendField(_ name: String, value: String, boundary: String) {
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
        append("\(value)\r\n")
    }

    mutating func appendFilePart(name: String, filename: String, mimeType: String, data: Data, boundary: String) {
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n")
        append("Content-Type: \(mimeType)\r\n\r\n")
        self.append(data)
        append("\r\n")
    }
}
