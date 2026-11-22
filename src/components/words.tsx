import { addressVerificationWords } from "@tenrai/sdk";
import { Hint } from "./hint.tsx";

/** The six verification words of an address, or undefined when it is no address. */
export function wordsOf(address: string): string | undefined {
  try {
    return addressVerificationWords(address).join(" · ");
  } catch {
    return undefined;
  }
}

/** An address's verification words, with a note that they are no recovery phrase. */
export function VerificationWords({ address }: { address: string }) {
  const words = wordsOf(address);
  if (!words) {
    return null;
  }
  return (
    <div className="verify-words">
      <span className="field__k hint-line">
        Address Verification Words
        <Hint label="About the verification words">These words are public and are not your recovery phrase.</Hint>
      </span>
      <span className="verify-words__list">{words}</span>
    </div>
  );
}
