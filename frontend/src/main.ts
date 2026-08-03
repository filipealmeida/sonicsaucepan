import { createStore } from "zustand/vanilla";
import catalogJson from "../../assets/chords/creative_chord_choices.json";
import "./styles.css";

type ChordEntry = {
  numeral?: string;
  full_name: string;
  intervals?: number[];
  root?: string | null;
  midi_notes?: number[];
};

type ChordFamily = {
  name: string;
  chords: ChordEntry[];
};

type ChordCatalog = {
  families: ChordFamily[];
};

type GraphNode = {
  id: number;
  chordName: string;
  nextId: number;
};

type LoopGraph = {
  headId: number;
  selectedNodeId: number;
  nextNodeId: number;
  nodes: Record<number, GraphNode>;
};

type HitZone = {
  kind: "family" | "chord" | "action" | "node";
  index?: number;
  action?: "add" | "remove";
  nodeId?: number;
  x: number;
  y: number;
  radius: number;
};

type GestureContext = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  gestureHandled: boolean;
  longPressTimer: number | null;
};

type AppState = {
  catalog: ChordCatalog;
  selectedFamilyIndex: number;
  selectedChordIndex: number;
  graph: LoopGraph;
  status: string;
  showMobileSheet: boolean;
  playing: boolean;
  centralTone: string;
  bpm: number;
  swing: number;
  graphBackend: "wasm" | "local";
};

type GraphBridge = {
  mode: "wasm" | "local";
  addAfter(graph: LoopGraph, afterId: number, chordName: string): LoopGraph;
  remove(graph: LoopGraph, nodeId: number): LoopGraph;
};

type WasmGraphLike = {
  add_after?: (afterId: number, chordName: string) => number;
  addAfter?: (afterId: number, chordName: string) => number;
  remove?: (nodeId: number) => void;
  snapshot_json?: () => string;
  snapshotJson?: () => string;
};

type WasmGlobal = {
  WasmLoopGraph?: new (initialChordName: string) => WasmGraphLike;
};

type ChordDescriptor = {
  label: string;
  midi: number[];
};

const CATALOG = catalogJson as ChordCatalog;

const root = document.getElementById("app");
if (!root) {
  throw new Error("Expected #app container");
}

const chordLookup = new Map<string, ChordEntry>();
for (const family of CATALOG.families) {
  for (const chord of family.chords) {
    chordLookup.set(chord.full_name.toLowerCase(), chord);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function wrapIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  const mod = index % length;
  return mod < 0 ? mod + length : mod;
}

function shortenFamilyName(name: string): string {
  const words = name.split(/\s+/);
  if (words.length <= 2) {
    return name;
  }

  const important = words.find((part) =>
    /^(diatonic|secondary|modal|ii-v|tritone|diminished|explicit|user)$/i.test(part)
  );
  return important ?? words[0];
}

function createInitialGraph(chordName: string): LoopGraph {
  return {
    headId: 0,
    selectedNodeId: 0,
    nextNodeId: 1,
    nodes: {
      0: { id: 0, chordName, nextId: 0 },
    },
  };
}

function graphSequence(graph: LoopGraph, maxSteps = 128): GraphNode[] {
  const nodes: GraphNode[] = [];
  let cursor = graph.headId;
  const visited = new Set<number>();

  for (let step = 0; step < maxSteps; step += 1) {
    const node = graph.nodes[cursor];
    if (!node || visited.has(cursor)) {
      break;
    }

    nodes.push(node);
    visited.add(cursor);
    cursor = node.nextId;

    if (cursor === graph.headId) {
      break;
    }
  }

  return nodes;
}

function findPredecessor(graph: LoopGraph, nodeId: number): GraphNode | null {
  for (const node of Object.values(graph.nodes)) {
    if (node.nextId === nodeId) {
      return node;
    }
  }
  return null;
}

function addAfterLocal(graph: LoopGraph, afterId: number, chordName: string): LoopGraph {
  const selected = graph.nodes[afterId];
  if (!selected) {
    return graph;
  }

  const insertedId = graph.nextNodeId;
  const insertedNode: GraphNode = {
    id: insertedId,
    chordName,
    nextId: selected.nextId,
  };

  return {
    ...graph,
    selectedNodeId: insertedId,
    nextNodeId: insertedId + 1,
    nodes: {
      ...graph.nodes,
      [selected.id]: { ...selected, nextId: insertedId },
      [insertedId]: insertedNode,
    },
  };
}

function removeLocal(graph: LoopGraph, nodeId: number): LoopGraph {
  if (nodeId === graph.headId) {
    return graph;
  }

  const target = graph.nodes[nodeId];
  if (!target) {
    return graph;
  }

  const predecessor = findPredecessor(graph, nodeId);
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
    selectedNodeId: predecessor.id,
    nodes: updatedNodes,
  };
}

