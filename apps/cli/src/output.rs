//! Output formatting utilities
//!
//! This module provides helper functions for formatting CLI output in both
//! human-readable table format and machine-readable JSON format.

// Allow dead code - these functions will be used when commands are implemented
#![allow(dead_code)]

use colored::Colorize;
use serde::Serialize;

/// Print data as formatted JSON
pub fn print_json<T: Serialize>(data: &T) -> anyhow::Result<()> {
    let json = serde_json::to_string_pretty(data)?;
    println!("{}", json);
    Ok(())
}

/// Print a simple key-value pair
pub fn print_kv(key: &str, value: &str) {
    println!("{}: {}", key.cyan().bold(), value);
}

/// Print a section header
pub fn print_header(text: &str) {
    println!("{}", text.bold().underline());
}

/// Print a success message
pub fn print_success(message: &str) {
    println!("{} {}", "✓".green(), message);
}

/// Print an error message
pub fn print_error(message: &str) {
    eprintln!("{} {}", "✗".red(), message);
}

/// Print a warning message
pub fn print_warning(message: &str) {
    println!("{} {}", "⚠".yellow(), message);
}

/// Print a dimmed/secondary message
pub fn print_dimmed(message: &str) {
    println!("{}", message.dimmed());
}

/// A simple table row for list output
pub struct TableRow {
    pub columns: Vec<String>,
}

impl TableRow {
    pub fn new(columns: Vec<String>) -> Self {
        Self { columns }
    }
}

/// Print a simple table with headers and rows
pub fn print_table(headers: &[&str], rows: &[TableRow]) {
    if rows.is_empty() {
        println!("{}", "(no data)".dimmed());
        return;
    }

    // Calculate column widths
    let mut widths: Vec<usize> = headers.iter().map(|h| h.len()).collect();
    for row in rows {
        for (i, col) in row.columns.iter().enumerate() {
            if i < widths.len() {
                widths[i] = widths[i].max(col.len());
            }
        }
    }

    // Print header
    let header_line: Vec<String> = headers
        .iter()
        .enumerate()
        .map(|(i, h)| format!("{:width$}", h, width = widths[i]))
        .collect();
    println!("{}", header_line.join("  ").bold());

    // Print separator
    let separator: Vec<String> = widths.iter().map(|&w| "-".repeat(w)).collect();
    println!("{}", separator.join("  ").dimmed());

    // Print rows
    for row in rows {
        let line: Vec<String> = row
            .columns
            .iter()
            .enumerate()
            .map(|(i, col)| {
                let width = widths.get(i).copied().unwrap_or(col.len());
                format!("{:width$}", col, width = width)
            })
            .collect();
        println!("{}", line.join("  "));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_table_row_new() {
        let row = TableRow::new(vec!["a".to_string(), "b".to_string()]);
        assert_eq!(row.columns.len(), 2);
        assert_eq!(row.columns[0], "a");
        assert_eq!(row.columns[1], "b");
    }

    #[test]
    fn test_print_json_success() {
        #[derive(Serialize)]
        struct TestData {
            name: String,
        }
        let data = TestData {
            name: "test".to_string(),
        };
        // Just verify it doesn't panic
        let result = print_json(&data);
        assert!(result.is_ok());
    }
}
