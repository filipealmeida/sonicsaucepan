use ss_core::music::ChordCatalog;

#[test]
fn seed_catalog_roundtrip_and_validate() {
    let seed = include_str!("../../../assets/chords/default_families.json");
    let parsed: ChordCatalog = serde_json::from_str(seed).expect("seed JSON should parse");
    parsed.validate().expect("seed catalog should validate");

    let serialized = serde_json::to_string_pretty(&parsed).expect("serialize should work");
    let reparsed: ChordCatalog =
        serde_json::from_str(&serialized).expect("reparse should parse serialized catalog");

    assert_eq!(parsed, reparsed);
}
