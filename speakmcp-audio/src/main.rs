use std::io::{self, BufRead, Write};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use base64::{engine::general_purpose, Engine as _};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum Command {
    #[serde(rename = "start_capture")]
    StartCapture { id: String, kind: String },
    #[serde(rename = "stop_capture")]
    StopCapture { id: String },
    #[serde(rename = "shutdown")]
    Shutdown,
}

#[derive(Debug)]
struct AudioChunk {
    session_id: String,
    sequence: u64,
    sample_rate: u32,
    channels: u16,
    data: Vec<u8>, // PCM s16le
}

fn write_json_line(value: serde_json::Value) {
    let mut stdout = io::stdout();
    if let Err(e) = writeln!(stdout, "{}", value.to_string()) {
        eprintln!("[AUDIO] Failed to write JSON line: {}", e);
    }
}

fn start_capture(
    session_id: String,
    audio_tx: mpsc::Sender<AudioChunk>,
) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No default input device available".to_string())?;

    let supported_config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get default input config: {}", e))?;

    let sample_format = supported_config.sample_format();
    let config: cpal::StreamConfig = supported_config.into();
    let sample_rate = config.sample_rate.0;
    let channels = config.channels;

    let session_id_cb = session_id.clone();
    let audio_tx_cb = audio_tx.clone();
    let seq_counter = Arc::new(AtomicU64::new(0));
    let seq_cb = seq_counter.clone();

    let err_fn = |err| eprintln!("[AUDIO] an error occurred on stream: {}", err);

    let stream = match sample_format {
        cpal::SampleFormat::F32 => {
            device
                .build_input_stream(
                    &config,
                    move |data: &[f32], _| {
                        let mut bytes = Vec::with_capacity(data.len() * 2);
                        for &sample in data {
                            let s = (sample.max(-1.0).min(1.0) * i16::MAX as f32) as i16;
                            bytes.extend_from_slice(&s.to_le_bytes());
                        }
                        let seq = seq_cb.fetch_add(1, Ordering::Relaxed);
                        let chunk = AudioChunk {
                            session_id: session_id_cb.clone(),
                            sequence: seq,
                            sample_rate,
                            channels,
                            data: bytes,
                        };
                        let _ = audio_tx_cb.send(chunk);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build input stream: {}", e))?
        }
        cpal::SampleFormat::I16 => {
            device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _| {
                        let mut bytes = Vec::with_capacity(data.len() * 2);
                        for &sample in data {
                            bytes.extend_from_slice(&sample.to_le_bytes());
                        }
                        let seq = seq_cb.fetch_add(1, Ordering::Relaxed);
                        let chunk = AudioChunk {
                            session_id: session_id_cb.clone(),
                            sequence: seq,
                            sample_rate,
                            channels,
                            data: bytes,
                        };
                        let _ = audio_tx_cb.send(chunk);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build input stream: {}", e))?
        }
        cpal::SampleFormat::U16 => {
            device
                .build_input_stream(
                    &config,
                    move |data: &[u16], _| {
                        let mut bytes = Vec::with_capacity(data.len() * 2);
                        for &sample in data {
                            // Center unsigned samples around zero and convert to i16
                            let s = (sample as i32 - i16::MAX as i32) as i16;
                            bytes.extend_from_slice(&s.to_le_bytes());
                        }
                        let seq = seq_cb.fetch_add(1, Ordering::Relaxed);
                        let chunk = AudioChunk {
                            session_id: session_id_cb.clone(),
                            sequence: seq,
                            sample_rate,
                            channels,
                            data: bytes,
                        };
                        let _ = audio_tx_cb.send(chunk);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build input stream: {}", e))?
        }
        _ => {
            return Err("Unsupported sample format".to_string());
        }
    };

    stream
        .play()
        .map_err(|e| format!("Failed to play input stream: {}", e))?;

    Ok(stream)
}

fn main() {
    let (cmd_tx, cmd_rx) = mpsc::channel::<Command>();
    let (audio_tx, audio_rx) = mpsc::channel::<AudioChunk>();

    // Thread: read commands from stdin and send to main loop
    thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            let line = match line {
                Ok(l) => l.trim().to_string(),
                Err(e) => {
                    eprintln!("[AUDIO] stdin read error: {}", e);
                    break;
                }
            };

            if line.is_empty() {
                continue;
            }

            let cmd: Result<Command, _> = serde_json::from_str(&line);
            match cmd {
                Ok(c) => {
                    if cmd_tx.send(c).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("[AUDIO] Failed to parse command: {} | line= {}", e, line);
                    write_json_line(json!({
                        "type": "error",
                        "code": "BAD_REQUEST",
                        "message": format!("Failed to parse command: {}", e),
                    }));
                }
            }
        }
    });

    let mut current_stream: Option<cpal::Stream> = None;
    let mut current_session: Option<String> = None;

    loop {
        // Flush any pending audio chunks
        while let Ok(chunk) = audio_rx.try_recv() {
            let b64 = general_purpose::STANDARD.encode(&chunk.data);
            write_json_line(json!({
                "type": "audio_chunk",
                "id": chunk.session_id,
                "sequence": chunk.sequence,
                "sampleRate": chunk.sample_rate,
                "channels": chunk.channels,
                "encoding": "pcm_s16le",
                "data": b64,
            }));
        }

        match cmd_rx.recv_timeout(Duration::from_millis(50)) {
            Ok(Command::StartCapture { id, kind: _ }) => {
                if current_stream.is_some() {
                    write_json_line(json!({
                        "type": "error",
                        "id": id,
                        "code": "ALREADY_CAPTURING",
                        "message": "Audio capture already in progress",
                    }));
                    continue;
                }

                match start_capture(id.clone(), audio_tx.clone()) {
                    Ok(stream) => {
                        current_stream = Some(stream);
                        current_session = Some(id);
                    }
                    Err(msg) => {
                        write_json_line(json!({
                            "type": "error",
                            "id": id,
                            "code": "START_FAILED",
                            "message": msg,
                        }));
                    }
                }
            }
            Ok(Command::StopCapture { id }) => {
                if current_stream.is_some() {
                    current_stream = None; // dropping stops capture
                    current_session = None;
                } else {
                    write_json_line(json!({
                        "type": "error",
                        "id": id,
                        "code": "NOT_CAPTURING",
                        "message": "No active audio capture to stop",
                    }));
                }
            }
            Ok(Command::Shutdown) => {
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Just loop again to flush audio and wait for commands
                continue;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break;
            }
        }
    }
}
