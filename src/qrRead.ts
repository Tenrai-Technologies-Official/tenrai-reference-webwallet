import jsQR from "jsqr";

const MAX_SIDE = 960;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const FRAME_MILLIS = 150;

type Source = HTMLVideoElement | ImageBitmap;
type Reader = (source: Source) => Promise<string | null>;

interface Detector {
  detect(source: Source): Promise<{ rawValue: string }[]>;
}

interface DetectorClass {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

let reader: Reader | undefined;

async function nativeReader(): Promise<Reader | undefined> {
  const Barcode = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (typeof Barcode !== "function") {
    return undefined;
  }
  try {
    if (!(await Barcode.getSupportedFormats()).includes("qr_code")) {
      return undefined;
    }
    const detector = new Barcode({ formats: ["qr_code"] });
    return async (source) => (await detector.detect(source))[0]?.rawValue ?? null;
  } catch {
    return undefined;
  }
}

/** The browser's own detector where it has one, jsQR otherwise. */
async function readerFor(): Promise<Reader> {
  reader ??= (await nativeReader()) ?? softReader();
  return reader;
}

function softReader(): Reader {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return async (source) => {
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (!context || !width || !height) {
      return null;
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
  };
}

function cameraProblem(error: unknown): string {
  switch ((error as { name?: string })?.name) {
    case "NotAllowedError":
      return "Camera access was refused. Allow it for the wallet, or choose an image.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found. Choose an image instead.";
    case "NotReadableError":
      return "The camera is in use by another program.";
    default:
      return error instanceof Error && error.message ? error.message : "The camera could not be started.";
  }
}

/** Reads camera frames until `accept` takes a text; returns the function that stops the camera. */
export function startScanner(video: HTMLVideoElement, accept: (text: string) => Promise<boolean>, report: (message: string) => void): () => void {
  let stream: MediaStream | undefined;
  let timer = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    window.clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
  void (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("The camera needs the wallet opened over HTTPS. Choose an image instead.");
      }
      const read = await readerFor();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (stopped) {
        return stop();
      }
      video.srcObject = stream;
      await video.play();
      const frame = async () => {
        if (stopped) {
          return;
        }
        const text = video.readyState >= 2 ? await read(video).catch(() => null) : null;
        if (stopped) {
          return;
        }
        if (text && (await accept(text))) {
          return stop();
        }
        timer = window.setTimeout(frame, FRAME_MILLIS);
      };
      void frame();
    } catch (error) {
      stop();
      report(cameraProblem(error));
    }
  })();
  return stop;
}

export async function readImage(file: File): Promise<string | null> {
  if (!(file.size > 0) || file.size > MAX_IMAGE_BYTES) {
    throw new Error("Choose an image of at most 20 MB.");
  }
  const read = await readerFor();
  const bitmap = await createImageBitmap(file);
  try {
    return await read(bitmap);
  } finally {
    bitmap.close();
  }
}
