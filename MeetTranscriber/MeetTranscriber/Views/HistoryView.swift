import SwiftUI

struct HistoryView: View {
    @EnvironmentObject private var store: TranscriptStore
    @State private var selected: Transcript?

    var body: some View {
        NavigationStack {
            Group {
                if store.transcripts.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
            .navigationTitle("Historique")
        }
        .sheet(item: $selected) { transcript in
            TranscriptView(transcript: transcript)
        }
    }

    private var list: some View {
        List {
            ForEach(store.transcripts) { transcript in
                Button(action: { selected = transcript }) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Label("", systemImage: iconName(for: transcript.sourceType))
                                .labelStyle(.iconOnly)
                                .foregroundStyle(.secondary)
                            Text(transcript.title)
                                .font(.headline)
                                .lineLimit(1)
                        }
                        Text(transcript.text)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                        Text(transcript.createdAt, style: .relative)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 2)
                }
                .buttonStyle(.plain)
            }
            .onDelete(perform: store.delete)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "waveform.slash")
                .font(.system(size: 48))
                .foregroundStyle(.tertiary)
            Text("Aucune transcription")
                .font(.headline)
                .foregroundStyle(.secondary)
            Text("Vos transcriptions apparaîtront ici.")
                .font(.subheadline)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }

    private func iconName(for type: Transcript.SourceType) -> String {
        switch type {
        case .file: return "doc.fill"
        case .recording: return "mic.fill"
        case .url: return "link"
        }
    }
}
