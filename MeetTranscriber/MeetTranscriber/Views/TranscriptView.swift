import SwiftUI

struct TranscriptView: View {
    let transcript: Transcript
    @Environment(\.dismiss) private var dismiss
    @State private var showCopied = false

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if transcript.segments.isEmpty {
                        Text(transcript.text)
                            .font(.body)
                            .padding()
                    } else {
                        ForEach(transcript.segments, id: \.start) { segment in
                            SegmentRow(segment: segment)
                            Divider().padding(.leading)
                        }
                    }
                }
            }
            .navigationTitle(transcript.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Fermer") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack(spacing: 16) {
                        Button(action: copyText) {
                            Image(systemName: showCopied ? "checkmark" : "doc.on.doc")
                        }
                        ShareLink(item: transcript.text) {
                            Image(systemName: "square.and.arrow.up")
                        }
                    }
                }
            }
        }
    }

    private func copyText() {
        UIPasteboard.general.string = transcript.text
        showCopied = true
        Task {
            try? await Task.sleep(for: .seconds(2))
            showCopied = false
        }
    }
}

private struct SegmentRow: View {
    let segment: TranscriptSegment

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(formatTime(segment.start))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
            Text(segment.text)
                .font(.body)
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    private func formatTime(_ seconds: Double) -> String {
        let total = Int(max(0, seconds))
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%d:%02d", m, s)
    }
}
