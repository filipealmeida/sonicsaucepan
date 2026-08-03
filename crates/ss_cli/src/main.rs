use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use serde::Deserialize;

use ss_audio::{
    available_midi_output_ports, chord_symbol_to_playable, default_output_sample_rate,
    play_mono_blocking, preset_catalog, render_progression_mono, send_progression_midi_blocking,
    write_wav_mono_i16, EffectConfig, EffectPreset, FilterConfig, PlayableChord, SynthConfig,
    Waveform,
};
use ss_core::music::ChordDefinition;
use ss_core::service::{
    self, CatalogValidationRequest, GraphAddAfterInlineNameRequest, GraphService,
    OrderedCycleRequest, ResolveChordRequest,
};

#[derive(Debug, Parser)]
#[command(name = "ss_cli")]
#[command(about = "Sonic Saucepan command-line tooling")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    ValidateJson {
        #[arg(help = "Path to a chord catalog JSON file")]
        input: PathBuf,
        #[arg(long, default_value_t = false)]
        envelope: bool,
    },
    ResolveChord {
        #[arg(help = "Path to a single ChordDefinition JSON file")]
        chord_file: PathBuf,
        #[arg(long, default_value = "C")]
        central_tone: String,
        #[arg(long, default_value_t = 4)]
        base_octave: i8,
        #[arg(long, default_value_t = false)]
        envelope: bool,
    },
    GraphDemo {
        #[arg(long, default_value_t = 16)]
        max_steps: usize,
    },
    ListPresets,
    Perform {
        #[arg(long, help = "Progression file path containing chord definitions")]
        progression_file: Option<PathBuf>,
        #[arg(long, help = "Comma-separated chord symbols, e.g. Cmaj7,Dm7,G7")]
        chords: Option<String>,
        #[arg(long, default_value = "C")]
        central_tone: String,
        #[arg(long, default_value_t = 4)]
        base_octave: i8,
        #[arg(long, default_value_t = 120.0)]
        bpm: f32,
        #[arg(long, default_value_t = 4.0)]
        beats_per_chord: f32,
        #[arg(long, default_value_t = 1, help = "How many times to repeat the progression")]
        loops: u32,
        #[arg(long, value_enum, default_value_t = CliWaveform::Sine)]
        waveform: CliWaveform,
        #[arg(long, default_value_t = 0.2)]
        gain: f32,
        #[arg(long, value_enum, help = "Select a built-in synthesis preset")]
        preset: Option<CliPreset>,
        #[arg(long, help = "Optional low-pass cutoff in Hz")]
        lowpass_cutoff_hz: Option<f32>,
        #[arg(long, help = "Optional delay wet mix [0..1]")]
        delay_mix: Option<f32>,
        #[arg(long, default_value_t = 280.0, help = "Delay time in milliseconds")]
        delay_time_ms: f32,
        #[arg(long, default_value_t = 0.35, help = "Delay feedback [0..1)")]
        delay_feedback: f32,
        #[arg(long, allow_hyphen_values = true, help = "Enable compression with threshold in dB (e.g. -18)")]
        compression_threshold_db: Option<f32>,
        #[arg(long, default_value_t = 3.0, help = "Compressor ratio")]
        compression_ratio: f32,
        #[arg(long, default_value_t = 0.0, help = "Compressor makeup gain in dB")]
        compression_makeup_db: f32,
        #[arg(long, help = "Enable distortion with drive amount")]
        distortion_drive: Option<f32>,
        #[arg(long, default_value_t = 0.4, help = "Distortion wet mix [0..1]")]
        distortion_mix: f32,
        #[arg(long, help = "Enable phase effect with wet mix [0..1]")]
        phase_mix: Option<f32>,
        #[arg(long, default_value_t = 0.35, help = "Phase LFO rate in Hz")]
        phase_rate_hz: f32,
        #[arg(long, default_value_t = 0.7, help = "Phase depth [0..1]")]
        phase_depth: f32,
        #[arg(long, default_value_t = 0.2, help = "Phase feedback [-1..1]")]
        phase_feedback: f32,
        #[arg(long, help = "Enable chorus with wet mix [0..1]")]
        chorus_mix: Option<f32>,
        #[arg(long, default_value_t = 0.8, help = "Chorus LFO rate in Hz")]
        chorus_rate_hz: f32,
        #[arg(long, default_value_t = 8.0, help = "Chorus depth in milliseconds")]
        chorus_depth_ms: f32,
        #[arg(long, help = "Enable reverb with wet mix [0..1]")]
        reverb_mix: Option<f32>,
        #[arg(long, default_value_t = 0.7, help = "Reverb room size [0..1]")]
        reverb_room_size: f32,
        #[arg(long, help = "Optional output WAV path")]
        output_wav: Option<PathBuf>,
        #[arg(long, help = "Optional MIDI output port index")]
        midi_out_port: Option<usize>,
        #[arg(long, default_value_t = 1, help = "MIDI output channel (1-16)")]
        midi_channel: u8,
        #[arg(long, default_value_t = false, help = "Render only; do not play audio")]
        no_play: bool,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum CliWaveform {
    Sine,
    Square,
    Saw,
    Triangle,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum CliPreset {
    Clean,
    #[value(alias = "warm-pad", alias = "warmpad")]
    WarmPad,
    #[value(alias = "ambient-wash", alias = "ambientwash")]
    AmbientWash,
    #[value(alias = "lofi-drive", alias = "lofi", alias = "lofidrive")]
    LofiDrive,
    #[value(alias = "club-punch", alias = "clubpunch")]
    ClubPunch,
    #[value(alias = "space-echo", alias = "spaceecho")]
    SpaceEcho,
    #[value(alias = "dream-chorus", alias = "dreamchorus")]
    DreamChorus,
}

impl From<CliPreset> for EffectPreset {
    fn from(value: CliPreset) -> Self {
        match value {
            CliPreset::Clean => EffectPreset::Clean,
            CliPreset::WarmPad => EffectPreset::WarmPad,
            CliPreset::AmbientWash => EffectPreset::AmbientWash,
            CliPreset::LofiDrive => EffectPreset::LofiDrive,
            CliPreset::ClubPunch => EffectPreset::ClubPunch,
            CliPreset::SpaceEcho => EffectPreset::SpaceEcho,
            CliPreset::DreamChorus => EffectPreset::DreamChorus,
        }
    }
}

impl From<CliWaveform> for Waveform {
    fn from(value: CliWaveform) -> Self {
        match value {
            CliWaveform::Sine => Waveform::Sine,
            CliWaveform::Square => Waveform::Square,
            CliWaveform::Saw => Waveform::Saw,
            CliWaveform::Triangle => Waveform::Triangle,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ProgressionFileInput {
    Bare(Vec<ProgressionEntry>),
    WithMeta(ProgressionDocument),
}

#[derive(Debug, Deserialize)]
struct ProgressionDocument {
    central_tone: Option<String>,
    base_octave: Option<i8>,
    beats_per_chord: Option<f32>,
    chords: Vec<ProgressionEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ProgressionEntry {
    Symbol(String),
    Definition(ChordDefinition),
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::ValidateJson { input, envelope } => cmd_validate_json(input, envelope),
        Commands::ResolveChord {
            chord_file,
            central_tone,
            base_octave,
            envelope,
        } => cmd_resolve_chord(chord_file, central_tone, base_octave, envelope),
        Commands::GraphDemo { max_steps } => cmd_graph_demo(max_steps),
        Commands::ListPresets => cmd_list_presets(),
        Commands::Perform {
            progression_file,
            chords,
            central_tone,
            base_octave,
            bpm,
            beats_per_chord,
            loops,
            waveform,
            gain,
            preset,
            lowpass_cutoff_hz,
            delay_mix,
            delay_time_ms,
            delay_feedback,
            compression_threshold_db,
            compression_ratio,
            compression_makeup_db,
            distortion_drive,
            distortion_mix,
            phase_mix,
            phase_rate_hz,
            phase_depth,
            phase_feedback,
            chorus_mix,
            chorus_rate_hz,
            chorus_depth_ms,
            reverb_mix,
            reverb_room_size,
            output_wav,
            midi_out_port,
            midi_channel,
            no_play,
        } => cmd_perform(
            progression_file,
            chords,
            central_tone,
            base_octave,
            bpm,
            beats_per_chord,
            loops,
            waveform,
            gain,
            preset,
            lowpass_cutoff_hz,
            delay_mix,
            delay_time_ms,
            delay_feedback,
            compression_threshold_db,
            compression_ratio,
            compression_makeup_db,
            distortion_drive,
            distortion_mix,
            phase_mix,
            phase_rate_hz,
            phase_depth,
            phase_feedback,
            chorus_mix,
            chorus_rate_hz,
            chorus_depth_ms,
            reverb_mix,
            reverb_room_size,
            output_wav,
            midi_out_port,
            midi_channel,
            no_play,
        ),
    }
}

fn cmd_validate_json(input: PathBuf, envelope: bool) -> Result<()> {
    let raw = fs::read_to_string(&input)
        .with_context(|| format!("failed reading catalog file: {}", input.display()))?;
    let request = CatalogValidationRequest { json: raw };
    let response = service::validate_catalog(&request)
        .with_context(|| format!("catalog validation failed for {}", input.display()))?;

    if envelope {
        let env = service::validate_catalog_enveloped(&request)
            .with_context(|| format!("catalog validation failed for {}", input.display()))?;
        println!("{}", serde_json::to_string_pretty(&env)?);
        return Ok(());
    }

    println!(
        "ok: validated {} families from {}",
        response.family_count,
        input.display()
    );

    Ok(())
}

fn cmd_list_presets() -> Result<()> {
    println!("Available presets:");
    for (_preset, name, description) in preset_catalog() {
        println!("- {name}: {description}");
    }
    Ok(())
}

fn cmd_resolve_chord(
    chord_file: PathBuf,
    central_tone: String,
    base_octave: i8,
    envelope: bool,
) -> Result<()> {
    let raw = fs::read_to_string(&chord_file)
        .with_context(|| format!("failed reading chord file: {}", chord_file.display()))?;
    let request = ResolveChordRequest {
        chord_json: raw,
        central_tone,
        base_octave,
    };

    if envelope {
        let env = service::resolve_chord_request_enveloped(&request)
            .context("chord resolution failed")?;
        println!("{}", serde_json::to_string_pretty(&env)?);
        return Ok(());
    }

    let response = service::resolve_chord_request(&request)
        .context("chord resolution failed")?;

    println!("{}", serde_json::to_string_pretty(&response.resolved)?);
    Ok(())
}

fn cmd_graph_demo(max_steps: usize) -> Result<()> {
    let mut graph = GraphService::new("Cmaj7".to_string());
    let n1 = graph
        .add_after_inline_name_request(GraphAddAfterInlineNameRequest {
            after_id: 0,
            chord_name: "Am7".to_string(),
        })
        .context("failed to add Am7")?;
    let _n2 = graph
        .add_after_inline_name_request(GraphAddAfterInlineNameRequest {
            after_id: n1.new_id,
            chord_name: "Dm7".to_string(),
        })
        .context("failed to add Dm7")?;
    let _n3 = graph
        .add_after_inline_name_request(GraphAddAfterInlineNameRequest {
            after_id: _n2.new_id,
            chord_name: "G7".to_string(),
        })
        .context("failed to add G7")?;

    println!("graph:");
    println!("{}", serde_json::to_string_pretty(graph.graph())?);
    println!(
        "cycle: {:?}",
        graph
            .ordered_cycle_request(OrderedCycleRequest { max_steps })?
            .node_ids
    );

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn cmd_perform(
    progression_file: Option<PathBuf>,
    chords: Option<String>,
    central_tone: String,
    base_octave: i8,
    bpm: f32,
    beats_per_chord: f32,
    loops: u32,
    waveform: CliWaveform,
    gain: f32,
    preset: Option<CliPreset>,
    lowpass_cutoff_hz: Option<f32>,
    delay_mix: Option<f32>,
    delay_time_ms: f32,
    delay_feedback: f32,
    compression_threshold_db: Option<f32>,
    compression_ratio: f32,
    compression_makeup_db: f32,
    distortion_drive: Option<f32>,
    distortion_mix: f32,
    phase_mix: Option<f32>,
    phase_rate_hz: f32,
    phase_depth: f32,
    phase_feedback: f32,
    chorus_mix: Option<f32>,
    chorus_rate_hz: f32,
    chorus_depth_ms: f32,
    reverb_mix: Option<f32>,
    reverb_room_size: f32,
    output_wav: Option<PathBuf>,
    midi_out_port: Option<usize>,
    midi_channel: u8,
    no_play: bool,
) -> Result<()> {
    let mut effective_central = central_tone;
    let mut effective_octave = base_octave;
    let mut effective_beats_per_chord = beats_per_chord;
    let mut progression: Vec<PlayableChord> = Vec::new();

    if let Some(path) = progression_file {
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("failed reading progression file: {}", path.display()))?;

        let parsed: ProgressionFileInput = serde_json::from_str(&raw)
            .with_context(|| format!("failed parsing progression JSON: {}", path.display()))?;

        let entries = match parsed {
            ProgressionFileInput::Bare(entries) => entries,
            ProgressionFileInput::WithMeta(doc) => {
                if let Some(ct) = doc.central_tone {
                    effective_central = ct;
                }
                if let Some(bo) = doc.base_octave {
                    effective_octave = bo;
                }
                if let Some(bpc) = doc.beats_per_chord {
                    effective_beats_per_chord = bpc;
                }
                doc.chords
            }
        };

        progression.extend(resolve_entries(
            entries,
            &effective_central,
            effective_octave,
        )?);
    }

    if let Some(chord_csv) = chords {
        let symbols = chord_csv
            .split(',')
            .map(str::trim)
            .filter(|x| !x.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();

        for symbol in symbols {
            let chord = chord_symbol_to_playable(&symbol, effective_octave)
                .with_context(|| format!("failed to parse chord symbol: {symbol}"))?;
            progression.push(chord);
        }
    }

    if progression.is_empty() {
        anyhow::bail!(
            "no chords provided. Use --progression-file, --chords, or both"
        );
    }

    if loops == 0 {
        anyhow::bail!("--loops must be >= 1");
    }

    let mut repeated = Vec::with_capacity(progression.len() * loops as usize);
    for _ in 0..loops {
        repeated.extend(progression.iter().cloned());
    }

    let mut effects = Vec::new();
    if let Some(preset) = preset.map(EffectPreset::from) {
        effects.extend(preset.effects());
    }
    if let Some(threshold_db) = compression_threshold_db {
        effects.push(EffectConfig::Compression {
            threshold_db,
            ratio: compression_ratio,
            makeup_gain_db: compression_makeup_db,
        });
    }
    if let Some(drive) = distortion_drive {
        effects.push(EffectConfig::Distortion {
            drive,
            mix: distortion_mix,
        });
    }
    if let Some(mix) = phase_mix {
        effects.push(EffectConfig::Phase {
            rate_hz: phase_rate_hz,
            depth: phase_depth,
            mix,
            feedback: phase_feedback,
        });
    }
    if let Some(mix) = chorus_mix {
        effects.push(EffectConfig::Chorus {
            rate_hz: chorus_rate_hz,
            depth_ms: chorus_depth_ms,
            mix,
        });
    }
    if let Some(mix) = delay_mix {
        effects.push(EffectConfig::Delay {
            mix,
            feedback: delay_feedback,
            time_ms: delay_time_ms,
        });
    }
    if let Some(mix) = reverb_mix {
        effects.push(EffectConfig::Reverb {
            mix,
            room_size: reverb_room_size,
        });
    }

    let filter = lowpass_cutoff_hz.map(|cutoff_hz| FilterConfig {
        enabled: true,
        cutoff_hz,
        resonance: 0.0,
    });

    let mut base_cfg = SynthConfig::default();
    if let Some(preset) = preset.map(EffectPreset::from) {
        preset.apply_to_config(&mut base_cfg);
    }
    base_cfg.sample_rate = 44_100;
    base_cfg.bpm = bpm;
    base_cfg.beats_per_chord = effective_beats_per_chord;
    base_cfg.master_gain = gain;
    base_cfg.waveform = waveform.into();
    if let Some(filter) = filter {
        base_cfg.filter = Some(filter);
    }
    base_cfg.effects = effects;

    if let Some(path) = &output_wav {
        let samples = render_progression_mono(&repeated, &base_cfg)
            .context("failed to render audio for wav")?;
        write_wav_mono_i16(path, base_cfg.sample_rate, &samples)
            .with_context(|| format!("failed writing wav file: {}", path.display()))?;
        println!(
            "wrote wav {} ({} samples @ {} Hz, loops={})",
            path.display(),
            samples.len(),
            base_cfg.sample_rate,
            loops
        );
    }

    if let Some(port_index) = midi_out_port {
        send_progression_midi_blocking(
            &repeated,
            base_cfg.bpm,
            base_cfg.beats_per_chord,
            midi_channel,
            port_index,
        )
        .with_context(|| {
            let known_ports = available_midi_output_ports()
                .map(|ports| {
                    if ports.is_empty() {
                        "none".to_string()
                    } else {
                        ports
                            .into_iter()
                            .enumerate()
                            .map(|(i, n)| format!("{i}:{n}"))
                            .collect::<Vec<_>>()
                            .join(", ")
                    }
                })
                .unwrap_or_else(|_| "unknown".to_string());
            format!(
                "failed to send midi (port={}, channel={}); available ports: {}",
                port_index, midi_channel, known_ports
            )
        })?;

        println!(
            "sent midi for {} chords on port {} channel {}",
            repeated.len(),
            port_index,
            midi_channel
        );
    }

    if !no_play {
        let play_sr = default_output_sample_rate().context("failed to get output sample rate")?;
        let mut play_cfg = base_cfg.clone();
        play_cfg.sample_rate = play_sr;
        let samples = render_progression_mono(&repeated, &play_cfg)
            .context("failed to render audio for realtime playback")?;
        println!(
            "playing {} chords via default audio output at {} Hz (loops={})",
            repeated.len(),
            play_sr,
            loops
        );
        play_mono_blocking(&samples, play_sr).context("audio playback failed")?;
    }

    Ok(())
}

fn resolve_entries(
    entries: Vec<ProgressionEntry>,
    central_tone: &str,
    base_octave: i8,
) -> Result<Vec<PlayableChord>> {
    let mut out = Vec::with_capacity(entries.len());

    for entry in entries {
        match entry {
            ProgressionEntry::Symbol(symbol) => {
                let chord = chord_symbol_to_playable(&symbol, base_octave)
                    .with_context(|| format!("failed to parse chord symbol: {symbol}"))?;
                out.push(chord);
            }
            ProgressionEntry::Definition(def) => {
                let def_json = serde_json::to_string(&def)?;
                let response = service::resolve_chord_request(&ResolveChordRequest {
                    chord_json: def_json,
                    central_tone: central_tone.to_string(),
                    base_octave,
                })
                .context("failed to resolve chord definition in progression file")?;

                out.push(PlayableChord {
                    name: response.resolved.full_name,
                    midi_notes: response.resolved.midi_notes,
                });
            }
        }
    }

    Ok(out)
}
