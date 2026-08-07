import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { createStore } from "zustand/vanilla";
import catalogJson from "../../assets/chords/chord_strategy_A1.json";
import { NativeMidi } from "./plugins/native-midi";
import "./styles.css";

type ChordEntry = {
  numeral?: string;
  full_name: string;
  intervals?: Array<number | string>;
  root?: string | null;
  tones?: string[];
};

type ChordFamily = {
  name: string;
  chords: ChordEntry[];
};

type ChordCatalog = {
  families: ChordFamily[];
};

type GraphNodeType = "chord-selection";

type CustomChordInputKind = "tones" | "midi";

type GraphNodeAction = "add-after" | "remove-selected" | "cycle-selection";

type GraphNodeRenderStyle = {
  edgeStroke: string;
  edgeArrowFill: string;
  returnStroke: string;
  returnArrowFill: string;
  nodeStroke: string;
  headNodeStroke: string;
  nodeTextFill: string;
};

type GraphNodeTypeConfig = {
  label: string;
  icon: string;
  allowedActions: GraphNodeAction[];
  actionSymbols: {
    add: string;
    remove: string;
  };
  renderStyle: GraphNodeRenderStyle;
};

type GraphNode = {
  id: number;
  type: GraphNodeType;
  chordName: string;
  beatsPerChordOverride?: number | null;
  muted?: boolean;
  waveformOverride?: WaveformOption | null;
  effectsOverride?: EffectOption | null;
  bassPresetOverride?: BassPresetOption | null;
  customChordEnabled?: boolean;
  customChordInputKind?: CustomChordInputKind;
  customChordRawInput?: string;
  customChordTransposeWithCentralTone?: boolean;
  nextId: number;
};

type LoopGraph = {
  headId: number;
  headIds?: number[];
  selectedNodeId: number;
  nextNodeId: number;
  nodes: Record<number, GraphNode>;
};

type SavedLoopRecord = {
  id: string;
  name: string;
  graph: LoopGraph;
  selectedFamilyIndex: number;
  selectedChordIndex: number;
  chordFanVisible: boolean;
  sceneZoom: number;
  scenePan: { x: number; y: number };
  nodeOffsets: Record<number, { x: number; y: number }>;
  settings: {
    centralTone: string;
    bpm: number;
    timeSignature: TimeSignatureOption;
    beatsPerChord: number;
    swing: number;
    humanizeAmount: number;
    accentStrength: number;
    layerWidth: number;
    waveform: WaveformOption;
    effects: EffectOption;
    bassPreset: BassPresetOption;
    midiEnabled: boolean;
    midiPortId: string;
    midiChannel: number;
    debugFooterEnabled: boolean;
  };
  updatedAt: string;
};

type AppState = {
  catalog: ChordCatalog;
  selectedFamilyIndex: number;
  selectedChordIndex: number;
  chordFanVisible: boolean;
  showSelectedRomanNumeral: boolean;
  nodeTimingModalNodeId: number | null;
  graph: LoopGraph;
  settings: AppSettings;
  savedLoops: SavedLoopRecord[];
  savedLoopDraft: string;
  savedLoopSelectedId: string | null;
  savedLoopsPage: number;
  debugInput: string;
  debugLogs: string[];
  status: string;
};

type WaveformOption = "sine" | "square" | "sawtooth" | "triangle";

type TimeSignatureOption = "4/4" | "3/4" | "6/8";

type EffectOption = "none" | "delay" | "chorus";

type BassPresetOption = "off" | "root" | "root-octave" | "root-fifth" | "oom-pah" | "stride";

type MidiPortOption = {
  id: string;
  name: string;
};

type AppSettings = {
  showPanel: boolean;
  showPerformPanel: boolean;
  showSavedLoopsPanel: boolean;
  showNodeTimingPanel: boolean;
  debugFooterEnabled: boolean;
  alwaysPlayChords: boolean;
  centralTone: string;
  bpm: number;
  timeSignature: TimeSignatureOption;
  beatsPerChord: number;
  swing: number;
  humanizeAmount: number;
  accentStrength: number;
  layerWidth: number;
  waveform: WaveformOption;
  effects: EffectOption;
  bassPreset: BassPresetOption;
  midiEnabled: boolean;
  midiPortId: string;
  midiChannel: number;
  midiPorts: MidiPortOption[];
};

type EnvelopeParams = {
  attackSec: number;
  decaySec: number;
  sustainLevel: number;
  releaseSec: number;
};

type StageLayout = {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  chordInner: number;
  chordOuter: number;
  majorInner: number;
  majorOuter: number;
  centerRadius: number;
  familyInner: number;
  familyOuter: number;
  addX: number;
  addY: number;
  removeX: number;
  removeY: number;
  actionRadius: number;
};

type HitZone =
  | { kind: "chord"; index: number; cx: number; cy: number; segment: Segment }
  | { kind: "family"; index: number; cx: number; cy: number; segment: Segment }
  | { kind: "graph-node"; nodeId: number; cx: number; cy: number; radius: number }
  | { kind: "add"; cx: number; cy: number; radius: number }
  | { kind: "remove"; cx: number; cy: number; radius: number }
  | { kind: "center"; cx: number; cy: number; radius: number };

type Segment = {
  start: number;
  end: number;
  inner: number;
  outer: number;
};

type SceneGeometry = {
  chordSegments: Segment[];
  familySegments: Segment[];
  familyIndices: number[];
  selectedFamilySegmentIndex: number;
  majorBand: Segment;
};

const STORAGE_KEY = "sonic-saucepan-session-graph-v1";
const SETTINGS_STORAGE_KEY = "sonic-saucepan-settings-v1";
const INTERACTION_STORAGE_KEY = "sonic-saucepan-interaction-v1";
const SAVED_LOOPS_STORAGE_KEY = "sonic-saucepan-saved-loops-v1";
const SAVED_LOOPS_PAGE_SIZE = 8;
const MAX_SEGMENTS = 16;
const CATALOG_TEMPLATE = catalogJson as ChordCatalog;
const CENTRAL_TONES = [
  "A",
  "A#",
  "Bb",
  "B",
  "B#",
  "Cb",
  "C",
  "C#",
  "Db",
  "D",
  "D#",
  "Eb",
  "E",
  "E#",
  "Fb",
  "F",
  "F#",
  "Gb",
  "G",
  "G#",
  "Ab",
] as const;
const WAVEFORMS: WaveformOption[] = ["sine", "triangle", "sawtooth", "square"];
const TIME_SIGNATURES: TimeSignatureOption[] = ["4/4", "3/4", "6/8"];
const EFFECT_OPTIONS: EffectOption[] = ["none", "delay", "chorus"];
const BASS_PRESET_OPTIONS: BassPresetOption[] = ["off", "root", "root-octave", "root-fifth", "oom-pah", "stride"];
const BASS_PRESET_LABELS: Record<BassPresetOption, string> = {
  off: "Off",
  root: "Root",
  "root-octave": "Root + Octave",
  "root-fifth": "Root + Fifth",
  "oom-pah": "Oom-pah",
  stride: "Stride",
};
const MAX_DEBUG_LOGS = 220;
const CHORD_ENVELOPE: EnvelopeParams = {
  attackSec: 0.016,
  decaySec: 0.09,
  sustainLevel: 0.72,
  releaseSec: 0.11,
};
const BASS_ENVELOPE: EnvelopeParams = {
  attackSec: 0.008,
  decaySec: 0.08,
  sustainLevel: 0.64,
  releaseSec: 0.095,
};
const HUMANIZE_ONSET_SEC = 0.004;
const HUMANIZE_DETUNE_CENTS = 3.5;
const CHORD_UNISON_DETUNE_CENTS = 7;

type SynthLayer = {
  waveform: OscillatorType;
  gain: number;
  detuneCents: number;
};

const GRAPH_NODE_TYPE_REGISTRY: Record<GraphNodeType, GraphNodeTypeConfig> = {
  "chord-selection": {
    label: "Chord Selection",
    icon: "C",
    allowedActions: ["add-after", "remove-selected", "cycle-selection"],
    actionSymbols: {
      add: "+",
      remove: "-",
    },
    renderStyle: {
      edgeStroke: "rgba(122, 204, 255, 0.88)",
      edgeArrowFill: "rgba(160, 223, 255, 0.96)",
      returnStroke: "rgba(255, 210, 126, 0.96)",
      returnArrowFill: "rgba(255, 209, 130, 0.98)",
      nodeStroke: "rgba(106, 165, 255, 0.78)",
      headNodeStroke: "rgba(255, 210, 130, 0.9)",
      nodeTextFill: "rgba(149, 198, 255, 0.95)",
    },
  },
};

type MidiOutputLike = {
  id: string;
  name?: string | null;
  send: (data: number[]) => void;
};

type MidiAccessLike = {
  outputs?: {
    get?: (id: string) => MidiOutputLike | undefined;
    forEach?: (callback: (value: MidiOutputLike) => void) => void;
    values?: () => IterableIterator<MidiOutputLike>;
  };
  onstatechange: ((event: unknown) => void) | null;
};

type MidiRequestOptions = {
  sysex?: boolean;
};

type MidiBackend = "web" | "native";

const WEB_MIDI_UNAVAILABLE_STATUS = "Web MIDI unavailable. In Firefox on Linux, enable dom.webmidi.enabled in about:config and reload.";
const NATIVE_MIDI_UNAVAILABLE_STATUS = "Native Android MIDI unavailable on this device.";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Expected #app container");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function randomCentered(amount: number): number {
  return (Math.random() * 2 - 1) * amount;
}

function computeAccent(beatWithinChord: number, stepsPerChord: number, strengthPercent: number): number {
  let baseAccent = 1;
  if (beatWithinChord > 0) {
    const midpoint = Math.max(1, Math.floor(stepsPerChord / 2));
    baseAccent = stepsPerChord >= 4 && beatWithinChord === midpoint ? 0.86 : 0.76;
  }
  const strength = clamp(strengthPercent / 100, 0, 1.5);
  return 1 - (1 - baseAccent) * strength;
}

function scheduleAdsrEnvelope(
  gainParam: AudioParam,
  startTime: number,
  noteDurationSec: number,
  peak: number,
  envelope: EnvelopeParams,
): void {
  const duration = Math.max(0.04, noteDurationSec);
  const attackEnd = startTime + Math.min(envelope.attackSec, duration * 0.35);
  const decayEnd = Math.min(attackEnd + envelope.decaySec, startTime + duration * 0.72);
  const sustainValue = Math.max(0.0001, peak * clamp(envelope.sustainLevel, 0, 1));
  const releaseStart = Math.max(decayEnd, startTime + duration - envelope.releaseSec);
  const releaseEnd = startTime + duration;

  gainParam.setValueAtTime(0.0001, startTime);
  gainParam.linearRampToValueAtTime(Math.max(0.0002, peak), attackEnd);
  gainParam.linearRampToValueAtTime(sustainValue, decayEnd);
  gainParam.setValueAtTime(sustainValue, releaseStart);
  gainParam.exponentialRampToValueAtTime(0.0001, releaseEnd);
}

function chordLayersForWaveform(waveform: WaveformOption, chorusDepthCents: number, widthPercent: number): SynthLayer[] {
  const widthScale = clamp(widthPercent / 100, 0, 1.6);
  const base: SynthLayer = { waveform, gain: 0.56, detuneCents: 0 };
  return [
    base,
    { waveform, gain: 0.21, detuneCents: (CHORD_UNISON_DETUNE_CENTS + chorusDepthCents) * widthScale },
    { waveform, gain: 0.21, detuneCents: (-CHORD_UNISON_DETUNE_CENTS - chorusDepthCents) * widthScale },
    { waveform: "triangle", gain: 0.14, detuneCents: 0 },
  ];
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  const mod = index % length;
  return mod < 0 ? mod + length : mod;
}

function createInitialGraph(initialChord: string): LoopGraph {
  return {
    headId: 0,
    headIds: [0],
    selectedNodeId: 0,
    nextNodeId: 1,
    nodes: {
      0: {
        id: 0,
        type: "chord-selection",
        chordName: initialChord,
        beatsPerChordOverride: null,
        muted: false,
        waveformOverride: null,
        effectsOverride: null,
        bassPresetOverride: null,
        customChordEnabled: false,
        customChordInputKind: "tones",
        customChordRawInput: "",
        customChordTransposeWithCentralTone: false,
        nextId: 0,
      },
    },
  };
}

function graphNodeTypeConfig(type: GraphNodeType): GraphNodeTypeConfig {
  return GRAPH_NODE_TYPE_REGISTRY[type];
}

function graphNodeTypeAllowsAction(type: GraphNodeType, action: GraphNodeAction): boolean {
  return graphNodeTypeConfig(type).allowedActions.includes(action);
}

function selectedGraphNode(state: AppState): GraphNode | null {
  return state.graph.nodes[state.graph.selectedNodeId] ?? null;
}

function selectedNodeAllowsAction(state: AppState, action: GraphNodeAction): boolean {
  const node = selectedGraphNode(state);
  if (!node) {
    return false;
  }
  if (action === "remove-selected") {
    const nodeCount = graphSequence(state.graph).length;
    if (nodeCount <= 1) {
      return false;
    }
  }
  return graphNodeTypeAllowsAction(node.type, action);
}

function selectedNodeActionSymbols(state: AppState): { add: string; remove: string } | null {
  const node = selectedGraphNode(state);
  if (!node) {
    return null;
  }
  return graphNodeTypeConfig(node.type).actionSymbols;
}

function graphHeadIds(graph: LoopGraph): number[] {
  const heads: number[] = [];
  const seen = new Set<number>();
  const pushHead = (value: unknown): void => {
    const id = Number(value);
    if (!Number.isFinite(id) || seen.has(id) || !graph.nodes[id]) {
      return;
    }
    seen.add(id);
    heads.push(id);
  };

  if (Array.isArray(graph.headIds)) {
    graph.headIds.forEach((id) => pushHead(id));
  }
  pushHead(graph.headId);

  if (heads.length === 0) {
    const fallback = Object.keys(graph.nodes)
      .map((value) => Number(value))
      .find((id) => Number.isFinite(id) && !!graph.nodes[id]);
    if (fallback !== undefined) {
      heads.push(fallback);
    }
  }

  return heads;
}

function normalizeGraphHeads(graph: LoopGraph): LoopGraph {
  const heads = graphHeadIds(graph);
  return {
    ...graph,
    headId: heads[0] ?? graph.headId,
    headIds: heads,
  };
}

function collectReachableNodeIds(graph: LoopGraph, startId: number, maxSteps = 2048): Set<number> {
  const reachable = new Set<number>();
  let cursor = startId;
  for (let step = 0; step < maxSteps; step += 1) {
    const node = graph.nodes[cursor];
    if (!node || reachable.has(node.id)) {
      break;
    }
    reachable.add(node.id);
    cursor = node.nextId;
  }
  return reachable;
}

function setNodeAsGraphHead(graph: LoopGraph, nodeId: number): LoopGraph {
  if (!graph.nodes[nodeId]) {
    return graph;
  }

  const currentHeads = graphHeadIds(graph);
  const nextHeads: number[] = [];
  let replaced = false;

  currentHeads.forEach((headId) => {
    const reachable = collectReachableNodeIds(graph, headId);
    if (reachable.has(nodeId)) {
      if (!replaced) {
        nextHeads.push(nodeId);
        replaced = true;
      }
      return;
    }
    nextHeads.push(headId);
  });

  if (!replaced) {
    nextHeads.push(nodeId);
  }

  const normalizedHeads = Array.from(new Set(nextHeads)).filter((id) => !!graph.nodes[id]);
  const fallbackHead = normalizedHeads[0] ?? nodeId;

  return normalizeGraphHeads({
    ...graph,
    headId: fallbackHead,
    headIds: normalizedHeads.length > 0 ? normalizedHeads : [fallbackHead],
  });
}

function sanitizeLoopGraph(graph: Partial<LoopGraph> | null | undefined): LoopGraph | null {
  if (!graph || !graph.nodes || typeof graph.nodes !== "object") {
    return null;
  }

  const normalizedNodes: Record<number, GraphNode> = {};
  let maxNodeId = -1;

  for (const [nodeIdText, rawNode] of Object.entries(graph.nodes)) {
    const nodeId = Number(nodeIdText);
    if (!Number.isFinite(nodeId)) {
      continue;
    }

    const sourceNode = rawNode as Partial<GraphNode> | undefined;
    const nextId = Number(sourceNode?.nextId);
    normalizedNodes[nodeId] = {
      id: nodeId,
      type: sourceNode?.type === "chord-selection" ? "chord-selection" : "chord-selection",
      chordName:
        typeof sourceNode?.chordName === "string" && sourceNode.chordName.trim().length > 0
          ? sourceNode.chordName
          : "Cmaj7add9",
      beatsPerChordOverride: sourceNode?.beatsPerChordOverride ?? null,
      muted: sourceNode?.muted === true,
      waveformOverride: sourceNode?.waveformOverride ?? null,
      effectsOverride: sourceNode?.effectsOverride ?? null,
      bassPresetOverride: sourceNode?.bassPresetOverride ?? null,
      customChordEnabled: sourceNode?.customChordEnabled === true,
      customChordInputKind: sourceNode?.customChordInputKind === "midi" ? "midi" : "tones",
      customChordRawInput: typeof sourceNode?.customChordRawInput === "string" ? sourceNode.customChordRawInput : "",
      customChordTransposeWithCentralTone: sourceNode?.customChordTransposeWithCentralTone === true,
      nextId: Number.isFinite(nextId) ? nextId : nodeId,
    };
    maxNodeId = Math.max(maxNodeId, nodeId);
  }

  const nodeIds = Object.keys(normalizedNodes).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (nodeIds.length === 0) {
    return null;
  }

  nodeIds.forEach((nodeId) => {
    const node = normalizedNodes[nodeId];
    if (!node) {
      return;
    }
    if (!normalizedNodes[node.nextId]) {
      node.nextId = node.id;
    }
  });

  const fallbackHead = nodeIds[0];
  const candidateHeadValues = Array.isArray(graph.headIds)
    ? [...graph.headIds, graph.headId]
    : [graph.headId];
  const headIds: number[] = [];
  const seenHeads = new Set<number>();
  candidateHeadValues.forEach((value) => {
    const headId = Number(value);
    if (!Number.isFinite(headId) || seenHeads.has(headId) || !normalizedNodes[headId]) {
      return;
    }
    seenHeads.add(headId);
    headIds.push(headId);
  });
  if (headIds.length === 0) {
    headIds.push(fallbackHead);
  }

  const selectedCandidate = Number(graph.selectedNodeId);
  const selectedNodeId = Number.isFinite(selectedCandidate) && normalizedNodes[selectedCandidate]
    ? selectedCandidate
    : headIds[0];
  const nextNodeCandidate = Number(graph.nextNodeId);
  const nextNodeId = Number.isFinite(nextNodeCandidate)
    ? Math.max(nextNodeCandidate, maxNodeId + 1)
    : maxNodeId + 1;

  return normalizeGraphHeads({
    headId: headIds[0],
    headIds,
    selectedNodeId,
    nextNodeId,
    nodes: normalizedNodes,
  });
}

function graphSequence(graph: LoopGraph, maxSteps = 512): GraphNode[] {
  const output: GraphNode[] = [];
  const visited = new Set<number>();
  let safetySteps = 0;

  const walkFrom = (startId: number): void => {
    let cursor = startId;
    for (let step = 0; step < maxSteps; step += 1) {
      if (safetySteps >= maxSteps * 4) {
        return;
      }
      safetySteps += 1;
      const node = graph.nodes[cursor];
      if (!node || visited.has(node.id)) {
        return;
      }
      output.push(node);
      visited.add(node.id);
      cursor = node.nextId;
    }
  };

  graphHeadIds(graph).forEach((headId) => walkFrom(headId));
  Object.keys(graph.nodes).forEach((key) => {
    const nodeId = Number(key);
    if (!Number.isFinite(nodeId) || visited.has(nodeId)) {
      return;
    }
    walkFrom(nodeId);
  });

  return output;
}

function findPredecessor(graph: LoopGraph, nodeId: number): GraphNode | null {
  for (const node of Object.values(graph.nodes)) {
    if (node.nextId === nodeId) {
      return node;
    }
  }
  return null;
}

function addAfterSelected(graph: LoopGraph, chordName: string): LoopGraph {
  const selected = graph.nodes[graph.selectedNodeId];
  if (!selected) {
    return graph;
  }

  const newId = graph.nextNodeId;
  const nextGraph: LoopGraph = {
    ...graph,
    selectedNodeId: newId,
    nextNodeId: newId + 1,
    nodes: {
      ...graph.nodes,
      [selected.id]: { ...selected, nextId: newId },
      [newId]: {
        id: newId,
        type: selected.type,
        chordName,
        beatsPerChordOverride: selected.beatsPerChordOverride ?? null,
        muted: selected.muted === true,
        waveformOverride: selected.waveformOverride ?? null,
        effectsOverride: selected.effectsOverride ?? null,
        bassPresetOverride: selected.bassPresetOverride ?? null,
        customChordEnabled: selected.customChordEnabled === true,
        customChordInputKind: selected.customChordInputKind === "midi" ? "midi" : "tones",
        customChordRawInput: selected.customChordRawInput ?? "",
        customChordTransposeWithCentralTone: selected.customChordTransposeWithCentralTone === true,
        nextId: selected.nextId,
      },
    },
  };
  return normalizeGraphHeads(nextGraph);
}

function removeSelected(graph: LoopGraph): LoopGraph {
  if (Object.keys(graph.nodes).length <= 1) {
    return graph;
  }

  const target = graph.nodes[graph.selectedNodeId];
  if (!target) {
    return graph;
  }

  const predecessor = findPredecessor(graph, target.id);
  if (!predecessor) {
    return graph;
  }

  const updatedNodes = { ...graph.nodes };
  delete updatedNodes[target.id];
  updatedNodes[predecessor.id] = {
    ...predecessor,
    nextId: target.nextId,
  };

  const currentHeads = graphHeadIds(graph);
  const nextHeads = currentHeads.filter((id) => id !== target.id);
  if (currentHeads.includes(target.id)) {
    const replacementHead = target.nextId;
    if (updatedNodes[replacementHead] && !nextHeads.includes(replacementHead)) {
      nextHeads.push(replacementHead);
    }
  }
  const compactHeads = nextHeads.filter((id) => !!updatedNodes[id]);
  const fallbackHead = compactHeads[0] ?? Number(Object.keys(updatedNodes)[0] ?? 0);

  const nextGraph: LoopGraph = {
    ...graph,
    headId: fallbackHead,
    headIds: compactHeads.length > 0 ? compactHeads : [fallbackHead],
    selectedNodeId: predecessor.id,
    nodes: updatedNodes,
  };
  return normalizeGraphHeads(nextGraph);
}

function nextSelected(graph: LoopGraph): LoopGraph {
  const selected = graph.nodes[graph.selectedNodeId];
  if (!selected) {
    return graph;
  }

  return {
    ...graph,
    selectedNodeId: selected.nextId,
  };
}

function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let current = angle % twoPi;
  if (current < 0) {
    current += twoPi;
  }
  return current;
}

function angleInRange(angle: number, start: number, end: number): boolean {
  const a = normalizeAngle(angle);
  const s = normalizeAngle(start);
  const e = normalizeAngle(end);
  if (s <= e) {
    return a >= s && a <= e;
  }
  return a >= s || a <= e;
}

function pointInRingSegment(point: { x: number; y: number }, zone: { cx: number; cy: number; segment: Segment }): boolean {
  const dx = point.x - zone.cx;
  const dy = point.y - zone.cy;
  const radius = Math.hypot(dx, dy);
  if (radius < zone.segment.inner || radius > zone.segment.outer) {
    return false;
  }
  const angle = Math.atan2(dy, dx);
  return angleInRange(angle, zone.segment.start, zone.segment.end);
}

function describeArcSegment(
  centerX: number,
  centerY: number,
  radius: number,
  angle: number,
): { x: number; y: number } {
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
  };
}

function segmentMidpoint(
  layout: StageLayout,
  segment: Segment,
  centerX = layout.centerX,
  centerY = layout.centerY,
): { x: number; y: number } {
  const angle = (segment.start + segment.end) * 0.5;
  const radius = (segment.inner + segment.outer) * 0.5;
  return describeArcSegment(centerX, centerY, radius, angle);
}

function shorthand(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : "Family";
}

function bandLabel(name: string): string {
  return shorthand(name);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function chordLabel(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "I";
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function initialChordName(catalog: ChordCatalog): string {
  return catalog.families[0]?.chords[0]?.full_name ?? "Cmaj7add9";
}

function findChordInCatalog(
  catalog: ChordCatalog,
  chordName: string,
): { familyIndex: number; chordIndex: number } | null {
  const target = chordName.trim().toLowerCase();
  if (!target) {
    return null;
  }

  for (let familyIndex = 0; familyIndex < catalog.families.length; familyIndex += 1) {
    const family = catalog.families[familyIndex];
    for (let chordIndex = 0; chordIndex < family.chords.length; chordIndex += 1) {
      const chord = family.chords[chordIndex];
      if (chord.full_name.trim().toLowerCase() === target) {
        return { familyIndex, chordIndex };
      }
    }
  }

  return null;
}

function loadSavedGraph(): LoopGraph | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<LoopGraph>;
    const sanitizedGraph = sanitizeLoopGraph(parsed);
    if (!sanitizedGraph) {
      return null;
    }
    const normalizedNodes: Record<number, GraphNode> = {};
    for (const [nodeIdText, node] of Object.entries(sanitizedGraph.nodes)) {
      const nodeId = Number(nodeIdText);
      if (!Number.isFinite(nodeId)) {
        continue;
      }
      normalizedNodes[nodeId] = {
        ...node,
        beatsPerChordOverride: normalizeNodeBeatsOverride(node.beatsPerChordOverride),
        muted: node.muted === true,
        waveformOverride: node.waveformOverride == null ? null : normalizeWaveform(node.waveformOverride),
        effectsOverride: node.effectsOverride == null ? null : normalizeEffects(node.effectsOverride),
        bassPresetOverride: node.bassPresetOverride == null ? null : normalizeBassPreset(node.bassPresetOverride),
        customChordEnabled: node.customChordEnabled === true,
        customChordInputKind: node.customChordInputKind === "midi" ? "midi" : "tones",
        customChordRawInput: typeof node.customChordRawInput === "string" ? node.customChordRawInput : "",
        customChordTransposeWithCentralTone: node.customChordTransposeWithCentralTone === true,
      };
    }
    const nextNodeId = Math.max(
      sanitizedGraph.nextNodeId,
      Math.max(...Object.keys(normalizedNodes).map((value) => Number(value))) + 1,
    );
    const normalizedGraph: LoopGraph = {
      ...sanitizedGraph,
      nextNodeId,
      nodes: normalizedNodes,
    };
    return normalizeGraphHeads(normalizedGraph);
  } catch {
    return null;
  }
}

function saveGraph(graph: LoopGraph): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(graph));
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(graph));
  } catch {
    // ignore storage errors
  }
}

