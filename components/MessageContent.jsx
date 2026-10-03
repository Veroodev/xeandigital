'use client';

import { useMemo } from 'react';
import Markdown from './Markdown';
import CodeBlock from './CodeBlock';
import { parseMessage } from '@/lib/artifacts';

export default function MessageContent({ messageId, content, activeArtifactId, onOpenArtifact }) {
  const segments = useMemo(() => parseMessage(content), [content]);

  return (
    <div className="space-y-3">
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          seg.content.trim() ? <Markdown key={i}>{seg.content}</Markdown> : null
        ) : (
          <CodeBlock
            key={i}
            block={seg}
            active={activeArtifactId === `${messageId}:${seg.index}`}
            onOpen={() => onOpenArtifact(messageId, seg.index)}
          />
        )
      )}
    </div>
  );
}