function parseWasmSnapshot(snapshotJson: string, selectedNodeId: number): LoopGraph | null {
  try {
    const parsed = JSON.parse(snapshotJson) as {
      initial_id: number;
      next_id: number;
      nodes: Record<string, { id: number; chord?: { name?: string }; next: number }>;
    };

    const nodes: Record<number, GraphNode> = {};
    for (const raw of Object.values(parsed.nodes)) {
      const chordName = raw.chord?.name ?? `Node ${raw.id}`;
      nodes[raw.id] = {
        id: raw.id,
        chordName,
        nextId: raw.next,
      };
    }

    const selected = nodes[selectedNodeId] ? selectedNodeId : parsed.initial_id;
    return {
      headId: parsed.initial_id,
      selectedNodeId: selected,
      nextNodeId: parsed.next_id,
      nodes,
    };
  } catch {
    return null;
  }
}

function createWasmBridge(initialChord: string): GraphBridge | null {
  const globalObject = globalThis as typeof globalThis & { SonicSaucepanWasm?: WasmGlobal };
  const wasmGlobal = globalObject.SonicSaucepanWasm;
  if (!wasmGlobal?.WasmLoopGraph) {
    return null;
  }

  try {
    const wasmGraph = new wasmGlobal.WasmLoopGraph(initialChord);

    const addAfterCall = wasmGraph.add_after ?? wasmGraph.addAfter;
    const snapshotCall = wasmGraph.snapshot_json ?? wasmGraph.snapshotJson;
    const removeCall = wasmGraph.remove;

    if (!addAfterCall || !snapshotCall || !removeCall) {
      return null;
    }

    return {
      mode: "wasm",
      addAfter(graph, afterId, chordName) {
        const newId = addAfterCall.call(wasmGraph, afterId, chordName);
        const parsed = parseWasmSnapshot(snapshotCall.call(wasmGraph), newId);
        return parsed ?? addAfterLocal(graph, afterId, chordName);
      },
      remove(graph, nodeId) {
        if (nodeId === graph.headId) {
          return graph;
        }

        const predecessor = findPredecessor(graph, nodeId);
        removeCall.call(wasmGraph, nodeId);
        const parsed = parseWasmSnapshot(
          snapshotCall.call(wasmGraph),
          predecessor?.id ?? graph.headId,
        );
        return parsed ?? removeLocal(graph, nodeId);
      },
    };
  } catch {
    return null;
  }
}

function createGraphBridge(initialChord: string): GraphBridge {
  const wasmBridge = createWasmBridge(initialChord);
  if (wasmBridge) {
    return wasmBridge;
  }

  return {
    mode: "local",
    addAfter: addAfterLocal,
    remove: removeLocal,
  };
}

function parseRoot(input: string): { semitone: number; tail: string } {
  const match = input.trim().match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!match) {
    return { semitone: 0, tail: "" };
  }

  const letter = match[1].toUpperCase();
  const accidental = match[2];
  const tail = match[3] ?? "";

  const base: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };

  let semitone = base[letter] ?? 0;
  if (accidental === "#") {
    semitone += 1;
  } else if (accidental === "b") {
    semitone -= 1;
  }

  semitone = ((semitone % 12) + 12) % 12;
  return { semitone, tail: tail.toLowerCase() };
}

function semitoneIntervalsFromName(name: string): number[] {
  const { tail } = parseRoot(name);

  if (tail.includes("dim")) {
    return [0, 3, 6, 9];
  }

  if (tail.includes("m7b5") || tail.includes("ø")) {
    return [0, 3, 6, 10];
  }

  if (tail.includes("m7")) {
    return [0, 3, 7, 10];
  }

  if (tail.includes("m")) {
    return [0, 3, 7];
  }

  if (tail.includes("7") && !tail.includes("maj7")) {
    return [0, 4, 7, 10];
  }

  if (tail.includes("maj7")) {
    return [0, 4, 7, 11];
  }

  return [0, 4, 7];
}

