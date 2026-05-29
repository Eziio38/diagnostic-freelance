import SwiftUI
import UniformTypeIdentifiers

struct HomeView: View {
    @EnvironmentObject private var store: TranscriptStore
    @StateObject private var recorder = AudioRecorder()
    @AppStorage("preferredLanguage") private var preferredLanguage = "auto"

    @State private var showFilePicker = false
    @State private var showURLSheet = false
    @State private var isTranscribing = false
    @State private var transcriptResult: Transcript?
    @State private var errorMessage: String?

    private var lang: String? { preferredLanguage == "auto" ? nil : preferredLanguage }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Spacer()

                VStack(spacing: 24) {
                    recordButton
                    Divider()
                    importButtons
                }
                .padding(.horizontal, 24)

                Spacer()

                if isTranscribing {
                    transcribingBanner
                }
            }
            .navigationTitle("MeetTranscriber")
            .navigationBarTitleDisplayMode(.large)
        }
        .fileImporter(
            isPresented: $showFilePicker,
            allowedContentTypes: [.audio, .movie, .mpeg4Movie, .mpeg4Audio, .mp3],
            allowsMultipleSelection: false,
            onCompletion: handleFileImport
        )
        .sheet(isPresented: $showURLSheet) {
            URLInputView { url in Task { await transcribeFromURL(url) } }
        }
        .sheet(item: $transcriptResult) { transcript in
            TranscriptView(transcript: transcript)
        }
        .alert("Erreur", isPresented: .init(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    // MARK: – Sub-views

    private var recordButton: some View {
        VStack(spacing: 12) {
            if recorder.isRecording {
                RecordingIndicator()
            }
            Button(action: toggleRecording) {
                Label(
                    recorder.isRecording ? "Arrêter l'enregistrement" : "Enregistrer",
                    systemImage: recorder.isRecording ? "stop.circle.fill" : "mic.circle.fill"
                )
                .font(.headline)
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(recorder.isRecording ? .red : .accentColor)
            .controlSize(.large)
            .disabled(isTranscribing)
        }
    }

    private var importButtons: some View {
        VStack(spacing: 12) {
            Button(action: { showFilePicker = true }) {
                Label("Importer un fichier", systemImage: "doc.badge.plus")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .disabled(isTranscribing || recorder.isRecording)

            Button(action: { showURLSheet = true }) {
                Label("Transcription via URL", systemImage: "link")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .disabled(isTranscribing || recorder.isRecording)
        }
    }

    private var transcribingBanner: some View {
        HStack(spacing: 10) {
            ProgressView()
            Text("Transcription en cours…")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .padding(.bottom, 16)
    }

    // MARK: – Actions

    private func toggleRecording() {
        if recorder.isRecording {
            let title = "Enregistrement \(shortDate())"
            Task {
                guard let url = await recorder.stopRecording() else { return }
                await transcribeAudio(from: url, title: title, sourceType: .recording, cleanup: true)
            }
        } else {
            Task {
                do {
                    _ = try await recorder.startRecording()
                } catch {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    private func handleFileImport(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            errorMessage = error.localizedDescription
        case .success(let urls):
            guard let url = urls.first else { return }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }

            let tmp = FileManager.default.temporaryDirectory
                .appendingPathComponent(url.lastPathComponent)
            try? FileManager.default.removeItem(at: tmp)
            do {
                try FileManager.default.copyItem(at: url, to: tmp)
                Task { await transcribeAudio(from: tmp, title: url.lastPathComponent, sourceType: .file, cleanup: true) }
            } catch {
                errorMessage = "Impossible de lire le fichier : \(error.localizedDescription)"
            }
        }
    }

    private func transcribeFromURL(_ url: URL) async {
        isTranscribing = true
        defer { isTranscribing = false }
        do {
            let tmp = FileManager.default.temporaryDirectory
                .appendingPathComponent(url.lastPathComponent.isEmpty ? "download" : url.lastPathComponent)
            let (downloadURL, _) = try await URLSession.shared.download(from: url)
            try? FileManager.default.removeItem(at: tmp)
            try FileManager.default.moveItem(at: downloadURL, to: tmp)
            await transcribeAudio(from: tmp, title: url.lastPathComponent.isEmpty ? url.host ?? "URL" : url.lastPathComponent, sourceType: .url, cleanup: true)
        } catch {
            errorMessage = "Téléchargement échoué : \(error.localizedDescription)"
        }
    }

    private func transcribeAudio(from url: URL, title: String, sourceType: Transcript.SourceType, cleanup: Bool) async {
        guard !isTranscribing else { return }
        isTranscribing = true
        defer {
            isTranscribing = false
            if cleanup { try? FileManager.default.removeItem(at: url) }
        }
        do {
            let (text, segments) = try await TranscriptionService.shared.transcribe(fileURL: url, language: lang)
            let transcript = Transcript(title: title, text: text, segments: segments, sourceType: sourceType)
            store.add(transcript)
            transcriptResult = transcript
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func shortDate() -> String {
        let f = DateFormatter()
        f.dateStyle = .short
        f.timeStyle = .short
        f.locale = Locale(identifier: "fr_FR")
        return f.string(from: Date())
    }
}
