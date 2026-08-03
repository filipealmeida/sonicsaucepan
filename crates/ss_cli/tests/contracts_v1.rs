use ss_core::service::{
    self, CatalogValidationRequest, GraphAddAfterInlineNameRequest, GraphRemoveRequest,
    GraphService, OrderedCycleRequest, ResolveChordRequest,
};

fn json_fixture(path: &str) -> serde_json::Value {
    let raw = match path {
        "catalog_validation_enveloped.json" => {
            include_str!("../../../contracts/fixtures/v1/catalog_validation_enveloped.json")
        }
        "resolve_chord_enveloped.json" => {
            include_str!("../../../contracts/fixtures/v1/resolve_chord_enveloped.json")
        }
        "graph_add_after_enveloped.json" => {
            include_str!("../../../contracts/fixtures/v1/graph_add_after_enveloped.json")
        }
        "graph_ordered_cycle_enveloped.json" => {
            include_str!("../../../contracts/fixtures/v1/graph_ordered_cycle_enveloped.json")
        }
        "graph_remove_enveloped.json" => {
            include_str!("../../../contracts/fixtures/v1/graph_remove_enveloped.json")
        }
        _ => panic!("unknown fixture: {path}"),
    };

    serde_json::from_str(raw).expect("fixture JSON should parse")
}

#[test]
fn contract_v1_catalog_validation_envelope_matches_fixture() {
    let catalog_json = include_str!("../../../assets/chords/default_families.json");

    let actual = service::validate_catalog_enveloped(&CatalogValidationRequest {
        json: catalog_json.to_string(),
    })
    .expect("validation should succeed");

    let expected = json_fixture("catalog_validation_enveloped.json");
    let actual_json = serde_json::to_value(actual).expect("serialize actual envelope");

    assert_eq!(actual_json, expected);
}

#[test]
fn contract_v1_resolve_chord_envelope_matches_fixture() {
    let chord_json = include_str!("../../../assets/chords/example_chord_relative.json");

    let actual = service::resolve_chord_request_enveloped(&ResolveChordRequest {
        chord_json: chord_json.to_string(),
        central_tone: "C".to_string(),
        base_octave: 4,
    })
    .expect("resolution should succeed");

    let expected = json_fixture("resolve_chord_enveloped.json");
    let actual_json = serde_json::to_value(actual).expect("serialize actual envelope");

    assert_eq!(actual_json, expected);
}

#[test]
fn contract_v1_graph_envelopes_match_fixtures() {
    let mut graph = GraphService::new("Cmaj7".to_string());

    let add_1 = graph
        .add_after_inline_name_request_enveloped(GraphAddAfterInlineNameRequest {
            after_id: 0,
            chord_name: "Am7".to_string(),
        })
        .expect("add 1");
    let add_2 = graph
        .add_after_inline_name_request_enveloped(GraphAddAfterInlineNameRequest {
            after_id: add_1.payload.new_id,
            chord_name: "Dm7".to_string(),
        })
        .expect("add 2");
    let add_3 = graph
        .add_after_inline_name_request_enveloped(GraphAddAfterInlineNameRequest {
            after_id: add_2.payload.new_id,
            chord_name: "G7".to_string(),
        })
        .expect("add 3");

    let add_expected = json_fixture("graph_add_after_enveloped.json");
    let add_actual_json = serde_json::to_value(add_1).expect("serialize add envelope");
    assert_eq!(add_actual_json, add_expected);

    let cycle = graph
        .ordered_cycle_request_enveloped(OrderedCycleRequest { max_steps: 10 })
        .expect("cycle");
    let cycle_expected = json_fixture("graph_ordered_cycle_enveloped.json");
    let cycle_actual_json = serde_json::to_value(cycle).expect("serialize cycle envelope");
    assert_eq!(cycle_actual_json, cycle_expected);

    let removed = graph
        .remove_request_enveloped(GraphRemoveRequest {
            node_id: add_3.payload.new_id,
        })
        .expect("remove");
    let removed_expected = json_fixture("graph_remove_enveloped.json");
    let removed_actual_json = serde_json::to_value(removed).expect("serialize remove envelope");
    assert_eq!(removed_actual_json, removed_expected);
}
