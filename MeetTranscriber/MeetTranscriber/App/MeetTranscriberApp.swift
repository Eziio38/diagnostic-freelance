import SwiftUI

@main
struct MeetTranscriberApp: App {
    @StateObject private var store = TranscriptStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
    }
}
