import { Fragment, type ReactNode } from "react";
import { CopyButton, DownloadButton } from "./values.tsx";

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="facts">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** The 24 words, numbered, in the order they must be written down. */
export function Words({ phrase }: { phrase: string }) {
  return (
    <ol className="words">
      {phrase.split(" ").map((word, index) => (
        <li key={index} className="word">
          <span className="word__n">{index + 1}</span>
          <span className="word__w">{word}</span>
        </li>
      ))}
    </ol>
  );
}

export function PhraseButtons({ phrase }: { phrase: string }) {
  return (
    <>
      <CopyButton text={phrase} label="Copy words" />
      <DownloadButton text={`${phrase}\n`} file="tenrai-recovery-phrase.txt" label="Download .txt" />
    </>
  );
}
