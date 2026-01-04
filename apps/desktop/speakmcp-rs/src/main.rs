use serde::Serialize;
use serde_json::json;

// On non-Linux platforms, use rdev
#[cfg(not(target_os = "linux"))]
use rdev::{listen, Event, EventType};

#[derive(Serialize)]
struct KeyboardEvent {
    event_type: String,
    name: Option<String>,
    time: std::time::SystemTime,
    data: String,
}

// ============ Non-Linux (macOS/Windows) implementation using rdev ============
#[cfg(not(target_os = "linux"))]
fn deal_event_to_json(event: Event) -> KeyboardEvent {
    let mut jsonify_event = KeyboardEvent {
        event_type: "".to_string(),
        name: event.name,
        time: event.time,
        data: "".to_string(),
    };
    match event.event_type {
        EventType::KeyPress(key) => {
            jsonify_event.event_type = "KeyPress".to_string();
            jsonify_event.data = json!({"key": format!("{:?}", key)}).to_string();
        }
        EventType::KeyRelease(key) => {
            jsonify_event.event_type = "KeyRelease".to_string();
            jsonify_event.data = json!({"key": format!("{:?}", key)}).to_string();
        }
        _ => {}
    }
    jsonify_event
}

#[cfg(not(target_os = "linux"))]
fn keyboard_callback(event: Event) {
    match event.event_type {
        EventType::KeyPress(_) | EventType::KeyRelease(_) => {
            let json_event = deal_event_to_json(event);
            println!("{}", serde_json::to_string(&json_event).unwrap());
        }
        _ => {}
    }
}

#[cfg(not(target_os = "linux"))]
fn start_keyboard_listener() -> Result<(), Box<dyn std::error::Error>> {
    if let Err(error) = listen(move |event| {
        keyboard_callback(event);
    }) {
        return Err(format!("Failed to listen for keyboard events: {:?}", error).into());
    }
    Ok(())
}

// ============ Linux implementation using evdev directly ============
// This approach works on both X11 and Wayland without any X11 dependencies.
// Requires user to be in 'input' group: sudo usermod -aG input $USER
#[cfg(target_os = "linux")]
fn start_keyboard_listener() -> Result<(), Box<dyn std::error::Error>> {
    use evdev::{Device, Key};
    use std::fs;

    let input_dir = "/dev/input";
    let mut last_error: Option<String> = None;

    // Enumerate devices in /dev/input/ to find keyboards
    let entries = fs::read_dir(input_dir)
        .map_err(|e| format!("Cannot access {}: {}", input_dir, e))?;

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        // Only look at eventN devices
        if !name.starts_with("event") {
            continue;
        }

        // Try to open the device
        match Device::open(&path) {
            Ok(device) => {
                // Check if this device has keyboard capabilities (has letter keys)
                if device.supported_keys().map_or(false, |keys| {
                    keys.contains(Key::KEY_A) || keys.contains(Key::KEY_SPACE)
                }) {
                    eprintln!("Listening on keyboard: {} ({})",
                        device.name().unwrap_or("Unknown"),
                        path.display());

                    // Start listening loop on this device
                    return listen_keyboard_device(device);
                }
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::PermissionDenied {
                    last_error = Some(format!("Permission denied for {}", path.display()));
                }
            }
        }
    }

    // No keyboard found - provide helpful error message
    if let Some(err) = last_error {
        eprintln!("!error: PermissionDenied - User must be in 'input' group");
        eprintln!("Run: sudo usermod -aG input $USER");
        eprintln!("Then log out and log back in (or reboot)");
        return Err(format!("Failed to access keyboard devices: {}", err).into());
    }
    Err("No keyboard device found in /dev/input/".into())
}

#[cfg(target_os = "linux")]
fn listen_keyboard_device(mut device: evdev::Device) -> Result<(), Box<dyn std::error::Error>> {
    use evdev::InputEventKind;

    loop {
        for event in device.fetch_events()? {
            if let InputEventKind::Key(key) = event.kind() {
                let event_type = match event.value() {
                    0 => "KeyRelease",
                    1 => "KeyPress",
                    2 => continue, // Key repeat, skip
                    _ => continue,
                };

                let json_event = KeyboardEvent {
                    event_type: event_type.to_string(),
                    name: Some(format!("{:?}", key)),
                    time: std::time::SystemTime::now(),
                    data: json!({"key": format!("{:?}", key)}).to_string(),
                };

                println!("{}", serde_json::to_string(&json_event).unwrap());
            }
        }
    }
}

// ============ Common functions ============
fn write_text(text: &str) -> Result<(), Box<dyn std::error::Error>> {
    use enigo::{Enigo, Keyboard, Settings};

    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(enigo) => enigo,
        Err(e) => {
            eprintln!("Failed to create Enigo instance: {}", e);
            return Err(Box::new(e));
        }
    };

    match enigo.text(text) {
        Ok(_) => Ok(()),
        Err(e) => {
            eprintln!("Failed to write text: {}", e);
            Err(Box::new(e))
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() > 1 && args[1] == "listen" {
        if let Err(error) = start_keyboard_listener() {
            eprintln!("!error: {}", error);
            std::process::exit(1);
        }
    } else if args.len() > 2 && args[1] == "write" {
        let text = args[2].clone();

        match write_text(text.as_str()) {
            Ok(_) => {
                std::process::exit(0);
            },
            Err(e) => {
                eprintln!("Write command failed: {}", e);
                std::process::exit(101);
            }
        }
    } else {
        let name = args.get(0).map(|s| s.as_str()).unwrap_or("speakmcp-rs");
        eprintln!("Usage: {} [listen|write <text>]", name);
        eprintln!("Commands:");
        eprintln!("  listen       - Listen for keyboard events");
        eprintln!("  write <text> - Write text using accessibility API");
        std::process::exit(1);
    }
}
