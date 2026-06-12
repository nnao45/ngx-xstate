mod converter;

use std::io::{self, Read, Write};
use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    match args.as_slice() {
        [_] => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input).unwrap_or_else(|e| {
                eprintln!("nixx: read error: {e}");
                std::process::exit(1);
            });
            run_convert(&input, None);
        }
        [_, ref a] if a == "-" => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input).unwrap_or_else(|e| {
                eprintln!("nixx: read error: {e}");
                std::process::exit(1);
            });
            run_convert(&input, None);
        }
        [_, input_path] => {
            let src = std::fs::read_to_string(input_path).unwrap_or_else(|e| {
                eprintln!("nixx: {input_path}: {e}");
                std::process::exit(1);
            });
            run_convert(&src, None);
        }
        [_, input_path, output_path] => {
            let src = std::fs::read_to_string(input_path).unwrap_or_else(|e| {
                eprintln!("nixx: {input_path}: {e}");
                std::process::exit(1);
            });
            run_convert(&src, Some(Path::new(output_path)));
        }
        _ => {
            eprintln!("Usage: nixx [<input.nixx> [<output.nix>]]");
            eprintln!("       nixx -   (stdin → stdout)");
            std::process::exit(2);
        }
    }
}

fn run_convert(input: &str, output_path: Option<&Path>) {
    match converter::convert(input) {
        Ok(nix) => match output_path {
            Some(path) => {
                std::fs::write(path, nix).unwrap_or_else(|e| {
                    eprintln!("nixx: write error: {e}");
                    std::process::exit(1);
                });
            }
            None => {
                io::stdout().write_all(nix.as_bytes()).unwrap_or_else(|e| {
                    eprintln!("nixx: write error: {e}");
                    std::process::exit(1);
                });
            }
        },
        Err(e) => {
            eprintln!("nixx: conversion error: {e}");
            std::process::exit(1);
        }
    }
}
