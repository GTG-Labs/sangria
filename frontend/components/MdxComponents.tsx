import type { MDXComponents } from "mdx/types";

export const mdxComponents: MDXComponents = {
  h1: (props) => (
    <h1
      className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mt-8 mb-4"
      {...props}
    />
  ),
  h2: (props) => (
    <h2
      className="text-xl md:text-2xl font-semibold text-gray-900 dark:text-white mt-8 mb-3"
      {...props}
    />
  ),
  h3: (props) => (
    <h3
      className="text-lg font-semibold text-gray-900 dark:text-white mt-6 mb-2"
      {...props}
    />
  ),
  p: (props) => (
    <p
      className="text-gray-700 dark:text-zinc-300 leading-relaxed mb-4"
      {...props}
    />
  ),
  a: (props) => (
    <a
      className="text-sangria-500 hover:underline transition-colors"
      {...props}
    />
  ),
  ul: (props) => (
    <ul
      className="list-disc pl-6 text-gray-700 dark:text-zinc-300 mb-4 space-y-1"
      {...props}
    />
  ),
  ol: (props) => (
    <ol
      className="list-decimal pl-6 text-gray-700 dark:text-zinc-300 mb-4 space-y-1"
      {...props}
    />
  ),
  li: (props) => <li className="leading-relaxed" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="border-l-2 border-zinc-300 dark:border-zinc-700 pl-4 my-4 text-zinc-600 dark:text-zinc-400"
      {...props}
    />
  ),
  code: (props) => {
    const isInline = typeof props.children === "string";
    if (isInline) {
      return (
        <code
          className="text-sm font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded"
          {...props}
        />
      );
    }
    return <code {...props} />;
  },
  pre: (props) => (
    <pre
      className="bg-zinc-950 text-zinc-100 font-mono rounded-lg p-4 overflow-x-auto mb-4 text-sm leading-relaxed"
      {...props}
    />
  ),
  table: (props) => (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm" {...props} />
    </div>
  ),
  th: (props) => (
    <th
      className="text-left text-gray-900 dark:text-white bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-3 py-2 font-semibold"
      {...props}
    />
  ),
  td: (props) => (
    <td
      className="border-b border-zinc-100 dark:border-zinc-800 px-3 py-2 text-gray-700 dark:text-zinc-300"
      {...props}
    />
  ),
  hr: () => <hr className="border-zinc-200 dark:border-zinc-800 my-8" />,
  strong: (props) => (
    <strong
      className="text-gray-900 dark:text-white font-semibold"
      {...props}
    />
  ),
  img: (props) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="rounded-lg my-4 max-w-full" alt="" {...props} />
  ),
};
