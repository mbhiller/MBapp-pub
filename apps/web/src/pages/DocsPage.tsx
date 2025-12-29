import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Map of doc slugs to their file paths and display names
const DOCS = {
  foundations: {
    title: "Foundations",
    path: "/docs/MBapp-Foundations.md",
  },
  roadmap: {
    title: "Roadmap",
    path: "/docs/MBapp-Roadmap-Master-v10.0.md",
  },
  status: {
    title: "Status",
    path: "/docs/MBapp-Working.md",
  },
  "smoke-coverage": {
    title: "Smoke Coverage",
    path: "/docs/smoke-coverage.md",
  },
} as const;

type DocSlug = keyof typeof DOCS;

export default function DocsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentDoc = (searchParams.get("doc") as DocSlug) || "foundations";
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const docConfig = DOCS[currentDoc];
    if (!docConfig) {
      setError(`Unknown doc: ${currentDoc}`);
      return;
    }

    setLoading(true);
    setError(null);

    // Fetch markdown from the repo or local public folder
    // In dev/prod, markdown files should be served from public/ or fetched from repo
    const repoBase = import.meta.env.VITE_MBAPP_DOCS_BASE_URL || "https://raw.githubusercontent.com/mbhiller/MBapp-pub/main";
    const url = `${repoBase}${docConfig.path}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        return res.text();
      })
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        setError(err?.message || "Failed to load doc");
        setLoading(false);
      });
  }, [currentDoc]);

  const handleDocChange = (slug: DocSlug) => {
    setSearchParams({ doc: slug });
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 120px)", gap: 16 }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 220,
          background: "#fff",
          borderRight: "1px solid #ddd",
          padding: 16,
          overflowY: "auto",
        }}
      >
        <h3 style={{ margin: "0 0 12px 0", fontSize: 16 }}>Documentation</h3>
        <nav style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.entries(DOCS).map(([slug, { title }]) => (
            <button
              key={slug}
              onClick={() => handleDocChange(slug as DocSlug)}
              style={{
                padding: "8px 12px",
                textAlign: "left",
                border: "1px solid #ddd",
                background: currentDoc === slug ? "#0b3d91" : "#fff",
                color: currentDoc === slug ? "#fff" : "#111",
                cursor: "pointer",
                borderRadius: 4,
                fontSize: 14,
              }}
            >
              {title}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          background: "#fff",
          padding: 24,
          overflowY: "auto",
          borderRadius: 4,
        }}
      >
        {loading && <div>Loading...</div>}
        {error && <div style={{ color: "#b00020" }}>Error: {error}</div>}
        {!loading && !error && (
          <article
            style={{
              maxWidth: 900,
              lineHeight: 1.6,
              fontSize: 15,
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Customize heading styles
                h1: ({ ...props }) => <h1 style={{ borderBottom: "2px solid #ddd", paddingBottom: 8, marginTop: 24 }} {...props} />,
                h2: ({ ...props }) => <h2 style={{ borderBottom: "1px solid #eee", paddingBottom: 6, marginTop: 20 }} {...props} />,
                h3: ({ ...props }) => <h3 style={{ marginTop: 16 }} {...props} />,
                // Style code blocks
                code: ({ inline, ...props }: any) =>
                  inline ? (
                    <code style={{ background: "#f5f5f5", padding: "2px 6px", borderRadius: 3, fontSize: 14 }} {...props} />
                  ) : (
                    <code style={{ display: "block", background: "#f5f5f5", padding: 12, borderRadius: 4, overflowX: "auto", fontSize: 13 }} {...props} />
                  ),
                // Style tables
                table: ({ ...props }) => (
                  <div style={{ overflowX: "auto", margin: "16px 0" }}>
                    <table style={{ borderCollapse: "collapse", width: "100%" }} {...props} />
                  </div>
                ),
                th: ({ ...props }) => <th style={{ border: "1px solid #ddd", padding: 8, background: "#f5f5f5", textAlign: "left" }} {...props} />,
                td: ({ ...props }) => <td style={{ border: "1px solid #ddd", padding: 8 }} {...props} />,
                // Style links
                a: ({ ...props }) => <a style={{ color: "#0b3d91", textDecoration: "underline" }} {...props} />,
                // Style blockquotes
                blockquote: ({ ...props }) => (
                  <blockquote style={{ borderLeft: "4px solid #ddd", paddingLeft: 16, margin: "16px 0", color: "#555" }} {...props} />
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </article>
        )}
      </main>
    </div>
  );
}
