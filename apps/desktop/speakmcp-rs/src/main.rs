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

/// Convert evdev Key to rdev-compatible key name
/// The TypeScript handler expects rdev-style names like "ControlLeft", "KeyA", etc.
#[cfg(target_os = "linux")]
fn evdev_key_to_rdev_name(key: evdev::Key) -> String {
    use evdev::Key;
    match key {
        // Modifier keys
        Key::KEY_LEFTCTRL => "ControlLeft".to_string(),
        Key::KEY_RIGHTCTRL => "ControlRight".to_string(),
        Key::KEY_LEFTSHIFT => "ShiftLeft".to_string(),
        Key::KEY_RIGHTSHIFT => "ShiftRight".to_string(),
        Key::KEY_LEFTALT => "Alt".to_string(),  // rdev uses "Alt" for left alt
        Key::KEY_RIGHTALT => "AltRight".to_string(),
        Key::KEY_LEFTMETA => "MetaLeft".to_string(),
        Key::KEY_RIGHTMETA => "MetaRight".to_string(),

        // Letter keys (rdev uses "KeyA", "KeyB", etc.)
        Key::KEY_A => "KeyA".to_string(),
        Key::KEY_B => "KeyB".to_string(),
        Key::KEY_C => "KeyC".to_string(),
        Key::KEY_D => "KeyD".to_string(),
        Key::KEY_E => "KeyE".to_string(),
        Key::KEY_F => "KeyF".to_string(),
        Key::KEY_G => "KeyG".to_string(),
        Key::KEY_H => "KeyH".to_string(),
        Key::KEY_I => "KeyI".to_string(),
        Key::KEY_J => "KeyJ".to_string(),
        Key::KEY_K => "KeyK".to_string(),
        Key::KEY_L => "KeyL".to_string(),
        Key::KEY_M => "KeyM".to_string(),
        Key::KEY_N => "KeyN".to_string(),
        Key::KEY_O => "KeyO".to_string(),
        Key::KEY_P => "KeyP".to_string(),
        Key::KEY_Q => "KeyQ".to_string(),
        Key::KEY_R => "KeyR".to_string(),
        Key::KEY_S => "KeyS".to_string(),
        Key::KEY_T => "KeyT".to_string(),
        Key::KEY_U => "KeyU".to_string(),
        Key::KEY_V => "KeyV".to_string(),
        Key::KEY_W => "KeyW".to_string(),
        Key::KEY_X => "KeyX".to_string(),
        Key::KEY_Y => "KeyY".to_string(),
        Key::KEY_Z => "KeyZ".to_string(),

        // Number keys
        Key::KEY_0 => "Digit0".to_string(),
        Key::KEY_1 => "Digit1".to_string(),
        Key::KEY_2 => "Digit2".to_string(),
        Key::KEY_3 => "Digit3".to_string(),
        Key::KEY_4 => "Digit4".to_string(),
        Key::KEY_5 => "Digit5".to_string(),
        Key::KEY_6 => "Digit6".to_string(),
        Key::KEY_7 => "Digit7".to_string(),
        Key::KEY_8 => "Digit8".to_string(),
        Key::KEY_9 => "Digit9".to_string(),

        // Function keys
        Key::KEY_F1 => "F1".to_string(),
        Key::KEY_F2 => "F2".to_string(),
        Key::KEY_F3 => "F3".to_string(),
        Key::KEY_F4 => "F4".to_string(),
        Key::KEY_F5 => "F5".to_string(),
        Key::KEY_F6 => "F6".to_string(),
        Key::KEY_F7 => "F7".to_string(),
        Key::KEY_F8 => "F8".to_string(),
        Key::KEY_F9 => "F9".to_string(),
        Key::KEY_F10 => "F10".to_string(),
        Key::KEY_F11 => "F11".to_string(),
        Key::KEY_F12 => "F12".to_string(),

        // Special keys
        Key::KEY_ESC => "Escape".to_string(),
        Key::KEY_TAB => "Tab".to_string(),
        Key::KEY_CAPSLOCK => "CapsLock".to_string(),
        Key::KEY_SPACE => "Space".to_string(),
        Key::KEY_ENTER => "Return".to_string(),
        Key::KEY_BACKSPACE => "BackSpace".to_string(),
        Key::KEY_DELETE => "Delete".to_string(),
        Key::KEY_INSERT => "Insert".to_string(),
        Key::KEY_HOME => "Home".to_string(),
        Key::KEY_END => "End".to_string(),
        Key::KEY_PAGEUP => "PageUp".to_string(),
        Key::KEY_PAGEDOWN => "PageDown".to_string(),

        // Arrow keys
        Key::KEY_UP => "UpArrow".to_string(),
        Key::KEY_DOWN => "DownArrow".to_string(),
        Key::KEY_LEFT => "LeftArrow".to_string(),
        Key::KEY_RIGHT => "RightArrow".to_string(),

        // Punctuation/symbols
        Key::KEY_MINUS => "Minus".to_string(),
        Key::KEY_EQUAL => "Equal".to_string(),
        Key::KEY_LEFTBRACE => "BracketLeft".to_string(),
        Key::KEY_RIGHTBRACE => "BracketRight".to_string(),
        Key::KEY_BACKSLASH => "BackSlash".to_string(),
        Key::KEY_SEMICOLON => "Semicolon".to_string(),
        Key::KEY_APOSTROPHE => "Quote".to_string(),
        Key::KEY_GRAVE => "BackQuote".to_string(),
        Key::KEY_COMMA => "Comma".to_string(),
        Key::KEY_DOT => "Period".to_string(),
        Key::KEY_SLASH => "Slash".to_string(),

        // Numpad
        Key::KEY_KP0 => "Numpad0".to_string(),
        Key::KEY_KP1 => "Numpad1".to_string(),
        Key::KEY_KP2 => "Numpad2".to_string(),
        Key::KEY_KP3 => "Numpad3".to_string(),
        Key::KEY_KP4 => "Numpad4".to_string(),
        Key::KEY_KP5 => "Numpad5".to_string(),
        Key::KEY_KP6 => "Numpad6".to_string(),
        Key::KEY_KP7 => "Numpad7".to_string(),
        Key::KEY_KP8 => "Numpad8".to_string(),
        Key::KEY_KP9 => "Numpad9".to_string(),
        Key::KEY_KPENTER => "NumpadEnter".to_string(),
        Key::KEY_KPPLUS => "NumpadAdd".to_string(),
        Key::KEY_KPMINUS => "NumpadSubtract".to_string(),
        Key::KEY_KPASTERISK => "NumpadMultiply".to_string(),
        Key::KEY_KPSLASH => "NumpadDivide".to_string(),
        Key::KEY_KPDOT => "NumpadDecimal".to_string(),
        Key::KEY_NUMLOCK => "NumLock".to_string(),

        // Other
        Key::KEY_SCROLLLOCK => "ScrollLock".to_string(),
        Key::KEY_PAUSE => "Pause".to_string(),
        Key::KEY_PRINT => "PrintScreen".to_string(),
        Key::KEY_FN => "Function".to_string(),

        // Fallback: use the Debug format but strip the "KEY_" prefix
        _ => {
            let debug_name = format!("{:?}", key);
            if debug_name.starts_with("KEY_") {
                debug_name[4..].to_string()
            } else {
                debug_name
            }
        }
    }
}

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

                // Convert evdev key name to rdev-compatible format
                let rdev_key_name = evdev_key_to_rdev_name(key);

                let json_event = KeyboardEvent {
                    event_type: event_type.to_string(),
                    name: Some(rdev_key_name.clone()),
                    time: std::time::SystemTime::now(),
                    data: json!({"key": rdev_key_name}).to_string(),
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