type PersistedInteractionState = {
  selectedFamilyIndex?: number;
  selectedChordIndex?: number;
  chordFanVisible?: boolean;
  sceneZoom?: number;
  scenePan?: { x?: number; y?: number };
  nodeOffsets?: Record<string, { x?: number; y?: number }>;
  savedLoopSelectedId?: string | null;
  savedLoopDraft?: string;
  savedLoopsPage?: number;
};

function loadInteractionState(): PersistedInteractionState {
  try {
    const raw = localStorage.getItem(INTERACTION_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as PersistedInteractionState;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function loadSavedLoops(): SavedLoopRecord[] {
  try {
    const raw = localStorage.getItem(SAVED_LOOPS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as Partial<SavedLoopRecord>[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    const loops: SavedLoopRecord[] = [];
    parsed.forEach((loop) => {
      if (!loop || typeof loop.id !== "string" || typeof loop.name !== "string") {
        return;
      }
      const graph = sanitizeLoopGraph(loop.graph as Partial<LoopGraph> | undefined);
      if (!graph) {
        return;
      }
      loops.push({
        ...(loop as SavedLoopRecord),
        graph,
      });
    });
    return loops;
  } catch {
    return [];
  }
}

function saveSavedLoops(loops: SavedLoopRecord[]): void {
  try {
    localStorage.setItem(SAVED_LOOPS_STORAGE_KEY, JSON.stringify(loops));
  } catch {
    // ignore storage errors
  }
}

function randomLoopName(): string {
  const adjectives = [
    "agile",
    "bold",
    "brisk",
    "calm",
    "daring",
    "eager",
    "fuzzy",
    "lively",
    "mellow",
    "nimble",
    "plucky",
    "quiet",
    "rapid",
    "steady",
    "vivid",
    "witty",
  ];
  const names = [
    "archimedes",
    "babbage",
    "curie",
    "davinci",
    "einstein",
    "galileo",
    "hopper",
    "lovelace",
    "newton",
    "tesla",
    "turing",
    "noether",
    "fermi",
    "bohr",
    "kepler",
    "franklin",
  ];
  const a = adjectives[Math.floor(Math.random() * adjectives.length)];
  const b = names[Math.floor(Math.random() * names.length)];
  return `${a}_${b}`;
}

function loopNameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function findSavedLoopByName(
  loops: SavedLoopRecord[],
  name: string,
  excludedId?: string | null,
): SavedLoopRecord | null {
  const key = loopNameKey(name);
  if (!key) {
    return null;
  }

  return loops.find((loop) => loop.id !== excludedId && loopNameKey(loop.name) === key) ?? null;
}

function nextGeneratedLoopName(loops: SavedLoopRecord[], excludedId?: string | null): string {
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const candidate = randomLoopName();
    if (!findSavedLoopByName(loops, candidate, excludedId)) {
      return candidate;
    }
  }

  const baseName = randomLoopName();
  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const candidate = `${baseName}_${suffix}`;
    if (!findSavedLoopByName(loops, candidate, excludedId)) {
      return candidate;
    }
  }

  return `${baseName}_${Date.now()}`;
}

function cloneGraph(graph: LoopGraph): LoopGraph {
  return JSON.parse(JSON.stringify(graph)) as LoopGraph;
}

function currentLoopStateSignature(state: AppState): string {
  return JSON.stringify({
    graph: state.graph,
    selectedFamilyIndex: state.selectedFamilyIndex,
    selectedChordIndex: state.selectedChordIndex,
    chordFanVisible: state.chordFanVisible,
    sceneZoom,
    scenePan,
    nodeOffsets,
    settings: {
      centralTone: state.settings.centralTone,
      bpm: state.settings.bpm,
      timeSignature: state.settings.timeSignature,
      beatsPerChord: state.settings.beatsPerChord,
      swing: state.settings.swing,
      humanizeAmount: state.settings.humanizeAmount,
      accentStrength: state.settings.accentStrength,
      layerWidth: state.settings.layerWidth,
      waveform: state.settings.waveform,
      effects: state.settings.effects,
      bassPreset: state.settings.bassPreset,
      midiEnabled: state.settings.midiEnabled,
      midiPortId: state.settings.midiPortId,
      midiChannel: state.settings.midiChannel,
      debugFooterEnabled: state.settings.debugFooterEnabled,
    },
  });
}

let activeSavedLoopId: string | null = null;
let activeSavedLoopSignature = "";
let restoreSavedLoopNameFocus = false;
let savedLoopNameCursor = 0;

function shouldPromptToSaveCurrent(state: AppState): boolean {
  if (graphSequence(state.graph).length <= 1) {
    return false;
  }
  const signature = currentLoopStateSignature(state);
  return signature !== activeSavedLoopSignature;
}

function defaultSettings(): AppSettings {
  return {
    showPanel: false,
    showPerformPanel: false,
    showSavedLoopsPanel: false,
    showNodeTimingPanel: false,
    debugFooterEnabled: false,
    alwaysPlayChords: true,
    centralTone: "C",
    bpm: 96,
    timeSignature: "4/4",
    beatsPerChord: 4,
    swing: 0,
    humanizeAmount: 34,
    accentStrength: 100,
    layerWidth: 58,
    waveform: "triangle",
    effects: "none",
    bassPreset: "root",
    midiEnabled: false,
    midiPortId: "",
    midiChannel: 1,
    midiPorts: [],
  };
}

function normalizeWaveform(value: unknown): WaveformOption {
  return WAVEFORMS.includes(value as WaveformOption) ? (value as WaveformOption) : "triangle";
}

function normalizeTimeSignature(value: unknown): TimeSignatureOption {
  return TIME_SIGNATURES.includes(value as TimeSignatureOption) ? (value as TimeSignatureOption) : "4/4";
}

function normalizeEffects(value: unknown): EffectOption {
  return EFFECT_OPTIONS.includes(value as EffectOption) ? (value as EffectOption) : "none";
}

function normalizeBassPreset(value: unknown): BassPresetOption {
  return BASS_PRESET_OPTIONS.includes(value as BassPresetOption) ? (value as BassPresetOption) : "root";
}

function normalizeBpm(value: unknown): number {
  return clamp(Number(value) || 96, 40, 240);
}

function normalizeSwing(value: unknown): number {
  return clamp(Number(value) || 0, 0, 75);
}

function normalizeHumanizeAmount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, 0, 100) : 34;
}

function normalizeAccentStrength(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, 0, 150) : 100;
}

function normalizeLayerWidth(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, 0, 100) : 58;
}

const BEATS_PER_CHORD_OPTIONS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 8] as const;

function bpcLabel(v: number): string {
  return v < 1 ? `${v === 0.125 ? "1/8" : v === 0.25 ? "1/4" : "1/2"} beat` : `${v} beat${v === 1 ? "" : "s"}`;
}

function normalizeBeatsPerChord(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 4;
  return [...BEATS_PER_CHORD_OPTIONS].reduce((best, opt) =>
    Math.abs(opt - n) < Math.abs(best - n) ? opt : best
  );
}

function normalizeNodeBeatsOverride(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return normalizeBeatsPerChord(value);
}

function nodeUsesCustomChord(node: GraphNode): boolean {
  return node.customChordEnabled === true && (node.customChordRawInput ?? "").trim().length > 0;
}

type ParsedNodeCustomChord = {
  kind: CustomChordInputKind;
  midiNotes: number[];
  tonesText: string;
};

type NodeCustomPlaybackData = {
  midiNotes: number[];
  tonesText: string;
  label: string;
};

function centralToneTransposeDelta(centralTone: string): number {
  const targetSemitone = noteToSemitone(normalizeCentralTone(centralTone));
  if (targetSemitone === null) {
    return 0;
  }
  return ((targetSemitone - noteToSemitone("C")!) % 12 + 12) % 12;
}

