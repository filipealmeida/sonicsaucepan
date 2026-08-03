use std::f32::consts::PI;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[cfg(not(target_arch = "wasm32"))]
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
#[cfg(not(target_arch = "wasm32"))]
use midir::{MidiOutput, MidiOutputConnection};

pub type Result<T> = std::result::Result<T, SsAudioError>;

#[derive(Debug, Error)]
pub enum SsAudioError {
    #[error("invalid synth configuration: {0}")]
    InvalidConfig(String),
    #[error("invalid chord symbol: {0}")]
    InvalidChordSymbol(String),
    #[error("midi note out of range: {0}")]
    MidiOutOfRange(i16),
    #[error("audio output error: {0}")]
    AudioOutput(String),
    #[error("wav output error: {0}")]
    WavOutput(String),
    #[error("midi output error: {0}")]
    MidiOutput(String),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Waveform {
    Sine,
    Square,
    Saw,
    Triangle,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FilterConfig {
    pub enabled: bool,
    pub cutoff_hz: f32,
    pub resonance: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EffectConfig {
    Delay {
        mix: f32,
        feedback: f32,
        time_ms: f32,
    },
    Reverb {
        mix: f32,
        room_size: f32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SynthConfig {
    pub sample_rate: u32,
    pub bpm: f32,
    pub beats_per_chord: f32,
    pub master_gain: f32,
    pub attack_s: f32,
    pub release_s: f32,
    pub waveform: Waveform,
    pub filter: Option<FilterConfig>,
    pub effects: Vec<EffectConfig>,
}

impl Default for SynthConfig {
    fn default() -> Self {
        Self {
            sample_rate: 44_100,
            bpm: 120.0,
            beats_per_chord: 4.0,
            master_gain: 0.2,
            attack_s: 0.01,
            release_s: 0.08,
            waveform: Waveform::Sine,
            filter: None,
            effects: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlayableChord {
    pub name: String,
    pub midi_notes: Vec<u8>,
}

pub fn chord_symbol_to_playable(symbol: &str, octave: i8) -> Result<PlayableChord> {
    let trimmed = symbol.trim();
    if trimmed.is_empty() {
        return Err(SsAudioError::InvalidChordSymbol(symbol.to_string()));
    }

    let (root_str, quality) = split_root_and_quality(trimmed)?;
    let root_semitone = root_to_semitone(root_str)?;
    let intervals = quality_to_intervals(quality)?;

    let base = ((octave as i16 + 1) * 12) + i16::from(root_semitone);
    if !(0..=127).contains(&base) {
        return Err(SsAudioError::MidiOutOfRange(base));
    }

    let mut midi_notes = Vec::with_capacity(intervals.len());
    for interval in intervals {
        let note = base + i16::from(*interval);
        if !(0..=127).contains(&note) {
            return Err(SsAudioError::MidiOutOfRange(note));
        }
        midi_notes.push(note as u8);
    }

    Ok(PlayableChord {
        name: trimmed.to_string(),
        midi_notes,
    })
}

pub fn render_progression_mono(chords: &[PlayableChord], config: &SynthConfig) -> Result<Vec<f32>> {
    validate_config(config)?;
    if chords.is_empty() {
        return Err(SsAudioError::InvalidConfig(
            "progression must have at least one chord".to_string(),
        ));
    }

    let chord_secs = (60.0 / config.bpm) * config.beats_per_chord;
    let samples_per_chord = (chord_secs * config.sample_rate as f32) as usize;
    if samples_per_chord == 0 {
        return Err(SsAudioError::InvalidConfig(
            "computed chord duration has zero samples".to_string(),
        ));
    }

    let mut out = Vec::with_capacity(samples_per_chord * chords.len());
    let sr_f = config.sample_rate as f32;

    for chord in chords {
        for i in 0..samples_per_chord {
            let t = i as f32 / sr_f;
            let env = envelope(i, samples_per_chord, config.attack_s, config.release_s, sr_f);
            let mut s = 0.0;

            for midi in &chord.midi_notes {
                let freq = midi_to_hz(*midi);
                s += osc_sample(config.waveform, freq, t);
            }

            if !chord.midi_notes.is_empty() {
                s /= chord.midi_notes.len() as f32;
            }

            out.push((s * env * config.master_gain).clamp(-1.0, 1.0));
        }
    }

    apply_filter_chain(&mut out, config, sr_f);
    apply_effect_chain(&mut out, config);

    Ok(out)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn available_midi_output_ports() -> Result<Vec<String>> {
    let midi_out = MidiOutput::new("sonic-saucepan")
        .map_err(|e| SsAudioError::MidiOutput(e.to_string()))?;
    let ports = midi_out.ports();
    let mut names = Vec::with_capacity(ports.len());

    for port in ports {
        let name = midi_out
            .port_name(&port)
            .map_err(|e| SsAudioError::MidiOutput(e.to_string()))?;
        names.push(name);
    }

    Ok(names)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn send_progression_midi_blocking(
    chords: &[PlayableChord],
    bpm: f32,
    beats_per_chord: f32,
    channel: u8,
    output_port_index: usize,
) -> Result<()> {
    if chords.is_empty() {
        return Err(SsAudioError::InvalidConfig(
            "progression must have at least one chord".to_string(),
        ));
    }
    if bpm <= 0.0 || beats_per_chord <= 0.0 {
        return Err(SsAudioError::InvalidConfig(
            "bpm and beats_per_chord must be > 0".to_string(),
        ));
    }

    let status_channel = validate_midi_channel(channel)?;
    let mut conn = connect_midi_output(output_port_index)?;
    let chord_duration = Duration::from_secs_f32((60.0 / bpm) * beats_per_chord);

    for chord in chords {
        note_on_all(&mut conn, status_channel, &chord.midi_notes)?;
        std::thread::sleep(chord_duration);
        note_off_all(&mut conn, status_channel, &chord.midi_notes)?;
    }

    // All Notes Off (CC123) as a guard against hanging notes.
    conn.send(&[0xB0 | status_channel, 123, 0])
        .map_err(|e| SsAudioError::MidiOutput(e.to_string()))?;

    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn default_output_sample_rate() -> Result<u32> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| SsAudioError::AudioOutput("no output device available".to_string()))?;
    let cfg = device
        .default_output_config()
        .map_err(|e| SsAudioError::AudioOutput(e.to_string()))?;
    Ok(cfg.sample_rate().0)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn play_mono_blocking(samples: &[f32], sample_rate: u32) -> Result<()> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| SsAudioError::AudioOutput("no output device available".to_string()))?;

    let supported_config = device
        .default_output_config()
        .map_err(|e| SsAudioError::AudioOutput(e.to_string()))?;
    let channels = supported_config.channels() as usize;

    let mut config = supported_config.config();
    config.sample_rate = cpal::SampleRate(sample_rate);

    let samples = Arc::new(samples.to_vec());
    let data_len = samples.len();
    let err_fn = |err| eprintln!("audio stream error: {err}");

    let stream = match supported_config.sample_format() {
        cpal::SampleFormat::F32 => {
            let samples = Arc::clone(&samples);
            let mut idx: usize = 0;
            device
            .build_output_stream(
                &config,
                move |data: &mut [f32], _| {
                    for frame in data.chunks_mut(channels) {
                        let value = if idx < data_len { samples[idx] } else { 0.0 };
                        idx = idx.saturating_add(1);
                        for sample in frame.iter_mut() {
                            *sample = value;
                        }
                    }
                },
                err_fn,
                None,
            )
            .map_err(|e| SsAudioError::AudioOutput(e.to_string()))?
        }
        cpal::SampleFormat::I16 => {
            let samples = Arc::clone(&samples);
            let mut idx: usize = 0;
            device
            .build_output_stream(
                &config,
                move |data: &mut [i16], _| {
                    for frame in data.chunks_mut(channels) {
                        let value = if idx < data_len { samples[idx] } else { 0.0 };
                        idx = idx.saturating_add(1);
                        let v = (value * i16::MAX as f32) as i16;
                        for sample in frame.iter_mut() {
                            *sample = v;
                        }
                    }
                },
                err_fn,
                None,
            )
            .map_err(|e| SsAudioError::AudioOutput(e.to_string()))?
        }
        cpal::SampleFormat::U16 => {
            let samples = Arc::clone(&samples);
            let mut idx: usize = 0;
            device
            .build_output_stream(
                &config,
                move |data: &mut [u16], _| {
                    for frame in data.chunks_mut(channels) {
                        let value = if idx < data_len { samples[idx] } else { 0.0 };
                        idx = idx.saturating_add(1);
                        let scaled = ((value + 1.0) * 0.5 * u16::MAX as f32) as u16;
                        for sample in frame.iter_mut() {
                            *sample = scaled;
                        }
                    }
                },
                err_fn,
                None,
            )
            .map_err(|e| SsAudioError::AudioOutput(e.to_string()))?
        }
        _ => {
            return Err(SsAudioError::AudioOutput(
                "unsupported output sample format".to_string(),
            ));
        }
    };

    stream
        .play()
        .map_err(|e| SsAudioError::AudioOutput(e.to_string()))?;

    let seconds = samples.len() as f32 / sample_rate as f32;
    std::thread::sleep(std::time::Duration::from_secs_f32(seconds + 0.05));
    drop(stream);
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn write_wav_mono_i16(path: &std::path::Path, sample_rate: u32, samples: &[f32]) -> Result<()> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|e| SsAudioError::WavOutput(e.to_string()))?;

    for sample in samples {
        let v = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        writer
            .write_sample(v)
            .map_err(|e| SsAudioError::WavOutput(e.to_string()))?;
    }

    writer
        .finalize()
        .map_err(|e| SsAudioError::WavOutput(e.to_string()))?;
    Ok(())
}

fn validate_config(config: &SynthConfig) -> Result<()> {
    if config.sample_rate == 0 {
        return Err(SsAudioError::InvalidConfig(
            "sample_rate must be > 0".to_string(),
        ));
    }
    if config.bpm <= 0.0 {
        return Err(SsAudioError::InvalidConfig("bpm must be > 0".to_string()));
    }
    if config.beats_per_chord <= 0.0 {
        return Err(SsAudioError::InvalidConfig(
            "beats_per_chord must be > 0".to_string(),
        ));
    }
    Ok(())
}

fn envelope(i: usize, total: usize, attack_s: f32, release_s: f32, sample_rate: f32) -> f32 {
    let attack = (attack_s.max(0.0) * sample_rate) as usize;
    let release = (release_s.max(0.0) * sample_rate) as usize;

    if attack > 0 && i < attack {
        return i as f32 / attack as f32;
    }

    if release > 0 && i >= total.saturating_sub(release) {
        let remain = total.saturating_sub(i);
        return (remain as f32 / release as f32).clamp(0.0, 1.0);
    }

    1.0
}

fn osc_sample(waveform: Waveform, freq: f32, t: f32) -> f32 {
    let phase = 2.0 * PI * freq * t;
    match waveform {
        Waveform::Sine => phase.sin(),
        Waveform::Square => {
            if phase.sin() >= 0.0 {
                1.0
            } else {
                -1.0
            }
        }
        Waveform::Saw => {
            let x = (freq * t).fract();
            (2.0 * x) - 1.0
        }
        Waveform::Triangle => (2.0 / PI) * phase.sin().asin(),
    }
}

fn midi_to_hz(midi: u8) -> f32 {
    440.0 * 2.0_f32.powf((midi as f32 - 69.0) / 12.0)
}

fn apply_filter_chain(samples: &mut [f32], config: &SynthConfig, sample_rate: f32) {
    let Some(filter) = &config.filter else {
        return;
    };
    if !filter.enabled || filter.cutoff_hz <= 0.0 {
        return;
    }

    // One-pole low-pass. Resonance is reserved for a future biquad implementation.
    let dt = 1.0 / sample_rate;
    let rc = 1.0 / (2.0 * PI * filter.cutoff_hz.max(20.0));
    let alpha = dt / (rc + dt);
    let mut y = 0.0f32;
    for x in samples.iter_mut() {
        y += alpha * (*x - y);
        *x = y;
    }
}

fn apply_effect_chain(samples: &mut [f32], config: &SynthConfig) {
    for effect in &config.effects {
        match effect {
            EffectConfig::Delay {
                mix,
                feedback,
                time_ms,
            } => {
                let delay_samples =
                    ((config.sample_rate as f32 * *time_ms / 1000.0).max(1.0)) as usize;
                if delay_samples >= samples.len() {
                    continue;
                }
                let dry = 1.0 - mix.clamp(0.0, 1.0);
                let wet = mix.clamp(0.0, 1.0);
                let fb = feedback.clamp(0.0, 0.95);

                let mut buffer = vec![0.0f32; delay_samples];
                for (i, x) in samples.iter_mut().enumerate() {
                    let idx = i % delay_samples;
                    let delayed = buffer[idx];
                    let out = (*x * dry) + (delayed * wet);
                    buffer[idx] = *x + (delayed * fb);
                    *x = out.clamp(-1.0, 1.0);
                }
            }
            EffectConfig::Reverb { .. } => {
                // Reserved for future implementation.
            }
        }
    }
}

fn validate_midi_channel(channel_1_to_16: u8) -> Result<u8> {
    if !(1..=16).contains(&channel_1_to_16) {
        return Err(SsAudioError::InvalidConfig(
            "midi channel must be in 1..=16".to_string(),
        ));
    }
    Ok(channel_1_to_16 - 1)
}

#[cfg(not(target_arch = "wasm32"))]
fn connect_midi_output(output_port_index: usize) -> Result<MidiOutputConnection> {
    let midi_out = MidiOutput::new("sonic-saucepan")
        .map_err(|e| SsAudioError::MidiOutput(e.to_string()))?;
    let ports = midi_out.ports();
    let Some(port) = ports.get(output_port_index) else {
        return Err(SsAudioError::MidiOutput(format!(
            "invalid output port index {output_port_index}; available ports: {}",
            ports.len()
        )));
    };

    midi_out
        .connect(port, "ss_cli-midi-out")
        .map_err(|e| SsAudioError::MidiOutput(e.to_string()))
}

#[cfg(not(target_arch = "wasm32"))]
fn note_on_all(conn: &mut MidiOutputConnection, channel: u8, notes: &[u8]) -> Result<()> {
    for note in notes {
        conn.send(&[0x90 | channel, *note, 100])
            .map_err(|e| SsAudioError::MidiOutput(e.to_string()))?;
    }
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
fn note_off_all(conn: &mut MidiOutputConnection, channel: u8, notes: &[u8]) -> Result<()> {
    for note in notes {
        conn.send(&[0x80 | channel, *note, 0])
            .map_err(|e| SsAudioError::MidiOutput(e.to_string()))?;
    }
    Ok(())
}

fn split_root_and_quality(symbol: &str) -> Result<(&str, &str)> {
    let bytes = symbol.as_bytes();
    if bytes.is_empty() {
        return Err(SsAudioError::InvalidChordSymbol(symbol.to_string()));
    }

    let c0 = bytes[0] as char;
    if !matches!(c0, 'A'..='G' | 'a'..='g') {
        return Err(SsAudioError::InvalidChordSymbol(symbol.to_string()));
    }

    let mut root_end = 1usize;
    if bytes.len() > 1 {
        let c1 = bytes[1] as char;
        if c1 == '#' || c1 == 'b' || c1 == 'B' {
            root_end = 2;
        }
    }

    Ok((&symbol[..root_end], &symbol[root_end..]))
}

fn root_to_semitone(root: &str) -> Result<u8> {
    let r = root.to_ascii_uppercase();
    let semitone = match r.as_str() {
        "C" => 0,
        "C#" | "DB" => 1,
        "D" => 2,
        "D#" | "EB" => 3,
        "E" | "FB" => 4,
        "F" | "E#" => 5,
        "F#" | "GB" => 6,
        "G" => 7,
        "G#" | "AB" => 8,
        "A" => 9,
        "A#" | "BB" => 10,
        "B" | "CB" => 11,
        _ => return Err(SsAudioError::InvalidChordSymbol(root.to_string())),
    };
    Ok(semitone)
}

fn quality_to_intervals(quality: &str) -> Result<&'static [u8]> {
    let q = quality.trim().to_ascii_lowercase();
    let intervals: &'static [u8] = match q.as_str() {
        "" | "maj" => &[0, 4, 7],
        "m" | "min" => &[0, 3, 7],
        "5" => &[0, 7],
        "7" => &[0, 4, 7, 10],
        "maj7" => &[0, 4, 7, 11],
        "m7" | "min7" => &[0, 3, 7, 10],
        "dim" => &[0, 3, 6],
        "dim7" => &[0, 3, 6, 9],
        "aug" => &[0, 4, 8],
        "sus2" => &[0, 2, 7],
        "sus4" => &[0, 5, 7],
        "add9" => &[0, 4, 7, 14],
        _ => return Err(SsAudioError::InvalidChordSymbol(quality.to_string())),
    };
    Ok(intervals)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_chord_symbol() {
        let chord = chord_symbol_to_playable("Dm7", 4).expect("Dm7 should parse");
        assert_eq!(chord.midi_notes, vec![62, 65, 69, 72]);
    }

    #[test]
    fn renders_audio_buffer() {
        let chord = chord_symbol_to_playable("Cmaj7", 4).expect("Cmaj7 parse");
        let cfg = SynthConfig {
            bpm: 120.0,
            beats_per_chord: 1.0,
            sample_rate: 8_000,
            ..SynthConfig::default()
        };

        let samples = render_progression_mono(&[chord], &cfg).expect("render");
        assert!(!samples.is_empty());
        assert_eq!(samples.len(), 4_000);
    }

    #[test]
    fn validates_midi_channel_range() {
        assert!(validate_midi_channel(1).is_ok());
        assert!(validate_midi_channel(16).is_ok());
        assert!(validate_midi_channel(0).is_err());
        assert!(validate_midi_channel(17).is_err());
    }
}
