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

        // First, get the required buffer list size
        var bufferListSizeNeeded: Int = 0
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: &bufferListSizeNeeded,
            bufferListOut: nil,
            bufferListSize: 0,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: nil
        )

        guard bufferListSizeNeeded > 0 else { return }

        // Allocate properly sized AudioBufferList
        let audioBufferListPtr = UnsafeMutableRawPointer.allocate(
            byteCount: bufferListSizeNeeded,
            alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer { audioBufferListPtr.deallocate() }

        let audioBufferList = audioBufferListPtr.bindMemory(to: AudioBufferList.self, capacity: 1)
        var blockBuffer: CMBlockBuffer?

        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: audioBufferList,
            bufferListSize: bufferListSizeNeeded,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer
        )

        guard status == noErr else { return }

        let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
        let bufferCount = buffers.count

        if bufferCount == 1 {
            // Interleaved audio - convert Float32 to Int16 directly
            let buffer = buffers[0]
            guard let data = buffer.mData else { return }

            let floatCount = Int(buffer.mDataByteSize) / MemoryLayout<Float32>.size
            let floatPointer = data.bindMemory(to: Float32.self, capacity: floatCount)

            var int16Buffer = [Int16](repeating: 0, count: floatCount)
            for i in 0..<floatCount {
                let sample = floatPointer[i]
                let clamped = max(-1.0, min(1.0, sample))
                int16Buffer[i] = Int16(clamped * Float32(Int16.max))
            }

            int16Buffer.withUnsafeBytes { bufferPointer in
                let pcmData = Data(bufferPointer)
                try? outputHandle.write(contentsOf: pcmData)
            }
        } else if bufferCount >= 2 {
            // Non-interleaved audio - interleave L/R channels to stereo Int16
            guard let leftData = buffers[0].mData,
                  let rightData = buffers[1].mData else { return }

            let samplesPerChannel = Int(buffers[0].mDataByteSize) / MemoryLayout<Float32>.size
            let leftPointer = leftData.bindMemory(to: Float32.self, capacity: samplesPerChannel)
            let rightPointer = rightData.bindMemory(to: Float32.self, capacity: samplesPerChannel)

            // Interleave: L0, R0, L1, R1, L2, R2, ...
            var int16Buffer = [Int16](repeating: 0, count: samplesPerChannel * 2)
            for i in 0..<samplesPerChannel {
                let leftSample = max(-1.0, min(1.0, leftPointer[i]))
                let rightSample = max(-1.0, min(1.0, rightPointer[i]))
                int16Buffer[i * 2] = Int16(leftSample * Float32(Int16.max))
                int16Buffer[i * 2 + 1] = Int16(rightSample * Float32(Int16.max))
            }

            int16Buffer.withUnsafeBytes { bufferPointer in
                let pcmData = Data(bufferPointer)
                try? outputHandle.write(contentsOf: pcmData)
            }
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
            
            // Add audio output only - no need for screen capture
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

