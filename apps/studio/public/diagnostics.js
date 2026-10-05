export const metricLabels = {
  light:'曝光平衡',
  highlights:'高光保留',
  shadows:'暗部可读',
  color:'色彩节制',
  contrast:'影调层次',
  detail:'细节表现'
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function inspectPixels(data, width, height) {
  const total = width * height;
  if (!total || data.length !== total * 4) throw new Error('Invalid image pixels');
  const step = Math.max(1, Math.floor(total / 120000));
  const histogram = new Array(64).fill(0);
  let count = 0, sum = 0, sumSquares = 0, sumSaturation = 0, sumEdge = 0;
  let clippedHigh = 0, clippedLow = 0, warmth = 0;
  for (let pixel = 0; pixel < total; pixel += step) {
    const index = pixel * 4;
    const r = data[index] / 255, g = data[index + 1] / 255, b = data[index + 2] / 255;
    const luma = .2126 * r + .7152 * g + .0722 * b;
    histogram[Math.min(63, Math.floor(luma * 64))]++;
    sum += luma; sumSquares += luma * luma;
    sumSaturation += Math.max(r,g,b) - Math.min(r,g,b);
    warmth += r - b;
    if (luma > .965) clippedHigh++;
    if (luma < .035) clippedLow++;
    if (pixel % width < width - 1) {
      const next = index + 4;
      const adjacent = (.2126 * data[next] + .7152 * data[next + 1] + .0722 * data[next + 2]) / 255;
      sumEdge += Math.abs(adjacent - luma);
    }
    count++;
  }
  const mean = sum / count;
  const deviation = Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
  const saturation = sumSaturation / count;
  const edge = sumEdge / count;
  const brightClip = clippedHigh / count, darkClip = clippedLow / count;
  let seen = 0, p10 = 0, p90 = 1;
  for (let i = 0; i < histogram.length; i++) {
    seen += histogram[i];
    if (!p10 && seen >= count * .1) p10 = i / 63;
    if (p90 === 1 && seen >= count * .9) p90 = i / 63;
  }
  const score = value => Math.round(clamp(value, 15, 98));
  return {
    metrics:{
      light:score(90 - Math.abs(mean - .49) * 110 - (brightClip + darkClip) * 90),
      highlights:score(93 - brightClip * 430 - Math.max(0, p90 - .90) * 65),
      shadows:score(92 - darkClip * 420 - Math.max(0, .1 - p10) * 120),
      color:score(87 - Math.abs(saturation - .24) * 105 - Math.max(0, Math.abs(warmth / count) - .17) * 75),
      contrast:score(88 - Math.abs(deviation - .225) * 155),
      detail:score(68 + Math.min(.22, edge) * 210 - (brightClip + darkClip) * 25)
    },
    histogram,
    stats:{mean,deviation,saturation,warmth:warmth/count,brightClip,darkClip}
  };
}
