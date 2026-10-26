// Identité visuelle Bridgestone (outil interne) : logotype adapté au thème et logo « B ».

import wordmark from '../assets/bridgestone-wordmark.png';
import wordmarkWhite from '../assets/bridgestone-wordmark-blanc.png';
import bMark from '../assets/bridgestone-b.png';

/** Logotype « BRIDGESTONE » : version noire en thème clair, blanche en thème sombre. */
export function Wordmark({ height = 15 }: { height?: number }) {
  return (
    <span className="wordmark" style={{ height }}>
      <img className="wm-light" src={wordmark} alt="Bridgestone" draggable={false} />
      <img className="wm-dark" src={wordmarkWhite} alt="Bridgestone" draggable={false} />
    </span>
  );
}

/** Logo « B ». */
export function BMark({ size = 22 }: { size?: number }) {
  return <img className="b-mark" src={bMark} alt="" aria-hidden="true" width={size} height={size} draggable={false} />;
}
