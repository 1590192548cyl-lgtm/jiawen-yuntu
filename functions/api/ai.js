const AI_WORKER_URL = "https://jiawen-ai.1590192548cyl.workers.dev/";

export async function onRequestPost({ request, env }) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let upstream;
  try {
    if (env.AI_WORKER) {
      upstream = await env.AI_WORKER.fetch(request);
    } else {
      upstream = await fetch(AI_WORKER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: new URL(request.url).origin
        },
        body: request.body,
        redirect: "error"
      });
    }
  } catch (error) {
    return Response.json(
      { error: "AI proxy is temporarily unavailable" },
      { status: 502, headers: { "X-AI-Binding": env.AI_WORKER ? "bound" : "unbound" } }
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  if (upstream.headers.get("retry-after")) {
    headers.set("Retry-After", upstream.headers.get("retry-after"));
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers
  });
}

export function onRequestGet() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
