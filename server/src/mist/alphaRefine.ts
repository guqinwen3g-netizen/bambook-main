/**
 * 产品图抠图蒙版精修（纯 CPU，无额外模型）。
 *
 * IS-Net 对“白色面料 / 白色飘带 / 白绳 + 浅色背景”常给出一片低置信半透明 alpha，
 * 直接相乘会留下灰白雾面、脏边和背景色晕。这里在不引入更重模型的前提下做四件事：
 * 1. 残留清理：只保留与高置信主体连通的区域，脱离主体的漂浮雾块清零；
 * 2. 边缘带去雾：仅在靠近“确定背景”的窄带里，用局部背景色/前景色的颜色线估计压低
 *    “颜色就是背景”的低 alpha 像素（只压低不提高，避免把背景纹理抬成实体）；
 * 3. 内部补实：远离任何确定背景的主体内部若被模型判成半透明（白衣白底），补成实体；
 * 4. 去背景色污染：边缘带内半透明像素按 F=(I-(1-α)B)/α 还原前景色，去掉灰/暗色晕边。
 * 用户裁决“边缘完整连续优先于必须抠净”：所有调整都是平滑权重，主体内部和高置信边缘不被削弱。
 */
export type MatteImage = {data: Buffer; width: number; height: number};

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smooth = (edge0: number, edge1: number, value: number) => { const t = clamp01((value - edge0) / (edge1 - edge0)); return t * t * (3 - 2 * t); };

/** 可分离方框均值（滑动和，边界夹取）；scratch 复用以控制 worker 内存峰值。 */
function boxMean(source: Float32Array, width: number, height: number, radius: number, scratch: Float32Array, out = new Float32Array(width * height)) {
  const span = 2 * radius + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width; let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += source[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) { scratch[row + x] = sum / span; sum += source[row + Math.min(width - 1, x + radius + 1)] - source[row + Math.max(0, x - radius)]; }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += scratch[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) { out[y * width + x] = sum / span; sum += scratch[Math.min(height - 1, y + radius + 1) * width + x] - scratch[Math.max(0, y - radius) * width + x]; }
  }
  return out;
}

/** 以 alpha>seed 的足够大的连通主体为种子，只沿 alpha>grow 生长；返回可达标记。 */
function reachableFromSubject(alpha: Float32Array, width: number, height: number, seed: number, grow: number) {
  const count = width * height, label = new Int32Array(count).fill(-1), stack = new Int32Array(count), sizes: number[] = [];
  const visit = (start: number, accept: (value: number) => boolean, mark: (index: number) => void, marked: (index: number) => boolean) => {
    let top = 0, size = 0; stack[top++] = start; mark(start);
    while (top) {
      const index = stack[--top], x = index % width, y = (index - x) / width; size++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const next = yy * width + xx; if (!marked(next) && accept(alpha[next])) { mark(next); stack[top++] = next; }
      }
    }
    return size;
  };
  for (let p = 0; p < count; p++) if (alpha[p] > seed && label[p] < 0) { const id = sizes.length; sizes.push(visit(p, value => value > seed, index => { label[index] = id; }, index => label[index] >= 0)); }
  const largest = sizes.reduce((max, size) => Math.max(max, size), 0), minimum = Math.max(0.004 * largest, 0.0002 * count);
  const reach = new Uint8Array(count);
  for (let p = 0; p < count; p++) if (!reach[p] && label[p] >= 0 && sizes[label[p]] >= minimum) visit(p, value => value > grow, index => { reach[index] = 1; }, index => reach[index] === 1);
  return reach;
}

/**
 * rgba：工作分辨率下的原图（含原有透明度），mask：同尺寸 0–255 模型蒙版。
 * 返回带精修 alpha、去色污染后的 RGBA。
 */
