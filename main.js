import { Renderer, Program, Mesh, Triangle, Color } from "https://cdn.jsdelivr.net/npm/ogl@1.0.4/dist/ogl.esm.js";

const vertexShader = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform float iTime;
uniform vec3 iResolution;
uniform vec3 uColor;
uniform float uAmplitude;
uniform float uDistance;
uniform vec2 uMouse;

#define PI 3.1415926538

const int u_line_count = 40;
const float u_line_width = 7.0;
const float u_line_blur = 10.0;

float Perlin2D(vec2 P) {
    vec2 Pi = floor(P);
    vec4 Pf_Pfmin1 = P.xyxy - vec4(Pi, Pi + 1.0);
    vec4 Pt = vec4(Pi.xy, Pi.xy + 1.0);
    Pt = Pt - floor(Pt * (1.0 / 71.0)) * 71.0;
    Pt += vec2(26.0, 161.0).xyxy;
    Pt *= Pt;
    Pt = Pt.xzxz * Pt.yyww;
    vec4 hash_x = fract(Pt * (1.0 / 951.135664));
    vec4 hash_y = fract(Pt * (1.0 / 642.949883));
    vec4 grad_x = hash_x - 0.49999;
    vec4 grad_y = hash_y - 0.49999;
    vec4 grad_results = inversesqrt(grad_x * grad_x + grad_y * grad_y)
        * (grad_x * Pf_Pfmin1.xzxz + grad_y * Pf_Pfmin1.yyww);
    grad_results *= 1.4142135623730950;
    vec2 blend = Pf_Pfmin1.xy * Pf_Pfmin1.xy * Pf_Pfmin1.xy
               * (Pf_Pfmin1.xy * (Pf_Pfmin1.xy * 6.0 - 15.0) + 10.0);
    vec4 blend2 = vec4(blend, vec2(1.0 - blend));
    return dot(grad_results, blend2.zxzx * blend2.wwyy);
}

float pixel(float count, vec2 resolution) {
    return (1.0 / max(resolution.x, resolution.y)) * count;
}

