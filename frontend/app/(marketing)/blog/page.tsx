import Link from "next/link";
import { getAllPosts } from "@/lib/blog";
import BlogHeader from "@/components/BlogHeader";

export const metadata = {
  title: "Blog — Sangria",
  description: "Updates, guides, and deep dives from the Sangria team.",
};

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div className="pt-12">
      {/* Header with ballpit */}
      <BlogHeader />

      {/* Card grid */}
      <div className="max-w-6xl mx-auto px-6 pb-20">
        {posts.length === 0 ? (
          <p className="text-zinc-500 dark:text-zinc-400 text-center py-20">
            No posts yet. Check back soon!
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 border-t border-l border-zinc-200 dark:border-zinc-800">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="group border-b border-r border-zinc-200 dark:border-zinc-800 p-6 transition-all duration-200 hover:bg-[rgb(21,21,21)] hover:border-[rgb(21,21,21)]"
              >
                {post.tags[0] && (
                  <span className="text-[0.6875rem] font-bold uppercase tracking-wide text-sangria-500 group-hover:text-sangria-400 transition-colors duration-200">
                    {post.tags[0]}
                  </span>
                )}

                <h2 className="text-base font-semibold text-gray-900 dark:text-white mt-2 mb-2 leading-snug transition-colors duration-200 group-hover:text-[rgb(234,235,224)]">
                  {post.title}
                </h2>

                <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-3 transition-colors duration-200 group-hover:text-[rgb(234,235,224)]/60">
                  {post.author} · {new Date(post.date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>

                <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-3 transition-colors duration-200 group-hover:text-[rgb(234,235,224)]/70">
                  {post.description}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
