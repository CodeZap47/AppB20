import { useMemo } from 'react';
import { Link } from 'react-router';
import { useSnapshot } from '../data/DataContext';
import { memberName } from '../lib/format';
import { mentionParts } from '../lib/chat';
import { parseMessageText } from '../lib/messages';

/** Texto de un mensaje con bloques de código, código en línea y enlaces. No interpreta HTML. */
export function MessageText({ text }: { text: string }) {
  const { members, me } = useSnapshot();
  const blocks = useMemo(() => parseMessageText(text), [text]);
  return (
    <>
      {blocks.map((block, i) =>
        block.kind === 'code' ? (
          <pre key={i} className="bubble__code mono">
            {block.text}
          </pre>
        ) : (
          <p key={i} className="bubble__text">
            {block.parts.map((part, j) =>
              part.kind === 'link' ? (
                <a key={j} href={part.href} target="_blank" rel="noopener noreferrer">
                  {part.text}
                </a>
              ) : part.kind === 'code' ? (
                <code key={j} className="mono">
                  {part.text}
                </code>
              ) : (
                mentionParts(part.text).map((piece, k) => piece.kind === 'mention' ? (
                  <Link key={`${j}-${k}`} className={piece.memberId === me?.id ? 'mention mention--me' : 'mention'} to={`/perfil/${piece.memberId}`}>
                    @{memberName(members, piece.memberId)}
                  </Link>
                ) : piece.text)
              ),
            )}
          </p>
        ),
      )}
    </>
  );
}