function parseCustomToneToken(token: string): string | null {
  const match = token.trim().match(/^([A-Ga-g])([#b]?)$/);
  if (!match) {
    return null;
  }
  const [, letter, accidental] = match;
  return `${letter.toUpperCase()}${accidental}`;
}

function parseNodeCustomChord(node: GraphNode, centralTone: string): ParsedNodeCustomChord | null {
  if (!nodeUsesCustomChord(node)) {
    return null;
  }

  const raw = (node.customChordRawInput ?? "").trim();
  if (!raw) {
    return null;
  }

  const parts = raw.split(/[\s,;|]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  const allNumeric = parts.every((part) => /^-?\d+$/.test(part));
  const kind: CustomChordInputKind = allNumeric ? "midi" : "tones";
  const transposeDelta = node.customChordTransposeWithCentralTone === true
    ? centralToneTransposeDelta(centralTone)
    : 0;

  if (kind === "midi") {
    const midiNotes: number[] = [];
    for (const part of parts) {
      const n = Number(part);
      if (!Number.isInteger(n) || n < 0 || n > 127) {
        return null;
      }
      const transposed = clamp(n + transposeDelta, 0, 127);
      midiNotes.push(transposed);
    }
    if (midiNotes.length === 0) {
      return null;
    }
    return {
      kind,
      midiNotes,
      tonesText: midiNotes.join(" "),
    };
  }

  const preferFlats = normalizeCentralTone(centralTone).includes("b");
  const tones: string[] = [];
  for (const part of parts) {
    const token = parseCustomToneToken(part);
    if (!token) {
      return null;
    }
    const transposed = transposeDelta !== 0 ? transposeNoteName(token, transposeDelta, preferFlats) : token;
    tones.push(transposed);
  }
  const midiNotes = tonesToMidi(tones);
  if (midiNotes.length === 0) {
    return null;
  }
  return {
    kind,
    midiNotes,
    tonesText: tones.join(" "),
  };
}

function defaultCustomChordInputFromNode(state: AppState, node: GraphNode): string {
  const match = findChordInCatalog(state.catalog, node.chordName);
  if (!match) {
    return node.chordName;
  }
  const chord = state.catalog.families[match.familyIndex]?.chords[match.chordIndex];
  if (!chord) {
    return node.chordName;
  }
  const tones = chordTonesFromIntervals(chord, state.settings.centralTone);
  if (tones.length > 0) {
    return tones.join(" ");
  }
  return chord.full_name;
}

function resolveNodeCustomPlaybackData(state: AppState, node: GraphNode): NodeCustomPlaybackData | null {
  const parsed = parseNodeCustomChord(node, state.settings.centralTone);
  if (!parsed) {
    return null;
  }
  return {
    midiNotes: parsed.midiNotes,
    tonesText: parsed.tonesText,
    label: `Custom ${parsed.kind === "midi" ? "MIDI" : "tones"}`,
  };
}

function effectiveBeatsPerChordForNode(state: AppState, nodeId: number | null, graph: LoopGraph = state.graph): number {
  if (nodeId === null) {
    return normalizeBeatsPerChord(state.settings.beatsPerChord);
  }
  const node = graph.nodes[nodeId];
  if (!node) {
    return normalizeBeatsPerChord(state.settings.beatsPerChord);
  }
  return normalizeBeatsPerChord(node.beatsPerChordOverride ?? state.settings.beatsPerChord);
}

function effectiveWaveformForNode(state: AppState, node: GraphNode): WaveformOption {
  return node.waveformOverride ?? state.settings.waveform;
}

function effectiveEffectsForNode(state: AppState, node: GraphNode): EffectOption {
  return node.effectsOverride ?? state.settings.effects;
}

function effectiveBassPresetForNode(state: AppState, node: GraphNode): BassPresetOption {
  return node.bassPresetOverride ?? state.settings.bassPreset;
}

function normalizeCentralTone(value: unknown): string {
  const tone = `${value ?? ""}`.trim();
  return CENTRAL_TONES.includes(tone as (typeof CENTRAL_TONES)[number]) ? tone : "C";
}

function noteToSemitone(note: string): number | null {
  const normalized = note.trim();
  const semitones: Record<string, number> = {
    C: 0,
    "B#": 0,
    "C#": 1,
    Db: 1,
    D: 2,
    "D#": 3,
    Eb: 3,
    E: 4,
    Fb: 4,
    F: 5,
    "E#": 5,
    "F#": 6,
    Gb: 6,
    G: 7,
    "G#": 8,
    Ab: 8,
    A: 9,
    "A#": 10,
    Bb: 10,
    B: 11,
    Cb: 11,
  };
  return semitones[normalized] ?? null;
}

function semitoneToNote(semitone: number, preferFlats: boolean): string {
  const sharpNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const flatNames = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  const index = ((semitone % 12) + 12) % 12;
  return preferFlats ? flatNames[index] : sharpNames[index];
}

function transposeNoteName(note: string, deltaSemitones: number, preferFlats: boolean): string {
  const source = noteToSemitone(note);
  if (source === null) {
    return note;
  }
  return semitoneToNote(source + deltaSemitones, preferFlats);
}

function transposeChordName(fullName: string, deltaSemitones: number, preferFlats: boolean): string {
  const match = fullName.match(/^([A-G](?:#|b)?)(.*)$/);
  if (!match) {
    return fullName;
  }
  const [, rootToken, suffix] = match;
  const nextRoot = transposeNoteName(rootToken, deltaSemitones, preferFlats);
  return `${nextRoot}${suffix}`;
}

function transposeCatalogForCentralTone(catalog: ChordCatalog, centralTone: string): ChordCatalog {
  const tone = normalizeCentralTone(centralTone);
  const targetSemitone = noteToSemitone(tone);
  if (targetSemitone === null) {
    return catalog;
  }

  const deltaSemitones = ((targetSemitone - noteToSemitone("C")!) % 12 + 12) % 12;
  const preferFlats = tone.includes("b");

  return {
    families: catalog.families.map((family) => ({
      ...family,
      chords: family.chords.map((chord) => {
        if (!chord.numeral) {
          return { ...chord };
        }

        const nextChord: ChordEntry = {
          ...chord,
          full_name: transposeChordName(chord.full_name, deltaSemitones, preferFlats),
        };

        if (typeof chord.root === "string") {
          nextChord.root = transposeNoteName(chord.root, deltaSemitones, preferFlats);
        } else if (chord.root === null) {
          nextChord.root = null;
        }

        return nextChord;
      }),
    })),
  };
}

function buildChordRenameMap(fromCatalog: ChordCatalog, toCatalog: ChordCatalog): Record<string, string> {
  const renameMap: Record<string, string> = {};
  const familyCount = Math.min(fromCatalog.families.length, toCatalog.families.length);

  for (let familyIndex = 0; familyIndex < familyCount; familyIndex += 1) {
    const sourceFamily = fromCatalog.families[familyIndex];
    const targetFamily = toCatalog.families[familyIndex];
    const chordCount = Math.min(sourceFamily.chords.length, targetFamily.chords.length);
    for (let chordIndex = 0; chordIndex < chordCount; chordIndex += 1) {
      const sourceChord = sourceFamily.chords[chordIndex];
      const targetChord = targetFamily.chords[chordIndex];
      if (!sourceChord.numeral) {
        continue;
      }

      const sourceName = sourceChord.full_name.trim();
      const targetName = targetChord.full_name.trim();
      if (!sourceName || !targetName || sourceName === targetName) {
        continue;
      }

      if (!renameMap[sourceName] || renameMap[sourceName] === targetName) {
        renameMap[sourceName] = targetName;
      }
    }
  }

  return renameMap;
}

function applyChordRenameMapToGraph(graph: LoopGraph, renameMap: Record<string, string>): LoopGraph {
  const keys = Object.keys(renameMap);
  if (keys.length === 0) {
    return graph;
  }

  let changed = false;
  const nodes: Record<number, GraphNode> = {};
  for (const [nodeIdText, node] of Object.entries(graph.nodes)) {
    const nextName = renameMap[node.chordName] ?? node.chordName;
    if (nextName !== node.chordName) {
      changed = true;
    }
    nodes[Number(nodeIdText)] = nextName === node.chordName ? node : { ...node, chordName: nextName };
  }

  if (!changed) {
    return graph;
  }

  return {
    ...graph,
    nodes,
  };
}

function loadSettings(): AppSettings {
  const defaults = defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...defaults,
      debugFooterEnabled: parsed.debugFooterEnabled === true,
      alwaysPlayChords: parsed.alwaysPlayChords !== false,
      centralTone: normalizeCentralTone(parsed.centralTone),
      bpm: normalizeBpm(parsed.bpm),
      timeSignature: normalizeTimeSignature(parsed.timeSignature),
      beatsPerChord: normalizeBeatsPerChord(parsed.beatsPerChord),
      swing: normalizeSwing(parsed.swing),
      humanizeAmount: normalizeHumanizeAmount(parsed.humanizeAmount),
      accentStrength: normalizeAccentStrength(parsed.accentStrength),
      layerWidth: normalizeLayerWidth(parsed.layerWidth),
      waveform: normalizeWaveform(parsed.waveform),
      effects: normalizeEffects(parsed.effects),
      bassPreset: normalizeBassPreset(parsed.bassPreset),
      midiEnabled: Boolean(parsed.midiEnabled),
      midiPortId: typeof parsed.midiPortId === "string" ? parsed.midiPortId : "",
      midiChannel: clamp(Number(parsed.midiChannel) || 1, 1, 16),
      midiPorts: [],
      showPanel: false,
      showPerformPanel: false,
      showSavedLoopsPanel: false,
      showNodeTimingPanel: false,
    };
  } catch {
    return defaults;
  }
}

function saveSettings(settings: AppSettings): void {
  try {
    const persisted = {
      debugFooterEnabled: settings.debugFooterEnabled,
      alwaysPlayChords: settings.alwaysPlayChords,
      centralTone: settings.centralTone,
      bpm: settings.bpm,
      timeSignature: settings.timeSignature,
      beatsPerChord: settings.beatsPerChord,
      swing: settings.swing,
      humanizeAmount: settings.humanizeAmount,
      accentStrength: settings.accentStrength,
      layerWidth: settings.layerWidth,
      waveform: settings.waveform,
      effects: settings.effects,
      bassPreset: settings.bassPreset,
      midiEnabled: settings.midiEnabled,
      midiPortId: settings.midiPortId,
      midiChannel: settings.midiChannel,
    };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // ignore storage errors
  }
}

function withSelectedNodeChord(graph: LoopGraph, chordName: string): LoopGraph {
  const selected = graph.nodes[graph.selectedNodeId];
  if (!selected) {
    return graph;
  }

  return {
    ...graph,
    nodes: {
      ...graph.nodes,
      [selected.id]: {
        ...selected,
        chordName,
        customChordEnabled: false,
      },
    },
  };
}

function normalizeRootToken(rootText: string): string {
  const trimmed = rootText.trim();
  if (!trimmed) {
    return "C";
  }
  const letter = trimmed[0]?.toUpperCase() ?? "C";
  const accidental = trimmed[1] === "#" || trimmed[1] === "b" ? trimmed[1] : "";
  return `${letter}${accidental}`;
}

function chordTonesFromIntervals(chord: ChordEntry, centralTone: string): string[] {
  if (Array.isArray(chord.tones) && chord.tones.length > 0) {
    return chord.tones;
  }
  const rootTokenRaw = typeof chord.root === "string" && chord.root.trim().length > 0
    ? chord.root
    : (chord.full_name.match(/^([A-Ga-g][#b]?)/)?.[1] ?? centralTone);
  const rootToken = normalizeRootToken(rootTokenRaw);
  const rootSemitone = noteToSemitone(rootToken);
  if (rootSemitone === null) {
    return [];
  }

  const preferFlats = rootToken.includes("b");
  const rawIntervals = Array.isArray(chord.intervals) ? chord.intervals : [];
  const semitoneSteps = rawIntervals
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 1)
    .map((value) => Math.floor(value) - 1);

  if (semitoneSteps.length === 0) {
    return [];
  }

  const unique = [...new Set(semitoneSteps)];
  return unique.map((step) => semitoneToNote(rootSemitone + step, preferFlats));
}

function tonesToMidi(tones: string[]): number[] {
  const result: number[] = [];
  const lastMidiPerSemitone: Record<number, number> = {};
  let prevMidi = -1;
  for (const tone of tones) {
    const semitone = noteToSemitone(normalizeRootToken(tone.trim()));
    if (semitone === null) continue;
    let midi: number;
    if (lastMidiPerSemitone[semitone] !== undefined) {
      // repetition: exactly one octave above its previous occurrence
      midi = lastMidiPerSemitone[semitone] + 12;
    } else {
      midi = 60 + semitone; // anchor at C4
      if (prevMidi >= 0 && midi <= prevMidi) midi += 12;
    }
    lastMidiPerSemitone[semitone] = midi;
    result.push(midi);
    prevMidi = midi;
  }
  return result;
}

function chordToMidi(chord: ChordEntry): number[] {
  if (Array.isArray(chord.tones) && chord.tones.length > 0) {
    return tonesToMidi(chord.tones);
  }

  // When root is an explicit tone and intervals are defined, use them directly.
  // interval 1 = root (0 semitones), interval N = N-1 semitones above root.
  if (typeof chord.root === "string" && chord.root.trim().length > 0 && Array.isArray(chord.intervals) && chord.intervals.length > 0) {
    const rootSemitone = noteToSemitone(normalizeRootToken(chord.root.trim()));
    if (rootSemitone !== null) {
      const steps = chord.intervals
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v >= 1)
        .map((v) => Math.floor(v) - 1);
      const deduped = [...new Set(steps)].sort((a, b) => a - b);
      const rootMidi = 60 + rootSemitone;
      return deduped.map((step) => rootMidi + step);
    }
  }

  const rootToken = chord.root ?? chord.full_name;
  const rootMatch = rootToken.trim().match(/^([A-Ga-g])([#b]?)/);
  if (!rootMatch) {
    return [60, 64, 67];
  }

  const normalizedRoot = normalizeRootToken(`${rootMatch[1]}${rootMatch[2] ?? ""}`);
  const rootLetter = normalizedRoot[0] ?? "C";
  const accidental = normalizedRoot[1] ?? "";
  const rootSemitoneByNote: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };

  const baseSemitone = rootSemitoneByNote[rootLetter] ?? 0;
  const accidentalDelta = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  const normalizedSemitone = ((baseSemitone + accidentalDelta) % 12 + 12) % 12;
  const qualityText = chord.full_name.toLowerCase();

  let intervals = [0, 4, 7];
  if (qualityText.includes("dim")) {
    intervals = [0, 3, 6];
  } else if (qualityText.includes("aug") || qualityText.includes("+")) {
    intervals = [0, 4, 8];
  } else if (qualityText.includes("m") && !qualityText.includes("maj")) {
    intervals = [0, 3, 7];
  }

  if (qualityText.includes("sus2")) {
    intervals[1] = 2;
  } else if (qualityText.includes("sus4")) {
    intervals[1] = 5;
  }

  if (qualityText.includes("maj7")) {
    intervals.push(11);
  } else if (qualityText.includes("7")) {
    intervals.push(10);
  }

  if (qualityText.includes("add9") || qualityText.includes("9")) {
    intervals.push(14);
  }

  const intervalHints = chord.intervals ?? [];
  if (intervalHints.some((hint) => `${hint}`.includes("11"))) {
    intervals.push(17);
  }
  if (intervalHints.some((hint) => `${hint}`.includes("13"))) {
    intervals.push(21);
  }

  const rootMidi = 60 + normalizedSemitone;
  const deduped = [...new Set(intervals)].sort((a, b) => a - b);
  return deduped.map((interval) => rootMidi + interval);
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function toBassRegister(midi: number): number {
  // Target range E1–B2 (MIDI 28–47)
  let n = midi;
  while (n > 47) n -= 12;
  while (n < 28) n += 12;
  return n;
}

function computeBassNotes(chord: ChordEntry, preset: BassPresetOption, beatWithinChord: number, stepsPerChord: number): number[] {
  if (preset === "off") return [];
  const chordMidi = chordToMidi(chord);
  if (chordMidi.length === 0) return [];
  return computeBassNotesFromRootMidi(chordMidi[0], preset, beatWithinChord, stepsPerChord);
}

function computeBassNotesFromRootMidi(rootMidiInput: number, preset: BassPresetOption, beatWithinChord: number, stepsPerChord: number): number[] {
  if (preset === "off") return [];
  const root = toBassRegister(rootMidiInput);
  const fifth = root + 7;
  const midBeat = Math.max(1, Math.floor(stepsPerChord / 2));
  switch (preset) {
    case "root": return beatWithinChord === 0 ? [root] : [];
    case "root-octave": return beatWithinChord === 0 ? [root, root + 12] : [];
    case "root-fifth": return beatWithinChord === 0 ? [root, fifth] : [];
    case "oom-pah":
      if (beatWithinChord === 0) return [root];
      if (stepsPerChord >= 2 && beatWithinChord === midBeat) return [fifth];
      return [];
    case "stride":
      return beatWithinChord % 2 === 0 ? [root] : [root + 12];
    default: return [];
  }
}

function playBassNotes(
  midiNotes: number[],
  beatMs: number,
  options?: { velocity?: number; humanize?: boolean; accent?: number; humanizeAmount?: number },
): void {
  if (midiNotes.length === 0) return;
  let context: AudioContext;
  try { context = getAudioContext(); } catch { return; }
  if (context.state === "suspended") void context.resume();

  const now = context.currentTime;
  const sustainSec = Math.max(0.07, (beatMs * 0.78) / 1000);
  const velocity = clamp(options?.velocity ?? 1, 0.2, 1.2);
  const accent = clamp(options?.accent ?? 1, 0.6, 1.15);
  const humanize = options?.humanize !== false;
  const humanizeDepth = clamp(options?.humanizeAmount ?? 1, 0, 1);
  const master = context.createGain();
  master.connect(context.destination);
  master.gain.setValueAtTime(clamp(0.9 * velocity * accent, 0.2, 1.15), now);

  midiNotes.forEach((midi, i) => {
    const baseFreq = midiToFrequency(midi);
    const onsetJitter = humanize ? randomCentered(HUMANIZE_ONSET_SEC * 0.75 * humanizeDepth) : 0;
    const startAt = Math.max(now, now + i * 0.004 + onsetJitter);
    const detuneJitter = humanize ? randomCentered(HUMANIZE_DETUNE_CENTS * humanizeDepth) : 0;
    const peak = (0.28 / Math.max(1, midiNotes.length)) * velocity * accent;

    const subOsc = context.createOscillator();
    const subGain = context.createGain();
    subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(baseFreq, startAt);
    subOsc.detune.setValueAtTime(detuneJitter * 0.3, startAt);
    scheduleAdsrEnvelope(subGain.gain, startAt, sustainSec, peak, BASS_ENVELOPE);
    subOsc.connect(subGain);
    subGain.connect(master);

    const bodyOsc = context.createOscillator();
    const bodyGain = context.createGain();
    bodyOsc.type = "triangle";
    bodyOsc.frequency.setValueAtTime(baseFreq, startAt);
    bodyOsc.detune.setValueAtTime(5 + detuneJitter, startAt);
    scheduleAdsrEnvelope(bodyGain.gain, startAt, sustainSec, peak * 0.72, BASS_ENVELOPE);
    bodyOsc.connect(bodyGain);
    bodyGain.connect(master);

    subOsc.start(startAt);
    bodyOsc.start(startAt + 0.0015);
    subOsc.stop(startAt + sustainSec + 0.06);
    bodyOsc.stop(startAt + sustainSec + 0.06);
  });
}

let audioContextRef: AudioContext | null = null;
let midiAccessRef: MidiAccessLike | null = null;
let midiBackendRef: MidiBackend | null = null;
let midiStateListenerBound = false;
let midiPortsListenerHandle: PluginListenerHandle | null = null;

function getAudioContext(): AudioContext {
  if (audioContextRef) {
    return audioContextRef;
  }

  const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    throw new Error("Web Audio API is not supported in this browser");
  }

  audioContextRef = new Ctx();
  return audioContextRef;
}

function prefersNativeMidiBridge(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function midiUnavailableStatusMessage(): string {
  return prefersNativeMidiBridge() ? NATIVE_MIDI_UNAVAILABLE_STATUS : WEB_MIDI_UNAVAILABLE_STATUS;
}

function normalizeMidiPortName(name: string | null | undefined, fallbackId: string): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed.length > 0 ? trimmed : `MIDI ${fallbackId}`;
}

function collectWebMidiPorts(access: MidiAccessLike): MidiPortOption[] {
  const ports: MidiPortOption[] = [];
  const outputs = access.outputs;
  if (outputs?.forEach) {
    outputs.forEach((output) => {
      ports.push({ id: output.id, name: normalizeMidiPortName(output.name, output.id) });
    });
    return ports;
  }
  if (outputs?.values) {
    for (const output of outputs.values()) {
      ports.push({ id: output.id, name: normalizeMidiPortName(output.name, output.id) });
    }
  }
  return ports;
}

async function collectNativeMidiPorts(): Promise<MidiPortOption[]> {
  const response = await NativeMidi.listOutputs();
  return response.ports.map((port) => ({
    id: port.id,
    name: normalizeMidiPortName(port.name, port.id),
  }));
}

async function bindMidiStateListener(backend: MidiBackend, access?: MidiAccessLike): Promise<void> {
  if (midiStateListenerBound) {
    return;
  }

  if (backend === "native") {
    midiPortsListenerHandle = await NativeMidi.addListener("portsChanged", () => {
      void refreshMidiPorts();
    });
    midiStateListenerBound = true;
    return;
  }

  if (access) {
    access.onstatechange = () => {
      void refreshMidiPorts();
    };
    midiStateListenerBound = true;
  }
}

function resolveConfiguredMidiPortName(settings: AppSettings): string {
  return settings.midiPorts.find((port) => port.id === settings.midiPortId)?.name ?? settings.midiPortId;
}

async function sendMidiData(portId: string, data: number[]): Promise<void> {
  if (midiBackendRef === "native") {
    await NativeMidi.send({ portId, data });
    return;
  }

  const selectedOutput = resolveMidiOutput(portId);
  if (!selectedOutput) {
    throw new Error(`MIDI port not found: ${portId}`);
  }
  selectedOutput.send(data);
}

function resolveMidiOutput(portId: string): MidiOutputLike | null {
  const outputs = midiAccessRef?.outputs;
  if (!outputs) {
    return null;
  }
  if (outputs.get) {
    return outputs.get(portId) ?? null;
  }
  // forEach fallback for environments without .get()
  let found: MidiOutputLike | null = null;
  outputs.forEach?.((output) => {
    if (output.id === portId) {
      found = output;
    }
  });
  if (found) {
    return found;
  }
  if (outputs.values) {
    for (const output of outputs.values()) {
      if (output.id === portId) {
        return output;
      }
    }
  }
  return null;
}

function sendMidiPreview(chord: ChordEntry, sustainMs = 920, midiNotesOverride?: number[], labelOverride?: string): void {
  const state = store.getState();
  const settings = state.settings;
  if (!settings.midiEnabled || !settings.midiPortId) {
    return;
  }

  if (!midiBackendRef || (midiBackendRef === "web" && !midiAccessRef)) {
    appendDebugLog("[midi] skipped - no MIDI access (enable MIDI in settings)");
    return;
  }

  if (midiBackendRef === "web" && !resolveMidiOutput(settings.midiPortId)) {
    appendDebugLog(`[midi] port not found: ${settings.midiPortId}`);
    return;
  }

  const midiNotes = (midiNotesOverride ?? chordToMidi(chord)).map((note) => clamp(note, 0, 127));
  if (midiNotes.length === 0) {
    return;
  }
  const channel = clamp(settings.midiChannel, 1, 16) - 1;
  const noteOn = 0x90 + channel;
  const noteOff = 0x80 + channel;
  const chordLabel = labelOverride ?? chord.full_name;
  const portName = resolveConfiguredMidiPortName(settings);

  appendDebugLog(`[midi] ch${channel + 1} ${chordLabel} notes=[${midiNotes.join(',')}] port=${portName}`);

  midiNotes.forEach((note) => {
    void sendMidiData(settings.midiPortId, [noteOn, note, 96]).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      appendDebugLog(`[midi] send failed: ${detail}`);
    });
  });

  window.setTimeout(() => {
    midiNotes.forEach((note) => {
      void sendMidiData(settings.midiPortId, [noteOff, note, 0]).catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        appendDebugLog(`[midi] send failed: ${detail}`);
      });
    });
  }, Math.max(100, sustainMs - 80));
}

function playChordPreview(
  chord: ChordEntry,
  options?: {
    pulseNodeId?: number;
    pulseColorIndex?: number;
    sustainMs?: number;
    velocity?: number;
    humanize?: boolean;
    humanizeAmount?: number;
    layerWidth?: number;
    midiNotesOverride?: number[];
    tonesTextOverride?: string;
    labelOverride?: string;
    familyNameOverride?: string;
    waveformOverride?: WaveformOption;
    effectsOverride?: EffectOption;
  },
): void {
  triggerCenterPulse(options?.pulseNodeId, options?.pulseColorIndex ?? 0);

  const state = store.getState();
  const waveform = options?.waveformOverride ?? state.settings.waveform;
  const effects = options?.effectsOverride ?? state.settings.effects;
  const chordLabel = options?.labelOverride ?? chord.full_name;
  const match = findChordInCatalog(state.catalog, chord.full_name);
  const familyName = options?.familyNameOverride ?? (match ? state.catalog.families[match.familyIndex]?.name ?? "Unknown family" : "Unknown family");
  const tones = chordTonesFromIntervals(chord, state.settings.centralTone);
  const tonesText = options?.tonesTextOverride ?? (tones.length > 0 ? tones.join(" ") : "n/a");
  appendDebugLog(`[audio] ${familyName} | ${chordLabel} | tones: ${tonesText} | wave=${waveform} fx=${effects}`);

  sendMidiPreview(chord, options?.sustainMs, options?.midiNotesOverride, chordLabel);

  let context: AudioContext;
  try {
    context = getAudioContext();
  } catch {
    return;
  }

  if (context.state === "suspended") {
    void context.resume();
  }

  const midiNotes = options?.midiNotesOverride ?? chordToMidi(chord);
  if (midiNotes.length === 0) {
    return;
  }
  const frequencies = midiNotes.map(midiToFrequency);
  const now = context.currentTime;
  // sustain until just before the next chord; default to 1.1s for manual preview
  const sustainSec = options?.sustainMs !== undefined ? options.sustainMs / 1000 : 1.1;
  const velocity = clamp(options?.velocity ?? 1, 0.25, 1.25);
  const humanize = options?.humanize !== false;
  const humanizeDepth = clamp(options?.humanizeAmount ?? 1, 0, 1);
  const layerWidth = clamp(options?.layerWidth ?? 58, 0, 100);
  const master = context.createGain();
  const dryOutput = context.createGain();
  dryOutput.gain.setValueAtTime(1, now);
  master.connect(dryOutput);
  dryOutput.connect(context.destination);

  if (effects === "delay") {
    const delay = context.createDelay();
    const feedback = context.createGain();
    const wet = context.createGain();
    delay.delayTime.setValueAtTime(0.22, now);
    feedback.gain.setValueAtTime(0.32, now);
    wet.gain.setValueAtTime(0.24, now);
    master.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(context.destination);
  }

  master.gain.setValueAtTime(clamp(0.86 * velocity, 0.2, 1.25), now);

  const detuneSpread = effects === "chorus" ? 7 : 0;
  const layers = chordLayersForWaveform(waveform, detuneSpread, layerWidth);

  frequencies.forEach((frequency, index) => {
    const baseStart = now + index * 0.004 + (humanize ? randomCentered(HUMANIZE_ONSET_SEC * humanizeDepth) : 0);
    const startAt = Math.max(now, baseStart);
    const voicePeak = (0.24 / Math.max(1, frequencies.length)) * velocity;
    layers.forEach((layer, layerIndex) => {
      const oscillator = context.createOscillator();
      const voiceGain = context.createGain();
      const detuneJitter = humanize ? randomCentered(HUMANIZE_DETUNE_CENTS * humanizeDepth) : 0;
      oscillator.type = layer.waveform;
      oscillator.frequency.setValueAtTime(frequency, startAt);
      oscillator.detune.setValueAtTime(layer.detuneCents + detuneJitter, startAt);
      scheduleAdsrEnvelope(voiceGain.gain, startAt, sustainSec, voicePeak * layer.gain, CHORD_ENVELOPE);
      oscillator.connect(voiceGain);
      voiceGain.connect(master);
      oscillator.start(startAt + layerIndex * 0.0012);
      oscillator.stop(startAt + sustainSec + 0.06 + layerIndex * 0.0012);
    });
  });
}

async function ensureMidiAccess(): Promise<MidiAccessLike | null> {
  if (prefersNativeMidiBridge()) {
    if (midiBackendRef === "native") {
      return {} as MidiAccessLike;
    }

    try {
      const availability = await NativeMidi.isSupported();
      if (!availability.supported) {
        appendDebugLog("[midi] Native Android MIDI bridge is unavailable");
        return null;
      }
      midiBackendRef = "native";
      appendDebugLog("[midi] Native Android MIDI bridge ready");
      return {} as MidiAccessLike;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      appendDebugLog(`[midi] Native MIDI initialization failed: ${detail}`);
      return null;
    }
  }

  if (midiAccessRef) {
    midiBackendRef = "web";
    return midiAccessRef;
  }

  const nav = navigator as Navigator & {
    requestMIDIAccess?: (options?: MidiRequestOptions) => Promise<MidiAccessLike>;
  };
  if (!nav.requestMIDIAccess) {
    appendDebugLog("[midi] navigator.requestMIDIAccess is unavailable in this browser");
    return null;
  }

  try {
    // Some browsers are picky about options; prefer explicit non-sysex, then fallback.
    try {
      midiAccessRef = await nav.requestMIDIAccess({ sysex: false }) as unknown as MidiAccessLike;
    } catch {
      midiAccessRef = await nav.requestMIDIAccess() as unknown as MidiAccessLike;
    }
    midiBackendRef = "web";
    appendDebugLog("[midi] MIDI access granted");
    return midiAccessRef;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    appendDebugLog(`[midi] MIDI access failed: ${detail}`);
    return null;
  }
}

async function refreshMidiPorts(): Promise<void> {
  const access = await ensureMidiAccess();
  if (!access) {
    const state = store.getState();
    const settings = {
      ...state.settings,
      midiPorts: [],
      midiPortId: "",
    };
    saveSettings(settings);
    store.setState({
      ...state,
      settings,
      status: midiUnavailableStatusMessage(),
    });
    appendDebugLog(`[midi] ${midiUnavailableStatusMessage()}`);
    return;
  }

  const ports = midiBackendRef === "native"
    ? await collectNativeMidiPorts()
    : collectWebMidiPorts(access);

  const state = store.getState();
  const hasSelected = ports.some((port) => port.id === state.settings.midiPortId);
  const settings = {
    ...state.settings,
    midiPorts: ports,
    midiPortId: hasSelected
      ? state.settings.midiPortId
      : (ports[0]?.id ?? ""),
  };
  saveSettings(settings);
  store.setState({
    ...state,
    settings,
  });
  appendDebugLog(`[midi] Refreshed ${ports.length} MIDI output port${ports.length === 1 ? "" : "s"}`);

  if (ports.length === 0) {
    store.setState({
      ...store.getState(),
      status: "No MIDI outputs detected on this device.",
    });
    appendDebugLog("[midi] No MIDI output ports detected");
  }

  if (!midiStateListenerBound) {
    await bindMidiStateListener(midiBackendRef ?? "web", midiBackendRef === "web" ? access : undefined);
  }
}

const initialSettings = loadSettings();
const initialCatalog = transposeCatalogForCentralTone(CATALOG_TEMPLATE, initialSettings.centralTone);
const savedGraph = loadSavedGraph();
const startingGraph = normalizeGraphHeads(savedGraph ?? createInitialGraph(initialChordName(initialCatalog)));
const persistedInteraction = loadInteractionState();
const initialSavedLoops = loadSavedLoops();
const initialSelectedNode =
  startingGraph.nodes[startingGraph.selectedNodeId] ??
  startingGraph.nodes[graphHeadIds(startingGraph)[0]];
const initialSelection = initialSelectedNode
  ? findChordInCatalog(initialCatalog, initialSelectedNode.chordName)
  : null;
const initialSelectedFamilyIndex = clamp(
  Number.isFinite(persistedInteraction.selectedFamilyIndex)
    ? Number(persistedInteraction.selectedFamilyIndex)
    : (initialSelection?.familyIndex ?? 0),
  0,
  Math.max(0, initialCatalog.families.length - 1),
);
const initialSelectedChordIndex = clamp(
  Number.isFinite(persistedInteraction.selectedChordIndex)
    ? Number(persistedInteraction.selectedChordIndex)
    : (initialSelection?.chordIndex ?? 0),
  0,
  Math.max(0, (initialCatalog.families[initialSelectedFamilyIndex]?.chords.length ?? 1) - 1),
);
const initialSceneZoom = clamp(Number(persistedInteraction.sceneZoom) || 1, 0.30, 1.85);
const initialScenePan = {
  x: Number(persistedInteraction.scenePan?.x) || 0,
  y: Number(persistedInteraction.scenePan?.y) || 0,
};
const initialNodeOffsets: Record<number, { x: number; y: number }> = {};
for (const [nodeIdText, offset] of Object.entries(persistedInteraction.nodeOffsets ?? {})) {
  const nodeId = Number(nodeIdText);
  if (!Number.isFinite(nodeId)) {
    continue;
  }
  initialNodeOffsets[nodeId] = {
    x: Number(offset?.x) || 0,
    y: Number(offset?.y) || 0,
  };
}
const persistedSavedLoopSelectedId =
  typeof persistedInteraction.savedLoopSelectedId === "string"
  && initialSavedLoops.some((loop) => loop.id === persistedInteraction.savedLoopSelectedId)
    ? persistedInteraction.savedLoopSelectedId
    : null;

const store = createStore<AppState>(() => ({
  catalog: initialCatalog,
  selectedFamilyIndex: initialSelectedFamilyIndex,
  selectedChordIndex: initialSelectedChordIndex,
  chordFanVisible: persistedInteraction.chordFanVisible === true,
  showSelectedRomanNumeral: false,
  nodeTimingModalNodeId: null,
  graph: startingGraph,
  settings: initialSettings,
  savedLoops: initialSavedLoops,
  savedLoopDraft: typeof persistedInteraction.savedLoopDraft === "string"
    ? persistedInteraction.savedLoopDraft
    : randomLoopName(),
  savedLoopSelectedId: persistedSavedLoopSelectedId,
  savedLoopsPage: clamp(
    Number(persistedInteraction.savedLoopsPage) || 0,
    0,
    Math.max(0, Math.ceil(initialSavedLoops.length / SAVED_LOOPS_PAGE_SIZE) - 1),
  ),
  debugInput: "",
  debugLogs: ["[system] Debug footer initialized"],
  status: "Initial state ready",
}));

function appendDebugLog(message: string): void {
  const state = store.getState();
  const stamp = new Date().toISOString();
  const line = `${stamp} ${message}`;
  const merged = [...state.debugLogs, line];
  const nextLogs = merged.length > MAX_DEBUG_LOGS
    ? merged.slice(merged.length - MAX_DEBUG_LOGS)
    : merged;

  store.setState({
    ...state,
    debugLogs: nextLogs,
  });
}

function debugPanelMidiSummary(state: AppState): string[] {
  const preferredBackend = prefersNativeMidiBridge() ? "native-android" : "web-midi";
  const activeBackend = midiBackendRef ?? "inactive";
  const configuredPort = state.settings.midiPortId
    ? resolveConfiguredMidiPortName(state.settings)
    : "none";
  const portNames = state.settings.midiPorts.length > 0
    ? state.settings.midiPorts.map((port) => port.name).join(", ")
    : "none";
  const audioState = audioContextRef?.state ?? "not-created";

  return [
    `platform=${Capacitor.getPlatform()} native=${Capacitor.isNativePlatform() ? "yes" : "no"}`,
    `midi enabled=${state.settings.midiEnabled ? "yes" : "no"} preferred=${preferredBackend} active=${activeBackend}`,
    `midi channel=${state.settings.midiChannel} selected-port=${configuredPort}`,
    `midi outputs(${state.settings.midiPorts.length})=${portNames}`,
    `audio-context=${audioState} status=${state.status}`,
  ];
}

function saveInteractionState(): void {
  try {
    const state = store.getState();
    const payload: PersistedInteractionState = {
      selectedFamilyIndex: state.selectedFamilyIndex,
      selectedChordIndex: state.selectedChordIndex,
      chordFanVisible: state.chordFanVisible,
      sceneZoom,
      scenePan,
      nodeOffsets,
      savedLoopSelectedId: state.savedLoopSelectedId,
      savedLoopDraft: state.savedLoopDraft,
      savedLoopsPage: state.savedLoopsPage,
    };
    localStorage.setItem(INTERACTION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function updateSettings(patch: Partial<AppSettings>, status?: string): void {
  const state = store.getState();
  const settings = {
    ...state.settings,
    ...patch,
  };
  settings.centralTone = normalizeCentralTone(settings.centralTone);
  settings.humanizeAmount = normalizeHumanizeAmount(settings.humanizeAmount);
  settings.accentStrength = normalizeAccentStrength(settings.accentStrength);
  settings.layerWidth = normalizeLayerWidth(settings.layerWidth);

  let catalog = state.catalog;
  let graph = state.graph;
  if (settings.centralTone !== state.settings.centralTone) {
    catalog = transposeCatalogForCentralTone(CATALOG_TEMPLATE, settings.centralTone);
    const renameMap = buildChordRenameMap(state.catalog, catalog);
    graph = applyChordRenameMapToGraph(state.graph, renameMap);
    if (graph !== state.graph) {
      saveGraph(graph);
    }
  }

  saveSettings(settings);
  store.setState({
    ...state,
    catalog,
    graph,
    settings,
    status: status ?? state.status,
  });
}

function getSelectedChord(state: AppState): ChordEntry {
  const family = state.catalog.families[state.selectedFamilyIndex];
  return family.chords[state.selectedChordIndex] ?? family.chords[0] ?? { full_name: "Cmaj7add9", numeral: "I" };
}

function buildLayout(width: number, height: number): StageLayout {
  const minAxis = Math.min(width, height);
  const centerX = width * 0.5 + scenePan.x;
  const centerY = height * 0.665 + scenePan.y;
  const scale = sceneZoom;
  const centerRadius = minAxis * 0.14 * scale;

  return {
    width,
    height,
    centerX,
    centerY,
    chordInner: centerRadius + minAxis * 0.19 * scale,
    chordOuter: centerRadius + minAxis * 0.3 * scale,
    majorInner: centerRadius + minAxis * 0.045 * scale,
    majorOuter: centerRadius + minAxis * 0.072 * scale,
    centerRadius,
    familyInner: centerRadius + minAxis * 0.02 * scale,
    familyOuter: centerRadius + minAxis * 0.13 * scale,
    addX: centerX + centerRadius * 0.48,
    addY: centerY + centerRadius * 0.45,
    removeX: centerX - centerRadius * 0.48,
    removeY: centerY + centerRadius * 0.45,
    actionRadius: Math.max(10, minAxis * 0.02 * scale),
  };
}

function makeSegments(
  count: number,
  startDeg: number,
  endDeg: number,
  inner: number,
  outer: number,
  gapDeg: number,
): Segment[] {
  if (count <= 0) {
    return [];
  }

  const start = (startDeg * Math.PI) / 180;
  const end = (endDeg * Math.PI) / 180;
  const total = end - start;
  const step = total / count;
  const gap = (gapDeg * Math.PI) / 180;

  const segments: Segment[] = [];
  for (let index = 0; index < count; index += 1) {
    const segStart = start + step * index + gap * 0.5;
    const segEnd = start + step * (index + 1) - gap * 0.5;
    segments.push({
      start: segStart,
      end: segEnd,
      inner,
      outer,
    });
  }
  return segments;
}

function buildSceneGeometry(state: AppState, layout: StageLayout): SceneGeometry {
  const chordCount = state.chordFanVisible
    ? clamp(getSelectedChordFamily(state).chords.length, 1, MAX_SEGMENTS)
    : 0;
  const familyIndices = visibleFamilyIndices(state, Math.min(state.catalog.families.length, MAX_SEGMENTS));
  const familyCount = familyIndices.length;

  const familySegments = makeSegments(
    familyCount,
    -90,
    270,
    layout.familyInner,
    layout.familyOuter,
    1.2,
  );

  const selectedFamilySegmentIndex = familyIndices.indexOf(state.selectedFamilyIndex);

  let chordSegments: Segment[] = [];
  if (chordCount > 0 && selectedFamilySegmentIndex >= 0) {
    const selectedFamilySegment = familySegments[selectedFamilySegmentIndex];
    if (selectedFamilySegment) {
      const familyArc = selectedFamilySegment.end - selectedFamilySegment.start;
      const expandedArc = Math.min((138 * Math.PI) / 180, familyArc * 2.1);
      const centerAngle = (selectedFamilySegment.start + selectedFamilySegment.end) * 0.5;
      const expandedStart = centerAngle - expandedArc * 0.5;
      const gap = (2 * Math.PI) / 180;
      const step = expandedArc / chordCount;
      chordSegments = Array.from({ length: chordCount }, (_, index) => ({
        start: expandedStart + step * index + gap * 0.5,
        end: expandedStart + step * (index + 1) - gap * 0.5,
        inner: layout.chordInner,
        outer: layout.chordOuter,
      }));
    }
  }

  if (chordSegments.length === 0 && chordCount > 0) {
    chordSegments = makeSegments(
      chordCount,
      230,
      330,
      layout.chordInner,
      layout.chordOuter,
      2.4,
    );
  }

  return {
    chordSegments,
    familySegments,
    familyIndices,
    selectedFamilySegmentIndex,
    majorBand: {
      start: (224 * Math.PI) / 180,
      end: (316 * Math.PI) / 180,
      inner: layout.majorInner,
      outer: layout.majorOuter,
    },
  };
}

function getSelectedChordFamily(state: AppState): ChordFamily {
  return state.catalog.families[state.selectedFamilyIndex] ?? state.catalog.families[0] ?? { name: "MAJOR", chords: [] };
}

function visibleFamilyIndices(state: AppState, count: number): number[] {
  const length = state.catalog.families.length;
  const safeCount = clamp(count, 1, length);
  const out: number[] = [];
  for (let index = 0; index < safeCount; index += 1) {
    out.push(index);
  }
  return out;
}

class WebGlStage {
  private canvas: HTMLCanvasElement;

  private gl: WebGLRenderingContext;

  private program: WebGLProgram;

  private frame = 0;

  private currentLayout: StageLayout = buildLayout(1, 1);

  private currentGeometry: SceneGeometry = {
    chordSegments: [],
    familySegments: [],
    familyIndices: [],
    selectedFamilySegmentIndex: 0,
    majorBand: { start: 0, end: 0, inner: 0, outer: 0 },
  };

  private chordActive = 0;

  private familyActive = 0;

  private removeDisabled = 1;

  private uniforms: {
    resolution: WebGLUniformLocation;
    time: WebGLUniformLocation;
    center: WebGLUniformLocation;
    centerRadius: WebGLUniformLocation;
    majorBand: WebGLUniformLocation;
    chordCount: WebGLUniformLocation;
    chordSegments: WebGLUniformLocation;
    chordActive: WebGLUniformLocation;
    familyCount: WebGLUniformLocation;
    familySegments: WebGLUniformLocation;
    familyActive: WebGLUniformLocation;
    addCircle: WebGLUniformLocation;
    removeCircle: WebGLUniformLocation;
    removeDisabled: WebGLUniformLocation;
  };

  constructor(canvas: HTMLCanvasElement) {
    const gl =
      (canvas.getContext("webgl2", { antialias: true, alpha: false }) as unknown as WebGLRenderingContext | null) ??
      (canvas.getContext("webgl", { antialias: true, alpha: false }) as WebGLRenderingContext | null);
    if (!gl) {
      throw new Error("WebGL is not supported in this browser");
    }

    this.canvas = canvas;
    this.gl = gl;
    this.program = this.createProgram();

    this.uniforms = {
      resolution: this.getUniform("u_resolution"),
      time: this.getUniform("u_time"),
      center: this.getUniform("u_center"),
      centerRadius: this.getUniform("u_centerRadius"),
      majorBand: this.getUniform("u_majorBand"),
      chordCount: this.getUniform("u_chordCount"),
      chordSegments: this.getUniform("u_chordSegments"),
      chordActive: this.getUniform("u_chordActive"),
      familyCount: this.getUniform("u_familyCount"),
      familySegments: this.getUniform("u_familySegments"),
      familyActive: this.getUniform("u_familyActive"),
      addCircle: this.getUniform("u_addCircle"),
      removeCircle: this.getUniform("u_removeCircle"),
      removeDisabled: this.getUniform("u_removeDisabled"),
    };

    const vertices = new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]);

    const vertexBuffer = gl.createBuffer();
    if (!vertexBuffer) {
      throw new Error("Failed to allocate vertex buffer");
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(this.program, "a_position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
  }

  private getUniform(name: string): WebGLUniformLocation {
    const location = this.gl.getUniformLocation(this.program, name);
    if (!location) {
      throw new Error(`Missing uniform ${name}`);
    }
    return location;
  }

  private createShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error("Failed to create shader");
    }
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader) ?? "";
      this.gl.deleteShader(shader);
      throw new Error(`Shader compilation error: ${info}`);
    }
    return shader;
  }

  private createProgram(): WebGLProgram {
    const vertexSource = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fragmentSource = `
      precision mediump float;

      const int MAX_SEGMENTS = ${MAX_SEGMENTS};

      uniform vec2 u_resolution;
      uniform float u_time;
      uniform vec2 u_center;
      uniform float u_centerRadius;
      uniform vec4 u_majorBand;
      uniform int u_chordCount;
      uniform vec4 u_chordSegments[MAX_SEGMENTS];
      uniform int u_chordActive;
      uniform int u_familyCount;
      uniform vec4 u_familySegments[MAX_SEGMENTS];
      uniform int u_familyActive;
      uniform vec3 u_addCircle;
      uniform vec3 u_removeCircle;
      uniform float u_removeDisabled;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float softCircle(vec2 p, vec2 center, float radius, float blur) {
        float d = distance(p, center) - radius;
        return 1.0 - smoothstep(-blur, blur, d);
      }

      bool angleInRange(float a, float s, float e) {
        float twoPi = 6.28318530718;
        float angle = mod(a + twoPi, twoPi);
        float start = mod(s + twoPi, twoPi);
        float end = mod(e + twoPi, twoPi);
        if (start <= end) {
          return angle >= start && angle <= end;
        }
        return angle >= start || angle <= end;
      }

      float ringSegment(vec2 p, vec2 center, vec4 seg) {
        vec2 d = p - center;
        float r = length(d);
        float a = atan(d.y, d.x);
        if (!angleInRange(a, seg.x, seg.y)) {
          return 0.0;
        }

        float radial = max(seg.z - r, r - seg.w);
        float fill = 1.0 - smoothstep(-1.2, 1.8, radial);
        return fill;
      }

      float ringBorder(vec2 p, vec2 center, vec4 seg, float thickness) {
        vec2 d = p - center;
        float r = length(d);
        float a = atan(d.y, d.x);
        if (!angleInRange(a, seg.x, seg.y)) {
          return 0.0;
        }
        float edge = min(abs(r - seg.z), abs(r - seg.w));
        return 1.0 - smoothstep(thickness, thickness + 2.2, edge);
      }

      void main() {
        vec2 uv = gl_FragCoord.xy;

        vec3 bg = vec3(0.04, 0.06, 0.11);
        float vignette = smoothstep(1.22, 0.22, length((uv - u_center) / vec2(u_resolution.x * 0.52, u_resolution.y * 0.65)));
        bg += vec3(0.03, 0.07, 0.16) * vignette;
        bg += vec3(0.04, 0.07, 0.12) * (hash(uv * 0.012 + u_time * 0.03) - 0.5) * 0.09;

        vec3 color = bg;

        float centerGlow = softCircle(uv, u_center, u_centerRadius + 28.0, 95.0);
        color += vec3(0.02, 0.1, 0.21) * centerGlow;

        float core = softCircle(uv, u_center, u_centerRadius, 2.0);
        color = mix(color, vec3(0.03, 0.06, 0.14), core * 0.92);

        float coreBorder = abs(distance(uv, u_center) - u_centerRadius);
        float coreStroke = 1.0 - smoothstep(0.8, 3.0, coreBorder);
        color += vec3(0.28, 0.48, 0.95) * coreStroke;

        float majorFill = ringSegment(uv, u_center, u_majorBand);
        float majorBorder = ringBorder(uv, u_center, u_majorBand, 0.9);
        color = mix(color, vec3(0.23, 0.13, 0.03), majorFill * 0.96);
        color += vec3(1.0, 0.72, 0.22) * majorBorder;

        for (int i = 0; i < MAX_SEGMENTS; i += 1) {
          if (i < u_chordCount) {
            vec4 seg = u_chordSegments[i];
            float fill = ringSegment(uv, u_center, seg);
            float border = ringBorder(uv, u_center, seg, 0.9);
            float active = float(i == u_chordActive);
            vec3 base = mix(vec3(0.03, 0.06, 0.14), vec3(0.07, 0.19, 0.28), active);
            vec3 line = mix(vec3(0.26, 0.43, 0.86), vec3(0.45, 0.87, 1.0), active);
            color = mix(color, base, fill * 0.94);
            color += line * border;
          }

          if (i < u_familyCount) {
            vec4 seg2 = u_familySegments[i];
            float fill2 = ringSegment(uv, u_center, seg2);
            float border2 = ringBorder(uv, u_center, seg2, 0.9);
            float active2 = float(i == u_familyActive);
            vec3 base2 = mix(vec3(0.03, 0.05, 0.12), vec3(0.08, 0.15, 0.26), active2);
            vec3 line2 = mix(vec3(0.24, 0.41, 0.84), vec3(0.53, 0.85, 1.0), active2);
            color = mix(color, base2, fill2 * 0.92);
            color += line2 * border2;
          }
        }

        float addFill = softCircle(uv, u_addCircle.xy, u_addCircle.z, 2.0);
        float addBorder = 1.0 - smoothstep(0.8, 3.0, abs(distance(uv, u_addCircle.xy) - u_addCircle.z));
        color = mix(color, vec3(0.04, 0.08, 0.16), addFill * 0.93);
        color += vec3(0.44, 0.78, 1.0) * addBorder;

        float remFill = softCircle(uv, u_removeCircle.xy, u_removeCircle.z, 2.0);
        float remBorder = 1.0 - smoothstep(0.8, 3.0, abs(distance(uv, u_removeCircle.xy) - u_removeCircle.z));
        vec3 remLine = mix(vec3(0.42, 0.47, 0.72), vec3(0.95, 0.82, 0.52), 1.0 - u_removeDisabled);
        color = mix(color, vec3(0.04, 0.08, 0.16), remFill * 0.93);
        color += remLine * remBorder;

        float spark = hash(uv * 0.032 + vec2(10.3, -6.2));
        color += vec3(0.35, 0.72, 1.0) * smoothstep(0.997, 1.0, spark) * 0.5;

        gl_FragColor = vec4(color, 1.0);
      }
    `;

    const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);

    const program = this.gl.createProgram();
    if (!program) {
      throw new Error("Failed to create program");
    }

    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const info = this.gl.getProgramInfoLog(program) ?? "";
      throw new Error(`Program link error: ${info}`);
    }

    this.gl.useProgram(program);
    return program;
  }

  setScene(state: AppState, layout: StageLayout, geometry: SceneGeometry): void {
    this.currentLayout = layout;
    this.currentGeometry = geometry;
    this.chordActive = clamp(state.selectedChordIndex, 0, geometry.chordSegments.length - 1);
    this.familyActive = clamp(state.selectedFamilyIndex, 0, geometry.familySegments.length - 1);
    this.removeDisabled = graphSequence(state.graph).length <= 1 ? 1 : 0;
  }

  private resizeViewport(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.gl.viewport(0, 0, width, height);
  }

  draw(nowMs: number): void {
    this.frame = nowMs * 0.001;
    this.resizeViewport();

    const gl = this.gl;
    gl.useProgram(this.program);

    const dpr = window.devicePixelRatio || 1;
    const resX = this.currentLayout.width * dpr;
    const resY = this.currentLayout.height * dpr;

    gl.uniform2f(this.uniforms.resolution, resX, resY);
    gl.uniform1f(this.uniforms.time, this.frame);
    gl.uniform2f(this.uniforms.center, this.currentLayout.centerX * dpr, this.currentLayout.centerY * dpr);
    gl.uniform1f(this.uniforms.centerRadius, this.currentLayout.centerRadius * dpr);

    const major = this.currentGeometry.majorBand;
    gl.uniform4f(
      this.uniforms.majorBand,
      major.start,
      major.end,
      major.inner * dpr,
      major.outer * dpr,
    );

    const chordData = new Float32Array(MAX_SEGMENTS * 4);
    for (let index = 0; index < this.currentGeometry.chordSegments.length; index += 1) {
      const seg = this.currentGeometry.chordSegments[index];
      const offset = index * 4;
      chordData[offset] = seg.start;
      chordData[offset + 1] = seg.end;
      chordData[offset + 2] = seg.inner * dpr;
      chordData[offset + 3] = seg.outer * dpr;
    }

    const familyData = new Float32Array(MAX_SEGMENTS * 4);
    for (let index = 0; index < this.currentGeometry.familySegments.length; index += 1) {
      const seg = this.currentGeometry.familySegments[index];
      const offset = index * 4;
      familyData[offset] = seg.start;
      familyData[offset + 1] = seg.end;
      familyData[offset + 2] = seg.inner * dpr;
      familyData[offset + 3] = seg.outer * dpr;
    }

    gl.uniform1i(this.uniforms.chordCount, this.currentGeometry.chordSegments.length);
    gl.uniform4fv(this.uniforms.chordSegments, chordData);
    gl.uniform1i(this.uniforms.chordActive, this.chordActive);

    gl.uniform1i(this.uniforms.familyCount, this.currentGeometry.familySegments.length);
    gl.uniform4fv(this.uniforms.familySegments, familyData);
    gl.uniform1i(this.uniforms.familyActive, this.familyActive);

    gl.uniform3f(
      this.uniforms.addCircle,
      this.currentLayout.addX * dpr,
      this.currentLayout.addY * dpr,
      this.currentLayout.actionRadius * dpr,
    );

    gl.uniform3f(
      this.uniforms.removeCircle,
      this.currentLayout.removeX * dpr,
      this.currentLayout.removeY * dpr,
      this.currentLayout.actionRadius * 0.88 * dpr,
    );

    gl.uniform1f(this.uniforms.removeDisabled, this.removeDisabled);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

function overlay(rootEl: HTMLElement, state: AppState, layout: StageLayout, geometry: SceneGeometry): void {
  const activeNodeTimingInput = document.activeElement instanceof HTMLInputElement && document.activeElement.matches("input[data-node-timing-input='custom-chord']")
    ? document.activeElement
    : null;
  if (activeNodeTimingInput) {
    restoreNodeTimingChordInputFocus = true;
    nodeTimingChordInputCursor = activeNodeTimingInput.selectionStart ?? activeNodeTimingInput.value.length;
    nodeTimingChordInputSelectionEnd = activeNodeTimingInput.selectionEnd ?? nodeTimingChordInputCursor;
    nodeTimingChordInputSelectionDirection = activeNodeTimingInput.selectionDirection ?? "none";
  }

  const activeDebugInput = document.activeElement instanceof HTMLInputElement && document.activeElement.matches("input[data-debug-input]")
    ? document.activeElement
    : null;
  if (activeDebugInput) {
    debugFooterDraft = activeDebugInput.value;
    restoreDebugInputFocus = true;
  }

  const selectedChord = getSelectedChord(state);
  const family = getSelectedChordFamily(state);
  const selectedNode = selectedGraphNode(state);
  const nodeCount = graphSequence(state.graph).length;
  const selectedNodeTypeLabel = selectedNode ? graphNodeTypeConfig(selectedNode.type).label : "Node";

  const overlayContent = buildOverlayContent(state, layout, geometry);
  const progressionName = state.savedLoopDraft.trim() || "untitled_loop";

  const status = escapeHtml(state.status);
  rootEl.innerHTML = `
    <div class="stage-shell">
      <canvas class="webgl-stage" aria-label="Sonic Saucepan canvas stage"></canvas>
      <div class="corner-controls" role="toolbar" aria-label="Loop controls">
        <button class="corner-btn" data-action="settings" aria-label="Settings" title="Settings">⚙</button>
        <button class="corner-btn" data-action="saved-loops" aria-label="Saved loops" title="Saved loops">📖</button>
        <button class="corner-btn" data-action="add-initial" aria-label="Add initial state" title="Add initial state">◎</button>
        <button class="corner-btn perform ${performPlaying ? "playing" : "paused"}" data-action="perform" aria-label="Perform" title="Perform">
          ${performPlaying ? "❚❚" : "▶"}
        </button>
      </div>
      <div class="central-tone-badge" aria-label="Progression and central tone" role="button" tabindex="0" title="Focus selected chord in ring">
        <span class="central-tone-label">${escapeHtml(progressionName)}</span>
        <span class="central-tone-value">${escapeHtml(state.settings.centralTone)}</span>
      </div>
      <div class="hud">
        <div class="hud-title">Sonic Saucepan</div>
        <div class="hud-copy">Tap a ring to change the family or chord. Use the inner <span>+</span> and <span>-</span> controls to add or remove chord-selection nodes.</div>
        <div class="hud-meta">${escapeHtml(`${nodeCount} nodes · ${family.chords.length} chords · ${selectedNodeTypeLabel}`)}</div>
      </div>
      <div class="overlay" aria-hidden="true">
        ${overlayContent}
      </div>
      <div class="status">${status}</div>
      ${buildDebugFooter(state)}
      ${buildSettingsPanel(state)}
      ${buildPerformPanel(state)}
      ${buildNodeTimingPanel(state)}
      ${buildSavedLoopsPanel(state)}
    </div>
  `;
}

function buildDebugFooter(state: AppState): string {
  if (!state.settings.debugFooterEnabled) {
    return "";
  }

  const summaryRows = debugPanelMidiSummary(state)
    .map((line) => `<div class="debug-summary-line">${escapeHtml(line)}</div>`)
    .join("");
  const rows = state.debugLogs
    .map((line) => `<div class="debug-log-line">${escapeHtml(line)}</div>`)
    .join("");

  return `
    <section class="debug-footer" aria-label="Debug footer">
      <div class="debug-summary" data-debug-summary>${summaryRows}</div>
      <div class="debug-log" data-debug-log>${rows}</div>
      <form class="debug-input-row" data-debug-form>
        <span class="debug-prompt">&gt;</span>
        <input
          type="text"
          data-debug-input
          value="${escapeAttr(debugFooterDraft)}"
          placeholder="type debug note and press Enter"
          aria-label="Debug input"
          autocomplete="off"
        />
      </form>
    </section>
  `;
}

function buildSettingsPanel(state: AppState): string {
  const settings = state.settings;
  const toneOptions = CENTRAL_TONES
    .map((tone) => `<option value="${escapeAttr(tone)}" ${tone === settings.centralTone ? "selected" : ""}>${escapeHtml(tone)}</option>`)
    .join("");
  const channelOptions = Array.from({ length: 16 }, (_, index) => index + 1)
    .map((channel) => `<option value="${channel}" ${channel === settings.midiChannel ? "selected" : ""}>${channel}</option>`)
    .join("");
  const midiPortOptions = settings.midiPorts.length > 0
    ? settings.midiPorts
      .map((port) => `<option value="${escapeAttr(port.id)}" ${port.id === settings.midiPortId ? "selected" : ""}>${escapeHtml(port.name)}</option>`)
      .join("")
    : `<option value="">No MIDI outputs found</option>`;

  return `
    <div class="settings-modal ${settings.showPanel ? "open" : ""}" aria-hidden="${settings.showPanel ? "false" : "true"}">
      <button class="settings-backdrop" data-settings-action="close" aria-label="Close settings"></button>
      <section class="settings-panel" role="dialog" aria-modal="true" tabindex="-1" aria-label="Settings">
        <header class="settings-header">
          <h2>Settings</h2>
          <button class="settings-close" data-settings-action="close" aria-label="Close settings">×</button>
        </header>
        <div class="settings-fields">
          <label class="settings-field">
            <span>Central Tone</span>
            <select data-setting="central-tone">${toneOptions}</select>
          </label>
          <label class="settings-field inline">
            <span>MIDI</span>
            <input type="checkbox" data-setting="midi-enabled" ${settings.midiEnabled ? "checked" : ""} />
          </label>
          <label class="settings-field inline">
            <span>Always Play Chords</span>
            <input type="checkbox" data-setting="always-play-chords" ${settings.alwaysPlayChords ? "checked" : ""} />
          </label>
          <label class="settings-field inline">
            <span>Debug Footer</span>
            <input type="checkbox" data-setting="debug-footer-enabled" ${settings.debugFooterEnabled ? "checked" : ""} />
          </label>
          <label class="settings-field">
            <span>MIDI Port</span>
            <select data-setting="midi-port" ${settings.midiEnabled ? "" : "disabled"}>${midiPortOptions}</select>
          </label>
          <label class="settings-field">
            <span>MIDI Channel</span>
            <select data-setting="midi-channel" ${settings.midiEnabled ? "" : "disabled"}>${channelOptions}</select>
          </label>
        </div>
      </section>
    </div>
  `;
}

function buildPerformPanel(state: AppState): string {
  const settings = state.settings;
  const toneOptions = CENTRAL_TONES
    .map((tone) => `<option value="${escapeAttr(tone)}" ${tone === settings.centralTone ? "selected" : ""}>${escapeHtml(tone)}</option>`)
    .join("");
  const waveformOptions = WAVEFORMS
    .map((wave) => `<option value="${wave}" ${wave === settings.waveform ? "selected" : ""}>${escapeHtml(wave[0].toUpperCase() + wave.slice(1))}</option>`)
    .join("");
  const timeSignatureOptions = TIME_SIGNATURES
    .map((signature) => `<option value="${signature}" ${signature === settings.timeSignature ? "selected" : ""}>${escapeHtml(signature)}</option>`)
    .join("");
  const beatsPerChordOptions = BEATS_PER_CHORD_OPTIONS
    .map((v) => `<option value="${v}" ${v === settings.beatsPerChord ? "selected" : ""}>${escapeHtml(bpcLabel(v))}</option>`)
    .join("");
  const bassPresetOptions = BASS_PRESET_OPTIONS
    .map((p) => `<option value="${p}" ${p === settings.bassPreset ? "selected" : ""}>${escapeHtml(BASS_PRESET_LABELS[p])}</option>`)
    .join("");
  const effectsOptions = EFFECT_OPTIONS
    .map((effect) => `<option value="${effect}" ${effect === settings.effects ? "selected" : ""}>${escapeHtml(effect[0].toUpperCase() + effect.slice(1))}</option>`)
    .join("");

  return `
    <div class="settings-modal perform-modal ${settings.showPerformPanel ? "open" : ""}" aria-hidden="${settings.showPerformPanel ? "false" : "true"}">
      <button class="settings-backdrop" data-perform-action="close" aria-label="Close perform options"></button>
      <section class="settings-panel" role="dialog" aria-modal="true" tabindex="-1" aria-label="Perform options">
        <header class="settings-header">
          <h2>Perform Options</h2>
          <button class="settings-close" data-perform-action="close" aria-label="Close perform options">×</button>
        </header>
        <div class="settings-fields">
          <label class="settings-field">
            <span>Central Tone</span>
            <select data-perform-setting="central-tone">${toneOptions}</select>
          </label>
          <label class="settings-field">
            <span data-live-label="bpm">BPM (${settings.bpm})</span>
            <input type="range" min="60" max="240" step="1" value="${settings.bpm}" data-perform-setting="bpm" />
          </label>
          <label class="settings-field">
            <span>Time Signature</span>
            <select data-perform-setting="time-signature">${timeSignatureOptions}</select>
          </label>
          <label class="settings-field">
            <span>Beats Per Chord</span>
            <select data-perform-setting="beats-per-chord">${beatsPerChordOptions}</select>
          </label>
          <label class="settings-field">
            <span data-live-label="swing">Swing (${settings.swing}%)</span>
            <input type="range" min="0" max="75" step="1" value="${settings.swing}" data-perform-setting="swing" />
          </label>
          <label class="settings-field">
            <span data-live-label="humanize-amount">Humanize (${settings.humanizeAmount}%)</span>
            <input type="range" min="0" max="100" step="1" value="${settings.humanizeAmount}" data-perform-setting="humanize-amount" />
          </label>
          <label class="settings-field">
            <span data-live-label="accent-strength">Accent Strength (${settings.accentStrength}%)</span>
            <input type="range" min="0" max="150" step="1" value="${settings.accentStrength}" data-perform-setting="accent-strength" />
          </label>
          <label class="settings-field">
            <span data-live-label="layer-width">Layer Width (${settings.layerWidth}%)</span>
            <input type="range" min="0" max="100" step="1" value="${settings.layerWidth}" data-perform-setting="layer-width" />
          </label>
          <label class="settings-field">
            <span>Waveform</span>
            <select data-perform-setting="waveform">${waveformOptions}</select>
          </label>
          <label class="settings-field">
            <span>Effects</span>
            <select data-perform-setting="effects">${effectsOptions}</select>
          </label>
          <label class="settings-field">
            <span>Bass</span>
            <select data-perform-setting="bass-preset">${bassPresetOptions}</select>
          </label>
        </div>
      </section>
    </div>
  `;
}

function buildNodeTimingPanel(state: AppState): string {
  const settings = state.settings;
  const sequence = graphSequence(state.graph);
  const initialIds = graphHeadIds(state.graph);
  const activeNodeId = state.nodeTimingModalNodeId ?? state.graph.selectedNodeId;
  const activeNode = state.graph.nodes[activeNodeId] ?? null;
  const nodeOptions = sequence
    .map((node, index) => {
      const label = `${index + 1}. ${node.chordName}${initialIds.includes(node.id) ? " (Initial)" : ""}`;
      return `<option value="${node.id}" ${node.id === activeNodeId ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
  const overrideOptions = BEATS_PER_CHORD_OPTIONS
    .map((value) => `<option value="${value}" ${activeNode?.beatsPerChordOverride === value ? "selected" : ""}>${escapeHtml(bpcLabel(value))}</option>`)
    .join("");
  const effective = activeNode
    ? bpcLabel(effectiveBeatsPerChordForNode(state, activeNode.id))
    : bpcLabel(normalizeBeatsPerChord(state.settings.beatsPerChord));
  const initialNames = initialIds
    .map((id) => state.graph.nodes[id]?.chordName)
    .filter((name): name is string => !!name);
  const isActiveNodeHead = !!activeNode && initialIds.includes(activeNode.id);
  const customEnabled = activeNode?.customChordEnabled === true;
  const muted = activeNode?.muted === true;
  const customRaw = activeNode?.customChordRawInput ?? "";
  const customInputValue = activeNode ? nodeTimingDraftInputValue(state, activeNode) : customRaw;
  const customTranspose = activeNode?.customChordTransposeWithCentralTone === true;
  const parsedCustom = activeNode
    ? parseNodeCustomChord(
      {
        ...activeNode,
        customChordRawInput: customInputValue,
      },
      state.settings.centralTone,
    )
    : null;
  const customSourcePreview = customEnabled
    ? (parsedCustom?.tonesText ?? "invalid")
    : "catalog chord";
  const waveformOptions = WAVEFORMS
    .map((value) => {
      const selected = activeNode?.waveformOverride === value;
      return `<option value="${value}" ${selected ? "selected" : ""}>${escapeHtml(value[0].toUpperCase() + value.slice(1))}</option>`;
    })
    .join("");
  const effectsOptions = EFFECT_OPTIONS
    .map((value) => {
      const selected = activeNode?.effectsOverride === value;
      return `<option value="${value}" ${selected ? "selected" : ""}>${escapeHtml(value[0].toUpperCase() + value.slice(1))}</option>`;
    })
    .join("");
  const bassOptions = BASS_PRESET_OPTIONS
    .map((value) => {
      const selected = activeNode?.bassPresetOverride === value;
      return `<option value="${value}" ${selected ? "selected" : ""}>${escapeHtml(BASS_PRESET_LABELS[value])}</option>`;
    })
    .join("");
  const effectiveWaveform = activeNode ? effectiveWaveformForNode(state, activeNode) : state.settings.waveform;
  const effectiveEffects = activeNode ? effectiveEffectsForNode(state, activeNode) : state.settings.effects;
  const effectiveBass = activeNode ? effectiveBassPresetForNode(state, activeNode) : state.settings.bassPreset;

  return `
    <div class="settings-modal node-timing-modal ${settings.showNodeTimingPanel ? "open" : ""}" aria-hidden="${settings.showNodeTimingPanel ? "false" : "true"}">
      <button class="settings-backdrop" data-node-timing-action="close" aria-label="Close node ingredients"></button>
      <section class="settings-panel" role="dialog" aria-modal="true" tabindex="-1" aria-label="Node ingredients">
        <header class="settings-header">
          <h2>Node Ingredients</h2>
          <button class="settings-close" data-node-timing-action="close" aria-label="Close node ingredients">×</button>
        </header>
        <div class="settings-fields">
          <label class="settings-field">
            <span>Editing Node</span>
            <select data-node-timing-setting="node-id">${nodeOptions}</select>
          </label>
          <label class="settings-field">
            <span>Timing Preset</span>
            <select data-node-timing-setting="beats-override">
              <option value="inherit" ${(activeNode?.beatsPerChordOverride ?? null) === null ? "selected" : ""}>Inherit Global (${escapeHtml(bpcLabel(state.settings.beatsPerChord))})</option>
              ${overrideOptions}
            </select>
          </label>
          <div class="settings-field inline node-timing-info">
            <span>Effective For Node</span>
            <strong>${escapeHtml(effective)}</strong>
          </div>
          <div class="settings-field inline node-timing-info">
            <span>Initial States</span>
            <strong>${escapeHtml(initialNames.join(" · ") || "node")}</strong>
          </div>
          <button class="saved-loop-save-btn node-timing-head-btn" data-node-timing-action="make-head" type="button" ${isActiveNodeHead ? "disabled" : ""}>${isActiveNodeHead ? "Already Initial State" : "Set As Initial State"}</button>
          <label class="settings-field">
            <span>Chord Source</span>
            <select data-node-timing-setting="chord-source">
              <option value="catalog" ${customEnabled ? "" : "selected"}>Catalog chord (${escapeHtml(activeNode?.chordName ?? "")})</option>
              <option value="custom" ${customEnabled ? "selected" : ""}>Custom chord</option>
            </select>
          </label>
          <label class="settings-field inline">
            <span>Mute Node</span>
            <input type="checkbox" data-node-timing-setting="muted" ${muted ? "checked" : ""} />
          </label>
          <label class="settings-field inline">
            <span>Transpose With Central Tone</span>
            <input type="checkbox" data-node-timing-setting="custom-transpose" ${customTranspose ? "checked" : ""} ${customEnabled ? "" : "disabled"} />
          </label>
          <label class="settings-field">
            <span>Custom Notes</span>
            <input type="text" value="${escapeAttr(customInputValue)}" data-node-timing-input="custom-chord" placeholder="C E G Bb or 60 64 67" ${customEnabled ? "" : "disabled"} />
          </label>
          <div class="settings-field inline node-timing-info">
            <span>Custom Preview</span>
            <strong data-node-timing-custom-preview>${escapeHtml(customSourcePreview)}</strong>
          </div>
          <button class="saved-loop-save-btn" data-node-timing-action="test-chord" type="button">Test Chord</button>
          <label class="settings-field">
            <span>Waveform</span>
            <select data-node-timing-setting="waveform-override">
              <option value="inherit" ${activeNode?.waveformOverride == null ? "selected" : ""}>Inherit Global (${escapeHtml(state.settings.waveform)})</option>
              ${waveformOptions}
            </select>
          </label>
          <label class="settings-field">
            <span>Effects</span>
            <select data-node-timing-setting="effects-override">
              <option value="inherit" ${activeNode?.effectsOverride == null ? "selected" : ""}>Inherit Global (${escapeHtml(state.settings.effects)})</option>
              ${effectsOptions}
            </select>
          </label>
          <label class="settings-field">
            <span>Bass</span>
            <select data-node-timing-setting="bass-override">
              <option value="inherit" ${activeNode?.bassPresetOverride == null ? "selected" : ""}>Inherit Global (${escapeHtml(BASS_PRESET_LABELS[state.settings.bassPreset])})</option>
              ${bassOptions}
            </select>
          </label>
          <div class="settings-field inline node-timing-info">
            <span>Effective Sound</span>
            <strong data-node-timing-effective-sound>${escapeHtml(`${effectiveWaveform} · ${effectiveEffects} · ${BASS_PRESET_LABELS[effectiveBass]}`)}</strong>
          </div>
        </div>
      </section>
    </div>
  `;
}

function buildSavedLoopsPanel(state: AppState): string {
  const settings = state.settings;
  const pageCount = Math.max(1, Math.ceil(state.savedLoops.length / SAVED_LOOPS_PAGE_SIZE));
  const page = clamp(state.savedLoopsPage, 0, pageCount - 1);
  const pageStart = page * SAVED_LOOPS_PAGE_SIZE;
  const pageLoops = state.savedLoops.slice(pageStart, pageStart + SAVED_LOOPS_PAGE_SIZE);
  const rows = pageLoops
    .map((loop, pageOffset) => {
      const index = pageStart + pageOffset;
      const selected = loop.id === state.savedLoopSelectedId;
      return `
        <li>
          <button class="saved-loop-item ${selected ? "active" : ""}" data-saved-loop-id="${escapeAttr(loop.id)}" type="button" aria-pressed="${selected ? "true" : "false"}">
            <span class="saved-loop-position">${index + 1}</span>
            <span class="saved-loop-name">${escapeHtml(loop.name)}</span>
          </button>
        </li>
      `;
    })
    .join("");

  return `
    <div class="settings-modal saved-loops-modal ${settings.showSavedLoopsPanel ? "open" : ""}" aria-hidden="${settings.showSavedLoopsPanel ? "false" : "true"}">
      <button class="settings-backdrop" data-saved-loops-action="close" aria-label="Close saved loops"></button>
      <section class="settings-panel" role="dialog" aria-modal="true" tabindex="-1" aria-label="Saved loops">
        <header class="settings-header">
          <h2>Saved Loops</h2>
          <button class="settings-close" data-saved-loops-action="close" aria-label="Close saved loops">×</button>
        </header>
        <div class="settings-fields">
          <label class="settings-field">
            <span>Loop Name</span>
            <input type="text" value="${escapeAttr(state.savedLoopDraft)}" placeholder="Type loop name" data-saved-loop-input="name" />
          </label>
          <div class="saved-loop-actions">
            <button class="saved-loop-save-btn" data-saved-loops-action="save" type="button">Save Current State</button>
            <button class="saved-loop-reset-btn" data-saved-loops-action="reset-state" type="button">Reset To Initial Node</button>
          </div>
          <div class="saved-loop-list-wrap">
            <span class="saved-loop-label">Saved Progressions</span>
            <ol class="saved-loop-list">${rows || `<li class="saved-loop-empty">No saved loops yet</li>`}</ol>
          </div>
          <div class="saved-loop-pages" aria-label="Saved loops pages">
            ${Array.from({ length: pageCount }, (_, index) => {
              const active = index === page;
              return `<button class="saved-loop-page-btn ${active ? "active" : ""}" data-saved-loops-page="${index}" type="button" aria-pressed="${active ? "true" : "false"}">${index + 1}</button>`;
            }).join("")}
          </div>
          <div class="saved-loop-index">${state.savedLoops.length} saved loop${state.savedLoops.length === 1 ? "" : "s"} · page ${page + 1} / ${pageCount}</div>
        </div>
      </section>
    </div>
  `;
}

function selectedRingRomanNumeral(state: AppState): string | null {
  return getSelectedChord(state).numeral?.trim() || null;
}

function buildOverlayContent(state: AppState, layout: StageLayout, geometry: SceneGeometry): string {
  const selectedChord = getSelectedChord(state);
  const family = getSelectedChordFamily(state);
  const selectedNode = state.graph.nodes[state.graph.selectedNodeId];
  const majorLabel = state.showSelectedRomanNumeral
    ? (selectedRingRomanNumeral(state) ?? bandLabel(family.name))
    : bandLabel(family.name);
  const nodeViews = buildGraphNodeViews(state, layout);
  const initialNodeIds = new Set(graphHeadIds(state.graph));
  const selectedView = nodeViews.find((view) => view.isSelected);
  const activeCenterX = selectedView?.x ?? layout.centerX;
  const activeCenterY = selectedView?.y ?? layout.centerY;
  const addX = activeCenterX + layout.centerRadius * 0.48;
  const addY = activeCenterY + layout.centerRadius * 0.45;
  const removeX = activeCenterX - layout.centerRadius * 0.48;
  const removeY = activeCenterY + layout.centerRadius * 0.45;

  const chordLabels = state.chordFanVisible
    ? geometry.chordSegments
      .map((seg, index) => {
        const point = segmentMidpoint(layout, seg, activeCenterX, activeCenterY);
        const chord = family.chords[index];
        const labelSource = state.showSelectedRomanNumeral
          ? (chord?.numeral ?? chord?.full_name ?? "I")
          : (chord?.full_name ?? chord?.numeral ?? "I");
        const label = chordLabel(labelSource);
        return `<span class="label chord" style="left:${point.x}px;top:${point.y}px;transform:translate(-50%,-50%) scale(${sceneZoom.toFixed(3)})">${escapeHtml(label)}</span>`;
      })
      .join("")
    : "";

  const familyLabels = geometry.familySegments
    .map((seg, index) => {
      const point = segmentMidpoint(layout, seg, activeCenterX, activeCenterY);
      const familyIndex = geometry.familyIndices[index] ?? 0;
      const label = shorthand(state.catalog.families[familyIndex]?.name ?? "Family");
      return `<span class="label family" style="left:${point.x}px;top:${point.y}px;transform:translate(-50%,-50%) scale(${sceneZoom.toFixed(3)})">${escapeHtml(label)}</span>`;
    })
    .join("");

  const showAddAction = selectedNodeAllowsAction(state, "add-after");
  const showRemoveAction = selectedNodeAllowsAction(state, "remove-selected");
  const actionSymbols = selectedNodeActionSymbols(state);
  const addSymbol = actionSymbols?.add ?? "+";
  const removeSymbol = actionSymbols?.remove ?? "-";

  return `
    <span class="label center" style="left:${activeCenterX}px;top:${activeCenterY}px;transform:translate(-50%,-50%) scale(${sceneZoom.toFixed(3)})">${escapeHtml(chordLabel(selectedNode ? effectiveNodeChordLabel(state, selectedNode) : selectedChord.full_name))}</span>
    <span class="label major" style="left:${activeCenterX}px;top:${activeCenterY - layout.centerRadius + 24}px;transform:translate(-50%,-50%) scale(${sceneZoom.toFixed(3)})">${escapeHtml(majorLabel)}</span>
    ${chordLabels}
    ${familyLabels}
    ${showAddAction ? `<span class="label action plus" style="left:${addX}px;top:${addY}px">${escapeHtml(addSymbol)}</span>` : ""}
    ${showRemoveAction ? `<span class="label action remove" style="left:${removeX}px;top:${removeY}px">${escapeHtml(removeSymbol)}</span>` : ""}
  `;
}

type GraphNodeView = {
  nodeId: number;
  type: GraphNodeType;
  x: number;
  y: number;
  radius: number;
  isSelected: boolean;
  chordName: string;
  displayChordLabel: string;
};

type GestureContext = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  gestureHandled: boolean;
  longPressTimer: number | null;
  mode: "tap" | "drag-node" | "pan";
  targetNodeId: number | null;
  startedOnCenter: boolean;
  lastX: number;
  lastY: number;
};

let sceneZoom = initialSceneZoom;
let scenePan = { ...initialScenePan };
let performPlaying = false;
type PerformTrackState = {
  headId: number;
  pulseColorIndex: number;
  cursorNodeId: number | null;
  stepCount: number;
  beatWithinChord: number;
  currentChordSteps: number;
  timerId: number | null;
};
const performTracks: Record<number, PerformTrackState> = {};
let modalOpenCount = 0;
let resumePerformAfterModalClose = false;
let debugFooterDraft = "";
let restoreDebugInputFocus = false;
let restoreNodeTimingChordInputFocus = false;
let nodeTimingChordInputCursor = 0;
let nodeTimingChordInputSelectionEnd = 0;
let nodeTimingChordInputSelectionDirection: "forward" | "backward" | "none" = "none";
const nodeTimingCustomChordDrafts: Record<number, string> = {};
const nodeOffsets: Record<number, { x: number; y: number }> = { ...initialNodeOffsets };
const nodeVelocities: Record<number, { vx: number; vy: number }> = {};
let forcePinnedNodeId: number | null = null;
let forceRafId = 0;

const FORCE_LINK_DIST_RINGS = 3.3; // multiplier on familyOuter — keeps rings from touching
const FORCE_SPRING_K = 0.035;
const FORCE_REPULSION = 6000;
const FORCE_CENTER = 0.006;
const FORCE_DAMPING = 0.80;

function initMissingNodeOffsets(): void {
  const sequence = graphSequence(store.getState().graph);
  const count = sequence.length;
  sequence.forEach((node, i) => {
    if (!nodeOffsets[node.id]) {
      const angle = count > 1 ? (i / count) * Math.PI * 2 - Math.PI * 0.5 : 0;
      const r = count > 1 ? clamp(count * 55, 80, 300) : 0;
      nodeOffsets[node.id] = {
        x: Math.cos(angle) * r + (Math.random() - 0.5) * 30,
        y: Math.sin(angle) * r + (Math.random() - 0.5) * 30,
      };
    }
  });
}

function stepForceSimulation(layout: StageLayout): number {
  const cx = layout.centerX;
  const cy = layout.centerY;
  const linkDist = layout.familyOuter * FORCE_LINK_DIST_RINGS;
  const sequence = graphSequence(store.getState().graph);
  if (sequence.length === 0) return 0;

  const pos: Record<number, { x: number; y: number }> = {};
  for (const node of sequence) {
    if (!nodeOffsets[node.id]) nodeOffsets[node.id] = { x: (Math.random() - 0.5) * 60, y: (Math.random() - 0.5) * 60 };
    const o = nodeOffsets[node.id];
    pos[node.id] = { x: cx + o.x, y: cy + o.y };
    if (!nodeVelocities[node.id]) nodeVelocities[node.id] = { vx: 0, vy: 0 };
  }

  const fx: Record<number, number> = {};
  const fy: Record<number, number> = {};
  for (const node of sequence) { fx[node.id] = 0; fy[node.id] = 0; }

  // spring forces along each directed edge
  for (const node of sequence) {
    if (node.nextId === node.id) continue; // skip self-loop
    const a = pos[node.id];
    const b = pos[node.nextId];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 0.01;
    const delta = dist - linkDist;
    const f = delta * FORCE_SPRING_K;
    const ffx = (dx / dist) * f;
    const ffy = (dy / dist) * f;
    fx[node.id] += ffx;
    fy[node.id] += ffy;
    if (fx[node.nextId] !== undefined) { fx[node.nextId] -= ffx; fy[node.nextId] -= ffy; }
  }

  // repulsion between all pairs
  for (let i = 0; i < sequence.length; i++) {
    for (let j = i + 1; j < sequence.length; j++) {
      const a = pos[sequence[i].id];
      const b = pos[sequence[j].id];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist2 = Math.max(dx * dx + dy * dy, 1);
      const dist = Math.sqrt(dist2);
      const f = FORCE_REPULSION / dist2;
      fx[sequence[i].id] -= (dx / dist) * f;
      fy[sequence[i].id] -= (dy / dist) * f;
      fx[sequence[j].id] += (dx / dist) * f;
      fy[sequence[j].id] += (dy / dist) * f;
    }
  }

  // centering toward centroid
  let sumX = 0;
  let sumY = 0;
  for (const node of sequence) { sumX += pos[node.id].x; sumY += pos[node.id].y; }
  const centX = sumX / sequence.length;
  const centY = sumY / sequence.length;
  for (const node of sequence) {
    fx[node.id] += (cx - centX) * FORCE_CENTER;
    fy[node.id] += (cy - centY) * FORCE_CENTER;
  }

  // integrate velocities and positions; return total kinetic energy
  let totalKE = 0;
  for (const node of sequence) {
    if (node.id === forcePinnedNodeId) { nodeVelocities[node.id] = { vx: 0, vy: 0 }; continue; }
    const vel = nodeVelocities[node.id]!;
    vel.vx = (vel.vx + fx[node.id]) * FORCE_DAMPING;
    vel.vy = (vel.vy + fy[node.id]) * FORCE_DAMPING;
    totalKE += vel.vx * vel.vx + vel.vy * vel.vy;
    const o = nodeOffsets[node.id]!;
    o.x += vel.vx;
    o.y += vel.vy;
  }
  return totalKE;
}

function runForceLoop(): void {
  const canvas = root.querySelector<HTMLCanvasElement>(".webgl-stage");
  const rect = canvas?.getBoundingClientRect();
  if (canvas && rect && rect.width >= 1 && rect.height >= 1) {
    const layout = buildLayout(rect.width, rect.height);
    const ke = stepForceSimulation(layout);
    if (ke > 0.05) {
      redrawCanvasOnly(canvas);
      forceRafId = window.requestAnimationFrame(runForceLoop);
      return;
    }
    redrawCanvasOnly(canvas);
  }
  // Nodes settled — poll slowly to stay responsive to external state changes.
  forceRafId = window.setTimeout(runForceLoop, 200) as unknown as number;
}

activeSavedLoopId = store.getState().savedLoopSelectedId;
activeSavedLoopSignature = currentLoopStateSignature(store.getState());

const CENTER_PULSE_MS = 620;
let centerPulseRafId = 0;
type ActiveNodePulse = {
  nodeId: number | null;
  colorIndex: number;
  startMs: number;
};
let activeNodePulses: ActiveNodePulse[] = [];

const PULSE_COLOR_PALETTE = [
  "132, 236, 255",
  "160, 248, 198",
  "255, 210, 132",
  "191, 202, 255",
  "255, 176, 200",
];

function stopPerformLoop(): void {
  Object.values(performTracks).forEach((track) => {
    if (track.timerId !== null) {
      window.clearTimeout(track.timerId);
      track.timerId = null;
    }
  });
  Object.keys(performTracks).forEach((key) => {
    delete performTracks[Number(key)];
  });
  performPlaying = false;
}

function currentPerformStepMs(track: PerformTrackState): number {
  const state = store.getState();
  const { bpm, swing } = state.settings;
  const bpc = effectiveBeatsPerChordForNode(state, track.cursorNodeId);
  // For sub-beat values the timer fires every bpc beats; for whole beats it fires every 1 beat.
  const stepBeats = bpc < 1 ? bpc : 1;
  const beatMs = 60000 / clamp(bpm, 40, 240);
  const stepMs = beatMs * stepBeats;
  if (swing <= 0 || stepBeats < 1) {
    return stepMs;
  }
  const swingRatio = clamp(swing / 100, 0, 0.75);
  const isOddStep = track.stepCount % 2 === 1;
  const multiplier = isOddStep ? 1 - swingRatio * 0.5 : 1 + swingRatio * 0.5;
  return stepMs * multiplier;
}

function scheduleNextPerformStep(track: PerformTrackState): void {
  if (!performPlaying) {
    return;
  }
  const delayMs = currentPerformStepMs(track);
  track.timerId = window.setTimeout(() => {
    if (!performPlaying) {
      return;
    }
    track.stepCount += 1;
    performStep(track);
    scheduleNextPerformStep(track);
  }, delayMs);
}

function pulseStrengthForStart(startMs: number, nowMs: number): number {
  if (startMs <= 0) {
    return 0;
  }
  const elapsed = nowMs - startMs;
  if (elapsed < 0 || elapsed > CENTER_PULSE_MS) {
    return 0;
  }
  const t = clamp(elapsed / CENTER_PULSE_MS, 0, 1);
  return Math.sin(t * Math.PI) * (1 - t * 0.25);
}

function hasActivePulses(nowMs: number): boolean {
  return activeNodePulses.some((pulse) => pulseStrengthForStart(pulse.startMs, nowMs) > 0.001);
}

function schedulePulseRedraw(): void {
  if (centerPulseRafId !== 0) {
    return;
  }

  centerPulseRafId = window.requestAnimationFrame(function tick(nowMs) {
    centerPulseRafId = 0;
    const canvas = root.querySelector<HTMLCanvasElement>(".webgl-stage");
    if (!canvas) {
      return;
    }

    redrawCanvasOnly(canvas);
    if (hasActivePulses(nowMs)) {
      schedulePulseRedraw();
    }
  });
}

function triggerCenterPulse(nodeId?: number, colorIndex = 0): void {
  const now = performance.now();
  activeNodePulses = activeNodePulses.filter((pulse) => pulseStrengthForStart(pulse.startMs, now) > 0.001);
  activeNodePulses.push({
    nodeId: nodeId ?? null,
    colorIndex,
    startMs: now,
  });
  if (activeNodePulses.length > 24) {
    activeNodePulses = activeNodePulses.slice(activeNodePulses.length - 24);
  }
  schedulePulseRedraw();
}

function syncSelectionToNode(
  nodeId: number,
  status: string,
  options?: {
    updateSelection?: boolean;
    sustainMs?: number;
    velocity?: number;
    humanize?: boolean;
    humanizeAmount?: number;
    layerWidth?: number;
    playbackGraph?: LoopGraph;
    pulseNodeId?: number;
    pulseColorIndex?: number;
  },
): void {
  const state = store.getState();
  const playbackGraph = options?.playbackGraph ?? state.graph;
  const node = playbackGraph.nodes[nodeId];
  if (!node) {
    return;
  }

  const updateSelection = options?.updateSelection ?? true;
  const nodeMuted = node.muted === true;

  const nodeWaveform = effectiveWaveformForNode(state, node);
  const nodeEffects = effectiveEffectsForNode(state, node);
  const customPlayback = resolveNodeCustomPlaybackData(state, node);
  const match = customPlayback ? null : findChordInCatalog(state.catalog, node.chordName);
  const updatedGraph = updateSelection
    ? {
      ...state.graph,
      selectedNodeId: nodeId,
    }
    : state.graph;

  if (!nodeMuted && customPlayback) {
    const skipSound = !state.settings.alwaysPlayChords && performPlaying && updateSelection;
    if (!skipSound) {
      playChordPreview({ full_name: node.chordName || customPlayback.label }, {
        pulseNodeId: options?.pulseNodeId,
        pulseColorIndex: options?.pulseColorIndex,
        sustainMs: options?.sustainMs,
        velocity: options?.velocity,
        humanize: options?.humanize,
        humanizeAmount: options?.humanizeAmount,
        layerWidth: options?.layerWidth,
        midiNotesOverride: customPlayback.midiNotes,
        tonesTextOverride: customPlayback.tonesText,
        labelOverride: customPlayback.label,
        familyNameOverride: "Custom",
        waveformOverride: nodeWaveform,
        effectsOverride: nodeEffects,
      });
    }
  } else if (!nodeMuted && match) {
    const chord = state.catalog.families[match.familyIndex]?.chords[match.chordIndex];
    if (chord) {
      const skipSound = !state.settings.alwaysPlayChords && performPlaying && updateSelection;
      if (!skipSound) {
        playChordPreview(chord, {
          pulseNodeId: options?.pulseNodeId,
          pulseColorIndex: options?.pulseColorIndex,
          sustainMs: options?.sustainMs,
          velocity: options?.velocity,
          humanize: options?.humanize,
          humanizeAmount: options?.humanizeAmount,
          layerWidth: options?.layerWidth,
          waveformOverride: nodeWaveform,
          effectsOverride: nodeEffects,
        });
      }
    }
  }

  if (updateSelection) {
    saveGraph(updatedGraph);
    const keepCatalogSelection = performPlaying;
    store.setState({
      ...state,
      graph: updatedGraph,
      selectedFamilyIndex: keepCatalogSelection
        ? state.selectedFamilyIndex
        : (match?.familyIndex ?? state.selectedFamilyIndex),
      selectedChordIndex: keepCatalogSelection
        ? state.selectedChordIndex
        : (match?.chordIndex ?? state.selectedChordIndex),
      // During perform playback, do not auto-expand/switch family fan.
      chordFanVisible: keepCatalogSelection ? state.chordFanVisible : true,
      status,
    });
  }
}

function performStep(track: PerformTrackState): void {
  const state = store.getState();
  const graph = state.graph;
  const isChordBoundary = track.beatWithinChord === 0;
  if (!graph.nodes[track.headId]) {
    const fallbackHead = graphHeadIds(graph)[0];
    if (fallbackHead === undefined) {
      return;
    }
    track.headId = fallbackHead;
  }
  if (track.cursorNodeId === null || !graph.nodes[track.cursorNodeId]) {
    track.cursorNodeId = track.headId;
  } else if (isChordBoundary && track.stepCount > 0) {
    track.cursorNodeId = graph.nodes[track.cursorNodeId]?.nextId ?? track.headId;
  }

  if (track.cursorNodeId === null) {
    return;
  }

  const nodeBeatsPerChord = effectiveBeatsPerChordForNode(state, track.cursorNodeId);
  // Sub-beat: every step is a chord boundary. Whole-beat: boundary every N beats.
  const stepsPerChord = nodeBeatsPerChord < 1 ? 1 : nodeBeatsPerChord;
  track.currentChordSteps = stepsPerChord;

  if (isChordBoundary) {
    const chordName = graph.nodes[track.cursorNodeId]?.chordName ?? "state";
    const { bpm, accentStrength, humanizeAmount, layerWidth } = state.settings;
    const beatMs = 60000 / clamp(bpm, 40, 240);
    const sustainMs = nodeBeatsPerChord * beatMs * 0.92;
    const chordAccent = computeAccent(0, stepsPerChord, accentStrength);
    const humanizeDepth = clamp(humanizeAmount / 100, 0, 1);
    syncSelectionToNode(track.cursorNodeId, `Performing ${chordName}`, {
      updateSelection: false,
      sustainMs,
      velocity: chordAccent,
      humanize: true,
      humanizeAmount: humanizeDepth,
      layerWidth,
      pulseNodeId: track.cursorNodeId,
      pulseColorIndex: track.pulseColorIndex,
    });
    const node = graph.nodes[track.cursorNodeId];
    const nodeMuted = node?.muted === true;
    const bassPreset = node ? effectiveBassPresetForNode(state, node) : state.settings.bassPreset;
    const catalog = state.catalog;
    const customPlayback = node ? resolveNodeCustomPlaybackData(state, node) : null;
    const match = node && !customPlayback ? findChordInCatalog(catalog, node.chordName) : null;
    const chordEntry = match ? catalog.families[match.familyIndex]?.chords[match.chordIndex] : null;
    if (!nodeMuted && chordEntry) {
      const bassNotes = computeBassNotes(chordEntry, bassPreset, 0, stepsPerChord);
      playBassNotes(bassNotes, beatMs, {
        velocity: chordAccent,
        accent: chordAccent,
        humanize: true,
        humanizeAmount: humanizeDepth,
      });
    } else if (!nodeMuted && customPlayback && customPlayback.midiNotes.length > 0) {
      const bassNotes = computeBassNotesFromRootMidi(customPlayback.midiNotes[0], bassPreset, 0, stepsPerChord);
      playBassNotes(bassNotes, beatMs, {
        velocity: chordAccent,
        accent: chordAccent,
        humanize: true,
        humanizeAmount: humanizeDepth,
      });
    }
  } else {
    // On non-boundary beats, handle beat-aware bass patterns (oom-pah, stride).
    const { bpm, accentStrength, humanizeAmount } = state.settings;
    const beatMs = 60000 / clamp(bpm, 40, 240);
    const beatWithinChord = track.beatWithinChord;
    const node = track.cursorNodeId !== null ? graph.nodes[track.cursorNodeId] : null;
    const nodeMuted = node?.muted === true;
    const bassPreset = node ? effectiveBassPresetForNode(state, node) : state.settings.bassPreset;
    const customPlayback = node ? resolveNodeCustomPlaybackData(state, node) : null;
    const match = node && !customPlayback ? findChordInCatalog(state.catalog, node.chordName) : null;
    const chordEntry = match ? state.catalog.families[match.familyIndex]?.chords[match.chordIndex] : null;
    if (!nodeMuted && chordEntry) {
      const bassNotes = computeBassNotes(chordEntry, bassPreset, beatWithinChord, stepsPerChord);
      const beatAccent = computeAccent(beatWithinChord, stepsPerChord, accentStrength);
      const humanizeDepth = clamp(humanizeAmount / 100, 0, 1);
      playBassNotes(bassNotes, beatMs, {
        velocity: beatAccent,
        accent: beatAccent,
        humanize: true,
        humanizeAmount: humanizeDepth,
      });
    } else if (!nodeMuted && customPlayback && customPlayback.midiNotes.length > 0) {
      const bassNotes = computeBassNotesFromRootMidi(customPlayback.midiNotes[0], bassPreset, beatWithinChord, stepsPerChord);
      const beatAccent = computeAccent(beatWithinChord, stepsPerChord, accentStrength);
      const humanizeDepth = clamp(humanizeAmount / 100, 0, 1);
      playBassNotes(bassNotes, beatMs, {
        velocity: beatAccent,
        accent: beatAccent,
        humanize: true,
        humanizeAmount: humanizeDepth,
      });
    }
  }

  if (track.beatWithinChord + 1 >= track.currentChordSteps) {
    track.beatWithinChord = 0;
  } else {
    track.beatWithinChord += 1;
  }
}

function startPerformLoop(options?: { resetCursor?: boolean }): void {
  const resetCursor = options?.resetCursor ?? true;
  const previousTracks = { ...performTracks };
  stopPerformLoop();
  const state = store.getState();
  const headIds = graphHeadIds(state.graph);
  if (headIds.length === 0) {
    return;
  }
  performPlaying = true;
  headIds.forEach((headId, headIndex) => {
    const track: PerformTrackState = {
      headId,
      pulseColorIndex: headIndex,
      cursorNodeId: resetCursor ? null : (previousTracks[headId]?.cursorNodeId ?? null),
      stepCount: 0,
      beatWithinChord: 0,
      currentChordSteps: 1,
      timerId: null,
    };
    performTracks[headId] = track;
    performStep(track);
    scheduleNextPerformStep(track);
  });
}

function handleModalOpened(): void {
  if (modalOpenCount === 0 && performPlaying) {
    resumePerformAfterModalClose = true;
    stopPerformLoop();
  }
  modalOpenCount += 1;
}

function handleModalClosed(): void {
  modalOpenCount = Math.max(0, modalOpenCount - 1);
  if (modalOpenCount === 0 && resumePerformAfterModalClose) {
    resumePerformAfterModalClose = false;
    startPerformLoop({ resetCursor: false });
  }
}

function buildGraphNodeViews(state: AppState, layout: StageLayout): GraphNodeView[] {
  const sequence = graphSequence(state.graph);
  const selectedId = state.graph.selectedNodeId;
  const views: GraphNodeView[] = [];

  sequence.forEach((node) => {
    const offset = nodeOffsets[node.id] ?? { x: 0, y: 0 };
    const isSelected = node.id === selectedId;
    const radius = layout.chordOuter;

    views.push({
      nodeId: node.id,
      type: node.type,
      x: layout.centerX + offset.x,
      y: layout.centerY + offset.y,
      radius,
      isSelected,
      chordName: node.chordName,
      displayChordLabel: chordLabel(effectiveNodeChordLabel(state, node)),
    });
  });

  return views;
}

function panTowardsNode(canvas: HTMLCanvasElement, nodeId: number, amount = 0.88): void {
  const offset = nodeOffsets[nodeId];
  if (!offset) {
    return;
  }

  if (addNodePanRafId) {
    window.cancelAnimationFrame(addNodePanRafId);
    addNodePanRafId = 0;
  }

  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    return;
  }

  const startPanX = scenePan.x;
  const startPanY = scenePan.y;
  // Centering the node means moving scene pan toward the inverse node offset.
  const targetPanX = -offset.x;
  const targetPanY = -offset.y;
  const panAmount = clamp(amount, 0, 1);
  const endPanX = startPanX + (targetPanX - startPanX) * panAmount;
  const endPanY = startPanY + (targetPanY - startPanY) * panAmount;
  const startedAt = performance.now();
  const durationMs = 220;

  const animatePan = (now: number): void => {
    const t = clamp((now - startedAt) / durationMs, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);

    scenePan.x = startPanX + (endPanX - startPanX) * eased;
    scenePan.y = startPanY + (endPanY - startPanY) * eased;
    redrawCanvasOnly(canvas);

    if (t < 1) {
      addNodePanRafId = window.requestAnimationFrame(animatePan);
      return;
    }

    addNodePanRafId = 0;
    saveInteractionState();
  };

  addNodePanRafId = window.requestAnimationFrame(animatePan);
}

function constrainGraphViewport(state: AppState, layout: StageLayout): void {
  const views = buildGraphNodeViews(state, layout);
  if (views.length === 0) {
    return;
  }

  const marginX = 36;
  const marginY = 48;
  const selectedHalf = layout.chordOuter + 18;
  const compositionMinX = layout.centerX - selectedHalf;
  const compositionMaxX = layout.centerX + selectedHalf;
  const compositionMinY = layout.centerY - selectedHalf;
  const compositionMaxY = layout.centerY + selectedHalf;

  const minX = Math.min(compositionMinX, ...views.map((view) => view.x - view.radius));
  const maxX = Math.max(compositionMaxX, ...views.map((view) => view.x + view.radius));
  const minY = Math.min(compositionMinY, ...views.map((view) => view.y - view.radius));
  const maxY = Math.max(compositionMaxY, ...views.map((view) => view.y + view.radius));

  const availableWidth = layout.width - marginX * 2;
  const availableHeight = layout.height - marginY * 2;
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  if (spanX <= availableWidth) {
    if (minX < marginX) {
      scenePan.x += marginX - minX;
    } else if (maxX > layout.width - marginX) {
      scenePan.x -= maxX - (layout.width - marginX);
    }
  } else {
    const centerX = (minX + maxX) * 0.5;
    scenePan.x += layout.width * 0.5 - centerX;
  }

  if (spanY <= availableHeight) {
    if (minY < marginY) {
      scenePan.y += marginY - minY;
    } else if (maxY > layout.height - marginY) {
      scenePan.y -= maxY - (layout.height - marginY);
    }
  } else {
    const centerY = (minY + maxY) * 0.5;
    scenePan.y += layout.height * 0.5 - centerY;
  }
}

function findGraphNodeViewById(views: GraphNodeView[], nodeId: number): GraphNodeView | null {
  return views.find((view) => view.nodeId === nodeId) ?? null;
}

function trimNodeOffsets(graph: LoopGraph): void {
  const validIds = new Set(Object.keys(graph.nodes));
  for (const key of Object.keys(nodeOffsets)) {
    if (!validIds.has(key)) {
      delete nodeOffsets[key];
      delete nodeVelocities[Number(key)];
    }
  }
}

function buildHitZones(layout: StageLayout, geometry: SceneGeometry, state: AppState): HitZone[] {
  const zones: HitZone[] = [];
  const showAddAction = selectedNodeAllowsAction(state, "add-after");
  const showRemoveAction = selectedNodeAllowsAction(state, "remove-selected");
  const showCenterCycle = selectedNodeAllowsAction(state, "cycle-selection");
  const nodeViews = buildGraphNodeViews(state, layout);
  const initialNodeIds = new Set(graphHeadIds(state.graph));
  const selectedView = nodeViews.find((view) => view.isSelected);
  const activeCenterX = selectedView?.x ?? layout.centerX;
  const activeCenterY = selectedView?.y ?? layout.centerY;
  const addX = activeCenterX + layout.centerRadius * 0.48;
  const addY = activeCenterY + layout.centerRadius * 0.45;
  const removeX = activeCenterX - layout.centerRadius * 0.48;
  const removeY = activeCenterY + layout.centerRadius * 0.45;

  geometry.chordSegments.forEach((seg, index) => {
    zones.push({
      kind: "chord",
      index,
      cx: activeCenterX,
      cy: activeCenterY,
      segment: seg,
    });
  });

  geometry.familySegments.forEach((seg, index) => {
    const familyIndex = geometry.familyIndices[index] ?? 0;
    zones.push({
      kind: "family",
      index: familyIndex,
      cx: activeCenterX,
      cy: activeCenterY,
      segment: seg,
    });
  });

  if (showCenterCycle) {
    zones.push({
      kind: "center",
      cx: activeCenterX,
      cy: activeCenterY,
      radius: layout.centerRadius,
    });
  }

  // Add/remove controls overlap the center area, so they must be checked before center-cycle.
  if (showAddAction) {
    zones.push({
      kind: "add",
      cx: addX,
      cy: addY,
      radius: layout.actionRadius,
    });
  }

  if (showRemoveAction) {
    zones.push({
      kind: "remove",
      cx: removeX,
      cy: removeY,
      radius: layout.actionRadius * 0.88,
    });
  }

  nodeViews.forEach((view) => {
    if (view.isSelected) {
      return;
    }

    zones.push({
      kind: "graph-node",
      nodeId: view.nodeId,
      cx: view.x,
      cy: view.y,
      radius: view.radius + 10,
    });
  });

  return zones;
}

function drawFallback2d(
  canvas: HTMLCanvasElement,
  layout: StageLayout,
  geometry: SceneGeometry,
  state: AppState,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(layout.width * dpr));
  canvas.height = Math.max(1, Math.floor(layout.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const bg = ctx.createRadialGradient(
    layout.centerX,
    layout.centerY - layout.centerRadius,
    24,
    layout.centerX,
    layout.centerY,
    Math.max(layout.width, layout.height) * 0.66,
  );
  bg.addColorStop(0, "rgba(20, 36, 82, 0.5)");
  bg.addColorStop(1, "rgba(5, 10, 20, 0.96)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, layout.width, layout.height);

  function drawSegment(seg: Segment, fill: string, stroke: string): void {
    ctx.beginPath();
    ctx.arc(activeCenterX, activeCenterY, seg.outer, seg.start, seg.end);
    ctx.arc(activeCenterX, activeCenterY, seg.inner, seg.end, seg.start, true);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawSegmentAt(cx: number, cy: number, seg: Segment, scale: number, fill: string, stroke: string, lineWidth = 1.6): void {
    ctx.beginPath();
    ctx.arc(cx, cy, seg.outer * scale, seg.start, seg.end);
    ctx.arc(cx, cy, seg.inner * scale, seg.end, seg.start, true);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  const nodeViews = buildGraphNodeViews(state, layout);
  const initialNodeIds = new Set(graphHeadIds(state.graph));
  const selectedView = nodeViews.find((view) => view.isSelected);
  const activeCenterX = selectedView?.x ?? layout.centerX;
  const activeCenterY = selectedView?.y ?? layout.centerY;
  const addX = activeCenterX + layout.centerRadius * 0.48;
  const addY = activeCenterY + layout.centerRadius * 0.45;
  const removeX = activeCenterX - layout.centerRadius * 0.48;
  const removeY = activeCenterY + layout.centerRadius * 0.45;

  for (let index = 0; index < geometry.familySegments.length; index += 1) {
    const seg = geometry.familySegments[index];
    const active = state.selectedFamilyIndex === (geometry.familyIndices[index] ?? -1);
    drawSegment(
      seg,
      active ? "rgba(26, 56, 95, 0.9)" : "rgba(9, 17, 38, 0.9)",
      active ? "rgba(121, 214, 255, 0.9)" : "rgba(96, 145, 243, 0.7)",
    );
  }

  // Keep the major text label but avoid drawing the orange arc, which collides visually with the inner circle.

  for (let index = 0; index < geometry.chordSegments.length; index += 1) {
    const seg = geometry.chordSegments[index];
    const active = index === state.selectedChordIndex;
    drawSegment(
      seg,
      active ? "rgba(19, 57, 84, 0.96)" : "rgba(12, 20, 48, 0.94)",
      active ? "rgba(118, 230, 255, 0.95)" : "rgba(107, 165, 255, 0.72)",
    );
  }

  ctx.beginPath();
  ctx.arc(activeCenterX, activeCenterY, layout.centerRadius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(6, 14, 31, 0.96)";
  ctx.fill();
  ctx.strokeStyle = "rgba(104, 169, 255, 0.9)";
  ctx.lineWidth = 3;
  ctx.stroke();

  if (initialNodeIds.has(state.graph.selectedNodeId)) {
    ctx.beginPath();
    ctx.arc(activeCenterX, activeCenterY, layout.familyInner, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 178, 60, 0.92)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  const pulseNow = performance.now();
  activeNodePulses = activeNodePulses.filter((pulse) => pulseStrengthForStart(pulse.startMs, pulseNow) > 0.001);
  activeNodePulses.forEach((pulse) => {
    const pulseStrength = pulseStrengthForStart(pulse.startMs, pulseNow);
    if (pulseStrength <= 0.001) {
      return;
    }
    const pulseNodeView = pulse.nodeId !== null
      ? findGraphNodeViewById(nodeViews, pulse.nodeId)
      : null;
    const pulseCenterX = pulseNodeView?.x ?? activeCenterX;
    const pulseCenterY = pulseNodeView?.y ?? activeCenterY;
    const color = PULSE_COLOR_PALETTE[Math.abs(pulse.colorIndex) % PULSE_COLOR_PALETTE.length] ?? "132, 236, 255";

    ctx.beginPath();
    ctx.arc(pulseCenterX, pulseCenterY, layout.centerRadius + pulseStrength * 4.4, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${color}, ${0.24 + pulseStrength * 0.7})`;
    ctx.lineWidth = 3 + pulseStrength * 8;
    ctx.shadowColor = `rgba(${color}, 0.95)`;
    ctx.shadowBlur = 8 + pulseStrength * 26;
    ctx.stroke();
    ctx.shadowBlur = 0;
  });

  const showAddAction = selectedNodeAllowsAction(state, "add-after");
  const showRemoveAction = selectedNodeAllowsAction(state, "remove-selected");

  if (showAddAction) {
    ctx.beginPath();
    ctx.arc(addX, addY, layout.actionRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8, 15, 34, 0.94)";
    ctx.fill();
    ctx.strokeStyle = "rgba(126, 216, 255, 0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (showRemoveAction) {
    ctx.beginPath();
    ctx.arc(removeX, removeY, layout.actionRadius * 0.88, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8, 15, 34, 0.94)";
    ctx.fill();
    ctx.strokeStyle = "rgba(154, 172, 214, 0.86)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  {
    const sequence = graphSequence(state.graph);

    sequence.forEach((node) => {
    const from = findGraphNodeViewById(nodeViews, node.id);
    const to = findGraphNodeViewById(nodeViews, node.nextId);
    if (!from || !to) {
      return;
    }

    const isReturnToHead = initialNodeIds.has(node.nextId);
    const fromStyle = graphNodeTypeConfig(from.type).renderStyle;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) {
      // Keep the self-loop outside the family ring so it does not read as an inner-circle border.
      const loopRadius = Math.max(11, layout.centerRadius * 0.12);
      const ringPadding = Math.max(8, layout.centerRadius * 0.06);
      const loopOrbit = layout.familyOuter + loopRadius + ringPadding;
      const loopAngle = -Math.PI * 0.34;
      const loopCenterX = from.x + Math.cos(loopAngle) * loopOrbit;
      const loopCenterY = from.y + Math.sin(loopAngle) * loopOrbit;
      const loopStart = Math.PI * 0.15;
      const loopEnd = Math.PI * 1.7;
      ctx.beginPath();
      ctx.arc(loopCenterX, loopCenterY, loopRadius, loopStart, loopEnd);
      ctx.strokeStyle = fromStyle.edgeStroke;
      ctx.lineWidth = 2.2;
      ctx.stroke();

      const endAngle = loopEnd;
      const endX = loopCenterX + Math.cos(endAngle) * loopRadius;
      const endY = loopCenterY + Math.sin(endAngle) * loopRadius;
      const tx = -Math.sin(endAngle);
      const ty = Math.cos(endAngle);
      const head = 5.5;
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX - tx * head + ty * head * 0.56, endY - ty * head - tx * head * 0.56);
      ctx.lineTo(endX - tx * head - ty * head * 0.56, endY - ty * head + tx * head * 0.56);
      ctx.closePath();
      ctx.fillStyle = fromStyle.edgeArrowFill;
      ctx.fill();
      return;
    }

    const ux = dx / len;
    const uy = dy / len;
    const edgeR = layout.familyOuter;
    const startX = from.x + ux * edgeR;
    const startY = from.y + uy * edgeR;
    const endX = to.x - ux * edgeR;
    const endY = to.y - uy * edgeR;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = fromStyle.edgeStroke;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    const head = 8;
    const nx = -uy;
    const ny = ux;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - ux * head + nx * head * 0.58, endY - uy * head + ny * head * 0.58);
    ctx.lineTo(endX - ux * head - nx * head * 0.58, endY - uy * head - ny * head * 0.58);
    ctx.closePath();
    ctx.fillStyle = fromStyle.edgeArrowFill;
    ctx.fill();
    void isReturnToHead; // retained for potential future use
    });

    nodeViews.forEach((view) => {
    if (view.isSelected) {
      return;
    }

    const nodeScale = 1;
    const match = findChordInCatalog(state.catalog, view.chordName);
    const nodeFamilyIndex = match?.familyIndex ?? state.selectedFamilyIndex;
    const nodeFamily = state.catalog.families[nodeFamilyIndex] ?? getSelectedChordFamily(state);
    const nodeChordCount = clamp(nodeFamily.chords.length, 1, MAX_SEGMENTS);
    const nodeChordIndex = clamp(match?.chordIndex ?? 0, 0, Math.max(0, nodeChordCount - 1));
    const familyIndices = visibleFamilyIndices(state, Math.min(state.catalog.families.length, MAX_SEGMENTS));
    const familySegments = makeSegments(
      familyIndices.length,
      -90,
      270,
      layout.familyInner,
      layout.familyOuter,
      1.2,
    );
    const selectedFamilySegmentIndex = familyIndices.indexOf(nodeFamilyIndex);
    let chordSegments: Segment[] = [];

    if (selectedFamilySegmentIndex >= 0) {
      const selectedFamilySegment = familySegments[selectedFamilySegmentIndex];
      if (selectedFamilySegment) {
        const familyArc = selectedFamilySegment.end - selectedFamilySegment.start;
        const expandedArc = Math.min((138 * Math.PI) / 180, familyArc * 2.1);
        const centerAngle = (selectedFamilySegment.start + selectedFamilySegment.end) * 0.5;
        const expandedStart = centerAngle - expandedArc * 0.5;
        const gap = (2 * Math.PI) / 180;
        const step = expandedArc / nodeChordCount;
        chordSegments = Array.from({ length: nodeChordCount }, (_, index) => ({
          start: expandedStart + step * index + gap * 0.5,
          end: expandedStart + step * (index + 1) - gap * 0.5,
          inner: layout.chordInner,
          outer: layout.chordOuter,
        }));
      }
    }

    if (chordSegments.length === 0) {
      chordSegments = makeSegments(
        nodeChordCount,
        230,
        330,
        layout.chordInner,
        layout.chordOuter,
        2.4,
      );
    }

    familySegments.forEach((seg, index) => {
      const active = index === selectedFamilySegmentIndex;
      drawSegmentAt(
        view.x,
        view.y,
        seg,
        nodeScale,
        active ? "rgba(26, 56, 95, 0.86)" : "rgba(9, 17, 38, 0.88)",
        active ? "rgba(121, 214, 255, 0.84)" : "rgba(96, 145, 243, 0.62)",
        1.25,
      );
    });

    chordSegments.forEach((seg, index) => {
      const active = index === nodeChordIndex;
      drawSegmentAt(
        view.x,
        view.y,
        seg,
        nodeScale,
        active ? "rgba(19, 57, 84, 0.9)" : "rgba(12, 20, 48, 0.9)",
        active ? "rgba(118, 230, 255, 0.9)" : "rgba(107, 165, 255, 0.66)",
        1.35,
      );
    });

    // base sizes mirror CSS clamp minimums; sceneZoom mirrors transform:scale on the HTML overlay
    const familyFontPx = Math.max(1, Math.round(12.5 * sceneZoom));
    const chordFontPx = Math.max(1, Math.round(16.8 * sceneZoom));

    familySegments.forEach((seg, index) => {
      const familyIndex = familyIndices[index] ?? 0;
      const familyName = shorthand(state.catalog.families[familyIndex]?.name ?? "Family");
      const point = segmentMidpoint(layout, seg, view.x, view.y);
      ctx.fillStyle = "rgba(139, 182, 255, 0.88)";
      ctx.font = `400 ${familyFontPx}px 'Space Grotesk', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(familyName, point.x, point.y);
    });

    chordSegments.forEach((seg, index) => {
      const chord = nodeFamily.chords[index];
      const labelSource = state.showSelectedRomanNumeral
        ? (chord?.numeral ?? chord?.full_name ?? "I")
        : (chord?.full_name ?? chord?.numeral ?? "I");
      const label = chordLabel(labelSource);
      const point = segmentMidpoint(layout, seg, view.x, view.y);
      ctx.fillStyle = "rgba(139, 182, 255, 0.88)";
      ctx.font = `500 ${chordFontPx}px 'Cormorant Garamond', serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, point.x, point.y);
    });

    const nodeAddX = view.x + layout.centerRadius * 0.48;
    const nodeAddY = view.y + layout.centerRadius * 0.45;
    const nodeRemoveX = view.x - layout.centerRadius * 0.48;
    const nodeRemoveY = view.y + layout.centerRadius * 0.45;

    ctx.beginPath();
    ctx.arc(nodeAddX, nodeAddY, layout.actionRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8, 15, 34, 0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(126, 216, 255, 0.78)";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(nodeRemoveX, nodeRemoveY, layout.actionRadius * 0.88, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8, 15, 34, 0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(154, 172, 214, 0.72)";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.fillStyle = "rgba(214, 239, 255, 0.96)";
    ctx.font = "700 16px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("+", nodeAddX, nodeAddY + 0.5);
    ctx.fillText("-", nodeRemoveX, nodeRemoveY + 0.5);

    const isHead = initialNodeIds.has(view.nodeId);
    const viewStyle = graphNodeTypeConfig(view.type).renderStyle;
    ctx.beginPath();
    ctx.arc(view.x, view.y, layout.centerRadius * nodeScale, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(6, 14, 31, 0.95)";
    ctx.fill();
    ctx.strokeStyle = viewStyle.nodeStroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (isHead) {
      ctx.beginPath();
      ctx.arc(view.x, view.y, layout.familyInner * nodeScale, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 178, 60, 0.92)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const centerFontPx = Math.max(1, Math.round(35.2 * sceneZoom));
    ctx.fillStyle = "rgba(116, 183, 255, 0.95)";
    ctx.font = `500 ${centerFontPx}px 'Cormorant Garamond', serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(view.displayChordLabel.slice(0, 9), view.x, view.y + 1);
    });
  }
}

function pointerToCanvas(canvas: HTMLCanvasElement, event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function hitTest(zones: HitZone[], point: { x: number; y: number }): HitZone | null {
  for (let index = zones.length - 1; index >= 0; index -= 1) {
    const zone = zones[index];
    if (zone.kind === "chord" || zone.kind === "family") {
      if (pointInRingSegment(point, zone)) {
        return zone;
      }
      continue;
    }
    const dx = point.x - zone.cx;
    const dy = point.y - zone.cy;
    if (dx * dx + dy * dy <= zone.radius * zone.radius) {
      return zone;
    }
  }
  return null;
}

let stage: WebGlStage | null = null;
let hitZones: HitZone[] = [];
let rafId = 0;
let resizeObserver: ResizeObserver | null = null;
let pressContext: GestureContext | null = null;
let webglUnavailable = false;
const FORCE_CANVAS_RENDERER = true;
let addNodePanRafId = 0;

function selectFamily(index: number): void {
  const state = store.getState();
  const next = wrapIndex(index, state.catalog.families.length);
  store.setState({
    selectedFamilyIndex: next,
    selectedChordIndex: 0,
    chordFanVisible: true,
    status: `Focused family ${state.catalog.families[next].name}`,
  });
}

function selectChord(index: number): void {
  const state = store.getState();
  const family = getSelectedChordFamily(state);
  const next = wrapIndex(index, family.chords.length);
  const chosen = family.chords[next];

  if (chosen) {
    if (state.settings.alwaysPlayChords || !performPlaying) {
      playChordPreview(chosen, { velocity: 1, humanize: false });
    }
  }

  const updatedGraph = chosen?.full_name
    ? withSelectedNodeChord(state.graph, chosen.full_name)
    : state.graph;

  saveGraph(updatedGraph);
  store.setState({
    selectedChordIndex: next,
    chordFanVisible: true,
    graph: updatedGraph,
    status: `Focused chord ${chosen?.full_name ?? chosen?.numeral ?? ""} on node ${updatedGraph.selectedNodeId}`,
  });
  if (chosen?.full_name) {
    appendDebugLog(`[ui] edit node id=${updatedGraph.selectedNodeId} chord="${chosen.full_name}"`);
  }
}

function addNode(): void {
  const state = store.getState();
  const sourceNode = state.graph.nodes[state.graph.selectedNodeId];
  const sourceChordName = sourceNode?.chordName ?? getSelectedChord(state).full_name;
  const previousSelectedId = state.graph.selectedNodeId;
  const previousCount = graphSequence(state.graph).length;
  const insertedNodeId = state.graph.nextNodeId;
  const graph = addAfterSelected(state.graph, sourceChordName);
  // place new node near its predecessor with a small random kick
  const predOffset = nodeOffsets[previousSelectedId] ?? { x: 0, y: 0 };
  nodeOffsets[insertedNodeId] = {
    x: predOffset.x + (Math.random() - 0.5) * 80,
    y: predOffset.y + (Math.random() - 0.5) * 80,
  };
  nodeVelocities[insertedNodeId] = { vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4 };
  trimNodeOffsets(graph);
  saveGraph(graph);
  const nextCount = graphSequence(graph).length;
  const match = findChordInCatalog(state.catalog, sourceChordName);
  store.setState({
    graph,
    chordFanVisible: true,
    selectedFamilyIndex: match?.familyIndex ?? state.selectedFamilyIndex,
    selectedChordIndex: match?.chordIndex ?? state.selectedChordIndex,
    status: `Inserted state/node ${sourceChordName}`,
  });
  appendDebugLog(
    `[ui] add node id=${insertedNodeId} after=${previousSelectedId} chord="${sourceChordName}" count ${previousCount}->${nextCount}`,
  );

  const canvas = root.querySelector<HTMLCanvasElement>(".webgl-stage");
  if (canvas) {
    panTowardsNode(canvas, insertedNodeId);
    redrawCanvasOnly(canvas);
  }
}

function addInitialNode(): void {
  const state = store.getState();
  const sourceNode = state.graph.nodes[state.graph.selectedNodeId];
  const chordName = sourceNode?.chordName ?? getSelectedChord(state).full_name;
  const nodeId = state.graph.nextNodeId;
  const nextNode: GraphNode = {
    id: nodeId,
    type: "chord-selection",
    chordName,
    beatsPerChordOverride: sourceNode?.beatsPerChordOverride ?? null,
    muted: sourceNode?.muted === true,
    waveformOverride: sourceNode?.waveformOverride ?? null,
    effectsOverride: sourceNode?.effectsOverride ?? null,
    bassPresetOverride: sourceNode?.bassPresetOverride ?? null,
    customChordEnabled: sourceNode?.customChordEnabled === true,
    customChordInputKind: sourceNode?.customChordInputKind === "midi" ? "midi" : "tones",
    customChordRawInput: sourceNode?.customChordRawInput ?? "",
    customChordTransposeWithCentralTone: sourceNode?.customChordTransposeWithCentralTone === true,
    nextId: nodeId,
  };

  const graph = normalizeGraphHeads({
    ...state.graph,
    selectedNodeId: nodeId,
    nextNodeId: nodeId + 1,
    headIds: [...graphHeadIds(state.graph), nodeId],
    nodes: {
      ...state.graph.nodes,
      [nodeId]: nextNode,
    },
  });

  const prevOffset = nodeOffsets[state.graph.selectedNodeId] ?? { x: 0, y: 0 };
  nodeOffsets[nodeId] = {
    x: prevOffset.x + (Math.random() - 0.5) * 160,
    y: prevOffset.y + (Math.random() - 0.5) * 160,
  };
  nodeVelocities[nodeId] = { vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4 };

  saveGraph(graph);

  store.setState({
    ...state,
    graph,
    chordFanVisible: true,
    status: `Added initial state ${chordName}`,
  });
  appendDebugLog(
    `[ui] add initial node id=${nodeId} chord="${chordName}" totalInitial=${graphHeadIds(graph).length}`,
  );

  const canvas = root.querySelector<HTMLCanvasElement>(".webgl-stage");
  if (canvas) {
    panTowardsNode(canvas, nodeId);
    redrawCanvasOnly(canvas);
  }
}

function removeNode(): void {
  const state = store.getState();
  const nodeCount = graphSequence(state.graph).length;
  if (nodeCount <= 1) {
    appendDebugLog("[ui] remove ignored: only one node in graph");
    store.setState({
      status: "Only one node remains; remove is ignored",
    });
    return;
  }
  const label = state.graph.nodes[state.graph.selectedNodeId]?.chordName ?? "node";
  const removedNodeId = state.graph.selectedNodeId;
  const previousCount = graphSequence(state.graph).length;
  const graph = removeSelected(state.graph);
  trimNodeOffsets(graph);
  saveGraph(graph);
  const nextCount = graphSequence(graph).length;
  store.setState({
    graph,
    status: `Removed state/node ${label}`,
  });
  appendDebugLog(
    `[ui] remove node id=${removedNodeId} chord="${label}" count ${previousCount}->${nextCount}`,
  );
}

function cycleSelectedNode(): void {
  const state = store.getState();
  const graph = nextSelected(state.graph);
  const selectedNode = graph.nodes[graph.selectedNodeId];
  const selectedChord = selectedNode?.chordName ?? "";
  const match = findChordInCatalog(state.catalog, selectedChord);
  trimNodeOffsets(graph);
  saveGraph(graph);
  store.setState({
    graph,
    chordFanVisible: true,
    selectedFamilyIndex: match?.familyIndex ?? state.selectedFamilyIndex,
    selectedChordIndex: match?.chordIndex ?? state.selectedChordIndex,
    status: `Selected state/node ${selectedChord || "node"}`,
  });
  appendDebugLog(
    `[ui] cycle selected node -> id=${graph.selectedNodeId} chord="${selectedChord || "node"}"`,
  );
}

function resetCurrentStateToInitialNode(): void {
  let state = store.getState();
  if (shouldPromptToSaveCurrent(state)) {
    const shouldSave = window.confirm("Save current state before resetting to the initial node?");
    if (shouldSave) {
      saveCurrentLoopState();
      state = store.getState();
    }
  }

  stopPerformLoop();

  const initialChord = initialChordName(state.catalog);
  const nextLoopName = nextGeneratedLoopName(state.savedLoops);
  const graph = createInitialGraph(initialChord);
  const match = findChordInCatalog(state.catalog, initialChord);

  for (const key of Object.keys(nodeOffsets)) {
    delete nodeOffsets[key];
  }
  sceneZoom = 1;
  scenePan = { x: 0, y: 0 };

  saveGraph(graph);
  store.setState({
    ...state,
    graph,
    selectedFamilyIndex: match?.familyIndex ?? 0,
    selectedChordIndex: match?.chordIndex ?? 0,
    chordFanVisible: false,
    savedLoopSelectedId: null,
    savedLoopDraft: nextLoopName,
    savedLoopsPage: 0,
    status: "State reset to one initial node",
  });
  activeSavedLoopId = null;
  activeSavedLoopSignature = currentLoopStateSignature(store.getState());
  restoreSavedLoopNameFocus = true;
  savedLoopNameCursor = nextLoopName.length;
  appendDebugLog(`[ui] reset state -> nodeCount=${graphSequence(graph).length} chord="${initialChord}" name="${nextLoopName}"`);
}

function buildSavedLoopRecord(state: AppState, id: string, name: string): SavedLoopRecord {
  const offsets: Record<number, { x: number; y: number }> = {};
  for (const [nodeIdText, offset] of Object.entries(nodeOffsets)) {
    const nodeId = Number(nodeIdText);
    if (!Number.isFinite(nodeId)) {
      continue;
    }
    offsets[nodeId] = { x: offset.x, y: offset.y };
  }

  return {
    id,
    name,
    graph: normalizeGraphHeads(cloneGraph(state.graph)),
    selectedFamilyIndex: state.selectedFamilyIndex,
    selectedChordIndex: state.selectedChordIndex,
    chordFanVisible: state.chordFanVisible,
    sceneZoom,
    scenePan: { ...scenePan },
    nodeOffsets: offsets,
    settings: {
      centralTone: state.settings.centralTone,
      bpm: state.settings.bpm,
      timeSignature: state.settings.timeSignature,
      beatsPerChord: state.settings.beatsPerChord,
      swing: state.settings.swing,
      humanizeAmount: state.settings.humanizeAmount,
      accentStrength: state.settings.accentStrength,
      layerWidth: state.settings.layerWidth,
      waveform: state.settings.waveform,
      effects: state.settings.effects,
      bassPreset: state.settings.bassPreset,
      midiEnabled: state.settings.midiEnabled,
      midiPortId: state.settings.midiPortId,
      midiChannel: state.settings.midiChannel,
      debugFooterEnabled: state.settings.debugFooterEnabled,
    },
    updatedAt: new Date().toISOString(),
  };
}

function currentSavedLoopDraftValue(state: AppState): string {
  const liveInputValue = root?.querySelector<HTMLInputElement>("input[data-saved-loop-input='name']")?.value;
  if (typeof liveInputValue === "string") {
    return liveInputValue;
  }
  return state.savedLoopDraft;
}

function saveCurrentLoopState(): void {
  const state = store.getState();
  const selectedLoop = state.savedLoops.find((loop) => loop.id === state.savedLoopSelectedId) ?? null;
  const draftValue = currentSavedLoopDraftValue(state);
  const rawName = draftValue.trim();
  const name = rawName.length > 0
    ? rawName
    : nextGeneratedLoopName(state.savedLoops, selectedLoop?.id ?? null);
  const conflictingLoop = findSavedLoopByName(state.savedLoops, name, selectedLoop?.id ?? null);

  if (conflictingLoop && !window.confirm(`A saved loop named "${name}" already exists. Overwrite it?`)) {
    restoreSavedLoopNameFocus = true;
    savedLoopNameCursor = name.length;
    return;
  }

  const targetLoop = conflictingLoop ?? selectedLoop;
  const id = targetLoop?.id ?? `loop-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const nextRecord = buildSavedLoopRecord(state, id, name);
  const savedLoops = [nextRecord, ...state.savedLoops.filter((loop) => loop.id !== id)];
  const pageCount = Math.max(1, Math.ceil(savedLoops.length / SAVED_LOOPS_PAGE_SIZE));

  saveSavedLoops(savedLoops);
  store.setState({
    ...state,
    savedLoops,
    savedLoopSelectedId: id,
    savedLoopDraft: name,
    savedLoopsPage: 0,
    status: `Saved loop ${name}`,
  });
  activeSavedLoopId = id;
  activeSavedLoopSignature = currentLoopStateSignature(store.getState());
  restoreSavedLoopNameFocus = true;
  savedLoopNameCursor = name.length;
  appendDebugLog(`[ui] saved loop id=${id} name="${name}"`);
}

function loadSavedLoopState(loopId: string): void {
  const state = store.getState();
  const loop = state.savedLoops.find((entry) => entry.id === loopId);
  if (!loop) {
    return;
  }

  if (state.settings.showSavedLoopsPanel) {
    handleModalClosed();
  }

  if (shouldPromptToSaveCurrent(state)) {
    const shouldSave = window.confirm("Save current state before loading this loop?");
    if (shouldSave) {
      saveCurrentLoopState();
    }
  }

  stopPerformLoop();

  const settings: AppSettings = {
    ...state.settings,
    ...loop.settings,
    showPanel: false,
    showPerformPanel: false,
    showSavedLoopsPanel: false,
    midiPorts: state.settings.midiPorts,
  };
  const catalog = transposeCatalogForCentralTone(CATALOG_TEMPLATE, settings.centralTone);
  const graph = sanitizeLoopGraph(cloneGraph(loop.graph)) ?? createInitialGraph(initialChordName(catalog));
  for (const key of Object.keys(nodeOffsets)) {
    delete nodeOffsets[Number(key)];
  }
  for (const [nodeIdText, offset] of Object.entries(loop.nodeOffsets ?? {})) {
    const nodeId = Number(nodeIdText);
    if (!Number.isFinite(nodeId)) {
      continue;
    }
    nodeOffsets[nodeId] = {
      x: Number(offset?.x) || 0,
      y: Number(offset?.y) || 0,
    };
  }
  trimNodeOffsets(graph);

  sceneZoom = clamp(Number(loop.sceneZoom) || 1, 0.30, 1.85);
  scenePan = {
    x: Number(loop.scenePan?.x) || 0,
    y: Number(loop.scenePan?.y) || 0,
  };

  const selectedFamilyIndex = clamp(loop.selectedFamilyIndex, 0, Math.max(0, catalog.families.length - 1));
  const selectedChordIndex = clamp(
    loop.selectedChordIndex,
    0,
    Math.max(0, (catalog.families[selectedFamilyIndex]?.chords.length ?? 1) - 1),
  );

  saveSettings(settings);
  saveGraph(graph);
  const nextState: AppState = {
    ...state,
    catalog,
    graph,
    settings,
    selectedFamilyIndex,
    selectedChordIndex,
    chordFanVisible: loop.chordFanVisible,
    savedLoopSelectedId: loop.id,
    savedLoopDraft: loop.name,
    savedLoopsPage: clamp(
      Math.floor(state.savedLoops.findIndex((entry) => entry.id === loop.id) / SAVED_LOOPS_PAGE_SIZE),
      0,
      Math.max(0, Math.ceil(state.savedLoops.length / SAVED_LOOPS_PAGE_SIZE) - 1),
    ),
    status: `Loaded loop ${loop.name}`,
  };
  store.setState(nextState);
  activeSavedLoopId = loop.id;
  activeSavedLoopSignature = currentLoopStateSignature(store.getState());
  appendDebugLog(`[ui] loaded loop id=${loop.id} name="${loop.name}"`);
}

function redrawCanvasOnly(canvas: HTMLCanvasElement, options?: { preserveOverlay?: boolean }): void {
  const state = store.getState();
  const rect = canvas.getBoundingClientRect();
  const layout = buildLayout(rect.width, rect.height);
  const geometry = buildSceneGeometry(state, layout);
  hitZones = buildHitZones(layout, geometry, state);
  drawFallback2d(canvas, layout, geometry, state);

  const preserveOverlay = options?.preserveOverlay ?? state.settings.showNodeTimingPanel;
  if (preserveOverlay) {
    return;
  }

  const overlayEl = root.querySelector<HTMLElement>(".overlay");
  if (overlayEl) {
    overlayEl.innerHTML = buildOverlayContent(state, layout, geometry);
    overlayEl.style.transform = "none";
  }
}

function bindCornerControls(shell: HTMLElement): void {
  const addInitialBtn = shell.querySelector<HTMLButtonElement>(".corner-btn[data-action='add-initial']");
  const settingsBtn = shell.querySelector<HTMLButtonElement>(".corner-btn[data-action='settings']");
  const savedLoopsBtn = shell.querySelector<HTMLButtonElement>(".corner-btn[data-action='saved-loops']");
  const performBtn = shell.querySelector<HTMLButtonElement>(".corner-btn[data-action='perform']");
  const centralToneBadge = shell.querySelector<HTMLElement>(".central-tone-badge");

  addInitialBtn?.addEventListener("click", () => {
    addInitialNode();
  });

  const focusSelectedChordInRing = () => {
    const state = store.getState();
    const toggledShowRoman = !state.showSelectedRomanNumeral;
    const numeral = selectedRingRomanNumeral(state) ?? "current harmony";
    const status = toggledShowRoman
      ? `Focused ring as ${numeral}`
      : "Focused ring as chord names";

    store.setState({
      ...state,
      chordFanVisible: true,
      showSelectedRomanNumeral: toggledShowRoman,
      status,
    });
  };

  centralToneBadge?.addEventListener("click", focusSelectedChordInRing);
  centralToneBadge?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    focusSelectedChordInRing();
  });

  settingsBtn?.addEventListener("click", () => {
    const state = store.getState();
    if (!state.settings.showPanel) {
      handleModalOpened();
    }
    updateSettings({ showPanel: true }, "Settings opened");
    void refreshMidiPorts();
  });

  savedLoopsBtn?.addEventListener("click", () => {
    const state = store.getState();
    if (!state.settings.showSavedLoopsPanel) {
      handleModalOpened();
    }
    const selectedLoop = state.savedLoops.find((loop) => loop.id === state.savedLoopSelectedId);
    let nextDraft = state.savedLoopDraft;
    if (selectedLoop) {
      nextDraft = selectedLoop.name;
      store.setState({
        ...state,
        savedLoopDraft: nextDraft,
      });
    } else if (!state.savedLoopDraft.trim()) {
      nextDraft = nextGeneratedLoopName(state.savedLoops);
      store.setState({
        ...state,
        savedLoopDraft: nextDraft,
      });
    }
    restoreSavedLoopNameFocus = true;
    savedLoopNameCursor = nextDraft.length;
    updateSettings({ showSavedLoopsPanel: true }, "Saved loops opened");
  });

  if (!performBtn) {
    return;
  }

  let longPressTimer: number | null = null;
  let longPressFired = false;

  performBtn.addEventListener("pointerdown", () => {
    longPressFired = false;
    longPressTimer = window.setTimeout(() => {
      longPressFired = true;
      updateSettings({ showPerformPanel: true }, "Perform options opened");
    }, 560);
  });

  const finishPress = () => {
    if (longPressTimer !== null) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  performBtn.addEventListener("pointerleave", finishPress);
  performBtn.addEventListener("pointercancel", finishPress);
  performBtn.addEventListener("pointerup", () => {
    finishPress();
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    if (performPlaying) {
      stopPerformLoop();
      const state = store.getState();
      store.setState({
        ...state,
        status: "Loop paused",
      });
      return;
    }

    startPerformLoop({ resetCursor: true });
  });
}

function bindSettingsPanel(shell: HTMLElement): void {
  shell.querySelectorAll<HTMLElement>("[data-settings-action='close']").forEach((element) => {
    element.addEventListener("click", () => {
      const state = store.getState();
      if (state.settings.showPanel) {
        handleModalClosed();
      }
      updateSettings({ showPanel: false }, "Settings closed");
    });
  });

  const toneSelect = shell.querySelector<HTMLSelectElement>("select[data-setting='central-tone']");
  toneSelect?.addEventListener("change", () => {
    updateSettings({ centralTone: normalizeCentralTone(toneSelect.value) }, `Central tone set to ${toneSelect.value}`);
  });

  const midiEnabledToggle = shell.querySelector<HTMLInputElement>("input[data-setting='midi-enabled']");
  midiEnabledToggle?.addEventListener("change", async () => {
    const enabled = midiEnabledToggle.checked;
    if (!enabled) {
      appendDebugLog("[midi] MIDI disabled by user");
      updateSettings({ midiEnabled: false }, "MIDI disabled");
      return;
    }

    updateSettings({ midiEnabled: true }, "Enabling MIDI...");

    await refreshMidiPorts();
    const access = await ensureMidiAccess();
    if (!access) {
      appendDebugLog("[midi] MIDI enable failed: Web MIDI access unavailable");
      updateSettings({ midiEnabled: false }, "Web MIDI unavailable");
      return;
    }

    const latest = store.getState();
    if (latest.settings.midiPorts.length === 0) {
      appendDebugLog("[midi] MIDI enable failed: no output ports found");
      updateSettings({ midiEnabled: false }, "No MIDI output ports found");
      return;
    }

    appendDebugLog(`[midi] MIDI enabled with port ${latest.settings.midiPortId || "(first available)"}`);
    updateSettings({ midiEnabled: true }, "MIDI enabled");
  });

  const midiPortSelect = shell.querySelector<HTMLSelectElement>("select[data-setting='midi-port']");
  midiPortSelect?.addEventListener("change", () => {
    updateSettings({ midiPortId: midiPortSelect.value }, "MIDI port updated");
  });

  const midiChannelSelect = shell.querySelector<HTMLSelectElement>("select[data-setting='midi-channel']");
  midiChannelSelect?.addEventListener("change", () => {
    const channel = clamp(Number(midiChannelSelect.value) || 1, 1, 16);
    updateSettings({ midiChannel: channel }, `MIDI channel set to ${channel}`);
  });

  const debugToggle = shell.querySelector<HTMLInputElement>("input[data-setting='debug-footer-enabled']");
  debugToggle?.addEventListener("change", () => {
    const enabled = debugToggle.checked;
    updateSettings({ debugFooterEnabled: enabled }, enabled ? "Debug footer enabled" : "Debug footer disabled");
  });

  const alwaysPlayToggle = shell.querySelector<HTMLInputElement>("input[data-setting='always-play-chords']");
  alwaysPlayToggle?.addEventListener("change", () => {
    const enabled = alwaysPlayToggle.checked;
    updateSettings({ alwaysPlayChords: enabled }, enabled ? "Always play chords on" : "Always play chords off");
  });
}

function bindDebugFooter(shell: HTMLElement): void {
  const debugLog = shell.querySelector<HTMLElement>("[data-debug-log]");
  if (debugLog) {
    debugLog.scrollTop = debugLog.scrollHeight;
  }

  const input = shell.querySelector<HTMLInputElement>("input[data-debug-input]");
  if (input) {
    input.addEventListener("input", () => {
      debugFooterDraft = input.value;
    });

    input.addEventListener("focus", () => {
      restoreDebugInputFocus = true;
    });

    input.addEventListener("blur", () => {
      restoreDebugInputFocus = false;
      debugFooterDraft = input.value;
    });

    if (restoreDebugInputFocus) {
      input.focus();
      const cursor = input.value.length;
      input.setSelectionRange(cursor, cursor);
      restoreDebugInputFocus = false;
    }
  }

  const form = shell.querySelector<HTMLFormElement>("form[data-debug-form]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = (input?.value ?? "").trim();
    if (!value) {
      return;
    }

    restoreDebugInputFocus = true;
    debugFooterDraft = "";
    appendDebugLog(`[input] ${value}`);
    if (input) {
      input.value = "";
    }
  });
}

function bindPerformPanel(shell: HTMLElement): void {
  shell.querySelectorAll<HTMLElement>("[data-perform-action='close']").forEach((element) => {
    element.addEventListener("click", () => {
      updateSettings({ showPerformPanel: false }, "Perform options closed");
    });
  });

  const bpmInput = shell.querySelector<HTMLInputElement>("input[data-perform-setting='bpm']");
  const bpmLabel = shell.querySelector<HTMLElement>("[data-live-label='bpm']");
  bpmInput?.addEventListener("input", () => {
    const bpm = normalizeBpm(bpmInput.value);
    if (bpmLabel) {
      bpmLabel.textContent = `BPM (${bpm})`;
    }
    updateSettings({ bpm }, `Tempo set to ${bpm} BPM`);
  });

  const beatsPerChordSelect = shell.querySelector<HTMLSelectElement>("select[data-perform-setting='beats-per-chord']");
  beatsPerChordSelect?.addEventListener("change", () => {
    const beatsPerChord = normalizeBeatsPerChord(beatsPerChordSelect.value);
    updateSettings({ beatsPerChord }, `Beats per chord set to ${beatsPerChord}`);
  });

  const toneSelect = shell.querySelector<HTMLSelectElement>("select[data-perform-setting='central-tone']");
  toneSelect?.addEventListener("change", () => {
    updateSettings({ centralTone: normalizeCentralTone(toneSelect.value) }, `Central tone set to ${toneSelect.value}`);
  });

  const timeSignatureSelect = shell.querySelector<HTMLSelectElement>("select[data-perform-setting='time-signature']");
  timeSignatureSelect?.addEventListener("change", () => {
    const timeSignature = normalizeTimeSignature(timeSignatureSelect.value);
    updateSettings({ timeSignature }, `Time signature set to ${timeSignature}`);
  });

  const swingInput = shell.querySelector<HTMLInputElement>("input[data-perform-setting='swing']");
  const swingLabel = shell.querySelector<HTMLElement>("[data-live-label='swing']");
  swingInput?.addEventListener("input", () => {
    const swing = normalizeSwing(swingInput.value);
    if (swingLabel) {
      swingLabel.textContent = `Swing (${swing}%)`;
    }
    updateSettings({ swing }, `Swing set to ${swing}%`);
  });

  const humanizeInput = shell.querySelector<HTMLInputElement>("input[data-perform-setting='humanize-amount']");
  const humanizeLabel = shell.querySelector<HTMLElement>("[data-live-label='humanize-amount']");
  humanizeInput?.addEventListener("input", () => {
    const humanizeAmount = normalizeHumanizeAmount(humanizeInput.value);
    if (humanizeLabel) {
      humanizeLabel.textContent = `Humanize (${humanizeAmount}%)`;
    }
    updateSettings({ humanizeAmount }, `Humanize set to ${humanizeAmount}%`);
  });

  const accentInput = shell.querySelector<HTMLInputElement>("input[data-perform-setting='accent-strength']");
  const accentLabel = shell.querySelector<HTMLElement>("[data-live-label='accent-strength']");
  accentInput?.addEventListener("input", () => {
    const accentStrength = normalizeAccentStrength(accentInput.value);
    if (accentLabel) {
      accentLabel.textContent = `Accent Strength (${accentStrength}%)`;
    }
    updateSettings({ accentStrength }, `Accent strength set to ${accentStrength}%`);
  });

  const layerWidthInput = shell.querySelector<HTMLInputElement>("input[data-perform-setting='layer-width']");
  const layerWidthLabel = shell.querySelector<HTMLElement>("[data-live-label='layer-width']");
  layerWidthInput?.addEventListener("input", () => {
    const layerWidth = normalizeLayerWidth(layerWidthInput.value);
    if (layerWidthLabel) {
      layerWidthLabel.textContent = `Layer Width (${layerWidth}%)`;
    }
    updateSettings({ layerWidth }, `Layer width set to ${layerWidth}%`);
  });

  const waveformSelect = shell.querySelector<HTMLSelectElement>("select[data-perform-setting='waveform']");
  waveformSelect?.addEventListener("change", () => {
    const waveform = normalizeWaveform(waveformSelect.value);
    updateSettings({ waveform }, `Waveform set to ${waveform}`);
  });

  const effectsSelect = shell.querySelector<HTMLSelectElement>("select[data-perform-setting='effects']");
  effectsSelect?.addEventListener("change", () => {
    const effects = normalizeEffects(effectsSelect.value);
    updateSettings({ effects }, `Effects set to ${effects}`);
  });

  const bassPresetSelect = shell.querySelector<HTMLSelectElement>("select[data-perform-setting='bass-preset']");
  bassPresetSelect?.addEventListener("change", () => {
    const bassPreset = normalizeBassPreset(bassPresetSelect.value);
    updateSettings({ bassPreset }, `Bass set to ${BASS_PRESET_LABELS[bassPreset]}`);
  });
}

function openNodeTimingPanel(nodeId: number): void {
  const state = store.getState();
  store.setState({
    ...state,
    nodeTimingModalNodeId: nodeId,
    settings: {
      ...state.settings,
      showNodeTimingPanel: true,
    },
    status: `Opened node ingredients for ${state.graph.nodes[nodeId]?.chordName ?? "node"}`,
  });
}

function closeNodeTimingPanel(): void {
  const state = store.getState();
  const activeNodeId = state.nodeTimingModalNodeId;
  if (activeNodeId !== null) {
    delete nodeTimingCustomChordDrafts[activeNodeId];
  }
  restoreNodeTimingChordInputFocus = false;
  nodeTimingChordInputCursor = 0;
  nodeTimingChordInputSelectionEnd = 0;
  nodeTimingChordInputSelectionDirection = "none";
  store.setState({
    ...state,
    nodeTimingModalNodeId: null,
    settings: {
      ...state.settings,
      showNodeTimingPanel: false,
    },
    status: "Node ingredients closed",
  });
}

function effectiveNodeChordLabel(state: AppState, node: GraphNode): string {
  const customPlayback = resolveNodeCustomPlaybackData(state, node);
  return customPlayback?.tonesText ?? node.chordName;
}

function nodeTimingDraftInputValue(state: AppState, node: GraphNode): string {
  const draft = nodeTimingCustomChordDrafts[node.id];
  if (typeof draft === "string") {
    return draft;
  }
  const storedRaw = node.customChordRawInput ?? "";
  if (storedRaw.trim().length > 0) {
    return storedRaw;
  }
  return defaultCustomChordInputFromNode(state, node);
}

function bindNodeTimingPanel(shell: HTMLElement): void {
  const updateNode = (nodeId: number, updater: (node: GraphNode) => GraphNode, status?: string): void => {
    const state = store.getState();
    const node = state.graph.nodes[nodeId];
    if (!node) {
      return;
    }
    const graph = {
      ...state.graph,
      nodes: {
        ...state.graph.nodes,
        [nodeId]: updater(node),
      },
    };
    saveGraph(graph);
    store.setState({
      ...state,
      graph,
      status: status ?? state.status,
    });
  };

  shell.querySelectorAll<HTMLElement>("[data-node-timing-action='close']").forEach((element) => {
    element.addEventListener("click", () => {
      closeNodeTimingPanel();
    });
  });

  const nodeSelect = shell.querySelector<HTMLSelectElement>("select[data-node-timing-setting='node-id']");
  nodeSelect?.addEventListener("change", () => {
    const nodeId = Number(nodeSelect.value);
    if (!Number.isFinite(nodeId)) {
      return;
    }
    const state = store.getState();
    store.setState({
      ...state,
      nodeTimingModalNodeId: nodeId,
      status: `Editing ingredients for ${state.graph.nodes[nodeId]?.chordName ?? "node"}`,
    });
  });

  const sourceSelect = shell.querySelector<HTMLSelectElement>("select[data-node-timing-setting='chord-source']");
  sourceSelect?.addEventListener("change", () => {
    const state = store.getState();
    const nodeId = state.nodeTimingModalNodeId;
    if (nodeId === null) {
      return;
    }
    const node = state.graph.nodes[nodeId];
    if (!node) {
      return;
    }
    const enabled = sourceSelect.value === "custom";
    const nextRawInput = enabled
      ? nodeTimingDraftInputValue(state, node)
      : (node.customChordRawInput ?? "");
    nodeTimingCustomChordDrafts[nodeId] = nextRawInput;
    const parsed = parseNodeCustomChord({
      ...node,
      customChordEnabled: enabled,
      customChordRawInput: nextRawInput,
    }, state.settings.centralTone);
    updateNode(nodeId, (node) => ({
      ...node,
      customChordEnabled: enabled,
      customChordRawInput: parsed ? nextRawInput : (node.customChordRawInput ?? ""),
      customChordInputKind: parsed?.kind ?? node.customChordInputKind,
      customChordTransposeWithCentralTone: node.customChordTransposeWithCentralTone === true,
    }), enabled ? "Custom chord enabled for node" : "Catalog chord restored for node");
    appendDebugLog(`[ui] edit node id=${nodeId} customSource=${enabled ? "custom" : "catalog"}`);
  });

  const mutedToggle = shell.querySelector<HTMLInputElement>("input[data-node-timing-setting='muted']");
  mutedToggle?.addEventListener("change", () => {
    const state = store.getState();
    const nodeId = state.nodeTimingModalNodeId;
    if (nodeId === null) {
      return;
    }
    updateNode(nodeId, (node) => ({
      ...node,
      muted: mutedToggle.checked,
    }), mutedToggle.checked ? "Node muted" : "Node unmuted");
    appendDebugLog(`[ui] edit node id=${nodeId} muted=${mutedToggle.checked}`);
  });

  const transposeToggle = shell.querySelector<HTMLInputElement>("input[data-node-timing-setting='custom-transpose']");
  transposeToggle?.addEventListener("change", () => {
    const state = store.getState();
    const nodeId = state.nodeTimingModalNodeId;
    if (nodeId === null) {
      return;
    }
    updateNode(nodeId, (node) => ({
      ...node,
      customChordTransposeWithCentralTone: transposeToggle.checked,
    }), transposeToggle.checked ? "Custom chord transpose enabled" : "Custom chord transpose disabled");
    appendDebugLog(`[ui] edit node id=${nodeId} customTranspose=${transposeToggle.checked}`);
  });

  const waveformSelect = shell.querySelector<HTMLSelectElement>("select[data-node-timing-setting='waveform-override']");
  waveformSelect?.addEventListener("change", () => {
    const state = store.getState();
    const nodeId = state.nodeTimingModalNodeId;
    if (nodeId === null) {
      return;
    }
    const override = waveformSelect.value === "inherit" ? null : normalizeWaveform(waveformSelect.value);
    updateNode(nodeId, (node) => ({
      ...node,
      waveformOverride: override,
    }), override === null ? "Node waveform now inherits global setting" : `Node waveform set to ${override}`);
    appendDebugLog(`[ui] edit node id=${nodeId} waveform=${override ?? "inherit"}`);
  });

  const effectsSelect = shell.querySelector<HTMLSelectElement>("select[data-node-timing-setting='effects-override']");
  effectsSelect?.addEventListener("change", () => {
    const state = store.getState();
    const nodeId = state.nodeTimingModalNodeId;
    if (nodeId === null) {
      return;
    }
    const override = effectsSelect.value === "inherit" ? null : normalizeEffects(effectsSelect.value);
    updateNode(nodeId, (node) => ({
      ...node,
      effectsOverride: override,
    }), override === null ? "Node effects now inherit global setting" : `Node effects set to ${override}`);
    appendDebugLog(`[ui] edit node id=${nodeId} effects=${override ?? "inherit"}`);
  });

  const bassSelect = shell.querySelector<HTMLSelectElement>("select[data-node-timing-setting='bass-override']");
  bassSelect?.addEventListener("change", () => {
    const state = store.getState();
    const nodeId = state.nodeTimingModalNodeId;
    if (nodeId === null) {
      return;
    }
    const override = bassSelect.value === "inherit" ? null : normalizeBassPreset(bassSelect.value);
    updateNode(nodeId, (node) => ({
      ...node,
      bassPresetOverride: override,
    }), override === null ? "Node bass now inherits global setting" : `Node bass set to ${BASS_PRESET_LABELS[override]}`);
    appendDebugLog(`[ui] edit node id=${nodeId} bass=${override ?? "inherit"}`);
  });

  const customInput = shell.querySelector<HTMLInputElement>("input[data-node-timing-input='custom-chord']");
  const captureCustomInputSelection = (): void => {
    if (!customInput) {
      return;
    }
    nodeTimingChordInputCursor = customInput.selectionStart ?? customInput.value.length;
    nodeTimingChordInputSelectionEnd = customInput.selectionEnd ?? nodeTimingChordInputCursor;
    nodeTimingChordInputSelectionDirection = customInput.selectionDirection ?? "none";
  };

  customInput?.addEventListener("input", () => {
    const state = store.getState();
    const nodeId = state.nodeTimingModalNodeId;
    if (nodeId === null) {
      return;
    }
    const node = state.graph.nodes[nodeId];
    if (!node || node.customChordEnabled !== true) {
      return;
    }
    const rawInput = customInput.value;
    nodeTimingCustomChordDrafts[nodeId] = rawInput;
    restoreNodeTimingChordInputFocus = true;
    captureCustomInputSelection();
    const draftNode: GraphNode = {
      ...node,
      customChordRawInput: rawInput,
    };
    const parsedDraft = parseNodeCustomChord(draftNode, state.settings.centralTone);
    if (!parsedDraft) {
      return;
    }
    updateNode(nodeId, (currentNode) => ({
      ...currentNode,
      customChordRawInput: rawInput,
      customChordInputKind: parsedDraft.kind,
    }), `Custom chord ready: ${parsedDraft.tonesText}`
    );
    appendDebugLog(`[ui] edit node id=${nodeId} customChord="${parsedDraft.tonesText}"`);
  });

  customInput?.addEventListener("focus", () => {
    restoreNodeTimingChordInputFocus = true;
    captureCustomInputSelection();
  });

  customInput?.addEventListener("keyup", captureCustomInputSelection);
  customInput?.addEventListener("click", captureCustomInputSelection);

  customInput?.addEventListener("blur", (event) => {
    const focusEvent = event as FocusEvent;
    const nextTarget = focusEvent.relatedTarget;
    if (nextTarget instanceof HTMLElement && nextTarget.closest(".node-timing-modal")) {
      restoreNodeTimingChordInputFocus = false;
    }
    captureCustomInputSelection();
  });

  if (customInput && restoreNodeTimingChordInputFocus) {
    customInput.focus();
    const start = clamp(nodeTimingChordInputCursor, 0, customInput.value.length);
    const end = clamp(nodeTimingChordInputSelectionEnd, start, customInput.value.length);
    customInput.setSelectionRange(start, end, nodeTimingChordInputSelectionDirection);
  }

  const makeHeadButton = shell.querySelector<HTMLButtonElement>("button[data-node-timing-action='make-head']");
  makeHeadButton?.addEventListener("click", () => {
    const state = store.getState();
    const nodeId = state.nodeTimingModalNodeId;
    if (nodeId === null) {
      return;
    }
    const node = state.graph.nodes[nodeId];
    if (!node) {
      return;
    }
    const graph = setNodeAsGraphHead(state.graph, nodeId);
    saveGraph(graph);
    store.setState({
      ...state,
      graph,
      status: `Set ${node.chordName} as initial state`,
    });
    appendDebugLog(`[ui] set initial id=${nodeId} chord="${node.chordName}" (modal)`);
  });

  const timingSelect = shell.querySelector<HTMLSelectElement>("select[data-node-timing-setting='beats-override']");
  timingSelect?.addEventListener("change", () => {
    const state = store.getState();
    const nodeId = state.nodeTimingModalNodeId;
    if (nodeId === null) {
      return;
    }
    const node = state.graph.nodes[nodeId];
    if (!node) {
      return;
    }
    const override = timingSelect.value === "inherit"
      ? null
      : normalizeNodeBeatsOverride(Number(timingSelect.value));
    const nextNode: GraphNode = {
      ...node,
      beatsPerChordOverride: override,
    };
    const graph = {
      ...state.graph,
      nodes: {
        ...state.graph.nodes,
        [nodeId]: nextNode,
      },
    };
    saveGraph(graph);
    store.setState({
      ...state,
      graph,
      status: override === null
        ? `Node ${node.chordName} now inherits global beats`
        : `Node ${node.chordName} timing set to ${bpcLabel(override)}`,
    });
    appendDebugLog(
      `[ui] node timing id=${nodeId} chord="${node.chordName}" override=${override === null ? "inherit" : override}`,
    );
  });

  const testChordButton = shell.querySelector<HTMLButtonElement>("button[data-node-timing-action='test-chord']");
  testChordButton?.addEventListener("click", () => {
    const state = store.getState();
    const nodeId = state.nodeTimingModalNodeId;
    if (nodeId === null) {
      return;
    }
    const node = state.graph.nodes[nodeId];
    if (!node) {
      return;
    }
    if (node.muted === true) {
      store.setState({
        ...state,
        status: "Node is muted",
      });
      return;
    }
    const nodeWaveform = effectiveWaveformForNode(state, node);
    const nodeEffects = effectiveEffectsForNode(state, node);
    const customPlayback = resolveNodeCustomPlaybackData(state, node);
    if (customPlayback) {
      playChordPreview({ full_name: node.chordName || customPlayback.label }, {
        pulseNodeId: nodeId,
        midiNotesOverride: customPlayback.midiNotes,
        tonesTextOverride: customPlayback.tonesText,
        labelOverride: customPlayback.label,
        familyNameOverride: "Custom",
        waveformOverride: nodeWaveform,
        effectsOverride: nodeEffects,
      });
      store.setState({
        ...state,
        status: `Tested ${customPlayback.label}`,
      });
      return;
    }

    const match = findChordInCatalog(state.catalog, node.chordName);
    const chord = match ? state.catalog.families[match.familyIndex]?.chords[match.chordIndex] : null;
    if (chord) {
      playChordPreview(chord, {
        pulseNodeId: nodeId,
        waveformOverride: nodeWaveform,
        effectsOverride: nodeEffects,
      });
      store.setState({
        ...state,
        status: `Tested catalog chord ${chord.full_name}`,
      });
      return;
    }

    store.setState({
      ...state,
      status: "No valid chord available to test for this node",
    });
  });
}

function bindSavedLoopsPanel(shell: HTMLElement): void {
  shell.querySelectorAll<HTMLElement>("[data-saved-loops-action='close']").forEach((element) => {
    element.addEventListener("click", () => {
      const state = store.getState();
      if (state.settings.showSavedLoopsPanel) {
        handleModalClosed();
      }
      updateSettings({ showSavedLoopsPanel: false }, "Saved loops closed");
    });
  });

  const nameInput = shell.querySelector<HTMLInputElement>("input[data-saved-loop-input='name']");
  nameInput?.addEventListener("input", () => {
    const state = store.getState();
    restoreSavedLoopNameFocus = true;
    savedLoopNameCursor = nameInput.selectionStart ?? nameInput.value.length;
    store.setState({
      ...state,
      savedLoopDraft: nameInput.value,
    });
  });

  nameInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    saveCurrentLoopState();
  });

  if (nameInput && restoreSavedLoopNameFocus) {
    nameInput.focus();
    const cursor = clamp(savedLoopNameCursor, 0, nameInput.value.length);
    nameInput.setSelectionRange(cursor, cursor);
    restoreSavedLoopNameFocus = false;
  }

  const saveButton = shell.querySelector<HTMLButtonElement>("button[data-saved-loops-action='save']");
  saveButton?.addEventListener("click", () => {
    saveCurrentLoopState();
  });

  const resetButton = shell.querySelector<HTMLButtonElement>("button[data-saved-loops-action='reset-state']");
  resetButton?.addEventListener("click", () => {
    resetCurrentStateToInitialNode();
  });

  shell.querySelectorAll<HTMLButtonElement>("button[data-saved-loop-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const loopId = button.dataset.savedLoopId ?? "";
      if (!loopId) {
        return;
      }
      loadSavedLoopState(loopId);
    });
  });

  shell.querySelectorAll<HTMLButtonElement>("button[data-saved-loops-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const requestedPage = Number(button.dataset.savedLoopsPage ?? 0);
      const state = store.getState();
      const pageCount = Math.max(1, Math.ceil(state.savedLoops.length / SAVED_LOOPS_PAGE_SIZE));
      store.setState({
        ...state,
        savedLoopsPage: clamp(requestedPage, 0, pageCount - 1),
      });
      restoreSavedLoopNameFocus = true;
      savedLoopNameCursor = state.savedLoopDraft.length;
    });
  });
}

