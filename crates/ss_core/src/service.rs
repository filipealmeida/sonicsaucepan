use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::error::{Result, SsError};
use crate::graph::{ChordHandle, LoopGraph, NodeId};
use crate::music::{ChordCatalog, ChordDefinition, PitchClass, ResolveContext, ResolvedChord};

pub fn validate_catalog_json(json: &str) -> Result<ChordCatalog> {
    let catalog: ChordCatalog = serde_json::from_str(json)
        .map_err(|e| SsError::InvalidChordDefinition(format!("invalid catalog JSON: {e}")))?;
    catalog.validate()?;
    Ok(catalog)
}

pub fn resolve_chord_json(
    chord_json: &str,
    central_tone: &str,
    base_octave: i8,
) -> Result<ResolvedChord> {
    let chord: ChordDefinition = serde_json::from_str(chord_json)
        .map_err(|e| SsError::InvalidChordDefinition(format!("invalid chord JSON: {e}")))?;
    resolve_chord(&chord, central_tone, base_octave)
}

pub fn resolve_chord(
    chord: &ChordDefinition,
    central_tone: &str,
    base_octave: i8,
) -> Result<ResolvedChord> {
    let pitch = PitchClass::from_str(central_tone)?;
    chord.resolve(ResolveContext {
        central_tone: pitch,
        base_octave,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphService {
    graph: LoopGraph,
}

impl GraphService {
    pub fn new(initial_chord_name: String) -> Self {
        Self {
            graph: LoopGraph::new(ChordHandle::InlineName {
                name: initial_chord_name,
            }),
        }
    }

    pub fn add_after_inline_name(&mut self, after_id: NodeId, chord_name: String) -> Result<NodeId> {
        self.graph
            .add_after(after_id, ChordHandle::InlineName { name: chord_name })
    }

    pub fn remove(&mut self, node_id: NodeId) -> Result<()> {
        self.graph.remove(node_id)
    }

    pub fn ordered_cycle(&self, max_steps: usize) -> Result<Vec<NodeId>> {
        self.graph.ordered_cycle(max_steps)
    }

    pub fn as_json(&self) -> Result<String> {
        serde_json::to_string(&self.graph)
            .map_err(|e| SsError::InvalidChordDefinition(format!("graph serialization failed: {e}")))
    }

    pub fn graph(&self) -> &LoopGraph {
        &self.graph
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_catalog_json() {
        let raw = r#"{"families":[{"name":"x","chords":[{"full_name":"maj","intervals":[1,3,5]}]}]}"#;
        let catalog = validate_catalog_json(raw).expect("catalog should validate");
        assert_eq!(catalog.families.len(), 1);
    }

    #[test]
    fn resolves_chord_json() {
        let raw = r#"{"full_name":"m7","numeral":"ii","intervals":[1,3,5,7]}"#;
        let resolved = resolve_chord_json(raw, "C", 4).expect("resolution should work");
        assert_eq!(resolved.midi_notes, vec![62, 66, 69, 73]);
    }

    #[test]
    fn graph_service_splices_cycle() {
        let mut graph = GraphService::new("Cmaj7".to_string());
        let n1 = graph
            .add_after_inline_name(0, "Am7".to_string())
            .expect("n1");
        let n2 = graph
            .add_after_inline_name(n1, "Dm7".to_string())
            .expect("n2");

        let cycle = graph.ordered_cycle(8).expect("cycle");
        assert_eq!(cycle, vec![0, n1, n2, 0]);
    }
}
