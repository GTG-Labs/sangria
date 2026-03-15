import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, Tag } from "lucide-react";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getAllSlugs, getPostBySlug } from "@/lib/blog";
import { mdxComponents } from "@/components/MdxComponents";

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};

  return {
    title: `${post.title} — Sangria Blog`,
    description: post.description,
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  return (
    <div className="min-h-screen pt-24 pb-20">
      <div className="max-w-3xl mx-auto px-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-zinc-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Blog
        </Link>

        <header className="mb-10">
          <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {new Date(post.date).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
            {post.tags.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Tag className="w-4 h-4" />
                {post.tags.join(", ")}
              </span>
            )}
          </div>
          <h1 className="text-3xl md:text-5xl italic font-normal text-gray-900 dark:text-white leading-tight mb-4">
            {post.title}
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed">
            {post.description}
          </p>
          <hr className="border-zinc-200 dark:border-white/10 mt-8" />
        </header>

        <article>
          <MDXRemote source={post.source} components={mdxComponents} />
        </article>
      </div>
    </div>
  );
}