function midiFromChordName(name: string): number[] {
  const lookup = chordLookup.get(name.toLowerCase());
  if (lookup?.midi_notes && lookup.midi_notes.length > 0) {
    return lookup.midi_notes;
  }

  const { semitone } = parseRoot(name);
  const intervals = semitoneIntervalsFromName(name);
  const baseMidi = 60 + semitone;
  return intervals.map((interval) => clamp(baseMidi + interval, 24, 108));
}

function buildPlayableChords(graph: LoopGraph): ChordDescriptor[] {
  return graphSequence(graph).map((node) => ({
    label: node.chordName,
    midi: midiFromChordName(node.chordName),
  }));
}

class WebAudioTransport {
  private context: AudioContext | null = null;

  private isPlaying = false;

  private timer: number | null = null;

  private chordIndex = 0;

  private getState: () => AppState;

  constructor(getState: () => AppState) {
    this.getState = getState;
  }

  async start(): Promise<void> {
    if (this.isPlaying) {
      return;
    }

    const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) {
      throw new Error("Web Audio API is not available in this browser");
    }

    if (!this.context) {
      this.context = new AudioCtor();
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    this.isPlaying = true;
    this.chordIndex = 0;
    this.scheduleNext();
  }

  stop(): void {
    this.isPlaying = false;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.isPlaying || !this.context) {
      return;
    }

    const state = this.getState();
    const chordSet = buildPlayableChords(state.graph);
    if (chordSet.length === 0) {
      this.stop();
      return;
    }

    const bpm = clamp(state.bpm, 40, 220);
    const swingAmount = clamp(state.swing, 0, 60) / 100;

    const beatMs = 60_000 / bpm;
    const beatsPerChord = 4;
    let durationMs = beatMs * beatsPerChord;

    const isOffBeat = this.chordIndex % 2 === 1;
    if (isOffBeat) {
      durationMs *= 1 + swingAmount * 0.5;
    } else {
      durationMs *= 1 - swingAmount * 0.3;
    }

    const chord = chordSet[this.chordIndex % chordSet.length];
    const now = this.context.currentTime;
    this.playChord(chord.midi, durationMs / 1000, now);

    this.chordIndex += 1;
    this.timer = window.setTimeout(() => this.scheduleNext(), durationMs);
  }

  private playChord(midiNotes: number[], durationSec: number, now: number): void {
    if (!this.context) {
      return;
    }

    const master = this.context.createGain();
    master.connect(this.context.destination);
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.28, now + 0.04);
    master.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.12, durationSec * 0.92));

    for (const midi of midiNotes) {
      const frequency = 440 * 2 ** ((midi - 69) / 12);

      const osc = this.context.createOscillator();
      const voice = this.context.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(frequency, now);

      voice.gain.setValueAtTime(0.0001, now);
      voice.gain.exponentialRampToValueAtTime(0.12, now + 0.04);
      voice.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.1, durationSec * 0.85));

      osc.connect(voice);
      voice.connect(master);

      osc.start(now);
      osc.stop(now + durationSec);
    }

    const cleanupAt = now + durationSec + 0.15;
    master.gain.setValueAtTime(0.0001, cleanupAt);
  }
}

const initialChordName = CATALOG.families[0]?.chords[0]?.full_name ?? "Cmaj7";
const graphBridge = createGraphBridge(initialChordName);

const store = createStore<AppState>(() => ({
  catalog: CATALOG,
  selectedFamilyIndex: 0,
  selectedChordIndex: 0,
  graph: createInitialGraph(initialChordName),
  status: "Tap nodes to edit the loop. Swipe on canvas to browse. Long press center for controls.",
  showMobileSheet: false,
  playing: false,
  centralTone: "C",
  bpm: 120,
  swing: 0,
  graphBackend: graphBridge.mode,
}));

const audioTransport = new WebAudioTransport(() => store.getState());
let stageCleanup: (() => void) | null = null;