function bindCanvasInteractions(canvas: HTMLCanvasElement): void {
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const oldZoom = sceneZoom;
    const zoomDirection = event.deltaY > 0 ? -0.06 : 0.06;
    const newZoom = clamp(sceneZoom + zoomDirection, 0.30, 1.85);
    if (newZoom === oldZoom) {
      return;
    }

    // Keep the content under the cursor stable while zooming.
    const centerX = rect.width * 0.5 + scenePan.x;
    const centerY = rect.height * 0.665 + scenePan.y;
    const ratio = newZoom / oldZoom;
    scenePan.x += (pointerX - centerX) * (1 - ratio);
    scenePan.y += (pointerY - centerY) * (1 - ratio);

    sceneZoom = newZoom;
    saveInteractionState();
    redrawCanvasOnly(canvas);
  }, { passive: false });

  const activePointers = new Map<number, { x: number; y: number }>();
  let prevPinchDist = 0;

  canvas.addEventListener("pointerdown", (event) => {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size === 2) {
      // Second finger landed — start pinch, cancel any ongoing single-pointer gesture.
      const pts = [...activePointers.values()];
      prevPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (pressContext) {
        if (canvas.hasPointerCapture(pressContext.pointerId)) {
          canvas.releasePointerCapture(pressContext.pointerId);
        }
        pressContext = null;
      }
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    const point = pointerToCanvas(canvas, event);
    const hit = hitTest(hitZones, point);
    const startedOnCenter = hit?.kind === "center";
    const draggingGraphNode = hit?.kind === "graph-node" || startedOnCenter;
    const panGesture = !hit;
    const state = store.getState();

    pressContext = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      gestureHandled: false,
      longPressTimer: null,
      mode: draggingGraphNode ? "drag-node" : panGesture ? "pan" : "tap",
      targetNodeId: hit?.kind === "graph-node"
        ? hit.nodeId
        : (startedOnCenter ? state.graph.selectedNodeId : null),
      startedOnCenter,
      lastX: event.clientX,
      lastY: event.clientY,
    };

    if (pressContext.mode === "drag-node" && pressContext.targetNodeId !== null) {
      const nodeId = pressContext.targetNodeId;
      pressContext.longPressTimer = window.setTimeout(() => {
        if (!pressContext || pressContext.moved) return;
        pressContext.longPressTimer = null;
        pressContext.gestureHandled = true;
        openNodeTimingPanel(nodeId);
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        pressContext = null;
      }, 550);
    }

    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size >= 2) {
      const pts = [...activePointers.values()];
      const newDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (prevPinchDist > 0 && newDist > 0) {
        const factor = newDist / prevPinchDist;
        const newZoom = clamp(sceneZoom * factor, 0.30, 1.85);
        const rect = canvas.getBoundingClientRect();
        const midX = (pts[0].x + pts[1].x) * 0.5 - rect.left;
        const midY = (pts[0].y + pts[1].y) * 0.5 - rect.top;
        const centerX = rect.width * 0.5 + scenePan.x;
        const centerY = rect.height * 0.665 + scenePan.y;
        const ratio = newZoom / sceneZoom;
        scenePan.x += (midX - centerX) * (1 - ratio);
        scenePan.y += (midY - centerY) * (1 - ratio);
        sceneZoom = newZoom;
        redrawCanvasOnly(canvas);
      }
      prevPinchDist = newDist;
      return;
    }

    if (!pressContext || pressContext.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - pressContext.startX;
    const dy = event.clientY - pressContext.startY;
    if (Math.hypot(dx, dy) > 10) {
      pressContext.moved = true;
    }

    if (pressContext.moved && pressContext.longPressTimer !== null) {
      window.clearTimeout(pressContext.longPressTimer);
      pressContext.longPressTimer = null;
    }

    if (pressContext.mode === "drag-node" && pressContext.targetNodeId !== null) {
      const nodeId = pressContext.targetNodeId;
      forcePinnedNodeId = nodeId;
      nodeVelocities[nodeId] = { vx: 0, vy: 0 };
      const nodeOffset = nodeOffsets[nodeId] ?? { x: 0, y: 0 };
      const deltaX = event.clientX - pressContext.lastX;
      const deltaY = event.clientY - pressContext.lastY;
      nodeOffsets[nodeId] = {
        x: nodeOffset.x + deltaX,
        y: nodeOffset.y + deltaY,
      };
      pressContext.lastX = event.clientX;
      pressContext.lastY = event.clientY;
      redrawCanvasOnly(canvas);
    } else if (pressContext.mode === "pan") {
      const deltaX = event.clientX - pressContext.lastX;
      const deltaY = event.clientY - pressContext.lastY;
      scenePan.x += deltaX;
      scenePan.y += deltaY;
      pressContext.lastX = event.clientX;
      pressContext.lastY = event.clientY;
      redrawCanvasOnly(canvas);
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) {
      prevPinchDist = 0;
    }
    if (activePointers.size >= 1) {
      return;
    }
    if (!pressContext || pressContext.pointerId !== event.pointerId) {
      return;
    }

    if (pressContext.longPressTimer !== null) {
      window.clearTimeout(pressContext.longPressTimer);
      pressContext.longPressTimer = null;
    }
    if (pressContext.gestureHandled) {
      pressContext = null;
      return;
    }
    const point = pointerToCanvas(canvas, event);
    if (pressContext.mode === "drag-node") {
      forcePinnedNodeId = null;
      const draggedNodeId = pressContext.targetNodeId;
      if (draggedNodeId !== null && pressContext.moved) {
        const finalOffset = nodeOffsets[draggedNodeId] ?? { x: 0, y: 0 };
        appendDebugLog(
          `[ui] drag node id=${draggedNodeId} offset=(${Math.round(finalOffset.x)},${Math.round(finalOffset.y)})`,
        );
        saveInteractionState();
      }
      if (draggedNodeId !== null && !pressContext.moved) {
        if (pressContext.startedOnCenter) {
          cycleSelectedNode();
          if (canvas.hasPointerCapture(event.pointerId)) {
            canvas.releasePointerCapture(event.pointerId);
          }
          pressContext = null;
          return;
        }
        const state = store.getState();
        const selectedNode = state.graph.nodes[draggedNodeId];
        if (selectedNode) {
          const match = findChordInCatalog(state.catalog, selectedNode.chordName);
          store.setState({
            ...state,
            graph: {
              ...state.graph,
              selectedNodeId: draggedNodeId,
            },
            selectedFamilyIndex: match?.familyIndex ?? state.selectedFamilyIndex,
            selectedChordIndex: match?.chordIndex ?? state.selectedChordIndex,
            chordFanVisible: true,
            status: `Selected state/node ${selectedNode.chordName}`,
          });
          saveGraph({
            ...state.graph,
            selectedNodeId: draggedNodeId,
          });
          appendDebugLog(
            `[ui] selected node id=${draggedNodeId} chord="${selectedNode.chordName}"`,
          );
        }
      }
    } else if (!pressContext.moved) {
      const hit = hitTest(hitZones, point);
      if (hit?.kind === "family") {
        selectFamily(hit.index);
      } else if (hit?.kind === "chord") {
        selectChord(hit.index);
      } else if (hit?.kind === "add") {
        addNode();
      } else if (hit?.kind === "remove") {
        removeNode();
      } else if (hit?.kind === "center") {
        cycleSelectedNode();
      } else if (hit?.kind === "graph-node") {
        const state = store.getState();
        const selectedNode = state.graph.nodes[hit.nodeId];
        if (selectedNode) {
          const match = findChordInCatalog(state.catalog, selectedNode.chordName);
          store.setState({
            ...state,
            graph: { ...state.graph, selectedNodeId: hit.nodeId },
            selectedFamilyIndex: match?.familyIndex ?? state.selectedFamilyIndex,
            selectedChordIndex: match?.chordIndex ?? state.selectedChordIndex,
            chordFanVisible: true,
            status: `Selected state/node ${selectedNode.chordName}`,
          });
          saveGraph({ ...state.graph, selectedNodeId: hit.nodeId });
          appendDebugLog(`[ui] selected node id=${hit.nodeId} chord="${selectedNode.chordName}"`);
        }
      }
    }
    if (pressContext.mode === "pan" && pressContext.moved) {
      saveInteractionState();
    }
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    pressContext = null;
  });

  canvas.addEventListener("pointercancel", (event) => {
    if (!pressContext || pressContext.pointerId !== event.pointerId) {
      return;
    }
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    pressContext = null;
  });
}