export function refineAlphaMatte(rgba: Buffer, mask: Uint8Array, width: number, height: number): MatteImage {
  const count = width * height, side = Math.max(width, height), alpha = new Float32Array(count), scratch = new Float32Array(count);
  for (let p = 0; p < count; p++) alpha[p] = (mask[p] / 255) * (rgba[p * 4 + 3] / 255);

  // 1) 残留清理：主体外 2px 柔边过渡，其余不可达区域清零。
  const reach = reachableFromSubject(alpha, width, height, 0.6, 0.08), reachValue = new Float32Array(count);
  for (let p = 0; p < count; p++) reachValue[p] = reach[p];
  const nearSubject = boxMean(reachValue, width, height, 2, scratch);
  for (let p = 0; p < count; p++) if (!reach[p]) alpha[p] *= Math.min(1, nearSubject[p] * 3);

  // 2) 局部背景色 B / 前景色 F̄：按 (1-α)² / α² 加权的大半径均值。
  const radius = Math.max(8, Math.round(side * 0.02)), weightB = reachValue, weightF = nearSubject, channel = new Float32Array(count);
  for (let p = 0; p < count; p++) { weightB[p] = (1 - alpha[p]) ** 2; weightF[p] = alpha[p] ** 2; }
  const sumB = boxMean(weightB, width, height, radius, scratch), sumF = boxMean(weightF, width, height, radius, scratch);
  const background: Float32Array[] = [], foreground: Float32Array[] = [];
  for (let c = 0; c < 3; c++) {
    for (let p = 0; p < count; p++) channel[p] = (rgba[p * 4 + c] / 255) * weightB[p];
    const b = boxMean(channel, width, height, radius, scratch);
    for (let p = 0; p < count; p++) channel[p] = (rgba[p * 4 + c] / 255) * weightF[p];
    const f = boxMean(channel, width, height, radius, scratch);
    for (let p = 0; p < count; p++) { const own = rgba[p * 4 + c] / 255; b[p] = sumB[p] > 1e-4 ? b[p] / sumB[p] : own; f[p] = sumF[p] > 1e-4 ? f[p] / sumF[p] : own; }
    background.push(b); foreground.push(f);
  }

  // 3) 颜色线 alpha 估计与对比置信度。
  const colorAlpha = sumB, confidence = sumF;
  for (let p = 0; p < count; p++) {
    let dot = 0, norm = 0;
    for (let c = 0; c < 3; c++) { const d = foreground[c][p] - background[c][p]; dot += (rgba[p * 4 + c] / 255 - background[c][p]) * d; norm += d * d; }
    colorAlpha[p] = norm > 1e-6 ? clamp01(dot / norm) : alpha[p]; confidence[p] = smooth(0.03, 0.15, Math.sqrt(norm));
  }
  const smoothedColorAlpha = boxMean(colorAlpha, width, height, 2, scratch, channel);

  // 4) 边缘带（靠近确定背景）与内部（远离确定背景）权重。
  const backgroundSeed = colorAlpha; for (let p = 0; p < count; p++) backgroundSeed[p] = alpha[p] < 0.05 ? 1 : 0;
  const band = boxMean(backgroundSeed, width, height, Math.max(4, Math.round(side * 0.012)), scratch, weightB);
  const outerBand = boxMean(backgroundSeed, width, height, Math.max(16, Math.round(side * 0.02)), scratch, weightF);

  const out = Buffer.alloc(count * 4);
  for (let p = 0; p < count; p++) {
    const edge = smooth(0, 0.04, band[p]), outer = smooth(0, 0.04, outerBand[p]);
    let value = alpha[p];
    if (value > 0.002 && value < 0.98) { const delta = smoothedColorAlpha[p] - value; if (delta < 0) value += edge * confidence[p] * (1 - smooth(0.35, 0.6, value)) * delta; }
    if (outer < 1) value += (1 - outer) * (Math.max(value, smooth(0.15, 0.55, value)) - value);
    value = value < 0.03 ? 0 : value > 0.97 ? 1 : value;
    const unmix = edge * smooth(0.25, 0.6, value);
    for (let c = 0; c < 3; c++) {
      let color = rgba[p * 4 + c] / 255;
      if (unmix > 0 && value < 1) color += unmix * (clamp01((color - (1 - value) * background[c][p]) / value) - color);
      out[p * 4 + c] = Math.round(color * 255);
    }
    out[p * 4 + 3] = Math.round(value * 255);
  }
  return {data: out, width, height};
}
