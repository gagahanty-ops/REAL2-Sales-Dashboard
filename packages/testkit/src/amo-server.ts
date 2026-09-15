import { createServer } from "node:http";

type PagePayload = object;

export type AmoMockRequest = Readonly<{
  method: string;
  pathname: string;
  page: number;
}>;

export type AmoMockServer = Readonly<{
  origin: string;
  requests: AmoMockRequest[];
  failPage(pathname: string, page: number, status: number, times: number): void;
  close(): Promise<void>;
}>;

export async function createAmoMockServer(
  pages: Readonly<Record<string, readonly PagePayload[]>>,
): Promise<AmoMockServer> {
  const requests: AmoMockRequest[] = [];
  const failures = new Map<string, { status: number; remaining: number }>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const page = Number(url.searchParams.get("page") ?? "1");
    const method = request.method ?? "GET";
    requests.push({ method, pathname: url.pathname, page });

    const failureKey = `${url.pathname}:${page}`;
    const failure = failures.get(failureKey);
    if (failure && failure.remaining > 0) {
      failure.remaining -= 1;
      response.writeHead(failure.status, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "synthetic_failure" }));
      return;
    }

    const payload = pages[url.pathname]?.[page - 1];
    if (!payload) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "synthetic_not_found" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Synthetic amoCRM server did not bind a TCP port");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    failPage(pathname, page, status, times) {
      failures.set(`${pathname}:${page}`, { status, remaining: times });
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}
