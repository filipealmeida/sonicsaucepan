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

type AppState = {
  catalog: ChordCatalog;
  selectedFamilyIndex: number;
  selectedChordIndex: number;
  chordFanVisible: boolean;
  graph: LoopGraph;
  status: string;
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
const MAX_SEGMENTS = 16;
const CATALOG = catalogJson as ChordCatalog;
const NODE_MANIPULATION_ENABLED = false;

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
      0: { id: 0, chordName: initialChord, nextId: 0 },
    },
  };
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
    selectedNodeId: selected.id,
    nextNodeId: newId + 1,
    nodes: {
      ...graph.nodes,
      [selected.id]: { ...selected, nextId: newId },
      [newId]: {
        id: newId,
        chordName,
        nextId: selected.nextId,
      },
    },
  };
}

function removeSelected(graph: LoopGraph): LoopGraph {
  if (graph.selectedNodeId === graph.headId) {
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
    selectedNodeId: predecessor.id,
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

function segmentMidpoint(layout: StageLayout, segment: Segment): { x: number; y: number } {
  const angle = (segment.start + segment.end) * 0.5;
  const radius = (segment.inner + segment.outer) * 0.5;
  return describeArcSegment(layout.centerX, layout.centerY, radius, angle);
}

function shorthand(name: string): string {
  const upper = name.toUpperCase();
  if (upper.includes("DIATONIC")) {
    return "MINOR";
  }
  if (upper.includes("SECONDARY")) {
    return "DOMINANT";
  }
  if (upper.includes("MODAL")) {
    return "MODES";
  }
  if (upper.includes("USER")) {
    return "USER";
  }
  const first = name.split(/\s+/)[0] ?? "FAMILY";
  return first.toUpperCase();
}

function bandLabel(name: string): string {
  const upper = name.toUpperCase();
  if (upper.includes("DIATONIC") || upper.includes("MAJOR")) {
    return "MAJOR";
  }
  if (upper.includes("MODAL")) {
    return "MODES";
  }
  if (upper.includes("SECONDARY") || upper.includes("DOMINANT")) {
    return "DOMINANT";
  }
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
  const compact = value.replace(/\s+/g, "").toUpperCase();
  return compact.length > 6 ? compact.slice(0, 6) : compact;
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
    const raw = sessionStorage.getItem(STORAGE_KEY);
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
    return parsed;
  } catch {
    return null;
  }
}

function saveGraph(graph: LoopGraph): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(graph));
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

function playChordPreview(chord: ChordEntry): void {
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
  master.connect(context.destination);
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(0.18, now + 0.03);
  master.gain.exponentialRampToValueAtTime(0.001, now + 1.1);

  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const voiceGain = context.createGain();
    oscillator.type = index === 0 ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.detune.setValueAtTime((index - 1) * 4, now);
    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(0.28 / Math.max(1, frequencies.length), now + 0.02 + index * 0.01);
    voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95 + index * 0.02);
    oscillator.connect(voiceGain);
    voiceGain.connect(master);
    oscillator.start(now + index * 0.01);
    oscillator.stop(now + 1.15 + index * 0.02);
  });
}

const savedGraph = null;
const startingGraph = createInitialGraph(initialChordName(CATALOG));
const initialSelectedNode =
  startingGraph.nodes[startingGraph.selectedNodeId] ??
  startingGraph.nodes[startingGraph.headId];
const initialSelection = initialSelectedNode
  ? findChordInCatalog(CATALOG, initialSelectedNode.chordName)
  : null;

const store = createStore<AppState>(() => ({
  catalog: CATALOG,
  selectedFamilyIndex: initialSelection?.familyIndex ?? 0,
  selectedChordIndex: initialSelection?.chordIndex ?? 0,
  chordFanVisible: false,
  graph: startingGraph,
  status: "Initial state ready",
}));

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
    addX: centerX + centerRadius + minAxis * 0.11 * scale,
    addY: centerY - minAxis * 0.085 * scale,
    removeX: centerX + centerRadius + minAxis * 0.074 * scale,
    removeY: centerY - minAxis * 0.024 * scale,
    actionRadius: minAxis * 0.024 * scale,
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
      this.currentLayout.actionRadius * 0.78 * dpr,
    );

    gl.uniform1f(this.uniforms.removeDisabled, this.removeDisabled);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

