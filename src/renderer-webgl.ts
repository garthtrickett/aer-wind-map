import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import type { WindField } from "./wind.ts";
import { waveColor, type ForecastField } from "./wave.ts";
import { windColor } from "./renderer-canvas.ts";

type View = Readonly<{ center: Readonly<{ lat: number; lng: number }>; zoom: number }>;
type Surface = Readonly<{ gl: WebGL2RenderingContext; program: WebGLProgram; texture: WebGLTexture; vao: WebGLVertexArrayObject }>;
type Renderer = Readonly<{ setField: (field: ForecastField | null) => void; redraw: () => void }>;
type ParticleRenderer = Readonly<{ setField: (field: WindField | null) => void; redraw: () => void }>;

const worldCenter = (center: View["center"]): Readonly<{ x: number; y: number }> => {
  const latitude = Math.max(-85.05112878, Math.min(center.lat, 85.05112878));
  const sine = Math.sin(latitude * Math.PI / 180);
  return { x: (center.lng + 180) / 360, y: .5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI) };
};

const common = `
  uniform sampler2D u_wind;
  uniform vec2 u_grid;
  uniform float u_firstLongitude;
  uniform float u_firstLatitude;
  uniform float u_increment;
  uniform vec2 u_center;
  uniform float u_worldPixels;
  uniform vec2 u_viewport;

  vec2 windAt(vec2 screen) {
    vec2 world = u_center + (screen - u_viewport * .5) / u_worldPixels;
    float latitude = degrees(atan(sinh(3.141592653589793 * (1.0 - 2.0 * world.y))));
    float longitude = world.x * 360.0 - 180.0;
    float x = mod((longitude - u_firstLongitude) / u_increment, u_grid.x);
    float y = clamp((u_firstLatitude - latitude) / u_increment, 0.0, u_grid.y - 1.0);
    int x0 = int(floor(x));
    int x1 = (x0 + 1) % int(u_grid.x);
    int y0 = int(floor(y));
    int y1 = min(y0 + 1, int(u_grid.y) - 1);
    vec2 top = mix(texelFetch(u_wind, ivec2(x0, y0), 0).rg, texelFetch(u_wind, ivec2(x1, y0), 0).rg, fract(x));
    vec2 bottom = mix(texelFetch(u_wind, ivec2(x0, y1), 0).rg, texelFetch(u_wind, ivec2(x1, y1), 0).rg, fract(x));
    return mix(top, bottom, fract(y));
  }
`;

const colorVertex = `#version 300 es
  void main() {
    vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const colorFragment = `#version 300 es
  precision highp float;
  precision highp sampler2D;
  uniform vec2 u_resolution;
  uniform sampler2D u_colors;
  uniform vec2 u_center;
  uniform float u_worldPixels;
  uniform vec2 u_viewport;
  uniform vec2 u_grid;
  uniform float u_firstLongitude;
  uniform float u_firstLatitude;
  uniform float u_increment;
  out vec4 outColor;
  void main() {
    vec2 screen = vec2(gl_FragCoord.x / u_resolution.x, 1.0 - gl_FragCoord.y / u_resolution.y) * u_viewport;
    vec2 world = u_center + (screen - u_viewport * .5) / u_worldPixels;
    float latitude = degrees(atan(sinh(3.141592653589793 * (1.0 - 2.0 * world.y))));
    float longitude = world.x * 360.0 - 180.0;
    float x = mod((longitude - u_firstLongitude) / u_increment, u_grid.x);
    float y = clamp((u_firstLatitude - latitude) / u_increment, 0.0, u_grid.y - 1.0);
    outColor = texture(u_colors, vec2((x + .5) / u_grid.x, (y + .5) / u_grid.y));
  }
