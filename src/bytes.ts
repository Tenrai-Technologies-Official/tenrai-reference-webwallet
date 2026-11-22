export function base64(data: Uint8Array): string {
  let text = "";
  for (const byte of data) {
    text += String.fromCharCode(byte);
  }
  return btoa(text);
}

export function bytes(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

export function hexOf(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
