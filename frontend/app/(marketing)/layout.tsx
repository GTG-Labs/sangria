import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import GitHubStarChip from "@/components/GitHubStarChip";

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen flex-col">
      <Navigation />
      <div className="flex-1 flex flex-col">{children}</div>
      <Footer />
      <GitHubStarChip />
    </div>
  );
}