`;

const particleVertex = `#version 300 es
  precision highp float;
  precision highp sampler2D;
  layout(location = 0) in vec3 seed;
  uniform float u_time;
  uniform float u_pixelRatio;
  out vec2 direction;
  out float opacity;
  ${common}
  void main() {
    vec2 screen = (seed.xy - u_center) * u_worldPixels + u_viewport * .5;
    vec2 wind = windAt(screen);
    float speed = length(wind);
    direction = speed > .3 ? vec2(wind.x, -wind.y) / speed : vec2(1.0, 0.0);
    float age = fract(u_time / 3.2 + seed.z);
    vec2 position = screen + direction * min(3.0, max(.45, speed * .13)) * age * 190.0;
    gl_Position = vec4(position / u_viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
    gl_PointSize = 19.0 * u_pixelRatio;
    opacity = speed < .3 || isnan(speed) || isinf(speed) ? 0.0 : min(.86, (1.0 - age) * 2.9);
  }
`;

const particleFragment = `#version 300 es
  precision highp float;
  in vec2 direction;
  in float opacity;
  out vec4 outColor;
  float segmentDistance(vec2 point, vec2 start, vec2 end) {
    vec2 edge = end - start;
    return length(point - (start + edge * clamp(dot(point-start, edge) / dot(edge, edge), 0.0, 1.0)));
  }
  void main() {
    vec2 point = (gl_PointCoord - .5) * 19.0;
    vec2 local = vec2(dot(point, direction), dot(point, vec2(-direction.y, direction.x)));
    float distance = min(segmentDistance(local, vec2(-5.0, 0.0), vec2(5.0, 0.0)),
      min(segmentDistance(local, vec2(5.0, 0.0), vec2(1.0, -3.0)),
          segmentDistance(local, vec2(5.0, 0.0), vec2(1.0, 3.0))));
    float shadow = 1.0 - smoothstep(1.4, 3.8, distance);
    float line = 1.0 - smoothstep(.35, 1.15, distance);
    outColor = vec4(mix(vec3(.02, .12, .17), vec3(1.0), line), max(shadow * .2, line) * opacity);
  }
`;

const shader = (gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader => {
  const result = gl.createShader(kind);
  if (!result) throw new Error("Cannot create wind shader");
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(`Wind shader: ${gl.getShaderInfoLog(result)}`);
  return result;
};

const surface = (gl: WebGL2RenderingContext, vertex: string, fragment: string): Surface => {
  const program = gl.createProgram();
  const texture = gl.createTexture();
  const vao = gl.createVertexArray();
  if (!program || !texture || !vao) throw new Error("Cannot create wind WebGL resources");
  const vertexShader = shader(gl, gl.VERTEX_SHADER, vertex);
  const fragmentShader = shader(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Wind program: ${gl.getProgramInfoLog(program)}`);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { gl, program, texture, vao };
};

const uploadWind = (surface: Surface, field: WindField, values: Float32Array): void => {
  const { gl } = surface;
  gl.bindTexture(gl.TEXTURE_2D, surface.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, field.width, field.height, 0, gl.RG, gl.FLOAT, values);
};

const useView = (surface: Surface, field: ForecastField, view: View, width: number, height: number): void => {
  const { gl, program } = surface;
  const center = worldCenter(view.center);
  gl.useProgram(program);
  gl.bindVertexArray(surface.vao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, surface.texture);
  gl.uniform1i(gl.getUniformLocation(program, "u_wind"), 0);
  gl.uniform2f(gl.getUniformLocation(program, "u_grid"), field.width, field.height);
  gl.uniform1f(gl.getUniformLocation(program, "u_firstLongitude"), field.firstLongitude);
  gl.uniform1f(gl.getUniformLocation(program, "u_firstLatitude"), field.firstLatitude);
  gl.uniform1f(gl.getUniformLocation(program, "u_increment"), field.increment);
  gl.uniform2f(gl.getUniformLocation(program, "u_center"), center.x, center.y);
  gl.uniform1f(gl.getUniformLocation(program, "u_worldPixels"), 512 * 2 ** view.zoom);
  gl.uniform2f(gl.getUniformLocation(program, "u_viewport"), width, height);
};

const compositeFragment = `#version 300 es
  precision highp float;
  uniform sampler2D u_color;
  uniform vec2 u_resolution;
  out vec4 outColor;
  void main() {
    outColor = texture(u_color, gl_FragCoord.xy / u_resolution);
  }
`;

type Resources = {
  gl: WebGL2RenderingContext;
  color: Surface;
  composite: Surface;
  palette: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  colorWidth: number;
  colorHeight: number;
  colorKey: string;
};

const uploadField = (resources: Resources, field: ForecastField): void => {
  const { gl } = resources;
  const colors = new Uint8Array(field.width * field.height * 4);
  for (let index = 0; index < field.width * field.height; index++) {
    const value = field.kind === "wind" ? Math.hypot(field.u[index]!, field.v[index]!) : field.waveHeight[index]!;
    if (!Number.isFinite(value)) continue;
    const [red, green, blue] = field.kind === "wind" ? windColor(value) : waveColor(value);
    colors[index * 4] = red;
    colors[index * 4 + 1] = green;
    colors[index * 4 + 2] = blue;
    colors[index * 4 + 3] = 178;
  }
  gl.bindTexture(gl.TEXTURE_2D, resources.palette);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, field.width, field.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, colors);
  resources.colorKey = "";
};

