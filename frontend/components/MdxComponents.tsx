import type { MDXComponents } from "mdx/types";

export const mdxComponents: MDXComponents = {
  // Override default elements for consistent styling
  h1: (props) => (
    <h1
      className="text-3xl md:text-4xl italic font-normal text-gray-900 dark:text-white mt-10 mb-4"
      {...props}
    />
  ),
  h2: (props) => (
    <h2
      className="text-2xl italic font-normal text-gray-900 dark:text-white mt-10 mb-3 border-b border-zinc-100 dark:border-white/5 pb-2"
      {...props}
    />
  ),
  h3: (props) => (
    <h3
      className="text-xl italic font-normal text-gray-900 dark:text-white mt-8 mb-3"
      {...props}
    />
  ),
  p: (props) => (
    <p
      className="text-zinc-600 dark:text-zinc-400 leading-relaxed mb-4"
      {...props}
    />
  ),
  a: (props) => (
    <a
      className="text-sangria-500 hover:text-sangria-300 transition-colors"
      {...props}
    />
  ),
  ul: (props) => (
    <ul
      className="list-disc pl-6 text-zinc-600 dark:text-zinc-400 mb-4 space-y-1"
      {...props}
    />
  ),
  ol: (props) => (
    <ol
      className="list-decimal pl-6 text-zinc-600 dark:text-zinc-400 mb-4 space-y-1"
      {...props}
    />
  ),
  li: (props) => <li className="leading-relaxed" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="border-l-4 border-sangria-500 bg-sangria-500/5 py-3 px-4 my-4 text-zinc-700 dark:text-zinc-300 rounded-r-lg"
      {...props}
    />
  ),
  code: (props) => {
    // Inline code (not inside a pre block)
    const isInline = typeof props.children === "string";
    if (isInline) {
      return (
        <code
          className="text-sangria-500 bg-zinc-100 dark:bg-white/5 px-1.5 py-0.5 rounded font-mono text-sm"
          {...props}
        />
      );
    }
    return <code {...props} />;
  },
  pre: (props) => (
    <pre
      className="bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5 rounded-xl p-4 overflow-x-auto mb-4 text-sm leading-relaxed"
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
      className="text-left text-gray-900 dark:text-white bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 px-3 py-2 font-semibold"
      {...props}
    />
  ),
  td: (props) => (
    <td
      className="border border-zinc-200 dark:border-white/5 px-3 py-2 text-zinc-600 dark:text-zinc-400"
      {...props}
    />
  ),
  hr: () => <hr className="border-zinc-200 dark:border-white/10 my-8" />,
  strong: (props) => (
    <strong
      className="text-gray-900 dark:text-white font-semibold"
      {...props}
    />
  ),
  img: (props) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="rounded-xl my-4 max-w-full" alt="" {...props} />
  ),
};
