export default function Home() {
  return (
    <main style={{ fontFamily: "monospace", padding: "2rem" }}>
      <h1>Sangria Merchant — Next.js</h1>
      <p>Routes:</p>
      <ul>
        <li>
          <code>GET /</code> → free (this page)
        </li>
        <li>
          <code>GET /premium</code> → $0.01 (fixed)
        </li>
        <li>
          <code>GET /api/search?q=...</code> → up to $0.10 (variable)
        </li>
      </ul>
    </main>
  );
}
