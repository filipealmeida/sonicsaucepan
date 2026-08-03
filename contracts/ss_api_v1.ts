/*
 * Sonic Saucepan shared contract DTOs (API v1).
 * Keep this file in sync with Rust DTOs in crates/ss_core/src/service.rs and music.rs.
 */

export const API_VERSION = "1.0.0" as const;

export interface ApiEnvelope<T> {
  api_version: string;
  payload: T;
}

export interface CatalogValidationRequest {
  json: string;
}

export interface CatalogValidationResponse {
  family_count: number;
}

export interface ResolveChordRequest {
  chord_json: string;
  central_tone: string;
  base_octave: number;
}

export interface ResolveChordResponse {
  resolved: ResolvedChord;
}

export interface GraphAddAfterInlineNameRequest {
  after_id: number;
  chord_name: string;
}

export interface GraphAddAfterInlineNameResponse {
  new_id: number;
}

export interface GraphRemoveRequest {
  node_id: number;
}

export interface GraphRemoveResponse {
  removed_node_id: number;
}

export interface OrderedCycleRequest {
  max_steps: number;
}

export interface OrderedCycleResponse {
  node_ids: number[];
}

export interface GraphSnapshotResponse {
  graph_json: string;
}

export type ChordSource = "Relative" | "Fixed" | "ExplicitMidi";

export type PitchClass =
  | "C"
  | "CS"
  | "D"
  | "DS"
  | "E"
  | "F"
  | "FS"
  | "G"
  | "GS"
  | "A"
  | "AS"
  | "B";

export interface ResolvedChord {
  full_name: string;
  source: ChordSource;
  midi_notes: number[];
  pitch_classes: PitchClass[];
}