const paintColorTexture = (
  resources: Resources,
  field: ForecastField,
  view: View,
  width: number,
  height: number,
  revision: number,
): void => {
  const { gl } = resources;
  const colorWidth = Math.max(1, Math.round(width * .4));
  const colorHeight = Math.max(1, Math.round(height * .4));
  const key = `${revision}/${view.center.lng}/${view.center.lat}/${view.zoom}/${colorWidth}/${colorHeight}`;
  if (key === resources.colorKey) return;
  if (resources.colorWidth !== colorWidth || resources.colorHeight !== colorHeight) {
    gl.bindTexture(gl.TEXTURE_2D, resources.composite.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, colorWidth, colorHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    resources.colorWidth = colorWidth;
    resources.colorHeight = colorHeight;
  }
  const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const previousViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
  gl.bindFramebuffer(gl.FRAMEBUFFER, resources.framebuffer);
  gl.viewport(0, 0, colorWidth, colorHeight);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.STENCIL_TEST);
  useView(resources.color, field, view, width, height);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, resources.palette);
  gl.uniform1i(gl.getUniformLocation(resources.color.program, "u_colors"), 0);
  gl.uniform2f(gl.getUniformLocation(resources.color.program, "u_resolution"), colorWidth, colorHeight);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
  gl.viewport(previousViewport[0]!, previousViewport[1]!, previousViewport[2]!, previousViewport[3]!);
  resources.colorKey = key;
};

const renderWind = (
  resources: Resources,
  field: ForecastField,
  view: View,
  width: number,
  height: number,
  revision: number,
): void => {
  const { gl } = resources;
  paintColorTexture(resources, field, view, width, height, revision);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.SCISSOR_TEST);
  gl.colorMask(true, true, true, true);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  gl.useProgram(resources.composite.program);
  gl.bindVertexArray(resources.composite.vao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, resources.composite.texture);
  gl.uniform1i(gl.getUniformLocation(resources.composite.program, "u_color"), 0);
  gl.uniform2f(gl.getUniformLocation(resources.composite.program, "u_resolution"), gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
};

const createResources = (gl: WebGL2RenderingContext): Resources => {
  const color = surface(gl, colorVertex, colorFragment);
  const composite = surface(gl, colorVertex, compositeFragment);
  const palette = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!palette || !framebuffer) throw new Error("Cannot create wind map layer resources");
  gl.bindTexture(gl.TEXTURE_2D, palette);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, composite.texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, composite.texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return {
    gl, color, composite, palette, framebuffer,
    colorWidth: 0, colorHeight: 0, colorKey: "",
  };
};

const disposeResources = (resources: Resources): void => {
  const { gl } = resources;
  for (const layer of [resources.color, resources.composite]) {
    gl.deleteProgram(layer.program);
    gl.deleteTexture(layer.texture);
    gl.deleteVertexArray(layer.vao);
  }
  gl.deleteTexture(resources.palette);
  gl.deleteFramebuffer(resources.framebuffer);
};

