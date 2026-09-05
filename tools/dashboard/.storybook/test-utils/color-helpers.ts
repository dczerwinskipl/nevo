export type ColorTuple = [number, number, number, number];

let probeEl: HTMLDivElement | null = null;

function getProbeElement(): HTMLDivElement {
  if (!probeEl || !probeEl.isConnected) {
    probeEl = document.createElement('div');
    probeEl.setAttribute('data-color-probe', 'true');
    probeEl.style.position = 'fixed';
    probeEl.style.top = '-9999px';
    probeEl.style.left = '-9999px';
    probeEl.style.visibility = 'hidden';
    probeEl.style.pointerEvents = 'none';
    document.body.appendChild(probeEl);
  }
  return probeEl;
}

/**
 * Resolve a CSS custom property from document.documentElement.
 * Verifies that the custom property exists on document.documentElement.
 */
export function resolveLiveToken(tokenName: string): string {
  const rootStyle = window.getComputedStyle(document.documentElement);
  const rawValue = rootStyle.getPropertyValue(tokenName).trim();
  if (!rawValue) {
    throw new Error(`CSS token "${tokenName}" is not defined on document.documentElement`);
  }
  return rawValue;
}

/**
 * Resolves a CSS token into the browser's computed color string
 * (e.g. "rgb(29, 78, 216)").
 * Verifies that the custom property exists first; throws explicitly if missing.
 */
export function resolveLiveTokenComputed(tokenName: string): string {
  resolveLiveToken(tokenName);
  const probe = getProbeElement();
  probe.style.color = `var(${tokenName})`;
  return window.getComputedStyle(probe).color;
}

/**
 * Resolves a CSS token into RGBA tuple [r, g, b, a].
 */
export function resolveLiveTokenRgba(tokenName: string): ColorTuple {
  const computed = resolveLiveTokenComputed(tokenName);
  return parseCssColor(computed);
}

let canvasCtx: CanvasRenderingContext2D | null = null;

function getCanvasContext(): CanvasRenderingContext2D {
  if (!canvasCtx) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    canvasCtx = canvas.getContext('2d', { willReadFrequently: true });
    if (!canvasCtx) {
      throw new Error('Canvas 2D context not supported');
    }
  }
  return canvasCtx;
}

/**
 * Parses any valid CSS color string into [r, g, b, a] using the browser's 2D canvas.
 * Validates syntax using CSS.supports before rasterizing.
 * Throws if the syntax is unsupported or invalid (never silently falls back to black).
 */
export function parseCssColor(colorStr: string): ColorTuple {
  if (!colorStr || typeof colorStr !== 'string') {
    throw new Error(`Invalid color value: ${String(colorStr)}`);
  }
  const str = colorStr.trim();
  if (!str) {
    throw new Error('Color string cannot be empty');
  }

  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    if (!CSS.supports('color', str)) {
      throw new Error(`Unsupported or invalid CSS color syntax: "${str}"`);
    }
  }

  if (str === 'transparent') {
    return [0, 0, 0, 0];
  }

  const ctx = getCanvasContext();
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = str;
  ctx.fillRect(0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  const alpha = Number((data[3] / 255).toFixed(4));

  if (alpha === 0) {
    return [0, 0, 0, 0];
  }

  if (alpha >= 0.999) {
    return [data[0], data[1], data[2], 1];
  }

  // For translucent colors, use browser CSS relative color syntax if available
  // to avoid 8-bit premultiplied alpha quantization in canvas backing store.
  const relColor = `rgb(from ${str} r g b / 1)`;
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', relColor)) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = relColor;
    ctx.fillRect(0, 0, 1, 1);
    const opaqueData = ctx.getImageData(0, 0, 1, 1).data;
    return [opaqueData[0], opaqueData[1], opaqueData[2], alpha];
  }

  return [data[0], data[1], data[2], alpha];
}

/**
 * Standard WCAG 2.1 relative luminance and contrast calculations.
 */
export function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relLuminance(rgb: [number, number, number]): number {
  return 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
}

export function contrastRatio(rgb1: [number, number, number], rgb2: [number, number, number]): number {
  const l1 = relLuminance(rgb1);
  const l2 = relLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Alpha compositing: composite foreground over background.
 */
export function compositeOver(fg: ColorTuple, bg: ColorTuple): ColorTuple {
  const alphaOut = fg[3] + bg[3] * (1 - fg[3]);
  if (alphaOut === 0) return [0, 0, 0, 0];
  const r = (fg[0] * fg[3] + bg[0] * bg[3] * (1 - fg[3])) / alphaOut;
  const g = (fg[1] * fg[3] + bg[1] * bg[3] * (1 - fg[3])) / alphaOut;
  const b = (fg[2] * fg[3] + bg[2] * bg[3] * (1 - fg[3])) / alphaOut;
  return [Math.round(r), Math.round(g), Math.round(b), alphaOut];
}

/**
 * Traverses element and ancestor backgrounds until an opaque background is found,
 * compositing all layers. Resolves token fallback from live computed CSS if needed.
 */
export function getEffectiveBackgroundColor(el: HTMLElement): [number, number, number] {
  const layers: ColorTuple[] = [];
  let curr: HTMLElement | null = el;
  let foundOpaque = false;

  while (curr && curr !== document.documentElement) {
    const bg = window.getComputedStyle(curr).backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      const parsed = parseCssColor(bg);
      if (parsed[3] > 0) {
        layers.unshift(parsed);
        if (parsed[3] >= 0.999) {
          foundOpaque = true;
          break;
        }
      }
    }
    curr = curr.parentElement;
  }

  if (!foundOpaque && document.documentElement) {
    const rootBg = window.getComputedStyle(document.documentElement).backgroundColor;
    if (rootBg && rootBg !== 'transparent' && rootBg !== 'rgba(0, 0, 0, 0)') {
      const parsed = parseCssColor(rootBg);
      if (parsed[3] > 0) {
        layers.unshift(parsed);
        if (parsed[3] >= 0.999) {
          foundOpaque = true;
        }
      }
    }
  }

  // If still not opaque, resolve the canvas foundation from the live CSS custom property
  if (!foundOpaque) {
    const baseCanvas = resolveLiveTokenRgba('--color-background');
    layers.unshift(baseCanvas);
  }

  let comp = layers[0];
  for (let i = 1; i < layers.length; i++) {
    comp = compositeOver(layers[i], comp);
  }
  return [comp[0], comp[1], comp[2]];
}
