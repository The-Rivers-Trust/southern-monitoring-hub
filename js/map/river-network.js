// =====================================================================
// RIVER NETWORK
// The Open River Network reference layer, plus the "River flow
// direction" overlay - copied from the AQuA and NRS dashboards (keep the
// copies in step). Both start off and are linked: switching flow on
// switches the network on, switching the network off switches flow off.
// The map's Layers panel switches them (js/map/layers-panel.js).
//
// Flow direction is an animated overlay of light trails moving along
// each river segment from its first digitised vertex to its last (the
// network is digitised in flow direction). A normal renderer can't
// animate, so it's a custom WebGL layer view (adapted from Esri's
// "Animated lines with WebGL" sample). It only ever holds the segments
// in the current view, re-queried whenever the map stops moving, capped
// at MAX_SEGMENTS.
// =====================================================================

import { RIVER_NETWORK } from "../config.js";

const FLOW_EXTRA_WIDTH = 3; // trail is a bit wider than the river line
const FLOW_COLOR = [255, 255, 255, 255];
const TRAIL_SPEED = 120; // map units (metres) per second
const TRAIL_LENGTH = 250;
const TRAIL_CYCLE = 900;
const MAX_SEGMENTS = 8000;

// Adds both layers at `index` in the map's layers (network, then flow
// above it). Resolves to { network, flow }; flow is null if the WebGL
// overlay couldn't be created.
export async function addRiverNetwork(mapEl, index) {
  const [FeatureLayer, GraphicsLayer, BaseLayerViewGL2D, reactiveUtils] = await $arcgis.import([
    "@arcgis/core/layers/FeatureLayer.js",
    "@arcgis/core/layers/GraphicsLayer.js",
    "@arcgis/core/views/2d/layers/BaseLayerViewGL2D.js",
    "@arcgis/core/core/reactiveUtils.js",
  ]);

  const network = new FeatureLayer({
    url: RIVER_NETWORK.url,
    title: RIVER_NETWORK.title,
    outFields: ["Strahler"],
    visible: false,
    popupEnabled: false,
    minScale: RIVER_NETWORK.minScale,
    renderer: {
      type: "simple",
      symbol: { type: "simple-line", color: RIVER_NETWORK.color, cap: "round", join: "round" },
      visualVariables: [{ type: "size", field: "Strahler", stops: RIVER_NETWORK.widthByStrahler }],
    },
    // A soft shadow lifts the lines off either basemap.
    effect: "drop-shadow(0px, 0px, 3px, #000000)",
  });
  mapEl.map.add(network, index);

  // The flow overlay is added separately and guarded, so if WebGL or the
  // layer view fails for any reason the rest of the map is unaffected.
  let flow;
  try {
    const FlowLayerView = createFlowLayerView(BaseLayerViewGL2D, reactiveUtils);
    const FlowLayer = GraphicsLayer.createSubclass({
      createLayerView(view) {
        if (view.type === "2d") return new FlowLayerView({ view, layer: this });
        return null;
      },
    });
    flow = new FlowLayer({
      title: RIVER_NETWORK.flowTitle,
      visible: false,
      minScale: RIVER_NETWORK.flowMinScale,
    });
    mapEl.map.add(flow, index + 1);
  } catch (error) {
    console.warn("Southern Monitoring Hub: river flow direction unavailable:", error);
    return { network, flow: null };
  }

  // Link the two toggles.
  reactiveUtils.watch(() => flow.visible, (visible) => {
    if (visible && !network.visible) network.visible = true;
    refresh();
  });
  reactiveUtils.watch(() => network.visible, (visible) => {
    if (!visible && flow.visible) flow.visible = false;
  });

  // Re-query the segments in view whenever the map settles.
  let requestToken = 0;
  const view = mapEl.view;
  reactiveUtils.when(() => view.stationary, refresh);
  // The network's tiles arrive a moment after the map settles - re-read
  // the segments once they have.
  view.whenLayerView(network).then((networkView) => {
    reactiveUtils.watch(() => networkView.updating, (updating) => {
      if (!updating && flow.visible) refresh();
    });
  });

  return { network, flow };

  // The segments in view, taken from the network layer's own already
  // loaded tiles (milliseconds) rather than asked of the service again
  // (a second or more every time the map moved). Falls back to the
  // service if the layer view can't be read.
  async function segmentsInView() {
    try {
      const networkView = await view.whenLayerView(network);
      await reactiveUtils.whenOnce(() => !networkView.updating);
      const result = await networkView.queryFeatures({
        geometry: view.extent,
        returnGeometry: true,
        outFields: ["OBJECTID", "Strahler"],
      });
      return result.features.slice(0, MAX_SEGMENTS);
    } catch (error) {
      return null;
    }
  }

  async function segmentsFromService(token) {
    const features = [];
    for (let start = 0; features.length < MAX_SEGMENTS; ) {
      const result = await network.queryFeatures({
        geometry: view.extent,
        spatialRelationship: "intersects",
        outSpatialReference: view.spatialReference,
        returnGeometry: true,
        outFields: ["OBJECTID", "Strahler"],
        num: 2000,
        start,
      });
      if (token !== requestToken) return null; // superseded by a newer refresh
      features.push(...result.features);
      if (!result.exceededTransferLimit) break;
      start += result.features.length;
    }
    return features.slice(0, MAX_SEGMENTS);
  }

  async function refresh() {
    const token = ++requestToken;
    const active = flow.visible && view.scale <= RIVER_NETWORK.flowMinScale;
    if (!active) {
      if (flow.graphics.length) flow.graphics.removeAll();
      return;
    }
    const features = (await segmentsInView()) ?? (await segmentsFromService(token));
    if (token !== requestToken || !features) return; // superseded by a newer refresh
    flow.graphics.removeAll();
    flow.graphics.addMany(features.map((f) => ({
      attributes: { color: FLOW_COLOR, halfWidth: flowHalfWidth(f.attributes.Strahler) },
      geometry: { type: "polyline", paths: f.geometry.paths, spatialReference: f.geometry.spatialReference },
    })));
  }
}

