use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

use ss_core::service::{self, GraphService};

#[derive(Debug, Parser)]
#[command(name = "ss_cli")]
#[command(about = "Sonic Saucepan command-line tooling")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    ValidateJson {
        #[arg(help = "Path to a chord catalog JSON file")]
        input: PathBuf,
    },
    ResolveChord {
        #[arg(help = "Path to a single ChordDefinition JSON file")]
        chord_file: PathBuf,
        #[arg(long, default_value = "C")]
        central_tone: String,
        #[arg(long, default_value_t = 4)]
        base_octave: i8,
    },
    GraphDemo {
        #[arg(long, default_value_t = 16)]
        max_steps: usize,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::ValidateJson { input } => cmd_validate_json(input),
        Commands::ResolveChord {
            chord_file,
            central_tone,
            base_octave,
        } => cmd_resolve_chord(chord_file, central_tone, base_octave),
        Commands::GraphDemo { max_steps } => cmd_graph_demo(max_steps),
    }
}

fn cmd_validate_json(input: PathBuf) -> Result<()> {
    let raw = fs::read_to_string(&input)
        .with_context(|| format!("failed reading catalog file: {}", input.display()))?;
    let catalog = service::validate_catalog_json(&raw)
        .with_context(|| format!("catalog validation failed for {}", input.display()))?;

    println!(
        "ok: validated {} families from {}",
        catalog.families.len(),
        input.display()
    );

    Ok(())
}

fn cmd_resolve_chord(chord_file: PathBuf, central_tone: String, base_octave: i8) -> Result<()> {
    let raw = fs::read_to_string(&chord_file)
        .with_context(|| format!("failed reading chord file: {}", chord_file.display()))?;
    let resolved = service::resolve_chord_json(&raw, &central_tone, base_octave)
        .context("chord resolution failed")?;

    println!("{}", serde_json::to_string_pretty(&resolved)?);
    Ok(())
}

fn cmd_graph_demo(max_steps: usize) -> Result<()> {
    let mut graph = GraphService::new("Cmaj7".to_string());
    let n1 = graph
        .add_after_inline_name(0, "Am7".to_string())
        .context("failed to add Am7")?;
    let n2 = graph
        .add_after_inline_name(n1, "Dm7".to_string())
        .context("failed to add Dm7")?;
    let _n3 = graph
        .add_after_inline_name(n2, "G7".to_string())
        .context("failed to add G7")?;

    println!("graph:");
    println!("{}", serde_json::to_string_pretty(graph.graph())?);
    println!("cycle: {:?}", graph.ordered_cycle(max_steps)?);

    Ok(())
}
