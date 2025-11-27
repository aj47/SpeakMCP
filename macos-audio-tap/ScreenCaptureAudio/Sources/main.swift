import Foundation
import ScreenCaptureKit
import CoreMedia
import AVFoundation

// MARK: - Logging Helper
func log(_ message: String) {
    FileHandle.standardError.write("[\(Date())] \(message)\n".data(using: .utf8)!)
}

// MARK: - Audio Stream Handler
class AudioStreamHandler: NSObject, SCStreamOutput {
    private let outputHandle = FileHandle.standardOutput
    
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else {
            return
        }
        
        var length = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        
        let status = CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPointer)
        
        guard status == kCMBlockBufferNoErr, let data = dataPointer else {
            return
        }
        
        // Convert Float32 samples to Int16 PCM
        let floatCount = length / MemoryLayout<Float32>.size
        let floatPointer = UnsafeRawPointer(data).bindMemory(to: Float32.self, capacity: floatCount)
        
        var int16Buffer = [Int16](repeating: 0, count: floatCount)
        for i in 0..<floatCount {
            let sample = floatPointer[i]
            let clamped = max(-1.0, min(1.0, sample))
            int16Buffer[i] = Int16(clamped * Float32(Int16.max))
        }
        
        // Write PCM data to stdout
        int16Buffer.withUnsafeBytes { bufferPointer in
            let pcmData = Data(bufferPointer)
            try? outputHandle.write(contentsOf: pcmData)
        }
    }
}

// MARK: - Main Application
class ScreenCaptureAudioApp {
    private var stream: SCStream?
    private let handler = AudioStreamHandler()
    private var isRunning = true
    
    func run() async {
        log("Starting ScreenCaptureAudio...")
        
        // Setup signal handlers for graceful shutdown
        setupSignalHandlers()
        
        // Get available content
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            
            guard let display = content.displays.first else {
                log("Error: No displays found")
                exit(1)
            }
            
            log("Found display: \(display.width)x\(display.height)")
            
            // Create content filter for entire display
            let filter = SCContentFilter(display: display, excludingWindows: [])
            
            // Configure stream for audio capture
            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.sampleRate = 48000
            config.channelCount = 2
            config.excludesCurrentProcessAudio = true
            
            // We need to set some video config even though we only want audio
            config.width = 2
            config.height = 2
            config.minimumFrameInterval = CMTime(value: 1, timescale: 1) // 1 fps minimum
            
            // Create and start stream
            stream = SCStream(filter: filter, configuration: config, delegate: nil)
            
            guard let stream = stream else {
                log("Error: Failed to create stream")
                exit(1)
            }
            
            // Add outputs for both screen and audio
            try stream.addStreamOutput(handler, type: .screen, sampleHandlerQueue: .main)
            try stream.addStreamOutput(handler, type: .audio, sampleHandlerQueue: .main)
            
            log("Starting audio capture stream...")
            try await stream.startCapture()
            log("Audio capture started. Outputting 48000Hz stereo 16-bit PCM to stdout...")
            
            // Keep running until terminated
            while isRunning {
                try await Task.sleep(nanoseconds: 100_000_000) // 100ms
            }
            
            log("Stopping capture...")
            try await stream.stopCapture()
            log("Capture stopped")
            
        } catch {
            log("Error: \(error.localizedDescription)")
            exit(1)
        }
    }
    
    private func setupSignalHandlers() {
        signal(SIGTERM) { _ in
            FileHandle.standardError.write("Received SIGTERM\n".data(using: .utf8)!)
            exit(0)
        }
        signal(SIGINT) { _ in
            FileHandle.standardError.write("Received SIGINT\n".data(using: .utf8)!)
            exit(0)
        }
    }
}

// MARK: - Entry Point
let app = ScreenCaptureAudioApp()

Task {
    await app.run()
}

RunLoop.main.run()