float lineFn(vec2 st, float width, float perc, float offset, vec2 mouse, float time, float amplitude, float distance) {
    float split_offset = (perc * 0.4);
    float split_point = 0.1 + split_offset;

    float amplitude_normal = smoothstep(split_point, 0.7, st.x);
    float amplitude_strength = 0.5;
    float finalAmplitude = amplitude_normal * amplitude_strength
                           * amplitude * (1.0 + (mouse.y - 0.5) * 0.2);

    float time_scaled = time / 10.0 + (mouse.x - 0.5) * 1.0;
    float blur = smoothstep(split_point, split_point + 0.05, st.x) * perc;

    float xnoise = mix(
        Perlin2D(vec2(time_scaled, st.x + perc) * 2.5),
        Perlin2D(vec2(time_scaled, st.x + time_scaled) * 3.5) / 1.5,
        st.x * 0.3
    );

    float y = 0.5 + (perc - 0.5) * distance + xnoise / 2.0 * finalAmplitude;

    float line_start = smoothstep(
        y + (width / 2.0) + (u_line_blur * pixel(1.0, iResolution.xy) * blur),
        y,
        st.y
    );

    float line_end = smoothstep(
        y,
        y - (width / 2.0) - (u_line_blur * pixel(1.0, iResolution.xy) * blur),
        st.y
    );

    return clamp(
        (line_start - line_end) * (1.0 - smoothstep(0.0, 1.0, pow(perc, 0.3))),
        0.0,
        1.0
    );
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;

    float line_strength = 1.0;
    for (int i = 0; i < u_line_count; i++) {
        float p = float(i) / float(u_line_count);
        line_strength *= (1.0 - lineFn(
            uv,
            u_line_width * pixel(1.0, iResolution.xy) * (1.0 - p),
            p,
            (PI * 1.0) * p,
            uMouse,
            iTime,
            uAmplitude,
            uDistance
        ));
    }

    float colorVal = 1.0 - line_strength;
    fragColor = vec4(uColor * colorVal, colorVal);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

const DEFAULT_OPTIONS = {
  color: [0.66, 0.87, 0.92],
  amplitude: 1.0,
  distance: 0.25,
  enableMouseInteraction: true,
};

function parseColor(value) {
  if (!value) return null;
  if (Array.isArray(value) && value.length === 3) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const hexMatch = /^#?([0-9a-fA-F]{6})$/.exec(trimmed);
  if (hexMatch) {
    const hex = hexMatch[1];
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  const parts = trimmed.split(/[,\s]+/).map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return parts.map((n) => (n > 1 ? Math.min(Math.max(n / 255, 0), 1) : Math.min(Math.max(n, 0), 1)));
  }
  return null;
}

function readOptions(container) {
  const opts = {};
  const color = parseColor(container.dataset.color);
  if (color) opts.color = color;

  const amplitude = Number.parseFloat(container.dataset.amplitude);
  if (Number.isFinite(amplitude)) opts.amplitude = amplitude;

  const distance = Number.parseFloat(container.dataset.distance);
  if (Number.isFinite(distance)) opts.distance = distance;

  if (container.dataset.enableMouse) {
    opts.enableMouseInteraction = container.dataset.enableMouse !== "false";
  }

  return opts;
}

function createThreads(container, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const renderer = new Renderer({ alpha: true, dpr: Math.min(window.devicePixelRatio || 1, 2) });
  const { gl } = renderer;

  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const geometry = new Triangle(gl);
  const resolution = new Color(1, 1, 1);
  const uniformColor = new Color(...config.color);
  const uniformMouse = new Float32Array([0.5, 0.5]);

  const program = new Program(gl, {
    vertex: vertexShader,
    fragment: fragmentShader,
    uniforms: {
      iTime: { value: 0 },
      iResolution: { value: resolution },
      uColor: { value: uniformColor },
      uAmplitude: { value: config.amplitude },
      uDistance: { value: config.distance },
      uMouse: { value: uniformMouse },
    },
  });

  const mesh = new Mesh(gl, { geometry, program });
  container.appendChild(gl.canvas);

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;

    renderer.setSize(width, height);
    resolution.r = width;
    resolution.g = height;
    resolution.b = width / height;
  }

  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  if (resizeObserver) {
    resizeObserver.observe(container);
  } else {
    window.addEventListener("resize", resize);
  }
  resize();

  let currentMouse = [0.5, 0.5];
  let targetMouse = [0.5, 0.5];
  const smoothing = 0.05;

  function handlePointerMove(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (clientX - rect.left) / rect.width;
    const y = 1.0 - (clientY - rect.top) / rect.height;
    targetMouse = [Math.min(Math.max(x, 0), 1), Math.min(Math.max(y, 0), 1)];
  }

  function onMouseMove(event) {
    handlePointerMove(event.clientX, event.clientY);
  }

  function onTouchMove(event) {
    if (event.touches.length > 0) {
      const touch = event.touches[0];
      handlePointerMove(touch.clientX, touch.clientY);
    }
  }

  function resetMouse() {
    targetMouse = [0.5, 0.5];
  }

  if (config.enableMouseInteraction) {
    container.addEventListener("mousemove", onMouseMove);
    container.addEventListener("mouseleave", resetMouse);
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("touchend", resetMouse);
  }

  let animationId = null;
  let isRunning = true;

  function update(time) {
    if (!isRunning) return;

    if (config.enableMouseInteraction) {
      currentMouse[0] += smoothing * (targetMouse[0] - currentMouse[0]);
      currentMouse[1] += smoothing * (targetMouse[1] - currentMouse[1]);
      uniformMouse[0] = currentMouse[0];
      uniformMouse[1] = currentMouse[1];
    } else {
      uniformMouse[0] = 0.5;
      uniformMouse[1] = 0.5;
    }

    program.uniforms.iTime.value = time * 0.001;
    renderer.render({ scene: mesh });
    animationId = requestAnimationFrame(update);
  }

  animationId = requestAnimationFrame(update);

  return function destroy() {
    isRunning = false;
    if (animationId) cancelAnimationFrame(animationId);

    if (resizeObserver) {
      resizeObserver.disconnect();
    } else {
      window.removeEventListener("resize", resize);
    }

    if (config.enableMouseInteraction) {
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("mouseleave", resetMouse);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", resetMouse);
    }

    if (container.contains(gl.canvas)) {
      container.removeChild(gl.canvas);
    }

    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}

function bootstrap() {
  const container = document.getElementById("threads");
  if (!container) return;

  container.dataset.initialized = "true";
  if (typeof container._destroyThreads === "function") {
    container._destroyThreads();
  }

  container._destroyThreads = createThreads(container, readOptions(container));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
