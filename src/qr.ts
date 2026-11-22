// QR codes in byte mode at error correction level M, versions 1 to 10: enough for any address.

const MAX_VERSION = 10;
const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];
const FINDER_LIKE = [
  [true, false, true, true, true, false, true, false, false, false, false],
  [false, false, false, false, true, false, true, true, true, false, true],
];

type Grid = boolean[][];

function at(list: readonly number[], index: number): number {
  return list[index] ?? 0;
}

function rawCodewords(version: number): number {
  let bits = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2;
    bits -= (25 * alignments - 10) * alignments - 55;
    if (version >= 7) {
      bits -= 36;
    }
  }
  return Math.floor(bits / 8);
}

function dataCodewords(version: number): number {
  return rawCodewords(version) - at(EC_PER_BLOCK, version) * at(BLOCKS, version);
}

function multiply(x: number, y: number): number {
  let product = 0;
  for (let bit = 7; bit >= 0; bit -= 1) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((y >>> bit) & 1) * x;
  }
  return product;
}

function generator(degree: number): number[] {
  const result: number[] = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = multiply(at(result, j), root);
      if (j + 1 < degree) {
        result[j] = at(result, j) ^ at(result, j + 1);
      }
    }
    root = multiply(root, 2);
  }
  return result;
}

function remainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result: number[] = new Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] = at(result, index) ^ multiply(coefficient, factor);
    });
  }
  return result;
}

function codewords(bytes: readonly number[]): { version: number; words: number[] } {
  const header = (version: number) => 4 + (version < 10 ? 8 : 16);
  let version = 1;
  while (version <= MAX_VERSION && header(version) + bytes.length * 8 > dataCodewords(version) * 8) {
    version += 1;
  }
  if (version > MAX_VERSION) {
    throw new Error("the text is too long for a QR code");
  }
  const capacity = dataCodewords(version) * 8;
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let bit = length - 1; bit >= 0; bit -= 1) {
      bits.push((value >>> bit) & 1);
    }
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((byte) => put(byte, 8));
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let offset = 0; offset < bits.length; offset += 8) {
    data.push(bits.slice(offset, offset + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  for (let pad = 0xec; data.length < capacity / 8; pad ^= 0xec ^ 0x11) {
    data.push(pad);
  }

  const blocks = at(BLOCKS, version);
  const ecLength = at(EC_PER_BLOCK, version);
  const raw = rawCodewords(version);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const divisor = generator(ecLength);
  const split: number[][] = [];
  for (let block = 0, offset = 0; block < blocks; block += 1) {
    const part = data.slice(offset, offset + shortLength - ecLength + (block < shortBlocks ? 0 : 1));
    offset += part.length;
    const ec = remainder(part, divisor);
    if (block < shortBlocks) {
      part.push(0);
    }
    split.push(part.concat(ec));
  }
  const words: number[] = [];
  for (let index = 0; index < (split[0]?.length ?? 0); index += 1) {
    split.forEach((part, block) => {
      if (index !== shortLength - ecLength || block >= shortBlocks) {
        words.push(at(part, index));
      }
    });
  }
  return { version, words };
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) {
    return [];
  }
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step) {
    result.splice(1, 0, position);
  }
  return result;
}

function formatBits(mask: number): number {
  let rest = mask;
  for (let i = 0; i < 10; i += 1) {
    rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
  }
  return ((mask << 10) | rest) ^ 0x5412;
}

function drawFormat(set: (x: number, y: number, dark: boolean) => void, size: number, mask: number): void {
  const bits = formatBits(mask);
  const bit = (index: number) => ((bits >>> index) & 1) !== 0;
  for (let i = 0; i <= 5; i += 1) {
    set(8, i, bit(i));
  }
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) {
    set(14 - i, 8, bit(i));
  }
  for (let i = 0; i < 8; i += 1) {
    set(size - 1 - i, 8, bit(i));
  }
  for (let i = 8; i < 15; i += 1) {
    set(8, size - 15 + i, bit(i));
  }
  set(8, size - 8, true);
}

function cell(grid: Grid, x: number, y: number): boolean {
  return grid[y]?.[x] ?? false;
}

function penalty(modules: Grid, size: number): number {
  let score = 0;
  for (let a = 0; a < size; a += 1) {
    for (const read of [(b: number) => cell(modules, b, a), (b: number) => cell(modules, a, b)]) {
      let run = 1;
      for (let b = 1; b < size; b += 1) {
        if (read(b) !== read(b - 1)) {
          run = 1;
        } else {
          run += 1;
          if (run === 5) {
            score += 3;
          } else if (run > 5) {
            score += 1;
          }
        }
      }
      for (let b = 0; b + 11 <= size; b += 1) {
        for (const pattern of FINDER_LIKE) {
          if (pattern.every((dark, k) => read(b + k) === dark)) {
            score += 40;
          }
        }
      }
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const color = cell(modules, x, y);
      if (color) {
        dark += 1;
      }
      if (x + 1 < size && y + 1 < size && color === cell(modules, x + 1, y) && color === cell(modules, x, y + 1) && color === cell(modules, x + 1, y + 1)) {
        score += 3;
      }
    }
  }
  const total = size * size;
  return score + Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
}

/** The dark modules of a QR code for `text`, rows of booleans without the quiet zone. */
export function qrModules(text: string): Grid {
  const { version, words } = codewords([...new TextEncoder().encode(text)]);
  const size = version * 4 + 17;
  const base: Grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved: Grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserve = (x: number, y: number, dark: boolean) => {
    const row = base[y];
    const mark = reserved[y];
    if (row && mark) {
      row[x] = dark;
      mark[x] = true;
    }
  };
  for (let i = 0; i < size; i += 1) {
    reserve(6, i, i % 2 === 0);
    reserve(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) {
          reserve(x, y, distance !== 2 && distance !== 4);
        }
      }
    }
  }
  const positions = alignmentPositions(version, size);
  const last = positions.length - 1;
  positions.forEach((cx, i) =>
    positions.forEach((cy, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) {
        return;
      }
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          reserve(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }),
  );
  drawFormat(reserve, size, 0);
  if (version >= 7) {
    let rest = version;
    for (let i = 0; i < 12; i += 1) {
      rest = (rest << 1) ^ ((rest >>> 11) * 0x1f25);
    }
    const bits = (version << 12) | rest;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      reserve(a, b, dark);
      reserve(b, a, dark);
    }
  }
  let index = 0;
  const total = words.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5;
    }
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        const row = base[y];
        if (row && !cell(reserved, x, y) && index < total) {
          row[x] = ((at(words, index >>> 3) >>> (7 - (index & 7))) & 1) !== 0;
          index += 1;
        }
      }
    }
  }
  let best: { score: number; modules: Grid } | undefined;
  MASKS.forEach((inverts, mask) => {
    const modules = base.map((row, y) => row.map((dark, x) => (cell(reserved, x, y) ? dark : dark !== inverts(x, y))));
    drawFormat(
      (x, y, dark) => {
        const row = modules[y];
        if (row) {
          row[x] = dark;
        }
      },
      size,
      mask,
    );
    const score = penalty(modules, size);
    if (!best || score < best.score) {
      best = { score, modules };
    }
  });
  return best?.modules ?? base;
}
