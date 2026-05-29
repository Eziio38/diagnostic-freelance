import SwiftUI

struct RecordingIndicator: View {
    @State private var pulsing = false

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(Color.red)
                .frame(width: 10, height: 10)
                .opacity(pulsing ? 1 : 0.25)
                .animation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true), value: pulsing)
            Text("Enregistrement en cours…")
                .font(.subheadline.bold())
                .foregroundStyle(.red)
        }
        .onAppear { pulsing = true }
    }
}
