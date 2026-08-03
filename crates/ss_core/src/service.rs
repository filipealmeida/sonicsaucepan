use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::error::{Result, SsError};
use crate::graph::{ChordHandle, LoopGraph, NodeId};
use crate::music::{ChordCatalog, ChordDefinition, PitchClass, ResolveContext, ResolvedChord};

pub const API_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApiEnvelope<T> {
    pub api_version: String,
    pub payload: T,
}

impl<T> ApiEnvelope<T> {
    pub fn v1(payload: T) -> Self {
        Self {
            api_version: API_VERSION.to_string(),
            payload,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CatalogValidationRequest {
    pub json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CatalogValidationResponse {
    pub family_count: usize,
}

pub fn validate_catalog(request: &CatalogValidationRequest) -> Result<CatalogValidationResponse> {
    let catalog = validate_catalog_json(&request.json)?;
    Ok(CatalogValidationResponse {
        family_count: catalog.families.len(),
    })
}

pub fn validate_catalog_enveloped(
    request: &CatalogValidationRequest,
) -> Result<ApiEnvelope<CatalogValidationResponse>> {
    let payload = validate_catalog(request)?;
    Ok(ApiEnvelope::v1(payload))
}

pub fn validate_catalog_json(json: &str) -> Result<ChordCatalog> {
    let catalog: ChordCatalog = serde_json::from_str(json)
        .map_err(|e| SsError::InvalidChordDefinition(format!("invalid catalog JSON: {e}")))?;
    catalog.validate()?;
    Ok(catalog)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResolveChordRequest {
    pub chord_json: String,
    pub central_tone: String,
    pub base_octave: i8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResolveChordResponse {
    pub resolved: ResolvedChord,
}

pub fn resolve_chord_request(request: &ResolveChordRequest) -> Result<ResolveChordResponse> {
    let resolved = resolve_chord_json(
        &request.chord_json,
        &request.central_tone,
        request.base_octave,
    )?;
    Ok(ResolveChordResponse { resolved })
}

pub fn resolve_chord_request_enveloped(
    request: &ResolveChordRequest,
) -> Result<ApiEnvelope<ResolveChordResponse>> {
    let payload = resolve_chord_request(request)?;
    Ok(ApiEnvelope::v1(payload))
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphAddAfterInlineNameRequest {
    pub after_id: NodeId,
    pub chord_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphAddAfterInlineNameResponse {
    pub new_id: NodeId,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphRemoveRequest {
    pub node_id: NodeId,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphRemoveResponse {
    pub removed_node_id: NodeId,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrderedCycleRequest {
    pub max_steps: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrderedCycleResponse {
    pub node_ids: Vec<NodeId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphSnapshotResponse {
    pub graph_json: String,
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

    pub fn add_after_inline_name_request(
        &mut self,
        request: GraphAddAfterInlineNameRequest,
    ) -> Result<GraphAddAfterInlineNameResponse> {
        let new_id = self.add_after_inline_name(request.after_id, request.chord_name)?;
        Ok(GraphAddAfterInlineNameResponse { new_id })
    }

    pub fn add_after_inline_name_request_enveloped(
        &mut self,
        request: GraphAddAfterInlineNameRequest,
    ) -> Result<ApiEnvelope<GraphAddAfterInlineNameResponse>> {
        let payload = self.add_after_inline_name_request(request)?;
        Ok(ApiEnvelope::v1(payload))
    }

    pub fn remove(&mut self, node_id: NodeId) -> Result<()> {
        self.graph.remove(node_id)
    }

    pub fn remove_request(&mut self, request: GraphRemoveRequest) -> Result<GraphRemoveResponse> {
        self.remove(request.node_id)?;
        Ok(GraphRemoveResponse {
            removed_node_id: request.node_id,
        })
    }

    pub fn remove_request_enveloped(
        &mut self,
        request: GraphRemoveRequest,
    ) -> Result<ApiEnvelope<GraphRemoveResponse>> {
        let payload = self.remove_request(request)?;
        Ok(ApiEnvelope::v1(payload))
    }

    pub fn ordered_cycle(&self, max_steps: usize) -> Result<Vec<NodeId>> {
        self.graph.ordered_cycle(max_steps)
    }

    pub fn ordered_cycle_request(&self, request: OrderedCycleRequest) -> Result<OrderedCycleResponse> {
        let node_ids = self.ordered_cycle(request.max_steps)?;
        Ok(OrderedCycleResponse { node_ids })
    }

    pub fn ordered_cycle_request_enveloped(
        &self,
        request: OrderedCycleRequest,
    ) -> Result<ApiEnvelope<OrderedCycleResponse>> {
        let payload = self.ordered_cycle_request(request)?;
        Ok(ApiEnvelope::v1(payload))
    }

    pub fn as_json(&self) -> Result<String> {
        serde_json::to_string(&self.graph)
            .map_err(|e| SsError::InvalidChordDefinition(format!("graph serialization failed: {e}")))
    }

    pub fn snapshot_request(&self) -> Result<GraphSnapshotResponse> {
        let graph_json = self.as_json()?;
        Ok(GraphSnapshotResponse { graph_json })
    }

    pub fn snapshot_request_enveloped(&self) -> Result<ApiEnvelope<GraphSnapshotResponse>> {
        let payload = self.snapshot_request()?;
        Ok(ApiEnvelope::v1(payload))
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

        let response = validate_catalog(&CatalogValidationRequest {
            json: raw.to_string(),
        })
        .expect("dto request should validate");
        assert_eq!(response.family_count, 1);

        let enveloped = validate_catalog_enveloped(&CatalogValidationRequest {
            json: raw.to_string(),
        })
        .expect("enveloped dto request should validate");
        assert_eq!(enveloped.api_version, API_VERSION);
        assert_eq!(enveloped.payload.family_count, 1);
    }

    #[test]
    fn resolves_chord_json() {
        let raw = r#"{"full_name":"m7","numeral":"ii","intervals":[1,3,5,7]}"#;
        let resolved = resolve_chord_json(raw, "C", 4).expect("resolution should work");
        assert_eq!(resolved.midi_notes, vec![62, 66, 69, 73]);

        let response = resolve_chord_request(&ResolveChordRequest {
            chord_json: raw.to_string(),
            central_tone: "C".to_string(),
            base_octave: 4,
        })
        .expect("dto resolve should work");
        assert_eq!(response.resolved.midi_notes, vec![62, 66, 69, 73]);

        let enveloped = resolve_chord_request_enveloped(&ResolveChordRequest {
            chord_json: raw.to_string(),
            central_tone: "C".to_string(),
            base_octave: 4,
        })
        .expect("enveloped dto resolve should work");
        assert_eq!(enveloped.api_version, API_VERSION);
        assert_eq!(enveloped.payload.resolved.midi_notes, vec![62, 66, 69, 73]);
    }

    #[test]
    fn graph_service_splices_cycle() {
        let mut graph = GraphService::new("Cmaj7".to_string());
        let n1 = graph
            .add_after_inline_name_request(GraphAddAfterInlineNameRequest {
                after_id: 0,
                chord_name: "Am7".to_string(),
            })
            .expect("n1");
        let n2 = graph
            .add_after_inline_name_request(GraphAddAfterInlineNameRequest {
                after_id: n1.new_id,
                chord_name: "Dm7".to_string(),
            })
            .expect("n2");

        let n3_env = graph
            .add_after_inline_name_request_enveloped(GraphAddAfterInlineNameRequest {
                after_id: n2.new_id,
                chord_name: "G7".to_string(),
            })
            .expect("n3 envelope");
        assert_eq!(n3_env.api_version, API_VERSION);

        let cycle = graph
            .ordered_cycle_request(OrderedCycleRequest { max_steps: 8 })
            .expect("cycle");
        assert_eq!(cycle.node_ids, vec![0, n1.new_id, n2.new_id, n3_env.payload.new_id, 0]);

        let cycle_env = graph
            .ordered_cycle_request_enveloped(OrderedCycleRequest { max_steps: 8 })
            .expect("cycle envelope");
        assert_eq!(cycle_env.api_version, API_VERSION);
        assert_eq!(cycle_env.payload.node_ids, cycle.node_ids);

        let removed = graph
            .remove_request(GraphRemoveRequest {
                node_id: n3_env.payload.new_id,
            })
            .expect("remove response");
        assert_eq!(removed.removed_node_id, n3_env.payload.new_id);

        let removed_env = graph
            .remove_request_enveloped(GraphRemoveRequest {
                node_id: n2.new_id,
            })
            .expect("remove envelope");
        assert_eq!(removed_env.api_version, API_VERSION);
        assert_eq!(removed_env.payload.removed_node_id, n2.new_id);

        let snapshot = graph.snapshot_request().expect("snapshot");
        assert!(snapshot.graph_json.contains("Cmaj7"));

        let snapshot_env = graph
            .snapshot_request_enveloped()
            .expect("snapshot envelope");
        assert_eq!(snapshot_env.api_version, API_VERSION);
        assert!(snapshot_env.payload.graph_json.contains("Cmaj7"));
    }
}
