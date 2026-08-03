use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::error::{Result, SsError};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChordCatalog {
    pub families: Vec<ChordFamily>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChordFamily {
    pub name: String,
    #[serde(default)]
    pub chords: Vec<ChordDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChordDefinition {
    pub full_name: String,
    #[serde(default)]
    pub numeral: Option<String>,
    #[serde(default)]
    pub intervals: Option<Vec<u8>>,
    #[serde(default)]
    pub root: Option<String>,
    #[serde(default)]
    pub midi_notes: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PitchClass {
    C,
    Cs,
    D,
    Ds,
    E,
    F,
    Fs,
    G,
    Gs,
    A,
    As,
    B,
}

impl PitchClass {
    pub fn semitone(self) -> u8 {
        match self {
            Self::C => 0,
            Self::Cs => 1,
            Self::D => 2,
            Self::Ds => 3,
            Self::E => 4,
            Self::F => 5,
            Self::Fs => 6,
            Self::G => 7,
            Self::Gs => 8,
            Self::A => 9,
            Self::As => 10,
            Self::B => 11,
        }
    }

    pub fn from_semitone(semitone: u8) -> Self {
        match semitone % 12 {
            0 => Self::C,
            1 => Self::Cs,
            2 => Self::D,
            3 => Self::Ds,
            4 => Self::E,
            5 => Self::F,
            6 => Self::Fs,
            7 => Self::G,
            8 => Self::Gs,
            9 => Self::A,
            10 => Self::As,
            _ => Self::B,
        }
    }

    pub fn add_semitones(self, semitones: i16) -> Self {
        let base = self.semitone() as i16;
        let wrapped = (base + semitones).rem_euclid(12) as u8;
        Self::from_semitone(wrapped)
    }

    pub fn to_midi(self, octave: i8) -> Result<u8> {
        let value = ((octave as i16 + 1) * 12) + self.semitone() as i16;
        if !(0..=127).contains(&value) {
            return Err(SsError::MidiOutOfRange(value));
        }
        Ok(value as u8)
    }
}

impl FromStr for PitchClass {
    type Err = SsError;

    fn from_str(input: &str) -> std::result::Result<Self, Self::Err> {
        let normalized = input.trim().to_ascii_uppercase();
        let pitch = match normalized.as_str() {
            "C" => Self::C,
            "C#" | "DB" => Self::Cs,
            "D" => Self::D,
            "D#" | "EB" => Self::Ds,
            "E" | "FB" => Self::E,
            "F" | "E#" => Self::F,
            "F#" | "GB" => Self::Fs,
            "G" => Self::G,
            "G#" | "AB" => Self::Gs,
            "A" => Self::A,
            "A#" | "BB" => Self::As,
            "B" | "CB" => Self::B,
            _ => return Err(SsError::InvalidPitchClass(input.to_string())),
        };
        Ok(pitch)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ChordSource {
    Relative,
    Fixed,
    ExplicitMidi,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResolvedChord {
    pub full_name: String,
    pub source: ChordSource,
    pub midi_notes: Vec<u8>,
    pub pitch_classes: Vec<PitchClass>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResolveContext {
    pub central_tone: PitchClass,
    pub base_octave: i8,
}

impl Default for ResolveContext {
    fn default() -> Self {
        Self {
            central_tone: PitchClass::C,
            base_octave: 4,
        }
    }
}

impl ChordCatalog {
    pub fn validate(&self) -> Result<()> {
        for family in &self.families {
            for chord in &family.chords {
                chord.validate()?;
            }
        }
        Ok(())
    }
}

impl ChordDefinition {
    pub fn validate(&self) -> Result<()> {
        match (&self.intervals, &self.midi_notes) {
            (None, None) => Err(SsError::InvalidChordDefinition(
                "chord must define either intervals or midi_notes".to_string(),
            )),
            (Some(intervals), _) if intervals.is_empty() => Err(SsError::InvalidChordDefinition(
                "intervals cannot be empty".to_string(),
            )),
            (_, Some(midi)) if midi.is_empty() => Err(SsError::InvalidChordDefinition(
                "midi_notes cannot be empty".to_string(),
            )),
            _ => Ok(()),
        }
    }

    pub fn resolve(&self, ctx: ResolveContext) -> Result<ResolvedChord> {
        self.validate()?;

        if let Some(midi_notes) = &self.midi_notes {
            return Ok(ResolvedChord {
                full_name: self.full_name.clone(),
                source: ChordSource::ExplicitMidi,
                midi_notes: midi_notes.clone(),
                pitch_classes: midi_notes
                    .iter()
                    .map(|n| PitchClass::from_semitone(*n % 12))
                    .collect(),
            });
        }

        let intervals = self
            .intervals
            .as_ref()
            .ok_or_else(|| SsError::InvalidChordDefinition("intervals were missing".to_string()))?;

        let root_pc = if let Some(root) = &self.root {
            PitchClass::from_str(root)?
        } else if let Some(numeral) = &self.numeral {
            let semitone_delta = numeral_to_major_scale_semitones(numeral)? as i16;
            ctx.central_tone.add_semitones(semitone_delta)
        } else {
            ctx.central_tone
        };

        let root_midi = root_pc.to_midi(ctx.base_octave)?;
        let mut midi_notes = Vec::with_capacity(intervals.len());
        for degree in intervals {
            let semitone_offset = degree_to_semitones(*degree)? as i16;
            let note = root_midi as i16 + semitone_offset;
            if !(0..=127).contains(&note) {
                return Err(SsError::MidiOutOfRange(note));
            }
            midi_notes.push(note as u8);
        }

        let source = if self.root.is_some() {
            ChordSource::Fixed
        } else {
            ChordSource::Relative
        };

        let pitch_classes = midi_notes
            .iter()
            .map(|n| PitchClass::from_semitone(*n % 12))
            .collect();

        Ok(ResolvedChord {
            full_name: self.full_name.clone(),
            source,
            midi_notes,
            pitch_classes,
        })
    }
}

fn numeral_to_major_scale_semitones(numeral: &str) -> Result<u8> {
    let trimmed = numeral.trim();
    if trimmed.is_empty() {
        return Err(SsError::InvalidRomanNumeral(numeral.to_string()));
    }

    let (accidental, body) = match trimmed.chars().next() {
        Some('b') | Some('B') => (-1i16, &trimmed[1..]),
        Some('#') => (1i16, &trimmed[1..]),
        _ => (0i16, trimmed),
    };

    let body_upper = body.to_ascii_uppercase();
    let degree = match body_upper.as_str() {
        "I" => 0,
        "II" => 1,
        "III" => 2,
        "IV" => 3,
        "V" => 4,
        "VI" => 5,
        "VII" => 6,
        _ => return Err(SsError::InvalidRomanNumeral(numeral.to_string())),
    };

    const MAJOR_SCALE: [u8; 7] = [0, 2, 4, 5, 7, 9, 11];
    let base = MAJOR_SCALE[degree] as i16;
    Ok((base + accidental).rem_euclid(12) as u8)
}

fn degree_to_semitones(degree: u8) -> Result<u8> {
    if degree == 0 {
        return Err(SsError::InvalidChordDefinition(
            "interval degrees are 1-based and must be >= 1".to_string(),
        ));
    }

    const MAJOR_SCALE: [u8; 7] = [0, 2, 4, 5, 7, 9, 11];
    let idx = degree - 1;
    let octave = idx / 7;
    let scale_degree = (idx % 7) as usize;
    let semitones = MAJOR_SCALE[scale_degree] as u16 + (12 * octave as u16);

    if semitones > 127 {
        return Err(SsError::InvalidChordDefinition(
            "interval degree is too large".to_string(),
        ));
    }

    Ok(semitones as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_flexible_json_schema() {
        let json = r#"
        {
          "families": [
            {
              "name": "Major Scale (Relative)",
              "chords": [
                {
                  "numeral": "I",
                  "full_name": "maj7add9",
                  "intervals": [1, 3, 5, 7, 9],
                  "root": null
                }
              ]
            },
            {
              "name": "Fixed Chords",
              "chords": [
                {
                  "full_name": "Dmaj7add9",
                  "root": "D",
                  "intervals": [1, 3, 5, 7, 9]
                }
              ]
            },
            {
              "name": "Explicit MIDI",
              "chords": [
                {
                  "full_name": "CustomVoicing",
                  "midi_notes": [60, 64, 67, 74]
                }
              ]
            }
          ]
        }
        "#;

        let catalog: ChordCatalog = serde_json::from_str(json).expect("json must parse");
        catalog.validate().expect("catalog should validate");
        assert_eq!(catalog.families.len(), 3);
    }

    #[test]
    fn resolves_relative_chord_from_central_tone() {
        let chord = ChordDefinition {
            full_name: "m7".to_string(),
            numeral: Some("ii".to_string()),
            intervals: Some(vec![1, 3, 5, 7]),
            root: None,
            midi_notes: None,
        };

        let resolved = chord
            .resolve(ResolveContext {
                central_tone: PitchClass::C,
                base_octave: 4,
            })
            .expect("resolution should succeed");

        assert_eq!(resolved.source, ChordSource::Relative);
        assert_eq!(resolved.midi_notes, vec![62, 66, 69, 73]);
    }

    #[test]
    fn resolves_fixed_and_explicit_midi() {
        let fixed = ChordDefinition {
            full_name: "Dmaj7".to_string(),
            numeral: None,
            intervals: Some(vec![1, 3, 5, 7]),
            root: Some("D".to_string()),
            midi_notes: None,
        };

        let explicit = ChordDefinition {
            full_name: "CustomVoicing".to_string(),
            numeral: None,
            intervals: None,
            root: None,
            midi_notes: Some(vec![60, 64, 67, 74]),
        };

        let fixed_resolved = fixed.resolve(ResolveContext::default()).expect("fixed");
        assert_eq!(fixed_resolved.source, ChordSource::Fixed);
        assert_eq!(fixed_resolved.midi_notes, vec![62, 66, 69, 73]);

        let explicit_resolved = explicit
            .resolve(ResolveContext::default())
            .expect("explicit");
        assert_eq!(explicit_resolved.source, ChordSource::ExplicitMidi);
        assert_eq!(explicit_resolved.midi_notes, vec![60, 64, 67, 74]);
    }
}
