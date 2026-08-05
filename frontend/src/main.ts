import { createStore } from "zustand/vanilla";
import catalogJson from "../../assets/chords/creative_chord_choices.json";
import "./styles.css";

type ChordEntry = {
  numeral?: string;
  full_name: string;
  intervals?: Array<number | string>;
  root?: string | null;
};

type ChordFamily = {
  name: string;
  chords: ChordEntry[];
};

type ChordCatalog = {
  families: ChordFamily[];
};

type GraphNodeType = "chord-selection";

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
  nextId: number;
};

type LoopGraph = {
  headId: number;
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
    swing: number;
    waveform: WaveformOption;
    effects: EffectOption;
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

type MidiPortOption = {
  id: string;
  name: string;
};

type AppSettings = {
  showPanel: boolean;
  showPerformPanel: boolean;
  showSavedLoopsPanel: boolean;
  debugFooterEnabled: boolean;
  centralTone: string;
  bpm: number;
  timeSignature: TimeSignatureOption;
  swing: number;
  waveform: WaveformOption;
  effects: EffectOption;
  midiEnabled: boolean;
  midiPortId: string;
  midiChannel: number;
  midiPorts: MidiPortOption[];
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
const MAX_DEBUG_LOGS = 220;

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
  name?: string;
  send: (data: number[]) => void;
};

type MidiAccessLike = {
  outputs?: {
    forEach?: (callback: (value: MidiOutputLike) => void) => void;
    [Symbol.iterator]?: () => Iterator<[string, MidiOutputLike]>;
    values?: () => Iterator<MidiOutputLike>;
  };
  onstatechange: ((event: Event) => void) | null;
};

type MidiRequestOptions = {
  sysex?: boolean;
};

const root = document.getElementById("app");
if (!root) {
  throw new Error("Expected #app container");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
    selectedNodeId: 0,
    nextNodeId: 1,
    nodes: {
      0: { id: 0, type: "chord-selection", chordName: initialChord, nextId: 0 },
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

function graphSequence(graph: LoopGraph, maxSteps = 128): GraphNode[] {
  const output: GraphNode[] = [];
  const visited = new Set<number>();
  let cursor = graph.headId;

  for (let step = 0; step < maxSteps; step += 1) {
    const node = graph.nodes[cursor];
    if (!node || visited.has(node.id)) {
      break;
    }
    output.push(node);
    visited.add(node.id);
    cursor = node.nextId;
    if (cursor === graph.headId) {
      break;
    }
  }

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
  return {
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
        nextId: selected.nextId,
      },
    },
  };
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

  return {
    ...graph,
    headId: target.id === graph.headId ? target.nextId : graph.headId,
    selectedNodeId: target.id === graph.headId ? target.nextId : predecessor.id,
    nodes: updatedNodes,
  };
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
    const parsed = JSON.parse(raw) as LoopGraph;
    if (!parsed.nodes || typeof parsed.headId !== "number") {
      return null;
    }
    if (!parsed.nodes[parsed.headId]) {
      return null;
    }
    const selectedNodeId = typeof parsed.selectedNodeId === "number" && parsed.nodes[parsed.selectedNodeId]
      ? parsed.selectedNodeId
      : parsed.headId;
    const nextNodeId = typeof parsed.nextNodeId === "number"
      ? parsed.nextNodeId
      : (Math.max(...Object.keys(parsed.nodes).map((value) => Number(value))) + 1);
    return {
      ...parsed,
      selectedNodeId,
      nextNodeId,
    };
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
    const parsed = JSON.parse(raw) as SavedLoopRecord[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((loop) => loop && typeof loop.id === "string" && typeof loop.name === "string");
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
      swing: state.settings.swing,
      waveform: state.settings.waveform,
      effects: state.settings.effects,
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
    debugFooterEnabled: true,
    centralTone: "C",
    bpm: 96,
    timeSignature: "4/4",
    swing: 0,
    waveform: "triangle",
    effects: "none",
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

function normalizeBpm(value: unknown): number {
  return clamp(Number(value) || 96, 40, 240);
}

function normalizeSwing(value: unknown): number {
  return clamp(Number(value) || 0, 0, 75);
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
      debugFooterEnabled: parsed.debugFooterEnabled !== false,
      centralTone: normalizeCentralTone(parsed.centralTone),
      bpm: normalizeBpm(parsed.bpm),
      timeSignature: normalizeTimeSignature(parsed.timeSignature),
      swing: normalizeSwing(parsed.swing),
      waveform: normalizeWaveform(parsed.waveform),
      effects: normalizeEffects(parsed.effects),
      midiEnabled: Boolean(parsed.midiEnabled),
      midiPortId: typeof parsed.midiPortId === "string" ? parsed.midiPortId : "",
      midiChannel: clamp(Number(parsed.midiChannel) || 1, 1, 16),
      midiPorts: [],
      showPanel: false,
      showPerformPanel: false,
      showSavedLoopsPanel: false,
    };
  } catch {
    return defaults;
  }
}

function saveSettings(settings: AppSettings): void {
  try {
    const persisted = {
      debugFooterEnabled: settings.debugFooterEnabled,
      centralTone: settings.centralTone,
      bpm: settings.bpm,
      timeSignature: settings.timeSignature,
      swing: settings.swing,
      waveform: settings.waveform,
      effects: settings.effects,
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

function chordToMidi(chord: ChordEntry): number[] {
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

let audioContextRef: AudioContext | null = null;
let midiAccessRef: MidiAccessLike | null = null;
let midiStateListenerBound = false;

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

function sendMidiPreview(chord: ChordEntry): void {
  const state = store.getState();
  const settings = state.settings;
  if (!settings.midiEnabled || !settings.midiPortId) {
    return;
  }

  const outputs = midiAccessRef?.outputs;
  if (!outputs?.values) {
    return;
  }

  let selectedOutput: MidiOutputLike | null = null;
  for (const output of outputs.values()) {
    if (output.id === settings.midiPortId) {
      selectedOutput = output;
      break;
    }
  }

  if (!selectedOutput) {
    return;
  }

  const midiNotes = chordToMidi(chord).map((note) => clamp(note, 0, 127));
  const channel = clamp(settings.midiChannel, 1, 16) - 1;
  const noteOn = 0x90 + channel;
  const noteOff = 0x80 + channel;

  midiNotes.forEach((note) => {
    selectedOutput?.send([noteOn, note, 96]);
  });

  window.setTimeout(() => {
    midiNotes.forEach((note) => {
      selectedOutput?.send([noteOff, note, 0]);
    });
  }, 920);
}

function playChordPreview(chord: ChordEntry, pulseNodeId?: number): void {
  triggerCenterPulse(pulseNodeId);

  const state = store.getState();
  const waveform = state.settings.waveform;
  const effects = state.settings.effects;
  const match = findChordInCatalog(state.catalog, chord.full_name);
  const familyName = match ? state.catalog.families[match.familyIndex]?.name ?? "Unknown family" : "Unknown family";
  const tones = chordTonesFromIntervals(chord, state.settings.centralTone);
  const tonesText = tones.length > 0 ? tones.join(" ") : "n/a";
  appendDebugLog(`[audio] ${familyName} | ${chord.full_name} | tones: ${tonesText} | wave=${waveform} fx=${effects}`);

  sendMidiPreview(chord);

  let context: AudioContext;
  try {
    context = getAudioContext();
  } catch {
    return;
  }

  if (context.state === "suspended") {
    void context.resume();
  }

  const frequencies = chordToMidi(chord).map(midiToFrequency);
  const now = context.currentTime;
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

  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(0.18, now + 0.03);
  master.gain.exponentialRampToValueAtTime(0.001, now + 1.1);

  const detuneSpread = effects === "chorus" ? 11 : 4;

  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const voiceGain = context.createGain();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.detune.setValueAtTime((index - 1) * detuneSpread, now);
    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(0.28 / Math.max(1, frequencies.length), now + 0.02 + index * 0.01);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95 + index * 0.02);
    oscillator.connect(voiceGain);
    voiceGain.connect(master);
    oscillator.start(now + index * 0.01);
    oscillator.stop(now + 1.15 + index * 0.02);
  });
}

async function ensureMidiAccess(): Promise<MidiAccessLike | null> {
  if (midiAccessRef) {
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
      midiAccessRef = await nav.requestMIDIAccess({ sysex: false });
    } catch {
      midiAccessRef = await nav.requestMIDIAccess();
    }
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
      status: "Web MIDI unavailable. In Firefox on Linux, enable dom.webmidi.enabled in about:config and reload.",
    });
    appendDebugLog("[midi] Web MIDI unavailable. On Firefox/Linux enable dom.webmidi.enabled and reload.");
    return;
  }

  const ports: MidiPortOption[] = [];
  const outputs = access.outputs;
  if (outputs?.forEach) {
    outputs.forEach((output) => {
      ports.push({ id: output.id, name: output.name ?? `MIDI ${output.id}` });
    });
  } else if (outputs?.values) {
    for (const output of outputs.values()) {
      ports.push({ id: output.id, name: output.name ?? `MIDI ${output.id}` });
    }
  } else if (outputs?.[Symbol.iterator]) {
    for (const [, output] of outputs) {
      ports.push({ id: output.id, name: output.name ?? `MIDI ${output.id}` });
    }
  }

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
      status: "No MIDI outputs detected. On Firefox/Linux, verify Web MIDI is enabled and a port is exposed.",
    });
    appendDebugLog("[midi] No MIDI output ports detected");
  }

  if (!midiStateListenerBound) {
    access.onstatechange = () => {
      void refreshMidiPorts();
    };
    midiStateListenerBound = true;
  }
}