// Half the trail width for a Strahler order: the network's own line
// width (interpolated over widthByStrahler) plus FLOW_EXTRA_WIDTH.
function flowHalfWidth(strahler) {
  const stops = RIVER_NETWORK.widthByStrahler;
  let width = stops[0].size;
  if (typeof strahler === "number") {
    if (strahler >= stops[stops.length - 1].value) width = stops[stops.length - 1].size;
    else if (strahler > stops[0].value) {
      for (let i = 0; i < stops.length - 1; i++) {
        if (strahler >= stops[i].value && strahler <= stops[i + 1].value) {
          const t = (strahler - stops[i].value) / (stops[i + 1].value - stops[i].value);
          width = stops[i].size + t * (stops[i + 1].size - stops[i].size);
          break;
        }
      }
    }
  }
  return (width + FLOW_EXTRA_WIDTH) / 2;
}

// ---------------------------------------------------------------------
// WebGL layer view
// ---------------------------------------------------------------------

// Minimal stand-ins for the gl-matrix functions the sample uses, inlined
// so nothing extra loads from a CDN. Column-major, gl-matrix arg order.
const mat3 = {
  create: () => new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  identity(out) { out.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); return out; },
  translate(out, a, v) {
    const [a00, a01, a02, a10, a11, a12, a20, a21, a22] = a;
    const [x, y] = v;
    out.set([a00, a01, a02, a10, a11, a12, x * a00 + y * a10 + a20, x * a01 + y * a11 + a21, x * a02 + y * a12 + a22]);
    return out;
  },
  rotate(out, a, rad) {
    const [a00, a01, a02, a10, a11, a12, a20, a21, a22] = a;
    const s = Math.sin(rad);
    const c = Math.cos(rad);
    out.set([c * a00 + s * a10, c * a01 + s * a11, c * a02 + s * a12, c * a10 - s * a00, c * a11 - s * a01, c * a12 - s * a02, a20, a21, a22]);
    return out;
  },
  scale(out, a, v) {
    const [x, y] = v;
    out.set([x * a[0], x * a[1], x * a[2], y * a[3], y * a[4], y * a[5], a[6], a[7], a[8]]);
    return out;
  },
};