function mountStage(): void {
  const state = store.getState();
  const shell = root.querySelector<HTMLElement>(".stage-shell");
  const canvas = root.querySelector<HTMLCanvasElement>(".webgl-stage");
  if (!shell || !canvas) {
    return;
  }

  const rect = shell.getBoundingClientRect();
  const layout = buildLayout(rect.width, rect.height);
  const geometry = buildSceneGeometry(state, layout);
  hitZones = buildHitZones(layout, geometry, state);
  bindCornerControls(shell);
  bindSettingsPanel(shell);
  bindPerformPanel(shell);
  bindNodeTimingPanel(shell);
  bindSavedLoopsPanel(shell);
  bindDebugFooter(shell);
  bindCanvasInteractions(canvas);

  if (resizeObserver) {
    resizeObserver.disconnect();
  }

  resizeObserver = new ResizeObserver(() => {
    const c = root.querySelector<HTMLCanvasElement>(".webgl-stage");
    if (!c) {
      return;
    }
    if (!stage) {
      redrawCanvasOnly(c);
    } else {
      render();
    }
  });

  resizeObserver.observe(shell);

  if (FORCE_CANVAS_RENDERER) {
    stage = null;
    drawFallback2d(canvas, layout, geometry, state);
    return;
  }

  if (webglUnavailable) {
    drawFallback2d(canvas, layout, geometry, state);
    return;
  }

  try {
    stage = new WebGlStage(canvas);
  } catch {
    webglUnavailable = true;
    stage = null;
    drawFallback2d(canvas, layout, geometry, state);
    return;
  }

  stage.setScene(state, layout, geometry);
}