function setFamily(index: number): void {
  const state = store.getState();
  const familyCount = state.catalog.families.length;
  const nextFamilyIndex = wrapIndex(index, familyCount);

  store.setState({
    selectedFamilyIndex: nextFamilyIndex,
    selectedChordIndex: 0,
    status: `Focused family: ${state.catalog.families[nextFamilyIndex].name}`,
  });
}

function setChord(index: number): void {
  const state = store.getState();
  const family = state.catalog.families[state.selectedFamilyIndex];
  const nextChordIndex = wrapIndex(index, family.chords.length);

  store.setState({
    selectedChordIndex: nextChordIndex,
    status: `Focused chord: ${family.chords[nextChordIndex].full_name}`,
  });
}

function cycleFamily(delta: number): void {
  setFamily(store.getState().selectedFamilyIndex + delta);
}

function cycleChord(delta: number): void {
  setChord(store.getState().selectedChordIndex + delta);
}

function getSelectedChord(state: AppState): ChordEntry {
  const family = state.catalog.families[state.selectedFamilyIndex];
  return family.chords[state.selectedChordIndex] ?? family.chords[0];
}

function addSelectedChordToGraph(): void {
  const state = store.getState();
  const selectedChord = getSelectedChord(state);

  const nextGraph = graphBridge.addAfter(
    state.graph,
    state.graph.selectedNodeId,
    selectedChord.full_name,
  );

  store.setState({
    graph: nextGraph,
    status: `Inserted ${selectedChord.full_name} after selected node`,
  });
}

function removeSelectedGraphNode(): void {
  const state = store.getState();
  const selectedId = state.graph.selectedNodeId;
  if (selectedId === state.graph.headId) {
    store.setState({ status: "Initial state node cannot be removed" });
    return;
  }

  const selected = state.graph.nodes[selectedId];
  const nextGraph = graphBridge.remove(state.graph, selectedId);

  store.setState({
    graph: nextGraph,
    status: `Removed node ${selected?.chordName ?? ""}`,
  });
}

function selectGraphNode(nodeId: number): void {
  const state = store.getState();
  if (!state.graph.nodes[nodeId]) {
    return;
  }

  store.setState({
    graph: {
      ...state.graph,
      selectedNodeId: nodeId,
    },
    status: `Selected loop node ${state.graph.nodes[nodeId].chordName}`,
  });
}

function toggleMobileSheet(): void {
  const state = store.getState();
  store.setState({ showMobileSheet: !state.showMobileSheet });
}