function overlay(rootEl: HTMLElement, state: AppState, layout: StageLayout, geometry: SceneGeometry): void {
  const selectedChord = getSelectedChord(state);
  const family = getSelectedChordFamily(state);
  const selectedNode = state.graph.nodes[state.graph.selectedNodeId];
  const nodeCount = graphSequence(state.graph).length;

  const overlayContent = buildOverlayContent(state, layout, geometry);

  const status = escapeHtml(state.status);
  rootEl.innerHTML = `
    <div class="stage-shell">
      <canvas class="webgl-stage" aria-label="Sonic Saucepan canvas stage"></canvas>
      <div class="corner-controls" role="toolbar" aria-label="Loop controls">
        <button class="corner-btn" data-action="settings" aria-label="Settings" title="Settings">⚙</button>
        <button class="corner-btn" data-action="saved-loops" aria-label="Saved loops" title="Saved loops">⟳</button>
        <button class="corner-btn perform ${performPlaying ? "playing" : "paused"}" data-action="perform" aria-label="Perform" title="Perform">
          ${performPlaying ? "❚❚" : "▶"}
        </button>
      </div>
      <div class="hud">
        <div class="hud-title">Sonic Saucepan</div>
        <div class="hud-copy">Tap a ring to change the family or chord. Tap <span>+</span> to add the selected chord and <span>×</span> to remove the selected node.</div>
        <div class="hud-meta">${escapeHtml(`${nodeCount} nodes · ${family.chords.length} chords`)}</div>
      </div>
      <div class="overlay" aria-hidden="true">
        ${overlayContent}
      </div>
      <div class="status">${status}</div>
    </div>
  `;
}

function buildOverlayContent(state: AppState, layout: StageLayout, geometry: SceneGeometry): string {
  const selectedChord = getSelectedChord(state);
  const family = getSelectedChordFamily(state);
  const selectedNode = state.graph.nodes[state.graph.selectedNodeId];

  const chordLabels = state.chordFanVisible
    ? geometry.chordSegments
      .map((seg, index) => {
        const point = segmentMidpoint(layout, seg);
        const chord = family.chords[index];
        const label = chordLabel(chord?.numeral ?? chord?.full_name ?? "I");
        return `<span class="label chord" style="left:${point.x}px;top:${point.y}px">${escapeHtml(label)}</span>`;
      })
      .join("")
    : "";

  const familyLabels = geometry.familySegments
    .map((seg, index) => {
      const point = segmentMidpoint(layout, seg);
      const familyIndex = geometry.familyIndices[index] ?? 0;
      const label = shorthand(state.catalog.families[familyIndex]?.name ?? "Family");
      return `<span class="label family" style="left:${point.x}px;top:${point.y}px">${escapeHtml(label)}</span>`;
    })
    .join("");

  return `
    <div class="circuit circuit-left"></div>
    <div class="circuit circuit-right"></div>
    <span class="label center" style="left:${layout.centerX}px;top:${layout.centerY}px">${escapeHtml(chordLabel(selectedNode?.chordName ?? selectedChord.full_name))}</span>
    <span class="label major" style="left:${layout.centerX}px;top:${layout.centerY - layout.centerRadius + 24}px">${escapeHtml(bandLabel(family.name))}</span>
    ${chordLabels}
    ${familyLabels}
    ${NODE_MANIPULATION_ENABLED ? `<span class="label action plus" style="left:${layout.addX}px;top:${layout.addY}px">+</span>` : ""}
    ${NODE_MANIPULATION_ENABLED ? `<span class="label action remove" style="left:${layout.removeX}px;top:${layout.removeY}px">×</span>` : ""}
  `;
}

type GraphNodeView = {
  nodeId: number;
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
  lastX: number;
  lastY: number;
};

let sceneZoom = 1;
let scenePan = { x: 0, y: 0 };
let performPlaying = false;
let performTimerId: number | null = null;
let performCursorNodeId: number | null = null;
const nodeOffsets: Record<number, { x: number; y: number }> = {};

const PERFORM_STEP_MS = 760;