// Each line becomes a triangle strip: two vertices per point, pushed out
// either side by halfWidth, carrying the distance along the line (for
// the moving trail) and which side they're on (for the soft edge).
function extrudeLines(graphics, center) {
  let vtxCount = 0;
  let idxCount = 0;
  for (const g of graphics) {
    for (const path of g.geometry.paths) {
      vtxCount += path.length * 2;
      idxCount += (path.length - 1) * 6;
    }
  }
  const vertexData = new ArrayBuffer(7 * vtxCount * 4);
  const floats = new Float32Array(vertexData);
  const bytes = new Uint8Array(vertexData);
  const indexData = new Uint32Array(idxCount);
  let v = 0;
  let k = 0;

  const emitPair = (point, offset, distance, color) => {
    for (const side of [1, -1]) {
      const base = v * 7;
      floats[base] = point[0] - center[0];
      floats[base + 1] = point[1] - center[1];
      floats[base + 2] = side * offset[0];
      floats[base + 3] = side * offset[1];
      floats[base + 4] = distance;
      floats[base + 5] = side;
      bytes.set(color, 4 * (base + 6));
      v++;
    }
  };
  const emitQuad = () => {
    indexData.set([v - 4, v - 3, v - 2, v - 3, v - 1, v - 2], k);
    k += 6;
  };

  for (const g of graphics) {
    const { color, halfWidth } = g.attributes;
    for (const path of g.geometry.paths) {
      let current = null;
      let normal = null;
      let distance = 0;
      for (let j = 0; j < path.length; j++) {
        const point = path[j];
        if (current) {
          const dx = point[0] - current[0];
          const dy = point[1] - current[1];
          const len = Math.hypot(dx, dy) || 1;
          const next = [-dy / len, dx / len];
          let offset = next;
          if (normal) {
            // Mitre between the two segment normals.
            offset = [normal[0] + next[0], normal[1] + next[1]];
            const ol = Math.hypot(offset[0], offset[1]) || 1;
            offset = [offset[0] / ol, offset[1] / ol];
            const d = normal[0] * offset[0] + normal[1] * offset[1] || 1;
            offset = [offset[0] / d, offset[1] / d];
          }
          emitPair(current, [offset[0] * halfWidth, offset[1] * halfWidth], distance, color);
          if (j >= 2) emitQuad();
          normal = next;
          distance += len;
        }
        current = point;
      }
      if (normal) {
        emitPair(current, [normal[0] * halfWidth, normal[1] * halfWidth], distance, color);
        emitQuad();
      }
    }
  }
  return { vertexData, indexData: indexData.subarray(0, k) };
}

