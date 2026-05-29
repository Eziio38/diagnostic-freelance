import SwiftUI

struct URLInputView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var urlText = ""

    let onConfirm: (URL) -> Void

    private var parsedURL: URL? {
        guard !urlText.trimmingCharacters(in: .whitespaces).isEmpty,
              let url = URL(string: urlText.trimmingCharacters(in: .whitespaces)),
              url.scheme == "https" || url.scheme == "http"
        else { return nil }
        return url
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://…", text: $urlText)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .submitLabel(.go)
                        .onSubmit { submit() }
                } header: {
                    Text("URL du fichier audio ou vidéo")
                }

                Section {
                    Text("Collez l'URL directe d'un fichier audio/vidéo (Google Drive export, Dropbox, lien direct…).\nYouTube et les liens protégés ne sont pas supportés.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Transcription par URL")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Transcrire") { submit() }
                        .disabled(parsedURL == nil)
                }
            }
        }
    }

    private func submit() {
        guard let url = parsedURL else { return }
        dismiss()
        onConfirm(url)
    }
}
