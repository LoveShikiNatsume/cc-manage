import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  content: string;
  compact?: boolean;
}

export default function MarkdownView({ content, compact = false }: Props) {
  return (
    <div className={compact ? 'markdown-view markdown-view-compact' : 'markdown-view'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a
              {...props}
              className="text-blue-600 underline underline-offset-2 hover:text-blue-700"
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),
          code: ({ children, className, ...props }) => {
            const isBlock = className?.startsWith('language-');
            if (isBlock) {
              return (
                <code {...props} className={`${className ?? ''} block overflow-x-auto`}>
                  {children}
                </code>
              );
            }
            return (
              <code
                {...props}
                className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.92em] text-gray-800"
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-gray-200 bg-gray-50 px-2 py-1 text-left font-medium text-gray-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-200 px-2 py-1 align-top text-gray-700">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
