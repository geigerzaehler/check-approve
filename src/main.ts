import * as fs from "node:fs/promises";
import * as http from "node:http";
import { createListener } from "./app.js";
import * as httpExt from "./http-ext.js";

if (!process.env.PRIVATE_KEY_PATH) {
	throw new Error("PRIVATE_KEY_PATH environment variable not set");
}

if (!process.env.WEBHOOK_SECRET) {
	throw new Error("WEBHOOK_SECRET environment variable not set");
}

const server = http.createServer(
	createListener({
		webhookSecret: process.env.WEBHOOK_SECRET,
		privateKey: await fs.readFile(process.env.PRIVATE_KEY_PATH, "utf8"),
	}),
);

process.on("SIGTERM", async () => {
	await server[Symbol.asyncDispose]();
	process.exit(0);
});

const address = await httpExt.listen(server, {
	port: process.env.PORT || 8080,
});

console.log(`Server listining on ${address.address}:${address.port}`);
