import AVFoundation
import Foundation

enum RecorderError: LocalizedError {
    case permissionDenied
    case alreadyRecording
    case setupFailed(Error)
    case recordingFailed

    var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "Accès au microphone refusé. Autorisez-le dans Réglages > Confidentialité."
        case .alreadyRecording:
            return "Un enregistrement est déjà en cours."
        case .setupFailed(let error):
            return "Impossible de démarrer l'enregistrement : \(error.localizedDescription)"
        case .recordingFailed:
            return "L'enregistrement a échoué. Veuillez réessayer."
        }
    }
}

@MainActor
final class AudioRecorder: NSObject, ObservableObject {
    @Published var isRecording = false

    private var recorder: AVAudioRecorder?
    private var stopContinuation: CheckedContinuation<URL?, Never>?
    private let session = AVAudioSession.sharedInstance()

    func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            session.requestRecordPermission { continuation.resume(returning: $0) }
        }
    }

    func startRecording() async throws -> URL {
        guard !isRecording else { throw RecorderError.alreadyRecording }
        isRecording = true  // guard double-tap before awaiting permission

        guard await requestPermission() else {
            isRecording = false
            throw RecorderError.permissionDenied
        }
        do {
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
        } catch {
            isRecording = false
            throw RecorderError.setupFailed(error)
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("enregistrement_\(Int(Date().timeIntervalSince1970))")
            .appendingPathExtension("m4a")

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        do {
            let rec = try AVAudioRecorder(url: url, settings: settings)
            rec.delegate = self
            rec.record()
            recorder = rec
            return url
        } catch {
            isRecording = false
            throw RecorderError.setupFailed(error)
        }
    }

    // Awaits AVAudioRecorder's delegate callback so file is fully flushed before returning.
    func stopRecording() async -> URL? {
        guard recorder != nil else { return nil }
        return await withCheckedContinuation { continuation in
            stopContinuation = continuation
            recorder?.stop()
        }
    }
}

extension AudioRecorder: AVAudioRecorderDelegate {
    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        let url: URL? = flag ? recorder.url : nil
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.recorder = nil
            self.isRecording = false
            try? self.session.setActive(false, options: .notifyOthersOnDeactivation)
            self.stopContinuation?.resume(returning: url)
            self.stopContinuation = nil
        }
    }
}