async function togglePlayState(): Promise<void> {
  const state = store.getState();

  if (state.playing) {
    audioTransport.stop();
    store.setState({
      playing: false,
      status: "Stopped Web Audio playback",
    });
    return;
  }

  try {
    await audioTransport.start();
    store.setState({
      playing: true,
      status: "Playing loop through Web Audio",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start audio";
    store.setState({ status: message });
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawRingLabel(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  angle: number,
  width: number,
  height: number,
  text: string,
  active: boolean,
): void {
  const radians = ((angle - 90) * Math.PI) / 180;
  const x = centerX + Math.cos(radians) * radius;
  const y = centerY + Math.sin(radians) * radius;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((angle * Math.PI) / 180);

  drawRoundedRect(ctx, -width / 2, -height / 2, width, height, 14);
  ctx.fillStyle = active ? "rgba(255, 189, 74, 0.28)" : "rgba(12, 20, 48, 0.95)";
  ctx.strokeStyle = active ? "rgba(255, 205, 116, 0.95)" : "rgba(103, 160, 255, 0.5)";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = active ? "#ffe8b8" : "#dbe8ff";
  ctx.font = "600 14px 'Space Grotesk', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 1);
  ctx.restore();
}

function drawNodeTrack(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  y: number,
  width: number,
  nodes: GraphNode[],
  selectedNodeId: number,
): HitZone[] {
  const zones: HitZone[] = [];
  if (nodes.length === 0) {
    return zones;
  }

  const spacing = Math.min(102, width / Math.max(nodes.length, 1));
  const startX = centerX - ((nodes.length - 1) * spacing) / 2;

  ctx.save();
  ctx.strokeStyle = "rgba(110, 166, 255, 0.35)";
  ctx.lineWidth = 2;

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const x = startX + spacing * index;
    const selected = node.id === selectedNodeId;

    if (index < nodes.length - 1) {
      const nextX = startX + spacing * (index + 1);
      ctx.beginPath();
      ctx.moveTo(x + 22, y);
      ctx.lineTo(nextX - 22, y);
      ctx.stroke();
    } else {
      const loopBackX = startX;
      ctx.beginPath();
      ctx.moveTo(x + 24, y + 8);
      ctx.quadraticCurveTo(centerX, y + 52, loopBackX - 24, y + 8);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(x, y, selected ? 26 : 22, 0, Math.PI * 2);
    ctx.fillStyle = selected ? "rgba(255, 188, 69, 0.26)" : "rgba(9, 15, 35, 0.95)";
    ctx.fill();
    ctx.strokeStyle = selected ? "rgba(255, 212, 129, 0.95)" : "rgba(105, 164, 255, 0.62)";
    ctx.lineWidth = selected ? 2.7 : 2;
    ctx.stroke();

    ctx.fillStyle = selected ? "#ffe6b0" : "#d4e4ff";
    ctx.font = "700 11px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = node.chordName.length > 8 ? `${node.chordName.slice(0, 8)}.` : node.chordName;
    ctx.fillText(label, x, y + 0.5);

    zones.push({
      kind: "node",
      nodeId: node.id,
      x,
      y,
      radius: selected ? 26 : 22,
    });
  }

  ctx.restore();
  return zones;
}

function setupCanvas(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return () => {};
  }

  let hitZones: HitZone[] = [];
  let gesture: GestureContext | null = null;

  const resizeObserver = new ResizeObserver(() => {
    draw();
  });
  resizeObserver.observe(canvas);

  function getCanvasPoint(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function hitTest(point: { x: number; y: number }): HitZone | null {
    for (let index = hitZones.length - 1; index >= 0; index -= 1) {
      const zone = hitZones[index];
      const dx = point.x - zone.x;
      const dy = point.y - zone.y;
      if (dx * dx + dy * dy <= zone.radius * zone.radius) {
        return zone;
      }
    }
    return null;
  }

  function drawBackground(width: number, height: number): void {
    const gradient = ctx.createRadialGradient(
      width * 0.5,
      height * 0.38,
      40,
      width * 0.5,
      height * 0.7,
      width * 0.62,
    );

    gradient.addColorStop(0, "rgba(94, 149, 255, 0.25)");
    gradient.addColorStop(0.52, "rgba(10, 17, 40, 0.7)");
    gradient.addColorStop(1, "rgba(4, 8, 20, 0.98)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(104, 164, 255, 0.17)";
    ctx.lineWidth = 1;
    for (let row = 0; row < 6; row += 1) {
      const y = height * (0.13 + row * 0.12);
      ctx.beginPath();
      ctx.moveTo(width * 0.08, y);
      ctx.quadraticCurveTo(width * 0.52, y - 18, width * 0.92, y);
      ctx.stroke();
    }
  }

  function draw(): void {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = rect.width;
    const height = rect.height;
    const centerX = width * 0.5;
    const centerY = height * 0.5;

    drawBackground(width, height);

    const liveState = store.getState();
    const family = liveState.catalog.families[liveState.selectedFamilyIndex];
    const selectedChord = getSelectedChord(liveState);
    const graphNodes = graphSequence(liveState.graph);

    hitZones = [];

    const familyRadius = Math.min(width, height) * 0.38;
    const chordRadius = familyRadius * 1.2;
    const familyStart = 210;
    const familyEnd = 340;
    const chordStart = -160;
    const chordEnd = -20;

    for (let index = 0; index < liveState.catalog.families.length; index += 1) {
      const entry = liveState.catalog.families[index];
      const angle = liveState.catalog.families.length === 1
        ? 270
        : familyStart + (index / (liveState.catalog.families.length - 1)) * (familyEnd - familyStart);
      drawRingLabel(
        ctx,
        centerX,
        centerY,
        familyRadius,
        angle,
        130,
        34,
        shortenFamilyName(entry.name),
        index === liveState.selectedFamilyIndex,
      );

      const radians = ((angle - 90) * Math.PI) / 180;
      hitZones.push({
        kind: "family",
        index,
        x: centerX + Math.cos(radians) * familyRadius,
        y: centerY + Math.sin(radians) * familyRadius,
        radius: 28,
      });
    }

    for (let index = 0; index < family.chords.length; index += 1) {
      const entry = family.chords[index];
      const angle = family.chords.length === 1
        ? -90
        : chordStart + (index / (family.chords.length - 1)) * (chordEnd - chordStart);
      const radians = ((angle - 90) * Math.PI) / 180;
      const x = centerX + Math.cos(radians) * chordRadius;
      const y = centerY + Math.sin(radians) * chordRadius;
      const active = index === liveState.selectedChordIndex;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((angle * Math.PI) / 180);
      drawRoundedRect(ctx, -52, -20, 104, 40, 12);
      ctx.fillStyle = active ? "rgba(99, 182, 255, 0.26)" : "rgba(9, 17, 41, 0.96)";
      ctx.strokeStyle = active ? "rgba(146, 206, 255, 0.95)" : "rgba(103, 167, 255, 0.52)";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = active ? "#edf7ff" : "#9ad7ff";
      ctx.font = "700 13px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(entry.numeral ?? entry.full_name, 0, 1);
      ctx.restore();

      hitZones.push({
        kind: "chord",
        index,
        x,
        y,
        radius: 26,
      });
    }

    const arcY = centerY + 8;
    ctx.beginPath();
    ctx.arc(centerX, arcY, 145, (210 * Math.PI) / 180, (330 * Math.PI) / 180);
    ctx.lineWidth = 44;
    ctx.strokeStyle = "rgba(255, 189, 75, 0.2)";
    ctx.stroke();

    ctx.fillStyle = "#ffc86f";
    ctx.font = "700 18px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(shortenFamilyName(family.name).toUpperCase(), centerX, centerY + 8);

    const orbGlow = ctx.createRadialGradient(centerX, centerY + 58, 20, centerX, centerY + 58, 185);
    orbGlow.addColorStop(0, "rgba(255, 186, 67, 0.22)");
    orbGlow.addColorStop(0.66, "rgba(18, 39, 91, 0.82)");
    orbGlow.addColorStop(1, "rgba(5, 10, 25, 0.98)");
    ctx.beginPath();
    ctx.arc(centerX, centerY + 58, 185, 0, Math.PI * 2);
    ctx.fillStyle = orbGlow;
    ctx.fill();
    ctx.strokeStyle = "rgba(104, 174, 255, 0.78)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = "#86d6ff";
    ctx.font = "700 42px 'Cormorant Garamond', serif";
    ctx.fillText(
      liveState.graph.nodes[liveState.graph.selectedNodeId]?.chordName ?? selectedChord.full_name,
      centerX,
      centerY + 40,
    );

    ctx.fillStyle = "rgba(226, 236, 255, 0.82)";
    ctx.font = "600 15px 'Space Grotesk', sans-serif";
    ctx.fillText(family.name, centerX, centerY + 78);

    ctx.fillStyle = "#ffcd74";
    ctx.font = "700 14px 'Space Grotesk', sans-serif";
    ctx.fillText(selectedChord.numeral ?? "select", centerX, centerY + 102);

    const addX = centerX + familyRadius * 0.95;
    const addY = centerY - 10;
    ctx.beginPath();
    ctx.arc(addX, addY, 30, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(14, 26, 60, 0.95)";
    ctx.fill();
    ctx.strokeStyle = "rgba(116, 186, 255, 0.92)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#7fd0ff";
    ctx.font = "700 24px 'Space Grotesk', sans-serif";
    ctx.fillText("+", addX, addY + 1);

    const removeX = centerX + familyRadius * 0.82;
    const removeY = centerY + 58;
    ctx.beginPath();
    ctx.arc(removeX, removeY, 22, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(14, 24, 57, 0.95)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 203, 124, 0.92)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ffc86f";
    ctx.font = "700 20px 'Space Grotesk', sans-serif";
    ctx.fillText("-", removeX, removeY + 1);

    hitZones.push({ kind: "action", action: "add", x: addX, y: addY, radius: 30 });
    hitZones.push({ kind: "action", action: "remove", x: removeX, y: removeY, radius: 22 });

    const nodeZones = drawNodeTrack(
      ctx,
      centerX,
      height - 72,
      Math.min(width * 0.86, 640),
      graphNodes,
      liveState.graph.selectedNodeId,
    );
    hitZones.push(...nodeZones);
  }

  function onPointerDown(event: PointerEvent): void {
    canvas.setPointerCapture(event.pointerId);
    const point = getCanvasPoint(event);
    const longPressTimer = window.setTimeout(() => {
      if (!gesture || gesture.moved || gesture.gestureHandled) {
        return;
      }
      gesture.gestureHandled = true;
      toggleMobileSheet();
      store.setState({ status: "Opened transport controls" });
    }, 530);

    gesture = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      moved: false,
      gestureHandled: false,
      longPressTimer,
    };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!gesture || event.pointerId !== gesture.pointerId) {
      return;
    }

    const point = getCanvasPoint(event);
    const dx = point.x - gesture.startX;
    const dy = point.y - gesture.startY;

    if (Math.hypot(dx, dy) > 8) {
      gesture.moved = true;
    }

    if (gesture.gestureHandled) {
      return;
    }

    if (Math.abs(dx) > 52 || Math.abs(dy) > 52) {
      gesture.gestureHandled = true;
      if (gesture.longPressTimer !== null) {
        window.clearTimeout(gesture.longPressTimer);
      }

      if (Math.abs(dx) >= Math.abs(dy)) {
        cycleChord(dx > 0 ? 1 : -1);
      } else {
        cycleFamily(dy > 0 ? 1 : -1);
      }
    }
  }

  function onPointerUp(event: PointerEvent): void {
    if (!gesture || event.pointerId !== gesture.pointerId) {
      return;
    }

    if (gesture.longPressTimer !== null) {
      window.clearTimeout(gesture.longPressTimer);
    }

    const point = getCanvasPoint(event);
    if (!gesture.moved && !gesture.gestureHandled) {
      const hit = hitTest(point);
      if (hit?.kind === "family" && typeof hit.index === "number") {
        setFamily(hit.index);
      } else if (hit?.kind === "chord" && typeof hit.index === "number") {
        setChord(hit.index);
      } else if (hit?.kind === "action" && hit.action === "add") {
        addSelectedChordToGraph();
      } else if (hit?.kind === "action" && hit.action === "remove") {
        removeSelectedGraphNode();
      } else if (hit?.kind === "node" && typeof hit.nodeId === "number") {
        selectGraphNode(hit.nodeId);
      }
    }

    gesture = null;
  }

  function onPointerCancel(event: PointerEvent): void {
    if (!gesture || event.pointerId !== gesture.pointerId) {
      return;
    }

    if (gesture.longPressTimer !== null) {
      window.clearTimeout(gesture.longPressTimer);
    }

    gesture = null;
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);

  draw();

  return () => {
    resizeObserver.disconnect();
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
  };
}

function render(): void {
  const state = store.getState();
  const selectedFamily = state.catalog.families[state.selectedFamilyIndex];
  const selectedChord = getSelectedChord(state);
  const sequence = graphSequence(state.graph);

  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-kicker">Sonic Saucepan Web · ${state.graphBackend.toUpperCase()} graph</div>
          <h1>Graph-driven chord canvas</h1>
          <p>The stage uses canvas rendering, closed-loop node splicing, a WASM-first graph bridge, and Web Audio loop playback.</p>
        </div>
        <div class="status-pill">${escapeHtml(state.status)}</div>
      </header>

      <main class="workspace">
        <section class="stage-card">
          <canvas class="stage-canvas" aria-label="Chord graph stage"></canvas>
          <div class="gesture-hint">Swipe left/right: chord, swipe up/down: family, long press center: controls</div>
        </section>

        <aside class="rail">
          <section class="rail-card">
            <h2>Families</h2>
            <div class="family-grid">
              ${state.catalog.families
                .map((entry, index) => {
                  const active = index === state.selectedFamilyIndex;
                  return `<button class="chip ${active ? "is-active" : ""}" data-family="${index}">${escapeHtml(entry.name)}</button>`;
                })
                .join("")}
            </div>
          </section>

          <section class="rail-card">
            <h2>Chord Source</h2>
            <p class="rail-meta">Current family: ${escapeHtml(selectedFamily.name)}</p>
            <div class="family-grid">
              ${selectedFamily.chords
                .map((entry, index) => {
                  const active = index === state.selectedChordIndex;
                  const label = entry.numeral ?? entry.full_name;
                  return `<button class="chip ${active ? "is-active" : ""}" data-chord="${index}">${escapeHtml(label)}</button>`;
                })
                .join("")}
            </div>
            <div class="actions-row">
              <button class="action-btn" data-action="insert">Insert ${escapeHtml(selectedChord.full_name)}</button>
              <button class="action-btn secondary" data-action="remove">Remove Selected</button>
            </div>
          </section>

          <section class="rail-card">
            <div class="progression-head">
              <h2>Loop Graph</h2>
              <span>${sequence.length} nodes</span>
            </div>
            <div class="loop-list">
              ${sequence
                .map((node) => {
                  const active = node.id === state.graph.selectedNodeId;
                  return `<button class="loop-chip ${active ? "is-active" : ""}" data-node="${node.id}">${escapeHtml(node.chordName)}</button>`;
                })
                .join("")}
            </div>
          </section>
        </aside>
      </main>

      <nav class="mobile-dock" aria-label="Primary actions">
        <button class="dock-btn" data-dock="settings">Settings</button>
        <button class="dock-btn" data-dock="library">Loops</button>
        <button class="dock-btn perform ${state.playing ? "is-live" : ""}" data-dock="perform">${state.playing ? "Pause" : "Perform"}</button>
      </nav>

      <section class="mobile-sheet ${state.showMobileSheet ? "is-open" : ""}" aria-hidden="${state.showMobileSheet ? "false" : "true"}">
        <div class="sheet-handle"></div>
        <div class="sheet-grid">
          <label>
            Central tone
            <input data-control="tone" value="${escapeHtml(state.centralTone)}" maxlength="2" />
          </label>
          <label>
            BPM
            <input data-control="bpm" type="number" min="40" max="220" value="${state.bpm}" />
          </label>
          <label>
            Swing
            <input data-control="swing" type="range" min="0" max="60" value="${state.swing}" />
          </label>
        </div>
      </section>
    </div>
  `;

  const canvas = root.querySelector<HTMLCanvasElement>(".stage-canvas");
  if (canvas) {
    stageCleanup?.();
    stageCleanup = setupCanvas(canvas);
  }

  root.querySelectorAll<HTMLElement>("[data-family]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = Number(button.dataset.family);
      if (!Number.isNaN(value)) {
        setFamily(value);
      }
    });
  });

  root.querySelectorAll<HTMLElement>("[data-chord]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = Number(button.dataset.chord);
      if (!Number.isNaN(value)) {
        setChord(value);
      }
    });
  });

  root.querySelectorAll<HTMLElement>("[data-node]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = Number(button.dataset.node);
      if (!Number.isNaN(value)) {
        selectGraphNode(value);
      }
    });
  });

  root.querySelectorAll<HTMLElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "insert") {
        addSelectedChordToGraph();
      } else if (action === "remove") {
        removeSelectedGraphNode();
      }
    });
  });

  root.querySelectorAll<HTMLElement>("[data-dock]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.dock;
      if (action === "perform") {
        togglePlayState();
        toggleMobileSheet();
      } else if (action === "settings") {
        toggleMobileSheet();
      } else if (action === "library") {
        store.setState({ status: `Loop contains ${sequence.length} nodes` });
      }
    });
  });

  const toneInput = root.querySelector<HTMLInputElement>("input[data-control='tone']");
  const bpmInput = root.querySelector<HTMLInputElement>("input[data-control='bpm']");
  const swingInput = root.querySelector<HTMLInputElement>("input[data-control='swing']");

  toneInput?.addEventListener("input", () => {
    store.setState({
      centralTone: toneInput.value.toUpperCase(),
    });
  });

  bpmInput?.addEventListener("input", () => {
    const value = Number(bpmInput.value);
    if (!Number.isNaN(value)) {
      store.setState({
        bpm: clamp(Math.round(value), 40, 220),
      });
    }
  });

  swingInput?.addEventListener("input", () => {
    const value = Number(swingInput.value);
    if (!Number.isNaN(value)) {
      store.setState({
        swing: clamp(Math.round(value), 0, 60),
      });
    }
  });
}

store.subscribe(render);
render();