function stopPerformLoop(): void {
  if (performTimerId !== null) {
    window.clearInterval(performTimerId);
    performTimerId = null;
  }
  performPlaying = false;
}

function syncSelectionToNode(nodeId: number, status: string): void {
  const state = store.getState();
  const node = state.graph.nodes[nodeId];
  if (!node) {
    return;
  }

  const match = findChordInCatalog(state.catalog, node.chordName);
  const updatedGraph = {
    ...state.graph,
    selectedNodeId: nodeId,
  };

  if (match) {
    const chord = state.catalog.families[match.familyIndex]?.chords[match.chordIndex];
    if (chord) {
      playChordPreview(chord);
    }
  }

  saveGraph(updatedGraph);
  store.setState({
    ...state,
    graph: updatedGraph,
    selectedFamilyIndex: match?.familyIndex ?? state.selectedFamilyIndex,
    selectedChordIndex: match?.chordIndex ?? state.selectedChordIndex,
    chordFanVisible: true,
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
  syncSelectionToNode(performCursorNodeId, `Performing ${chordName}`);
}

function startPerformLoop(): void {
  stopPerformLoop();
  performPlaying = true;
  performCursorNodeId = null;
  performStep();
  performTimerId = window.setInterval(() => {
    performStep();
  }, PERFORM_STEP_MS);
}

function buildGraphNodeViews(state: AppState, layout: StageLayout): GraphNodeView[] {
  const sequence = graphSequence(state.graph);
  const orbitRadius = layout.chordOuter + Math.min(layout.width, layout.height) * 0.18 * sceneZoom;
  const orbitStart = (-24 * Math.PI) / 180;
  const selectedId = state.graph.selectedNodeId;
  const selectedNode = sequence.find((node) => node.id === selectedId);
  const others = sequence.filter((node) => node.id !== selectedId);
  const views: GraphNodeView[] = [];

  if (selectedNode) {
    views.push({
      nodeId: selectedNode.id,
      x: layout.centerX,
      y: layout.centerY,
      radius: layout.chordOuter,
      isSelected: true,
      chordName: selectedNode.chordName,
    });
  }

  others.forEach((node, index) => {
    const angle = orbitStart + (Math.PI * 2 * index) / Math.max(1, others.length);
    const base = describeArcSegment(layout.centerX, layout.centerY, orbitRadius, angle);
    const offset = nodeOffsets[node.id] ?? { x: 0, y: 0 };
    views.push({
      nodeId: node.id,
      x: base.x + offset.x,
      y: base.y + offset.y,
      radius: 18,
      isSelected: false,
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
    }
  }
}

function buildHitZones(layout: StageLayout, geometry: SceneGeometry, state: AppState): HitZone[] {
  const zones: HitZone[] = [];

  geometry.chordSegments.forEach((seg, index) => {
    zones.push({
      kind: "chord",
      index,
      cx: layout.centerX,
      cy: layout.centerY,
      segment: seg,
    });
  });

  geometry.familySegments.forEach((seg, index) => {
    const familyIndex = geometry.familyIndices[index] ?? 0;
    zones.push({
      kind: "family",
      index: familyIndex,
      cx: layout.centerX,
      cy: layout.centerY,
      segment: seg,
    });
  });

  if (NODE_MANIPULATION_ENABLED) {
    zones.push({
      kind: "add",
      cx: layout.addX,
      cy: layout.addY,
      radius: layout.actionRadius,
    });

    zones.push({
      kind: "remove",
      cx: layout.removeX,
      cy: layout.removeY,
      radius: layout.actionRadius * 0.78,
    });

    zones.push({
      kind: "center",
      cx: layout.centerX,
      cy: layout.centerY,
      radius: layout.centerRadius,
    });

    const nodeViews = buildGraphNodeViews(state, layout);
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
  }

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
    ctx.arc(layout.centerX, layout.centerY, seg.outer, seg.start, seg.end);
    ctx.arc(layout.centerX, layout.centerY, seg.inner, seg.end, seg.start, true);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

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
  ctx.arc(layout.centerX, layout.centerY, layout.centerRadius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(6, 14, 31, 0.96)";
  ctx.fill();
  ctx.strokeStyle = "rgba(104, 169, 255, 0.9)";
  ctx.lineWidth = 3;
  ctx.stroke();

  if (NODE_MANIPULATION_ENABLED) {
    ctx.beginPath();
    ctx.arc(layout.addX, layout.addY, layout.actionRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8, 15, 34, 0.94)";
    ctx.fill();
    ctx.strokeStyle = "rgba(126, 216, 255, 0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(layout.removeX, layout.removeY, layout.actionRadius * 0.78, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8, 15, 34, 0.94)";
    ctx.fill();
    ctx.strokeStyle = "rgba(154, 172, 214, 0.86)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const sequence = graphSequence(state.graph);
    const nodeViews = buildGraphNodeViews(state, layout);

    sequence.forEach((node) => {
    const from = findGraphNodeViewById(nodeViews, node.id);
    const to = findGraphNodeViewById(nodeViews, node.nextId);
    if (!from || !to) {
      return;
    }

    const isReturnToHead = node.nextId === state.graph.headId;
    if (!from.isSelected && !isReturnToHead) {
      return;
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) {
      const loopRadius = 12;
      const loopCenterX = from.x + 10;
      const loopCenterY = from.y - 10;
      const loopStart = Math.PI * 0.15;
      const loopEnd = Math.PI * 1.7;
      ctx.beginPath();
      ctx.arc(loopCenterX, loopCenterY, loopRadius, loopStart, loopEnd);
      ctx.strokeStyle = "rgba(122, 204, 255, 0.86)";
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
      ctx.fillStyle = "rgba(160, 223, 255, 0.96)";
      ctx.fill();
      return;
    }

    const ux = dx / len;
    const uy = dy / len;
    const startX = from.x + ux * (from.radius - 8);
    const startY = from.y + uy * (from.radius - 8);
    const endX = to.x - ux * (to.radius - 6);
    const endY = to.y - uy * (to.radius - 6);

    if (isReturnToHead && !from.isSelected) {
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
      ctx.strokeStyle = "rgba(255, 210, 126, 0.96)";
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
      ctx.fillStyle = "rgba(255, 209, 130, 0.98)";
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = isReturnToHead ? "rgba(255, 210, 126, 0.96)" : "rgba(122, 204, 255, 0.88)";
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
    ctx.fillStyle = isReturnToHead ? "rgba(255, 209, 130, 0.98)" : "rgba(160, 223, 255, 0.96)";
    ctx.fill();
    });

    nodeViews.forEach((view) => {
    if (view.isSelected) {
      return;
    }

    const isHead = view.nodeId === state.graph.headId;

    ctx.beginPath();
    ctx.arc(view.x, view.y, view.radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8, 16, 36, 0.92)";
    ctx.fill();
    ctx.strokeStyle = isHead ? "rgba(255, 210, 130, 0.9)" : "rgba(106, 165, 255, 0.78)";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.fillStyle = "rgba(149, 198, 255, 0.95)";
    ctx.font = "600 11px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(view.chordName.slice(0, 7), view.x, view.y + 1);
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
  const chord = getSelectedChord(state);
  const graph = addAfterSelected(state.graph, chord.full_name);
  trimNodeOffsets(graph);
  saveGraph(graph);
  store.setState({
    graph,
    status: `Inserted state/node ${chord.full_name}`,
  });
}

function removeNode(): void {
  const state = store.getState();
  if (state.graph.selectedNodeId === state.graph.headId) {
    store.setState({
      status: "Initial node cannot be removed",
    });
    return;
  }
  const label = state.graph.nodes[state.graph.selectedNodeId]?.chordName ?? "node";
  const graph = removeSelected(state.graph);
  trimNodeOffsets(graph);
  saveGraph(graph);
  store.setState({
    graph,
    status: `Removed state/node ${label}`,
  });
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
}

function redrawCanvasOnly(canvas: HTMLCanvasElement, clampViewport = true): void {
  const state = store.getState();
  const rect = canvas.getBoundingClientRect();
  const layout = buildLayout(rect.width, rect.height);
  if (clampViewport) {
    constrainGraphViewport(state, layout);
  }
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
    store.setState({
      ...state,
      status: "Settings panel placeholder: coming next",
    });
  });

  savedLoopsBtn?.addEventListener("click", () => {
    const state = store.getState();
    store.setState({
      ...state,
      status: "Saved loops panel placeholder: coming next",
    });
  });

  if (!performBtn) {
    return;
  }

  if (!NODE_MANIPULATION_ENABLED) {
    performBtn.disabled = true;
    performBtn.title = "Perform disabled in single-state mode";
    return;
  }

  let longPressTimer: number | null = null;
  let longPressFired = false;

  performBtn.addEventListener("pointerdown", () => {
    longPressFired = false;
    longPressTimer = window.setTimeout(() => {
      longPressFired = true;
      const state = store.getState();
      store.setState({
        ...state,
        status: "Perform options placeholder: hold actions coming next",
      });
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

    startPerformLoop();
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
    const newZoom = clamp(sceneZoom + zoomDirection, 0.68, 1.85);
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
    redrawCanvasOnly(canvas, false);
  }, { passive: false });

  canvas.addEventListener("pointerdown", (event) => {
    const point = pointerToCanvas(canvas, event);
    const hit = hitTest(hitZones, point);
    const draggingGraphNode = NODE_MANIPULATION_ENABLED && hit?.kind === "graph-node";
    const panGesture = !hit;

    pressContext = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      gestureHandled: false,
      longPressTimer: null,
      mode: draggingGraphNode ? "drag-node" : panGesture ? "pan" : "tap",
      targetNodeId: draggingGraphNode ? hit.nodeId : null,
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

    if (NODE_MANIPULATION_ENABLED && pressContext.mode === "drag-node" && pressContext.targetNodeId !== null) {
      const nodeId = pressContext.targetNodeId;
      const nodeOffset = nodeOffsets[nodeId] ?? { x: 0, y: 0 };
      const deltaX = event.clientX - pressContext.lastX;
      const deltaY = event.clientY - pressContext.lastY;
      nodeOffsets[nodeId] = {
        x: nodeOffset.x + deltaX,
        y: nodeOffset.y + deltaY,
      };
      pressContext.lastX = event.clientX;
      pressContext.lastY = event.clientY;
      redrawCanvasOnly(canvas, false);
    } else if (pressContext.mode === "pan") {
      const deltaX = event.clientX - pressContext.lastX;
      const deltaY = event.clientY - pressContext.lastY;
      scenePan.x += deltaX;
      scenePan.y += deltaY;
      pressContext.lastX = event.clientX;
      pressContext.lastY = event.clientY;
      redrawCanvasOnly(canvas, false);
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    if (!pressContext || pressContext.pointerId !== event.pointerId) {
      return;
    }

    const point = pointerToCanvas(canvas, event);
    if (NODE_MANIPULATION_ENABLED && pressContext.mode === "drag-node") {
      const draggedNodeId = pressContext.targetNodeId;
      if (draggedNodeId !== null && !pressContext.moved) {
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
        }
      }
    } else if (!pressContext.moved) {
      const hit = hitTest(hitZones, point);
      if (hit?.kind === "family") {
        selectFamily(hit.index);
      } else if (hit?.kind === "chord") {
        selectChord(hit.index);
      } else if (NODE_MANIPULATION_ENABLED && hit?.kind === "add") {
        addNode();
      } else if (NODE_MANIPULATION_ENABLED && hit?.kind === "remove") {
        removeNode();
      } else if (NODE_MANIPULATION_ENABLED && hit?.kind === "center") {
        cycleSelectedNode();
      } else if (NODE_MANIPULATION_ENABLED && hit?.kind === "graph-node") {
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
        }
      }
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
  bindCanvasInteractions(canvas);

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

  if (resizeObserver) {
    resizeObserver.disconnect();
  }

  resizeObserver = new ResizeObserver(() => {
    render();
  });

  resizeObserver.observe(shell);
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
render();

if (!FORCE_CANVAS_RENDERER) {
  rafId = window.requestAnimationFrame(animate);
}

window.addEventListener("beforeunload", () => {
  stopPerformLoop();
  if (rafId) {
    window.cancelAnimationFrame(rafId);
  }
  resizeObserver?.disconnect();
});
