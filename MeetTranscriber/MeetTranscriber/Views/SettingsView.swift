import SwiftUI

struct SettingsView: View {
    @State private var apiKey = KeychainHelper.load(account: KeychainHelper.apiKeyAccount) ?? ""
    @AppStorage("preferredLanguage") private var preferredLanguage = "auto"
    @State private var savedFeedback = false

    private let languages: [(code: String, label: String)] = [
        ("auto", "Automatique (détection)"),
        ("fr", "Français"),
        ("en", "Anglais"),
        ("es", "Espagnol"),
        ("de", "Allemand"),
        ("it", "Italien"),
        ("pt", "Portugais"),
        ("nl", "Néerlandais"),
        ("zh", "Chinois"),
        ("ja", "Japonais"),
        ("ar", "Arabe"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                apiKeySection
                languageSection
                aboutSection
            }
            .navigationTitle("Réglages")
        }
    }

    // MARK: – Sections

    private var apiKeySection: some View {
        Section {
            SecureField("sk-…", text: $apiKey)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.done)
                .onSubmit { saveKey() }

            Button(action: saveKey) {
                HStack {
                    Text("Enregistrer la clé")
                    Spacer()
                    if savedFeedback {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                }
            }
            .disabled(apiKey.trimmingCharacters(in: .whitespaces).isEmpty)

            Button(role: .destructive, action: deleteKey) {
                Text("Supprimer la clé")
            }
            .disabled(KeychainHelper.load(account: KeychainHelper.apiKeyAccount) == nil)

            Link("Obtenir une clé API OpenAI →",
                 destination: URL(string: "https://platform.openai.com/api-keys")!)
            .font(.footnote)

        } header: {
            Text("Clé API OpenAI")
        } footer: {
            Text("La clé est stockée de façon sécurisée dans le Keychain de l'appareil.")
        }
    }

    private var languageSection: some View {
        Section("Langue de transcription") {
            Picker("Langue", selection: $preferredLanguage) {
                ForEach(languages, id: \.code) { lang in
                    Text(lang.label).tag(lang.code)
                }
            }
        }
    }

    private var aboutSection: some View {
        Section("À propos") {
            LabeledContent("Modèle", value: "whisper-1 (OpenAI)")
            LabeledContent("Formats supportés", value: "mp4 · m4a · mp3 · wav")
            LabeledContent("Taille max", value: "25 Mo")
            LabeledContent("Version", value: "1.0")
        }
    }

    // MARK: – Actions

    private func saveKey() {
        let trimmed = apiKey.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        KeychainHelper.save(trimmed, account: KeychainHelper.apiKeyAccount)
        savedFeedback = true
        Task {
            try? await Task.sleep(for: .seconds(2))
            savedFeedback = false
        }
    }

    private func deleteKey() {
        KeychainHelper.delete(account: KeychainHelper.apiKeyAccount)
        apiKey = ""
    }
}