function createFlowLayerView(BaseLayerViewGL2D, reactiveUtils) {
  return BaseLayerViewGL2D.createSubclass({
    aPosition: 0,
    aOffset: 1,
    aDistance: 2,
    aSide: 3,
    aColor: 4,

    constructor() {
      this.transform = mat3.create();
      this.extrude = mat3.create();
      this.translationToCenter = new Float32Array(2);
      this.screenTranslation = new Float32Array(2);
      this.display = new Float32Array([NaN, 0, 0, 0, NaN, 0, -1, 1, 1]);
      this.screenScaling = new Float32Array([NaN, NaN, 1]);
      this.needsUpdate = false;
    },

    attach() {
      const gl = this.context;
      this.watcher = reactiveUtils.on(() => this.layer.graphics, "change", () => {
        this.needsUpdate = true;
        this.requestRender();
      });

      const vertexSource = `
        precision highp float;
        uniform mat3 u_transform;
        uniform mat3 u_extrude;
        uniform mat3 u_display;
        attribute vec2 a_position;
        attribute vec2 a_offset;
        attribute float a_distance;
        attribute float a_side;
        attribute vec4 a_color;
        varying float v_distance;
        varying float v_side;
        varying vec4 v_color;
        void main(void) {
          gl_Position.xy = (u_display * (u_transform * vec3(a_position, 1.0) + u_extrude * vec3(a_offset, 0.0))).xy;
          gl_Position.zw = vec2(0.0, 1.0);
          v_distance = a_distance;
          v_side = a_side;
          v_color = a_color;
        }`;
      const fragmentSource = `
        precision highp float;
        uniform float u_current_time;
        varying float v_distance;
        varying float v_side;
        varying vec4 v_color;
        const float TRAIL_SPEED = ${TRAIL_SPEED.toFixed(1)};
        const float TRAIL_LENGTH = ${TRAIL_LENGTH.toFixed(1)};
        const float TRAIL_CYCLE = ${TRAIL_CYCLE.toFixed(1)};
        void main(void) {
          float d = mod(v_distance - u_current_time * TRAIL_SPEED, TRAIL_CYCLE);
          float a1 = d < TRAIL_LENGTH ? mix(0.0, 1.0, d / TRAIL_LENGTH) : 0.0;
          float a2 = exp(-abs(v_side) * 3.0);
          gl_FragColor = v_color * (a1 * a2);
        }`;

      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        return shader;
      };
      const vs = compile(gl.VERTEX_SHADER, vertexSource);
      const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
      this.program = gl.createProgram();
      gl.attachShader(this.program, vs);
      gl.attachShader(this.program, fs);
      gl.bindAttribLocation(this.program, this.aPosition, "a_position");
      gl.bindAttribLocation(this.program, this.aOffset, "a_offset");
      gl.bindAttribLocation(this.program, this.aDistance, "a_distance");
      gl.bindAttribLocation(this.program, this.aSide, "a_side");
      gl.bindAttribLocation(this.program, this.aColor, "a_color");
      gl.linkProgram(this.program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);

      this.uTransform = gl.getUniformLocation(this.program, "u_transform");
      this.uExtrude = gl.getUniformLocation(this.program, "u_extrude");
      this.uDisplay = gl.getUniformLocation(this.program, "u_display");
      this.uCurrentTime = gl.getUniformLocation(this.program, "u_current_time");

      this.vertexBuffer = gl.createBuffer();
      this.indexBuffer = gl.createBuffer();
      this.indexBufferSize = 0;

      // The 5.x map view always runs WebGL2: native VAOs and 32-bit
      // indices (so a busy view can't overflow 16-bit index buffers).
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      for (const a of [this.aPosition, this.aOffset, this.aDistance, this.aSide, this.aColor]) gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 28, 0);
      gl.vertexAttribPointer(this.aOffset, 2, gl.FLOAT, false, 28, 8);
      gl.vertexAttribPointer(this.aDistance, 1, gl.FLOAT, false, 28, 16);
      gl.vertexAttribPointer(this.aSide, 1, gl.FLOAT, false, 28, 20);
      gl.vertexAttribPointer(this.aColor, 4, gl.UNSIGNED_BYTE, true, 28, 24);
      gl.bindVertexArray(null);

      this.centerAtLastUpdate = new Float32Array([this.view.state.center[0], this.view.state.center[1]]);
    },

    detach() {
      this.watcher.remove();
      const gl = this.context;
      gl.deleteBuffer(this.vertexBuffer);
      gl.deleteBuffer(this.indexBuffer);
      gl.deleteVertexArray(this.vao);
      gl.deleteProgram(this.program);
    },

    render(renderParameters) {
      const gl = renderParameters.context;
      const state = renderParameters.state;
      this.updatePositions(renderParameters);
      if (this.indexBufferSize === 0) return;

      mat3.identity(this.transform);
      this.screenTranslation[0] = (state.pixelRatio * state.size[0]) / 2;
      this.screenTranslation[1] = (state.pixelRatio * state.size[1]) / 2;
      mat3.translate(this.transform, this.transform, this.screenTranslation);
      mat3.rotate(this.transform, this.transform, (Math.PI * state.rotation) / 180);
      this.screenScaling[0] = state.pixelRatio / state.resolution;
      this.screenScaling[1] = -state.pixelRatio / state.resolution;
      mat3.scale(this.transform, this.transform, this.screenScaling);
      mat3.translate(this.transform, this.transform, this.translationToCenter);

      mat3.identity(this.extrude);
      mat3.rotate(this.extrude, this.extrude, (Math.PI * state.rotation) / 180);
      mat3.scale(this.extrude, this.extrude, [1, -1, 1]);

      this.display[0] = 2 / (state.pixelRatio * state.size[0]);
      this.display[4] = -2 / (state.pixelRatio * state.size[1]);

      gl.useProgram(this.program);
      gl.uniformMatrix3fv(this.uTransform, false, this.transform);
      gl.uniformMatrix3fv(this.uExtrude, false, this.extrude);
      gl.uniformMatrix3fv(this.uDisplay, false, this.display);
      gl.uniform1f(this.uCurrentTime, performance.now() / 1000.0);
      gl.bindVertexArray(this.vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawElements(gl.TRIANGLES, this.indexBufferSize, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);

      // Keep animating.
      this.requestRender();
    },

    // While the map moves, just shift the existing buffers; rebuild them
    // around the new centre once it stops (or the graphics change).
    updatePositions(renderParameters) {
      const { stationary, state, context: gl } = renderParameters;
      if (!stationary) {
        this.translationToCenter[0] = this.centerAtLastUpdate[0] - state.center[0];
        this.translationToCenter[1] = this.centerAtLastUpdate[1] - state.center[1];
        this.requestRender();
        return;
      }
      if (!this.needsUpdate && this.translationToCenter[0] === 0 && this.translationToCenter[1] === 0) return;

      this.centerAtLastUpdate.set(state.center);
      this.translationToCenter[0] = 0;
      this.translationToCenter[1] = 0;
      this.needsUpdate = false;

      const { vertexData, indexData } = extrudeLines(this.layer.graphics.items, this.centerAtLastUpdate);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);
      this.indexBufferSize = indexData.length;
    },
  });
}
