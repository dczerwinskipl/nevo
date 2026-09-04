import { userEvent } from 'storybook/test';

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

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
 * Recursively resolves if the property value is another var(--...).
 */
export function resolveLiveToken(tokenName: string): string {
  const rootStyle = window.getComputedStyle(document.documentElement);
  const rawValue = rootStyle.getPropertyValue(tokenName).trim();
  if (!rawValue) {
    throw new Error(`CSS token "${tokenName}" is not defined on document.documentElement`);
  }
  const varMatch = rawValue.match(/^var\((--[\w-]+)\)$/);
  if (varMatch) {
    return resolveLiveToken(varMatch[1]);
  }
  return rawValue;
}

/**
 * Resolves a CSS token into the browser's computed color string
 * (e.g. "rgb(29, 78, 216)").
 */
export function resolveLiveTokenComputed(tokenName: string): string {
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

/**
 * Parses any valid CSS color string (rgb, rgba, oklab, hex, transparent) into [r, g, b, a].
 * Throws if the syntax is unsupported or invalid (never silently falls back to black).
 */
export function parseCssColor(colorStr: string): ColorTuple {
  const str = colorStr.trim();

  // Validate syntax using browser CSS engine if available
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    if (!CSS.supports('color', str)) {
      throw new Error(`Unsupported CSS color syntax: "${colorStr}"`);
    }
  }

  if (str === 'transparent') {
    return [0, 0, 0, 0];
  }

  // Comma-separated: rgb(r, g, b) / rgba(r, g, b, a)
  const rgbCommaMatch = str.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+%?))?\s*\)$/i);
  if (rgbCommaMatch) {
    const r = Math.round(parseFloat(rgbCommaMatch[1]));
    const g = Math.round(parseFloat(rgbCommaMatch[2]));
    const b = Math.round(parseFloat(rgbCommaMatch[3]));
    let a = 1;
    if (rgbCommaMatch[4] !== undefined) {
      a = rgbCommaMatch[4].endsWith('%') ? parseFloat(rgbCommaMatch[4]) / 100 : parseFloat(rgbCommaMatch[4]);
    }
    return [r, g, b, a];
  }

  // Slash syntax: rgb(r g b / a) / rgba(r g b / a)
  const rgbSlashMatch = str.match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
  if (rgbSlashMatch) {
    const r = Math.round(parseFloat(rgbSlashMatch[1]));
    const g = Math.round(parseFloat(rgbSlashMatch[2]));
    const b = Math.round(parseFloat(rgbSlashMatch[3]));
    let a = 1;
    if (rgbSlashMatch[4] !== undefined) {
      a = rgbSlashMatch[4].endsWith('%') ? parseFloat(rgbSlashMatch[4]) / 100 : parseFloat(rgbSlashMatch[4]);
    }
    return [r, g, b, a];
  }

  // Hex syntax: #rgb, #rgba, #rrggbb, #rrggbbaa
  const hexMatch = str.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), 1];
    }
    if (hex.length === 4) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
        parseInt(hex[3] + hex[3], 16) / 255,
      ];
    }
    if (hex.length === 6) {
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1];
    }
    if (hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        parseInt(hex.slice(6, 8), 16) / 255,
      ];
    }
  }

  // OKLab syntax: oklab(L a b / alpha) or oklab(L a b)
  const oklabMatch = str.match(/^oklab\(([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)(?:\s*\/\s*([\d.]+%?))?\)$/i);
  if (oklabMatch) {
    const L = parseFloat(oklabMatch[1]);
    const a = parseFloat(oklabMatch[2]);
    const b = parseFloat(oklabMatch[3]);
    let alpha = 1;
    if (oklabMatch[4]) {
      alpha = oklabMatch[4].endsWith('%') ? parseFloat(oklabMatch[4]) / 100 : parseFloat(oklabMatch[4]);
    }
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    let r = +4.0767439362 * l - 3.3077115913 * m + 0.2309699292 * s;
    let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    r = r <= 0.0031308 ? 12.92 * r : 1.055 * Math.pow(r, 1 / 2.4) - 0.055;
    g = g <= 0.0031308 ? 12.92 * g : 1.055 * Math.pow(g, 1 / 2.4) - 0.055;
    bl = bl <= 0.0031308 ? 12.92 * bl : 1.055 * Math.pow(bl, 1 / 2.4) - 0.055;
    return [
      Math.round(Math.max(0, Math.min(255, r * 255))),
      Math.round(Math.max(0, Math.min(255, g * 255))),
      Math.round(Math.max(0, Math.min(255, bl * 255))),
      alpha,
    ];
  }

  // If it's a CSS variable or complex function, resolve it via DOM probe
  const probe = getProbeElement();
  probe.style.color = '';
  probe.style.color = str;
  if (probe.style.color) {
    const computed = window.getComputedStyle(probe).color;
    if (computed && computed !== str) {
      return parseCssColor(computed);
    }
  }

  throw new Error(`Unsupported or unparseable CSS color syntax: "${colorStr}"`);
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

/**
 * Disables CSS transitions on the element before hovering, guaranteeing
 * deterministic computed styles immediately without waiting for CSS animations.
 */
export async function hoverWithNoTransition(el: HTMLElement): Promise<void> {
  el.style.setProperty('transition', 'none', 'important');
  try {
    const browser = await import('vitest/browser');
    if (browser?.page) {
      await browser.page.elementLocator(el).hover();
      return;
    }
  } catch {
    // fallback
  }
  await userEvent.hover(el);
}

export async function unhoverWithNoTransition(el: HTMLElement): Promise<void> {
  try {
    const browser = await import('vitest/browser');
    if (browser?.page) {
      await browser.page.elementLocator(el).unhover();
      el.style.removeProperty('transition');
      return;
    }
  } catch {
    // fallback
  }
  await userEvent.unhover(el);
  el.style.removeProperty('transition');
}