const initialSettings = loadSettings();
const initialCatalog = transposeCatalogForCentralTone(CATALOG_TEMPLATE, initialSettings.centralTone);
const savedGraph = loadSavedGraph();
const startingGraph = savedGraph ?? createInitialGraph(initialChordName(initialCatalog));
const persistedInteraction = loadInteractionState();
const initialSavedLoops = loadSavedLoops();
const initialSelectedNode =
  startingGraph.nodes[startingGraph.selectedNodeId] ??
  startingGraph.nodes[startingGraph.headId];
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
    this.removeDisabled = state.graph.selectedNodeId === state.graph.headId ? 1 : 0;
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
        <button class="corner-btn perform ${performPlaying ? "playing" : "paused"}" data-action="perform" aria-label="Perform" title="Perform">
          ${performPlaying ? "❚❚" : "▶"}
        </button>
      </div>
      <div class="central-tone-badge" aria-label="Progression and central tone">
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
      ${buildSavedLoopsPanel(state)}
    </div>
  `;
}

function buildDebugFooter(state: AppState): string {
  if (!state.settings.debugFooterEnabled) {
    return "";
  }

  const rows = state.debugLogs
    .map((line) => `<div class="debug-log-line">${escapeHtml(line)}</div>`)
    .join("");

  return `
    <section class="debug-footer" aria-label="Debug footer">
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
      <section class="settings-panel" role="dialog" aria-modal="true" aria-label="Settings">
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
  const effectsOptions = EFFECT_OPTIONS
    .map((effect) => `<option value="${effect}" ${effect === settings.effects ? "selected" : ""}>${escapeHtml(effect[0].toUpperCase() + effect.slice(1))}</option>`)
    .join("");

  return `
    <div class="settings-modal perform-modal ${settings.showPerformPanel ? "open" : ""}" aria-hidden="${settings.showPerformPanel ? "false" : "true"}">
      <button class="settings-backdrop" data-perform-action="close" aria-label="Close perform options"></button>
      <section class="settings-panel" role="dialog" aria-modal="true" aria-label="Perform options">
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
            <span>BPM</span>
            <input type="number" min="40" max="240" step="1" value="${settings.bpm}" data-perform-setting="bpm" />
          </label>
          <label class="settings-field">
            <span>Time Signature</span>
            <select data-perform-setting="time-signature">${timeSignatureOptions}</select>
          </label>
          <label class="settings-field">
            <span>Swing (${settings.swing}%)</span>
            <input type="range" min="0" max="75" step="1" value="${settings.swing}" data-perform-setting="swing" />
          </label>
          <label class="settings-field">
            <span>Waveform</span>
            <select data-perform-setting="waveform">${waveformOptions}</select>
          </label>
          <label class="settings-field">
            <span>Effects</span>
            <select data-perform-setting="effects">${effectsOptions}</select>
          </label>
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
      <section class="settings-panel" role="dialog" aria-modal="true" aria-label="Saved loops">
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

function buildOverlayContent(state: AppState, layout: StageLayout, geometry: SceneGeometry): string {
  const selectedChord = getSelectedChord(state);
  const family = getSelectedChordFamily(state);
  const selectedNode = state.graph.nodes[state.graph.selectedNodeId];
  const nodeViews = buildGraphNodeViews(state, layout);
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
        const label = chordLabel(chord?.full_name ?? chord?.numeral ?? "I");
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
    <div class="circuit circuit-left"></div>
    <div class="circuit circuit-right"></div>
    <span class="label center" style="left:${activeCenterX}px;top:${activeCenterY}px;transform:translate(-50%,-50%) scale(${sceneZoom.toFixed(3)})">${escapeHtml(chordLabel(selectedNode?.chordName ?? selectedChord.full_name))}</span>
    <span class="label major" style="left:${activeCenterX}px;top:${activeCenterY - layout.centerRadius + 24}px;transform:translate(-50%,-50%) scale(${sceneZoom.toFixed(3)})">${escapeHtml(bandLabel(family.name))}</span>
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
let performTimerId: number | null = null;
let performCursorNodeId: number | null = null;
let performStepCount = 0;
let modalOpenCount = 0;
let resumePerformAfterModalClose = false;
let debugFooterDraft = "";
let restoreDebugInputFocus = false;
const nodeOffsets: Record<number, { x: number; y: number }> = { ...initialNodeOffsets };
const nodeVelocities: Record<number, { vx: number; vy: number }> = {};
let forcePinnedNodeId: number | null = null;
let forceRafId = 0;

const FORCE_LINK_DIST = 230;
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

function stepForceSimulation(cx: number, cy: number): void {
  const sequence = graphSequence(store.getState().graph);
  if (sequence.length === 0) return;

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
    const delta = dist - FORCE_LINK_DIST;
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

  // integrate velocities and positions
  for (const node of sequence) {
    if (node.id === forcePinnedNodeId) { nodeVelocities[node.id] = { vx: 0, vy: 0 }; continue; }
    const vel = nodeVelocities[node.id]!;
    vel.vx = (vel.vx + fx[node.id]) * FORCE_DAMPING;
    vel.vy = (vel.vy + fy[node.id]) * FORCE_DAMPING;
    const o = nodeOffsets[node.id]!;
    o.x += vel.vx;
    o.y += vel.vy;
  }
}

function runForceLoop(): void {
  const canvas = root.querySelector<HTMLCanvasElement>(".webgl-stage");
  forceRafId = window.requestAnimationFrame(runForceLoop);
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const layout = buildLayout(rect.width, rect.height);
  stepForceSimulation(layout.centerX, layout.centerY);
  redrawCanvasOnly(canvas);
}

activeSavedLoopId = store.getState().savedLoopSelectedId;
activeSavedLoopSignature = currentLoopStateSignature(store.getState());

const CENTER_PULSE_MS = 620;
let centerPulseStartMs = 0;
let centerPulseRafId = 0;
let centerPulseNodeId: number | null = null;

function stopPerformLoop(): void {
  if (performTimerId !== null) {
    window.clearTimeout(performTimerId);
    performTimerId = null;
  }
  performPlaying = false;
}

function currentPerformStepMs(stepCount: number): number {
  const { bpm, swing } = store.getState().settings;
  const beatMs = 60000 / clamp(bpm, 40, 240);
  if (swing <= 0) {
    return beatMs;
  }
  const swingRatio = clamp(swing / 100, 0, 0.75);
  const isOddStep = stepCount % 2 === 1;
  const multiplier = isOddStep ? 1 - swingRatio * 0.5 : 1 + swingRatio * 0.5;
  return beatMs * multiplier;
}

function scheduleNextPerformStep(): void {
  if (!performPlaying) {
    return;
  }
  const delayMs = currentPerformStepMs(performStepCount);
  performTimerId = window.setTimeout(() => {
    if (!performPlaying) {
      return;
    }
    performStepCount += 1;
    performStep();
    scheduleNextPerformStep();
  }, delayMs);
}

function pulseStrengthAt(nowMs: number): number {
  if (centerPulseStartMs <= 0) {
    return 0;
  }
  const elapsed = nowMs - centerPulseStartMs;
  if (elapsed < 0 || elapsed > CENTER_PULSE_MS) {
    return 0;
  }
  const t = clamp(elapsed / CENTER_PULSE_MS, 0, 1);
  return Math.sin(t * Math.PI) * (1 - t * 0.25);
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
    if (pulseStrengthAt(nowMs) > 0) {
      schedulePulseRedraw();
    }
  });
}

function triggerCenterPulse(nodeId?: number): void {
  if (pulseStrengthAt(performance.now()) > 0.001) {
    return;
  }
  centerPulseNodeId = nodeId ?? null;
  centerPulseStartMs = performance.now();
  schedulePulseRedraw();
}

function syncSelectionToNode(nodeId: number, status: string, options?: { updateSelection?: boolean }): void {
  const state = store.getState();
  const node = state.graph.nodes[nodeId];
  if (!node) {
    return;
  }

  const updateSelection = options?.updateSelection ?? true;

  const match = findChordInCatalog(state.catalog, node.chordName);
  const updatedGraph = updateSelection
    ? {
      ...state.graph,
      selectedNodeId: nodeId,
    }
    : state.graph;

  if (match) {
    const chord = state.catalog.families[match.familyIndex]?.chords[match.chordIndex];
    if (chord) {
      playChordPreview(chord, nodeId);
    }
  }

  if (updateSelection) {
    saveGraph(updatedGraph);
  }
  const keepCatalogSelection = performPlaying || !updateSelection;
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

function performStep(): void {
  const state = store.getState();
  const graph = state.graph;

  if (performCursorNodeId === null || !graph.nodes[performCursorNodeId]) {
    performCursorNodeId = graph.selectedNodeId;
  } else {
    performCursorNodeId = graph.nodes[performCursorNodeId]?.nextId ?? graph.headId;
  }

  if (performCursorNodeId === null) {
    return;
  }

  const chordName = graph.nodes[performCursorNodeId]?.chordName ?? "state";
  syncSelectionToNode(performCursorNodeId, `Performing ${chordName}`, { updateSelection: false });
}

function startPerformLoop(options?: { resetCursor?: boolean }): void {
  const resetCursor = options?.resetCursor ?? true;
  stopPerformLoop();
  performPlaying = true;
  performStepCount = 0;
  if (resetCursor) {
    performCursorNodeId = null;
  }
  performStep();
  scheduleNextPerformStep();
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
    });
  });

  return views;
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

  const pulseStrength = pulseStrengthAt(performance.now());
  if (pulseStrength > 0.001) {
    const pulseNodeView = centerPulseNodeId !== null
      ? findGraphNodeViewById(nodeViews, centerPulseNodeId)
      : null;
    const pulseCenterX = pulseNodeView?.x ?? activeCenterX;
    const pulseCenterY = pulseNodeView?.y ?? activeCenterY;
    ctx.beginPath();
    ctx.arc(pulseCenterX, pulseCenterY, layout.centerRadius + pulseStrength * 4, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(126, 231, 255, ${0.22 + pulseStrength * 0.7})`;
    ctx.lineWidth = 3 + pulseStrength * 8;
    ctx.shadowColor = "rgba(128, 238, 255, 0.95)";
    ctx.shadowBlur = 8 + pulseStrength * 26;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

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

    const isReturnToHead = node.nextId === state.graph.headId;
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
      ctx.strokeStyle = isReturnToHead ? fromStyle.returnStroke : fromStyle.edgeStroke;
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
      ctx.fillStyle = isReturnToHead ? fromStyle.returnArrowFill : fromStyle.edgeArrowFill;
      ctx.fill();
      return;
    }

    const ux = dx / len;
    const uy = dy / len;
    const startX = from.x + ux * (from.radius - 8);
    const startY = from.y + uy * (from.radius - 8);
    const endX = to.x - ux * (to.radius - 6);
    const endY = to.y - uy * (to.radius - 6);

    if (isReturnToHead) {
      const midX = (startX + endX) * 0.5;
      const midY = (startY + endY) * 0.5;
      const awayX = midX - layout.centerX;
      const awayY = midY - layout.centerY;
      const awayLen = Math.hypot(awayX, awayY) || 1;
      const controlX = midX + (awayX / awayLen) * 120;
      const controlY = midY + (awayY / awayLen) * 120;

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(controlX, controlY, endX, endY);
      ctx.strokeStyle = fromStyle.returnStroke;
      ctx.lineWidth = 3;
      ctx.stroke();

      const tx = endX - controlX;
      const ty = endY - controlY;
      const tLen = Math.hypot(tx, ty) || 1;
      const dirX = tx / tLen;
      const dirY = ty / tLen;
      const nx = -dirY;
      const ny = dirX;
      const head = 6;
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX - dirX * head + nx * head * 0.58, endY - dirY * head + ny * head * 0.58);
      ctx.lineTo(endX - dirX * head - nx * head * 0.58, endY - dirY * head - ny * head * 0.58);
      ctx.closePath();
      ctx.fillStyle = fromStyle.returnArrowFill;
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = isReturnToHead ? fromStyle.returnStroke : fromStyle.edgeStroke;
    ctx.lineWidth = isReturnToHead ? 3 : 2.4;
    ctx.stroke();

    const head = 6;
    const nx = -uy;
    const ny = ux;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - ux * head + nx * head * 0.58, endY - uy * head + ny * head * 0.58);
    ctx.lineTo(endX - ux * head - nx * head * 0.58, endY - uy * head - ny * head * 0.58);
    ctx.closePath();
    ctx.fillStyle = isReturnToHead ? fromStyle.returnArrowFill : fromStyle.edgeArrowFill;
    ctx.fill();
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

    familySegments.forEach((seg, index) => {
      const familyIndex = familyIndices[index] ?? 0;
      const familyName = shorthand(state.catalog.families[familyIndex]?.name ?? "Family");
      const point = segmentMidpoint(layout, seg, view.x, view.y);
      ctx.fillStyle = index === selectedFamilySegmentIndex
        ? "rgba(222, 242, 255, 0.96)"
        : "rgba(181, 214, 255, 0.86)";
      ctx.font = "600 10px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(familyName, point.x, point.y);
    });

    chordSegments.forEach((seg, index) => {
      const chord = nodeFamily.chords[index];
      const label = chordLabel(chord?.full_name ?? chord?.numeral ?? "I");
      const point = segmentMidpoint(layout, seg, view.x, view.y);
      ctx.fillStyle = index === nodeChordIndex
        ? "rgba(221, 249, 255, 0.98)"
        : "rgba(165, 208, 255, 0.9)";
      ctx.font = "500 13px 'Cormorant Garamond', serif";
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

    const isHead = view.nodeId === state.graph.headId;
    const viewStyle = graphNodeTypeConfig(view.type).renderStyle;
    ctx.beginPath();
    ctx.arc(view.x, view.y, layout.centerRadius * nodeScale, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(6, 14, 31, 0.95)";
    ctx.fill();
    ctx.strokeStyle = isHead ? viewStyle.headNodeStroke : viewStyle.nodeStroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = viewStyle.nodeTextFill;
    ctx.font = "600 11px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(view.chordName.slice(0, 9), view.x, view.y + 1);
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
    playChordPreview(chosen);
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
  stopPerformLoop();
  performCursorNodeId = null;

  const state = store.getState();
  const initialChord = initialChordName(state.catalog);
  const nextLoopName = randomLoopName();
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
    graph: cloneGraph(state.graph),
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
      swing: state.settings.swing,
      waveform: state.settings.waveform,
      effects: state.settings.effects,
      midiEnabled: state.settings.midiEnabled,
      midiPortId: state.settings.midiPortId,
      midiChannel: state.settings.midiChannel,
      debugFooterEnabled: state.settings.debugFooterEnabled,
    },
    updatedAt: new Date().toISOString(),
  };
}

