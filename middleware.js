// Vercel Routing Middleware: handles POST /api/notebook at the project root (no folders needed).
// Requires the ANTHROPIC_API_KEY environment variable (Vercel → Project → Settings → Environment Variables).
// Optional: ANTHROPIC_MODEL to override the default model.

export const config = { matcher: "/api/notebook" };

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const MAX_INPUT = 1200;

function briefPrompt(question, known) {
  return `You are the research notebook in Synthesize, a virtual pharmacology laboratory used for education and early computational exploration. A user described a disease target or a therapeutic goal. Propose one hypothetical candidate compound profile and the computational experiment that would test it.

Be accurate and conservative. Describe chemical classes, physical properties and general medicinal-chemistry reasoning only. Never give dosing advice, never claim a compound is safe or effective, never describe how to make controlled, toxic or dangerous substances, and never present anything as medical advice. If the request is not about pharmacology or biology, or is asking for something harmful, say so briefly in the "candidate" field and keep the other fields short.

Target or goal: ${question}
${known ? "Constraints: " + known : ""}

Reply with only a JSON object, no prose or code fences:
{"title": "short title, under 9 words",
 "candidate": "2-3 sentences describing the hypothetical compound class and how it would act",
 "properties": [{"symbol": "logP", "meaning": "target range and why"}],
 "experiment": ["3-5 short steps of a computational experiment"],
 "prediction": "one sentence on the outcome expected if the idea holds",
 "risk": "one sentence on the property or liability most likely to sink it",
 "limitations": "1-2 sentences on what a simulation cannot establish here",
 "lab": "the closest Synthesize experiment: molecule, synthesis, binding, pk, or null"}`;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export default async function middleware(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "Server is missing ANTHROPIC_API_KEY" }, 500);

  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const q = String(body.question || "").trim(), k = String(body.known || "").trim();
  if (body.kind !== "brief" || !q || q.length > MAX_INPUT || k.length > MAX_INPUT) return json({ error: "Invalid input" }, 400);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages: [{ role: "user", content: briefPrompt(q, k) }] })
    });
    if (r.status === 429) return json({ error: "Rate limited", code: "rate_limited" }, 429);
    if (!r.ok) return json({ error: "Upstream error" }, 502);
    const data = await r.json();
    const text = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("").replace(/```json|```/g, "").trim();
    const result = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return json({ result });
  } catch (e) {
    return json({ error: "Could not generate a response" }, 502);
  }
}
