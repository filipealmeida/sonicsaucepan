use wasm_bindgen::prelude::*;

use ss_core::service::{
    self, CatalogValidationRequest, GraphAddAfterInlineNameRequest, GraphRemoveRequest,
    GraphService, OrderedCycleRequest, ResolveChordRequest,
};

fn js_err<E: ToString>(err: E) -> JsValue {
    JsValue::from_str(&err.to_string())
}

#[wasm_bindgen]
pub fn validate_chord_catalog(json: &str) -> Result<(), JsValue> {
    service::validate_catalog(&CatalogValidationRequest {
        json: json.to_string(),
    })
    .map(|_| ())
    .map_err(js_err)
}

#[wasm_bindgen]
pub fn validate_chord_catalog_enveloped(json: &str) -> Result<JsValue, JsValue> {
    let response = service::validate_catalog_enveloped(&CatalogValidationRequest {
        json: json.to_string(),
    })
    .map_err(js_err)?;

    serde_wasm_bindgen::to_value(&response).map_err(js_err)
}

#[wasm_bindgen]
pub fn resolve_chord_json(
    chord_json: &str,
    central_tone: &str,
    base_octave: i8,
) -> Result<JsValue, JsValue> {
    let response = service::resolve_chord_request(&ResolveChordRequest {
        chord_json: chord_json.to_string(),
        central_tone: central_tone.to_string(),
        base_octave,
    })
    .map_err(js_err)?;

    serde_wasm_bindgen::to_value(&response.resolved).map_err(js_err)
}

#[wasm_bindgen]
pub fn resolve_chord_json_enveloped(
    chord_json: &str,
    central_tone: &str,
    base_octave: i8,
) -> Result<JsValue, JsValue> {
    let response = service::resolve_chord_request_enveloped(&ResolveChordRequest {
        chord_json: chord_json.to_string(),
        central_tone: central_tone.to_string(),
        base_octave,
    })
    .map_err(js_err)?;

    serde_wasm_bindgen::to_value(&response).map_err(js_err)
}

#[wasm_bindgen]
pub struct WasmLoopGraph {
    inner: GraphService,
}

#[wasm_bindgen]
impl WasmLoopGraph {
    #[wasm_bindgen(constructor)]
    pub fn new(initial_chord_name: String) -> Self {
        Self {
            inner: GraphService::new(initial_chord_name),
        }
    }

    pub fn add_after(&mut self, after_id: u32, chord_name: String) -> Result<u32, JsValue> {
        let response = self
            .inner
            .add_after_inline_name_request(GraphAddAfterInlineNameRequest {
                after_id: after_id as u64,
                chord_name,
            })
            .map_err(js_err)?;

        u32::try_from(response.new_id).map_err(js_err)
    }

    pub fn add_after_enveloped(
        &mut self,
        after_id: u32,
        chord_name: String,
    ) -> Result<JsValue, JsValue> {
        let response = self
            .inner
            .add_after_inline_name_request_enveloped(GraphAddAfterInlineNameRequest {
                after_id: after_id as u64,
                chord_name,
            })
            .map_err(js_err)?;

        serde_wasm_bindgen::to_value(&response).map_err(js_err)
    }

    pub fn remove(&mut self, node_id: u32) -> Result<(), JsValue> {
        self.inner
            .remove_request(GraphRemoveRequest {
                node_id: node_id as u64,
            })
            .map(|_| ())
            .map_err(js_err)
    }

    pub fn remove_enveloped(&mut self, node_id: u32) -> Result<JsValue, JsValue> {
        let response = self
            .inner
            .remove_request_enveloped(GraphRemoveRequest {
                node_id: node_id as u64,
            })
            .map_err(js_err)?;

        serde_wasm_bindgen::to_value(&response).map_err(js_err)
    }

    pub fn snapshot_json(&self) -> Result<String, JsValue> {
        self.inner.as_json().map_err(js_err)
    }

    pub fn snapshot_json_enveloped(&self) -> Result<JsValue, JsValue> {
        let response = self.inner.snapshot_request_enveloped().map_err(js_err)?;
        serde_wasm_bindgen::to_value(&response).map_err(js_err)
    }

    pub fn ordered_cycle(&self, max_steps: u32) -> Result<Vec<u32>, JsValue> {
        self.inner
            .ordered_cycle_request(OrderedCycleRequest {
                max_steps: max_steps as usize,
            })
            .map_err(js_err)?
            .node_ids
            .into_iter()
            .map(|id| u32::try_from(id).map_err(js_err))
            .collect()
    }

    pub fn ordered_cycle_enveloped(&self, max_steps: u32) -> Result<JsValue, JsValue> {
        let response = self
            .inner
            .ordered_cycle_request_enveloped(OrderedCycleRequest {
                max_steps: max_steps as usize,
            })
            .map_err(js_err)?;

        serde_wasm_bindgen::to_value(&response).map_err(js_err)
    }
}
