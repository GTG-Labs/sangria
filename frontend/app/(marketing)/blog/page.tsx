import Link from "next/link";
import { ArrowLeft, Calendar, Tag, User } from "lucide-react";
import { getAllPosts } from "@/lib/blog";

export const metadata = {
  title: "Blog — Sangria",
  description: "Updates, guides, and deep dives from the Sangria team.",
};

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="max-w-4xl mx-auto px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-zinc-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <div className="mb-12">
          <h1 className="text-4xl md:text-5xl italic font-normal text-gray-900 dark:text-white mb-4">
            Blog
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400">
            Updates, guides, and deep dives from the Sangria team.
          </p>
        </div>

        {posts.length === 0 ? (
          <p className="text-zinc-500 dark:text-zinc-400">
            No posts yet. Check back soon!
          </p>
        ) : (
          <div className="space-y-6">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="card p-6 card-hover block"
              >
                <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                  <span className="inline-flex items-center gap-1">
                    <User className="w-3.5 h-3.5" />
                    {post.author}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {new Date(post.date).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </span>
                  {post.tags.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Tag className="w-3.5 h-3.5" />
                      {post.tags.join(", ")}
                    </span>
                  )}
                </div>
                <h2 className="text-xl italic font-normal text-gray-900 dark:text-white mb-2">
                  {post.title}
                </h2>
                <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
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