const createParticleOverlay = (map: MapLibreMap, arrows: HTMLCanvasElement): ParticleRenderer => {
  const baseCanvas = map.getCanvas();
  const parent = baseCanvas.parentElement;
  if (!parent) throw new Error("Map canvas is not attached");
  parent.append(arrows);
  arrows.classList.add("leaflet-zoom-animated");
  arrows.style.zIndex = "101";
  const copyMapTransform = (): void => {
    arrows.style.transform = baseCanvas.style.transform;
    arrows.style.transformOrigin = baseCanvas.style.transformOrigin;
    arrows.style.transition = baseCanvas.style.transition;
  };
  const observer = new MutationObserver(copyMapTransform);
  observer.observe(baseCanvas, { attributes: true, attributeFilter: ["style"] });
  copyMapTransform();

  const gl = arrows.getContext("webgl2", { alpha: true, antialias: false }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error("Wind particle WebGL2 context is unavailable");
  const particles = surface(gl, particleVertex, particleFragment);
  const seedBuffer = gl.createBuffer();
  if (!seedBuffer) throw new Error("Cannot create wind particle buffer");
  gl.bindVertexArray(particles.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, seedBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const started = performance.now();
  let field: WindField | null = null;
  let frame = 0;
  let particleCount = 0;
  let seedWidth = 0;
  let seedHeight = 0;
  let seeds: Float32Array | null = null;
  let seedView: Readonly<{ center: Readonly<{ x: number; y: number }>; zoom: number }> | null = null;
  let zoomResetTimer: number | null = null;
  const paint = (now: number): void => {
    frame = 0;
    const width = baseCanvas.clientWidth;
    const height = baseCanvas.clientHeight;
    const pixelWidth = Math.max(1, Math.round(width * .75));
    const pixelHeight = Math.max(1, Math.round(height * .75));
    if (arrows.width !== pixelWidth || arrows.height !== pixelHeight) {
      arrows.width = pixelWidth;
      arrows.height = pixelHeight;
    }
    gl.viewport(0, 0, arrows.width, arrows.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (field && !document.hidden && width > 0 && height > 0) {
      const view: View = { center: map.getCenter(), zoom: map.getZoom() };
      const center = worldCenter(view.center);
      const worldPixels = 512 * 2 ** view.zoom;
      if (!seeds || seedWidth !== width || seedHeight !== height) {
        particleCount = Math.min(850, Math.max(240, Math.round(width * height / 1500)));
        seeds = new Float32Array(particleCount * 3);
        for (let index = 0; index < particleCount; index++) {
          seeds[index * 3] = center.x + (Math.random() - .5) * width / worldPixels;
          seeds[index * 3 + 1] = center.y + (Math.random() - .5) * height / worldPixels;
          seeds[index * 3 + 2] = Math.random();
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, seedBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
        seedWidth = width;
        seedHeight = height;
      } else if (seedView && (center.x !== seedView.center.x || center.y !== seedView.center.y || view.zoom !== seedView.zoom)) {
        let changed = false;
        const worldWrap = Math.round(center.x - seedView.center.x);
        if (worldWrap) {
          for (let index = 0; index < particleCount; index++) seeds[index * 3]! += worldWrap;
          changed = true;
        }
        if (Math.abs(view.zoom - seedView.zoom) > 0.000001) {
          if (zoomResetTimer !== null) clearTimeout(zoomResetTimer);
          zoomResetTimer = window.setTimeout(() => { seedWidth = 0; zoomResetTimer = null; requestPaint(); }, 180);
        } else {
          const margin = 24;
          const wrap = (position: number, span: number): number =>
            ((position + margin) % (span + margin * 2) + span + margin * 2) % (span + margin * 2) - margin;
          for (let index = 0; index < particleCount; index++) {
            const offset = index * 3;
            const x = (seeds[offset]! - center.x) * worldPixels + width * .5;
            const y = (seeds[offset + 1]! - center.y) * worldPixels + height * .5;
            if (x >= -margin && x <= width + margin && y >= -margin && y <= height + margin) continue;
            seeds[offset] = center.x + (wrap(x, width) - width * .5) / worldPixels;
            seeds[offset + 1] = center.y + (wrap(y, height) - height * .5) / worldPixels;
            changed = true;
          }
        }
        if (changed) {
          gl.bindBuffer(gl.ARRAY_BUFFER, seedBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
        }
      }
      seedView = { center, zoom: view.zoom };
      useView(particles, field, view, width, height);
      gl.uniform1f(gl.getUniformLocation(particles.program, "u_time"), reducedMotion.matches ? 0 : (now - started) / 1000);
      gl.uniform1f(gl.getUniformLocation(particles.program, "u_pixelRatio"), arrows.width / width);
      gl.drawArrays(gl.POINTS, 0, particleCount);
    }
    if (!reducedMotion.matches && !document.hidden) frame = requestAnimationFrame(paint);
  };
  const requestPaint = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(paint);
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) requestPaint(); });
  if (reducedMotion.matches) map.on("moveend", requestPaint);
  return {
    setField: (next) => {
      field = next;
      seeds = null;
      seedView = null;
      if (next) {
        const vectors = new Float32Array(next.width * next.height * 2);
        for (let index = 0; index < next.u.length; index++) {
          vectors[index * 2] = next.u[index]!;
          vectors[index * 2 + 1] = next.v[index]!;
        }
        uploadWind(particles, next, vectors);
      }
      requestPaint();
    },
    redraw: requestPaint,
  };
};

export const createWebGLWindRenderer = (map: MapLibreMap, arrows: HTMLCanvasElement): Renderer => {
  const particleOverlay = createParticleOverlay(map, arrows);
  let resources: Resources | null = null;
  let field: ForecastField | null = null;
  let revision = 0;
  const layer: CustomLayerInterface = {
    id: "aer-wind",
    type: "custom",
    renderingMode: "2d",
    onAdd: (_map, gl) => {
      resources = createResources(gl);
      if (field) uploadField(resources, field);
    },
    onRemove: () => {
      if (resources) disposeResources(resources);
      resources = null;
    },
    render: () => {
      if (!resources || !field) return;
      const canvas = map.getCanvas();
      if (!canvas.clientWidth || !canvas.clientHeight) return;
      renderWind(
        resources, field,
        { center: map.getCenter(), zoom: map.getZoom() },
        canvas.clientWidth, canvas.clientHeight,
        revision,
      );
    },
  };
  const addLayer = (): void => {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  };
  if (map.isStyleLoaded()) addLayer();
  else map.once("load", addLayer);
  return {
    setField: (next) => {
      field = next;
      revision++;
      if (next && resources) uploadField(resources, next);
      particleOverlay.setField(next?.kind === "wind" ? next : null);
      map.triggerRepaint();
    },
    redraw: () => {
      map.triggerRepaint();
      particleOverlay.redraw();
    },
  };
};
