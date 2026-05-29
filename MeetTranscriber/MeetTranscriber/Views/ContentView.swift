import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Label("Accueil", systemImage: "waveform")
                }
            HistoryView()
                .tabItem {
                    Label("Historique", systemImage: "clock")
                }
            SettingsView()
                .tabItem {
                    Label("Réglages", systemImage: "gear")
                }
        }
    }
}