let prevModalKey = "";

function render(): void {
  const state = store.getState();
  const currentStatus = !FORCE_CANVAS_RENDERER && webglUnavailable
    ? "WebGL unavailable in this embedded preview; open in a GPU-enabled browser to see the full scene"
    : state.status;

  const stateForRender = { ...state, status: currentStatus };
  const anyModalOpen = state.settings.showPanel
    || state.settings.showPerformPanel
    || state.settings.showSavedLoopsPanel
    || state.settings.showNodeTimingPanel;
  const modalKey = `${state.settings.showPanel}-${state.settings.showPerformPanel}-${state.settings.showSavedLoopsPanel}-${state.settings.showNodeTimingPanel}-${state.nodeTimingModalNodeId ?? "none"}`;
  const shellExists = !!root.querySelector(".stage-shell");
  const canUseModalFastPath = anyModalOpen
    && shellExists
    && modalKey === prevModalKey
    && !state.settings.showSavedLoopsPanel;

  // When a modal is already open and its visibility didn't change, skip full
  // innerHTML re-render to preserve open <select> dropdowns and focused inputs.
  if (canUseModalFastPath) {
    const canvas = root.querySelector<HTMLCanvasElement>(".webgl-stage");
    if (canvas) redrawCanvasOnly(canvas, { preserveOverlay: true });
    const performBtn = root.querySelector<HTMLButtonElement>(".corner-btn.perform");
    if (performBtn) {
      performBtn.textContent = performPlaying ? "❚❚" : "▶";
      performBtn.classList.toggle("playing", performPlaying);
      performBtn.classList.toggle("paused", !performPlaying);
    }
    // Patch dynamic label text inside the open modal without rebuilding its DOM.
    const s = state.settings;
    const bpmLabel = root.querySelector<HTMLElement>("[data-live-label='bpm']");
    if (bpmLabel) bpmLabel.textContent = `BPM (${s.bpm})`;
    const bpmInput = root.querySelector<HTMLInputElement>("input[data-perform-setting='bpm']");
    if (bpmInput && bpmInput.value !== String(s.bpm)) bpmInput.value = String(s.bpm);
    const swingLabel = root.querySelector<HTMLElement>("[data-live-label='swing']");
    if (swingLabel) swingLabel.textContent = `Swing (${s.swing}%)`;
    const swingInput = root.querySelector<HTMLInputElement>("input[data-perform-setting='swing']");
    if (swingInput && swingInput.value !== String(s.swing)) swingInput.value = String(s.swing);
    const humanizeLabel = root.querySelector<HTMLElement>("[data-live-label='humanize-amount']");
    if (humanizeLabel) humanizeLabel.textContent = `Humanize (${s.humanizeAmount}%)`;
    const humanizeInput = root.querySelector<HTMLInputElement>("input[data-perform-setting='humanize-amount']");
    if (humanizeInput && humanizeInput.value !== String(s.humanizeAmount)) humanizeInput.value = String(s.humanizeAmount);
    const accentLabel = root.querySelector<HTMLElement>("[data-live-label='accent-strength']");
    if (accentLabel) accentLabel.textContent = `Accent Strength (${s.accentStrength}%)`;
    const accentInput = root.querySelector<HTMLInputElement>("input[data-perform-setting='accent-strength']");
    if (accentInput && accentInput.value !== String(s.accentStrength)) accentInput.value = String(s.accentStrength);
    const layerWidthLabel = root.querySelector<HTMLElement>("[data-live-label='layer-width']");
    if (layerWidthLabel) layerWidthLabel.textContent = `Layer Width (${s.layerWidth}%)`;
    const layerWidthInput = root.querySelector<HTMLInputElement>("input[data-perform-setting='layer-width']");
    if (layerWidthInput && layerWidthInput.value !== String(s.layerWidth)) layerWidthInput.value = String(s.layerWidth);
    const savedLoopNameInput = root.querySelector<HTMLInputElement>("input[data-saved-loop-input='name']");
    if (savedLoopNameInput && savedLoopNameInput.value !== state.savedLoopDraft) {
      savedLoopNameInput.value = state.savedLoopDraft;
    }
    if (savedLoopNameInput && restoreSavedLoopNameFocus) {
      savedLoopNameInput.focus();
      const cursor = clamp(savedLoopNameCursor, 0, savedLoopNameInput.value.length);
      savedLoopNameInput.setSelectionRange(cursor, cursor);
      restoreSavedLoopNameFocus = false;
    }
    if (state.settings.showNodeTimingPanel) {
      const activeNodeId = state.nodeTimingModalNodeId ?? state.graph.selectedNodeId;
      const activeNode = state.graph.nodes[activeNodeId] ?? null;
      if (activeNode) {
        const customEnabled = activeNode.customChordEnabled === true;
        const customInputValue = nodeTimingDraftInputValue(state, activeNode);
        const parsedCustom = parseNodeCustomChord(
          {
            ...activeNode,
            customChordRawInput: customInputValue,
          },
          state.settings.centralTone,
        );
        const previewText = activeNode.customChordEnabled === true
          ? (parsedCustom?.tonesText ?? "invalid")
          : "catalog chord";
        const previewEl = root.querySelector<HTMLElement>("[data-node-timing-custom-preview]");
        if (previewEl) {
          previewEl.textContent = previewText;
        }

        const sourceSelect = root.querySelector<HTMLSelectElement>("select[data-node-timing-setting='chord-source']");
        if (sourceSelect) {
          const nextSourceValue = customEnabled ? "custom" : "catalog";
          if (sourceSelect.value !== nextSourceValue) {
            sourceSelect.value = nextSourceValue;
          }
        }

        const customInput = root.querySelector<HTMLInputElement>("input[data-node-timing-input='custom-chord']");
        if (customInput) {
          customInput.disabled = !customEnabled;
          if (document.activeElement !== customInput && customInput.value !== customInputValue) {
            customInput.value = customInputValue;
          }
        }

        const transposeToggle = root.querySelector<HTMLInputElement>("input[data-node-timing-setting='custom-transpose']");
        if (transposeToggle) {
          transposeToggle.disabled = !customEnabled;
          transposeToggle.checked = activeNode.customChordTransposeWithCentralTone === true;
        }

        const effectiveSoundEl = root.querySelector<HTMLElement>("[data-node-timing-effective-sound]");
        if (effectiveSoundEl) {
          const waveform = effectiveWaveformForNode(state, activeNode);
          const effects = effectiveEffectsForNode(state, activeNode);
          const bass = effectiveBassPresetForNode(state, activeNode);
          effectiveSoundEl.textContent = `${waveform} · ${effects} · ${BASS_PRESET_LABELS[bass]}`;
        }
      }
    }
    return;
  }

  prevModalKey = modalKey;

  const placeholderLayout = buildLayout(window.innerWidth, window.innerHeight);
  const geometry = buildSceneGeometry(stateForRender, placeholderLayout);
  overlay(root, stateForRender, placeholderLayout, geometry);

  // Trap focus inside open modals by marking background as inert.
  const bgElements = [
    root.querySelector<HTMLElement>(".webgl-stage"),
    root.querySelector<HTMLElement>(".overlay"),
    root.querySelector<HTMLElement>(".corner-controls"),
    root.querySelector<HTMLElement>(".debug-footer"),
  ];
  for (const el of bgElements) {
    if (!el) continue;
    if (anyModalOpen) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }
  if (anyModalOpen) {
    const openPanel = root.querySelector<HTMLElement>(".settings-modal.open .settings-panel");
    if (openPanel && !openPanel.contains(document.activeElement)) {
      const first = openPanel.querySelector<HTMLElement>("button,input,select,[tabindex]");
      (first ?? openPanel).focus();
    }
  }

  mountStage();
}

function animate(now: number): void {
  stage?.draw(now);
  rafId = window.requestAnimationFrame(animate);
}

store.subscribe(render);
store.subscribe(saveInteractionState);
render();
initMissingNodeOffsets();

if (!FORCE_CANVAS_RENDERER) {
  rafId = window.requestAnimationFrame(animate);
}
forceRafId = window.requestAnimationFrame(runForceLoop);

window.addEventListener("beforeunload", () => {
  saveInteractionState();
  stopPerformLoop();
  if (centerPulseRafId) {
    window.cancelAnimationFrame(centerPulseRafId);
    centerPulseRafId = 0;
  }
  if (addNodePanRafId) {
    window.cancelAnimationFrame(addNodePanRafId);
    addNodePanRafId = 0;
  }
  if (rafId) {
    window.cancelAnimationFrame(rafId);
  }
  if (forceRafId) {
    window.cancelAnimationFrame(forceRafId);
    window.clearTimeout(forceRafId);
    forceRafId = 0;
  }
  resizeObserver?.disconnect();
});
