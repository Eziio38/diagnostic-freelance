import Foundation

@MainActor
final class TranscriptStore: ObservableObject {
    @Published private(set) var transcripts: [Transcript] = []

    private var storageURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("transcripts.json")
    }

    init() { load() }

    func add(_ transcript: Transcript) {
        transcripts.insert(transcript, at: 0)
        persist()
    }

    func delete(at offsets: IndexSet) {
        transcripts.remove(atOffsets: offsets)
        persist()
    }

    private func persist() {
        do {
            let data = try JSONEncoder().encode(transcripts)
            try data.write(to: storageURL, options: .atomic)
        } catch {
            print("TranscriptStore: save error — \(error)")
        }
    }

    private func load() {
        guard let data = try? Data(contentsOf: storageURL) else { return }
        transcripts = (try? JSONDecoder().decode([Transcript].self, from: data)) ?? []
    }
}
