import assert from "node:assert/strict";
import type * as http from "node:http";
import type * as net from "node:net";

export type RequestListener = (
	req: http.IncomingMessage,
	res: http.ServerResponse,
) => Promise<void> | void;

type Handler = (
	req: http.IncomingMessage,
	res: http.ServerResponse,
) => Promise<boolean | undefined> | undefined;

export function dispatcher(
	handlers: Iterable<Handler>,
	fallback: http.RequestListener = defaultFallback,
): http.RequestListener {
	return async function dispatch(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	) {
		for (const handle of handlers) {
			if ((await handle(req, res)) !== false) {
				return;
			}
		}

		fallback(req, res);
	};
}

export function sane(listener: RequestListener): RequestListener {
	return handleErrors(ensureResponse(listener));
}

function handleErrors(listener: RequestListener): RequestListener {
	return async function handleErrors(req, res) {
		try {
			await listener(req, res);
		} catch (error) {
			if (error instanceof HttpError) {
				error.send(res);
			} else {
				console.error(new Error("Request handler error", { cause: error }));
				res.statusCode = 500;
				res.end("");
			}
		}
	};
}

function ensureResponse(
	listener: RequestListener,
	{ responseFinishTimeout = 10_000 } = {},
): RequestListener {
	return async function ensureResponse(req, res) {
		await listener(req, res);
		if (res.writableEnded) {
			return;
		}
		let cleanup: (() => void) | undefined;
		try {
			await new Promise((resolve, reject) => {
				const onPrefinish = () => resolve(undefined);
				res.once("error", reject);
				res.once("prefinish", () => {
					resolve(undefined);
				});
				const timeout = setTimeout(() => {
					reject(new Error("Timeout while handling request"));
				}, responseFinishTimeout);
				cleanup = () => {
					clearTimeout(timeout);
					res.off("prefinish", onPrefinish);
					res.off("error", reject);
				};
			});
		} finally {
			cleanup?.();
		}
	};
}

function defaultFallback(req: http.IncomingMessage, res: http.ServerResponse) {
	res.statusCode = 404;
	res.end("Not found");
}

export function path(
	method: "GET" | "POST" | "PUT",
	path: string,
	handle: RequestListener,
): Handler {
	return async (req: http.IncomingMessage, res: http.ServerResponse) => {
		assert(req.url);
		const url = new URL(req.url, "http://localhost");
		if (req.method === method && url.pathname === path) {
			await handle(req, res);
		} else {
			return false;
		}
	};
}

export class HttpError extends Error {
	public statusCode: number;
	public body: string | undefined;
	public headers: Headers;

	constructor(
		statusCode: number,
		{
			headers,
			body,
			cause,
		}: { headers?: Headers; body?: string; cause?: Error } = {},
	) {
		super("", { cause });
		this.statusCode = statusCode;
		this.headers = new Headers(headers);
		this.body = body;
	}

	static json(
		statusCode: number,
		body: unknown,
		{
			headers,
			cause,
		}: { headers?: Headers; body?: string; cause?: Error } = {},
	) {
		headers = new Headers(headers);
		if (!headers.has("content-type")) {
			headers.set("content-type", "application/json");
		}
		return new HttpError(statusCode, {
			headers,
			body: JSON.stringify(body),
			cause,
		});
	}

	send(res: http.ServerResponse) {
		res.statusCode = this.statusCode;
		res.setHeaders(this.headers);
		res.end(this.body);
	}
}

export async function listen(
	server: http.Server,
	options: {
		port?: number | string;
		host?: string;
	},
): Promise<net.AddressInfo & AsyncDisposable> {
	await new Promise((resolve, reject) => {
		server.listen(options, () => resolve(undefined));
		server.once("error", reject);
	});
	const address = server.address();
	assert(address && typeof address === "object");
	return {
		...address,
		[Symbol.asyncDispose]: async () => {
			await server[Symbol.asyncDispose]();
		},
	};
}
