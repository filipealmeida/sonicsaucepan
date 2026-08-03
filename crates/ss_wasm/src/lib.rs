use wasm_bindgen::prelude::*;

use ss_core::service::{self, GraphService};

fn js_err<E: ToString>(err: E) -> JsValue {
    JsValue::from_str(&err.to_string())
}

#[wasm_bindgen]
pub fn validate_chord_catalog(json: &str) -> Result<(), JsValue> {
    service::validate_catalog_json(json).map(|_| ()).map_err(js_err)
}

#[wasm_bindgen]
pub fn resolve_chord_json(
    chord_json: &str,
    central_tone: &str,
    base_octave: i8,
) -> Result<JsValue, JsValue> {
    let resolved = service::resolve_chord_json(chord_json, central_tone, base_octave)
        .map_err(js_err)?;

    serde_wasm_bindgen::to_value(&resolved).map_err(js_err)
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
        let id = self
            .inner
            .add_after_inline_name(after_id as u64, chord_name)
            .map_err(js_err)?;

        u32::try_from(id).map_err(js_err)
    }

    pub fn remove(&mut self, node_id: u32) -> Result<(), JsValue> {
        self.inner.remove(node_id as u64).map_err(js_err)
    }

    pub fn snapshot_json(&self) -> Result<String, JsValue> {
        self.inner.as_json().map_err(js_err)
    }

    pub fn ordered_cycle(&self, max_steps: u32) -> Result<Vec<u32>, JsValue> {
        self.inner
            .ordered_cycle(max_steps as usize)
            .map_err(js_err)?
            .into_iter()
            .map(|id| u32::try_from(id).map_err(js_err))
            .collect()
    }
}
