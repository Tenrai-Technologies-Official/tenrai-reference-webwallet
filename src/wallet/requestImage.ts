import { qrModules } from "../qr.ts";

const WIDTH = 1080;
const HEIGHT = 1440;
const MARGIN = 72;
const QR_BOX = 600;
const QUIET_ZONE = 4;
const FONTS = ["700 76px Inter", "600 26px Inter", "500 30px Inter", "500 27px 'JetBrains Mono'"] as const;

interface Request {
  uri: string;
  address: string;
  words: string;
  /** Null when the QR encodes a bare address. */
  amount: string | null;
  payload?: string;
  network: string;
  logo: string;
}

export async function paymentImage(request: Request): Promise<Blob> {
  await Promise.all(FONTS.map((font) => document.fonts.load(font).catch(() => [])));
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d");
  if (!g) {
    throw new Error("this device cannot draw the image");
  }
  g.font = FONTS[2];
  const notes = request.payload ? lines(g, request.payload, WIDTH - MARGIN * 3) : [];
  const shift = notes.length ? 24 + notes.length * 40 : 0;
  const height = HEIGHT + shift;
  canvas.width = WIDTH;
  canvas.height = height;
  g.fillStyle = "#000000";
  g.fillRect(0, 0, WIDTH, height);
  g.beginPath();
  g.roundRect(MARGIN / 2, MARGIN / 2, WIDTH - MARGIN, height - MARGIN, 40);
  g.fillStyle = "#09090b";
  g.fill();
  g.strokeStyle = "#2e2e33";
  g.lineWidth = 2;
  g.stroke();
  const shine = g.createLinearGradient(MARGIN, 0, WIDTH - MARGIN, 0);
  shine.addColorStop(0, "rgba(250, 250, 250, 0)");
  shine.addColorStop(0.5, "rgba(250, 250, 250, 0.35)");
  shine.addColorStop(1, "rgba(250, 250, 250, 0)");
  g.fillStyle = shine;
  g.fillRect(MARGIN, MARGIN / 2, WIDTH - MARGIN * 2, 2);

  const image = await picture(request.logo);
  if (image) {
    g.drawImage(image, (WIDTH - 280) / 2, 92, 280, (280 * image.naturalHeight) / image.naturalWidth);
  }
  g.textAlign = "center";
  label(g, request.amount === null ? "PAYMENT ADDRESS" : "PAYMENT REQUEST", 230);
  g.font = FONTS[0];
  g.fillStyle = "#fafafa";
  g.fillText(request.amount ?? "TRAI", WIDTH / 2, 320, WIDTH - MARGIN * 2);
  g.font = FONTS[2];
  g.fillStyle = "#a1a1aa";
  notes.forEach((line, index) => g.fillText(line, WIDTH / 2, 380 + index * 40));

  const modules = qrModules(request.uri);
  const side = modules.length + QUIET_ZONE * 2;
  const cell = Math.floor(QR_BOX / side);
  const size = cell * side;
  const left = (WIDTH - size) / 2;
  const top = 372 + shift;
  g.beginPath();
  g.roundRect(left - 18, top - 18, size + 36, size + 36, 28);
  g.fillStyle = "#ffffff";
  g.fill();
  g.fillStyle = "#000000";
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) {
        g.fillRect(left + (x + QUIET_ZONE) * cell, top + (y + QUIET_ZONE) * cell, cell, cell);
      }
    }),
  );

  let y = top + size + 92;
  label(g, "ADDRESS", y);
  g.font = FONTS[3];
  g.fillStyle = "#e4e4e7";
  for (const line of wrap(g, request.address, WIDTH - MARGIN * 3)) {
    y += 42;
    g.fillText(line, WIDTH / 2, y);
  }
  y += 72;
  label(g, "ADDRESS VERIFICATION WORDS", y);
  g.font = FONTS[2];
  g.fillStyle = "#fafafa";
  g.fillText(request.words, WIDTH / 2, y + 46, WIDTH - MARGIN * 2);
  g.font = FONTS[1];
  g.fillStyle = "#71717a";
  g.fillText(`Tenrai ${request.network} · scan with a Tenrai wallet`, WIDTH / 2, height - 82);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("the image could not be drawn"))), "image/png"),
  );
}

function label(g: CanvasRenderingContext2D, text: string, y: number) {
  g.font = FONTS[1];
  g.fillStyle = "#71717a";
  g.letterSpacing = "4px";
  g.fillText(text, WIDTH / 2, y);
  g.letterSpacing = "0px";
}

function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const character of text) {
    if (line && g.measureText(line + character).width > width) {
      lines.push(line);
      line = "";
    }
    line += character;
  }
  return line ? [...lines, line] : lines;
}

function lines(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const done: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const longer = line ? `${line} ${word}` : word;
    if (g.measureText(longer).width <= width) {
      line = longer;
      continue;
    }
    if (line) {
      done.push(line);
    }
    const pieces = wrap(g, word, width);
    line = pieces.pop() ?? "";
    done.push(...pieces);
  }
  return line ? [...done, line] : done;
}

function picture(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
