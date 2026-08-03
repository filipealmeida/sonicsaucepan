use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::Serialize;
use serde_json::Value;

use ss_core::service::{
    self, CatalogValidationRequest, GraphAddAfterInlineNameRequest, GraphRemoveRequest,
    GraphService, OrderedCycleRequest, ResolveChordRequest,
};

fn main() -> Result<()> {
    let check_mode = env::args().skip(1).any(|arg| arg == "--check");
    let root = workspace_root();
    let out_dir = root.join("contracts/fixtures/v1");

    let fixtures = build_fixtures()?;

    if check_mode {
        check_fixtures(&out_dir, &fixtures)
    } else {
        write_fixtures(&out_dir, &fixtures)
    }
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("workspace root should resolve")
}

fn build_fixtures() -> Result<Vec<(&'static str, Value)>> {
    let catalog_json = include_str!("../../../../assets/chords/default_families.json");
    let chord_json = include_str!("../../../../assets/chords/example_chord_relative.json");

    let catalog_env = service::validate_catalog_enveloped(&CatalogValidationRequest {
        json: catalog_json.to_string(),
    })?;

    let resolve_env = service::resolve_chord_request_enveloped(&ResolveChordRequest {
        chord_json: chord_json.to_string(),
        central_tone: "C".to_string(),
        base_octave: 4,
    })?;

    let mut graph = GraphService::new("Cmaj7".to_string());

    let add_1 = graph.add_after_inline_name_request_enveloped(GraphAddAfterInlineNameRequest {
        after_id: 0,
        chord_name: "Am7".to_string(),
    })?;

    let add_2 = graph.add_after_inline_name_request_enveloped(GraphAddAfterInlineNameRequest {
        after_id: add_1.payload.new_id,
        chord_name: "Dm7".to_string(),
    })?;

    let add_3 = graph.add_after_inline_name_request_enveloped(GraphAddAfterInlineNameRequest {
        after_id: add_2.payload.new_id,
        chord_name: "G7".to_string(),
    })?;

    let cycle = graph.ordered_cycle_request_enveloped(OrderedCycleRequest { max_steps: 10 })?;

    let remove = graph.remove_request_enveloped(GraphRemoveRequest {
        node_id: add_3.payload.new_id,
    })?;

    Ok(vec![
        (
            "catalog_validation_enveloped.json",
            serde_json::to_value(catalog_env)?,
        ),
        (
            "resolve_chord_enveloped.json",
            serde_json::to_value(resolve_env)?,
        ),
        (
            "graph_add_after_enveloped.json",
            serde_json::to_value(add_1)?,
        ),
        (
            "graph_ordered_cycle_enveloped.json",
            serde_json::to_value(cycle)?,
        ),
        (
            "graph_remove_enveloped.json",
            serde_json::to_value(remove)?,
        ),
    ])
}

fn write_fixtures(out_dir: &Path, fixtures: &[(&str, Value)]) -> Result<()> {
    fs::create_dir_all(out_dir)
        .with_context(|| format!("failed to create fixture dir: {}", out_dir.display()))?;

    for (name, value) in fixtures {
        let path = out_dir.join(name);
        let json = to_pretty_json(value)?;
        fs::write(&path, json)
            .with_context(|| format!("failed writing fixture: {}", path.display()))?;
        println!("updated {}", path.display());
    }

    Ok(())
}

fn check_fixtures(out_dir: &Path, fixtures: &[(&str, Value)]) -> Result<()> {
    let mut mismatches = Vec::new();

    for (name, generated) in fixtures {
        let path = out_dir.join(name);
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("missing fixture file: {}", path.display()))?;
        let existing: Value = serde_json::from_str(&raw)
            .with_context(|| format!("invalid JSON in fixture: {}", path.display()))?;

        if &existing != generated {
            mismatches.push(path);
        }
    }

    if mismatches.is_empty() {
        println!("contract fixtures are up to date");
        return Ok(());
    }

    eprintln!("contract fixture drift detected:");
    for path in mismatches {
        eprintln!("- {}", path.display());
    }
    eprintln!("run: cargo run -p ss_cli --bin generate_contract_fixtures");

    bail!("contract fixtures differ from generated DTO envelopes")
}

fn to_pretty_json<T: Serialize>(value: &T) -> Result<String> {
    let mut out = serde_json::to_string_pretty(value)?;
    out.push('\n');
    Ok(out)
}
