use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

use ss_core::service::{
    self, CatalogValidationRequest, GraphAddAfterInlineNameRequest, GraphService,
    OrderedCycleRequest, ResolveChordRequest,
};

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
        #[arg(long, default_value_t = false)]
        envelope: bool,
    },
    ResolveChord {
        #[arg(help = "Path to a single ChordDefinition JSON file")]
        chord_file: PathBuf,
        #[arg(long, default_value = "C")]
        central_tone: String,
        #[arg(long, default_value_t = 4)]
        base_octave: i8,
        #[arg(long, default_value_t = false)]
        envelope: bool,
    },
    GraphDemo {
        #[arg(long, default_value_t = 16)]
        max_steps: usize,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::ValidateJson { input, envelope } => cmd_validate_json(input, envelope),
        Commands::ResolveChord {
            chord_file,
            central_tone,
            base_octave,
            envelope,
        } => cmd_resolve_chord(chord_file, central_tone, base_octave, envelope),
        Commands::GraphDemo { max_steps } => cmd_graph_demo(max_steps),
    }
}

fn cmd_validate_json(input: PathBuf, envelope: bool) -> Result<()> {
    let raw = fs::read_to_string(&input)
        .with_context(|| format!("failed reading catalog file: {}", input.display()))?;
    let request = CatalogValidationRequest { json: raw };
    let response = service::validate_catalog(&request)
        .with_context(|| format!("catalog validation failed for {}", input.display()))?;

    if envelope {
        let env = service::validate_catalog_enveloped(&request)
            .with_context(|| format!("catalog validation failed for {}", input.display()))?;
        println!("{}", serde_json::to_string_pretty(&env)?);
        return Ok(());
    }

    println!(
        "ok: validated {} families from {}",
        response.family_count,
        input.display()
    );

    Ok(())
}

fn cmd_resolve_chord(
    chord_file: PathBuf,
    central_tone: String,
    base_octave: i8,
    envelope: bool,
) -> Result<()> {
    let raw = fs::read_to_string(&chord_file)
        .with_context(|| format!("failed reading chord file: {}", chord_file.display()))?;
    let request = ResolveChordRequest {
        chord_json: raw,
        central_tone,
        base_octave,
    };

    if envelope {
        let env = service::resolve_chord_request_enveloped(&request)
            .context("chord resolution failed")?;
        println!("{}", serde_json::to_string_pretty(&env)?);
        return Ok(());
    }

    let response = service::resolve_chord_request(&request)
        .context("chord resolution failed")?;

    println!("{}", serde_json::to_string_pretty(&response.resolved)?);
    Ok(())
}

fn cmd_graph_demo(max_steps: usize) -> Result<()> {
    let mut graph = GraphService::new("Cmaj7".to_string());
    let n1 = graph
        .add_after_inline_name_request(GraphAddAfterInlineNameRequest {
            after_id: 0,
            chord_name: "Am7".to_string(),
        })
        .context("failed to add Am7")?;
    let _n2 = graph
        .add_after_inline_name_request(GraphAddAfterInlineNameRequest {
            after_id: n1.new_id,
            chord_name: "Dm7".to_string(),
        })
        .context("failed to add Dm7")?;
    let _n3 = graph
        .add_after_inline_name_request(GraphAddAfterInlineNameRequest {
            after_id: _n2.new_id,
            chord_name: "G7".to_string(),
        })
        .context("failed to add G7")?;

    println!("graph:");
    println!("{}", serde_json::to_string_pretty(graph.graph())?);
    println!(
        "cycle: {:?}",
        graph
            .ordered_cycle_request(OrderedCycleRequest { max_steps })?
            .node_ids
    );

    Ok(())
}