function saveCurrentLoopState(): void {
  const state = store.getState();
  const rawName = state.savedLoopDraft.trim();
  const name = rawName.length > 0 ? rawName : randomLoopName();
  const id = `loop-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const nextRecord = buildSavedLoopRecord(state, id, name);
  const savedLoops = [nextRecord, ...state.savedLoops];
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
  performCursorNodeId = null;

  const settings: AppSettings = {
    ...state.settings,
    ...loop.settings,
    showPanel: false,
    showPerformPanel: false,
    showSavedLoopsPanel: false,
    midiPorts: state.settings.midiPorts,
  };
  const catalog = transposeCatalogForCentralTone(CATALOG_TEMPLATE, settings.centralTone);
  const graph = cloneGraph(loop.graph);
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

function redrawCanvasOnly(canvas: HTMLCanvasElement): void {
  const state = store.getState();
  const rect = canvas.getBoundingClientRect();
  const layout = buildLayout(rect.width, rect.height);
  const geometry = buildSceneGeometry(state, layout);
  hitZones = buildHitZones(layout, geometry, state);
  drawFallback2d(canvas, layout, geometry, state);

  const overlayEl = root.querySelector<HTMLElement>(".overlay");
  if (overlayEl) {
    overlayEl.innerHTML = buildOverlayContent(state, layout, geometry);
    overlayEl.style.transform = "none";
  }
}

function bindCornerControls(shell: HTMLElement): void {
  const settingsBtn = shell.querySelector<HTMLButtonElement>(".corner-btn[data-action='settings']");
  const savedLoopsBtn = shell.querySelector<HTMLButtonElement>(".corner-btn[data-action='saved-loops']");
  const performBtn = shell.querySelector<HTMLButtonElement>(".corner-btn[data-action='perform']");

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
    if (selectedLoop) {
      store.setState({
        ...state,
        savedLoopDraft: selectedLoop.name,
      });
    } else if (!state.savedLoopDraft.trim()) {
      store.setState({
        ...state,
        savedLoopDraft: randomLoopName(),
      });
    }
    restoreSavedLoopNameFocus = true;
    savedLoopNameCursor = (selectedLoop?.name ?? state.savedLoopDraft).length;
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
      const state = store.getState();
      if (!state.settings.showPerformPanel) {
        handleModalOpened();
      }
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
      const state = store.getState();
      if (state.settings.showPerformPanel) {
        handleModalClosed();
      }
      updateSettings({ showPerformPanel: false }, "Perform options closed");
    });
  });

  const bpmInput = shell.querySelector<HTMLInputElement>("input[data-perform-setting='bpm']");
  bpmInput?.addEventListener("change", () => {
    const bpm = normalizeBpm(bpmInput.value);
    updateSettings({ bpm }, `Tempo set to ${bpm} BPM`);
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
  swingInput?.addEventListener("input", () => {
    const swing = normalizeSwing(swingInput.value);
    updateSettings({ swing }, `Swing set to ${swing}%`);
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

  canvas.addEventListener("pointerdown", (event) => {
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
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!pressContext || pressContext.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - pressContext.startX;
    const dy = event.clientY - pressContext.startY;
    if (Math.hypot(dx, dy) > 10) {
      pressContext.moved = true;
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
    if (!pressContext || pressContext.pointerId !== event.pointerId) {
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
            graph: {
              ...state.graph,
              selectedNodeId: hit.nodeId,
            },
            selectedFamilyIndex: match?.familyIndex ?? state.selectedFamilyIndex,
            selectedChordIndex: match?.chordIndex ?? state.selectedChordIndex,
            chordFanVisible: true,
            status: `Selected state/node ${selectedNode.chordName}`,
          });
          saveGraph({
            ...state.graph,
            selectedNodeId: hit.nodeId,
          });
          appendDebugLog(
            `[ui] selected node id=${hit.nodeId} chord="${selectedNode.chordName}"`,
          );
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

function render(): void {
  const state = store.getState();
  const currentStatus = !FORCE_CANVAS_RENDERER && webglUnavailable
    ? "WebGL unavailable in this embedded preview; open in a GPU-enabled browser to see the full scene"
    : state.status;

  const stateForRender = {
    ...state,
    status: currentStatus,
  };

  const placeholderLayout = buildLayout(window.innerWidth, window.innerHeight);
  const geometry = buildSceneGeometry(stateForRender, placeholderLayout);
  overlay(root, stateForRender, placeholderLayout, geometry);

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
  if (rafId) {
    window.cancelAnimationFrame(rafId);
  }
  if (forceRafId) {
    window.cancelAnimationFrame(forceRafId);
    forceRafId = 0;
  }
  resizeObserver?.disconnect();
});
