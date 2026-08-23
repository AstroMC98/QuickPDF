import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

/**
 * Minimal request helper.
 *
 * Node's global fetch is deliberately avoided here: eSCL over HTTPS uses
 * self-signed certificates on the device itself, and fetch offers no supported
 * way to relax certificate checking per-request. node:https does.
 */
export function request(url, { method = "GET", headers = {}, body, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const isTls = target.protocol === "https:";
    const lib = isTls ? https : http;

    const req = lib.request(
      target,
      {
        method,
        headers,
        // The scanner IS the certificate authority for itself. There is no CA to
        // check against, and the connection never leaves the local network.
        ...(isTls ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
            get text() {
              return Buffer.concat(chunks).toString("utf8");
            },
          }),
        );
      },
    );

    req.setTimeout(timeout, () => req.destroy(new Error(`Timed out after ${timeout}ms`)));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
