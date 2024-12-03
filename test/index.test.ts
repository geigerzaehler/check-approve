import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import http from "node:http";
import type * as nodeNet from "node:net";
import { test } from "node:test";

import * as webhooksMethods from "@octokit/webhooks-methods";
import * as jose from "jose";
import nock from "nock";

import * as App from "../src/app.js";
import * as httpExt from "../src/http-ext.js";

process.env.NODE_ENV = "test";

test("create check run success", async () => {
	using _ = enableNock();
	const jwt = await mockGithubJwt();

	nock("https://api.github.com")
		.get("/repos/OWNER/REPO/installation")
		.reply(200, { id: "12345" })
		.post("/app/installations/12345/access_tokens")
		.reply(200, {})
		.post("/repos/OWNER/REPO/check-runs", {
			name: "foo",
			head_sha: "deadbeef",
			status: "completed",
			conclusion: "success",
			output: {
				title: "TITLE",
			},
			actions: [
				{
					identifier: "approve",
					label: "Approve",
					description: "Approve",
				},
			],
		})
		.reply(200, {
			name: "foo",
			id: "CHECK_RUN_ID",
		});

	await using address = await startSever();

	const response = await fetch(
		`http://localhost:${address.port}/api/check-run`,
		{
			method: "POST",
			headers: {
				Authorization: `bearer ${jwt}`,
			},
			body: JSON.stringify({
				name: "foo",
				head_sha: "deadbeef",
				status: "completed",
				conclusion: "success",
				output: {
					title: "TITLE",
				},
			}),
		},
	);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		name: "foo",
		id: "CHECK_RUN_ID",
	});
});

test("invalid token", async () => {
	using _ = enableNock();
	const jwt = await mockGithubJwt("OTHER AUDIENCE");
	await using address = await startSever();

	let response = await fetch(`http://localhost:${address.port}/api/check-run`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${jwt}`,
		},
	});

	assert.equal(response.status, 403);
	assert.deepEqual(await response.json(), {
		name: "JWTClaimValidationFailed",
		code: "ERR_JWT_CLAIM_VALIDATION_FAILED",
		message: 'unexpected "aud" claim value',
	});

	response = await fetch(`http://localhost:${address.port}/api/check-run`, {
		method: "POST",
	});

	assert.equal(response.status, 403);
	assert.deepEqual(await response.json(), {
		message: "Invalid authorization header",
	});
});

test("webhook sets check sucessful", async () => {
	using _ = enableNock();

	nock("https://api.github.com")
		.post("/app/installations/12345/access_tokens")
		.reply(200, {})
		.patch("/repos/OWNER/REPO/check-runs/56789", {
			status: "completed",
			conclusion: "success",
		})
		.reply(200);

	await using address = await startSever();

	const payload = JSON.stringify({
		action: "check_run.requested_action",
		check_run: { id: "56789" },
		repository: {
			name: "REPO",
			owner: { login: "OWNER" },
		},
		installation: {
			id: "12345",
		},
	});

	const response = await fetch(
		`http://localhost:${address.port}/api/github/webhooks`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-github-delivery": crypto.randomUUID(),
				"x-github-event": "check_run.requested_action",
				"x-hub-signature-256": await webhooksMethods.sign(
					"WEBHOOK_SECRET",
					payload,
				),
			},
			body: payload,
		},
	);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.text(), "ok\n");
});

test("Github API error", async () => {
	using _ = enableNock();
	const jwt = await mockGithubJwt();

	nock("https://api.github.com")
		.get("/repos/OWNER/REPO/installation")
		.reply(200, { id: "12345" })
		.post("/app/installations/12345/access_tokens")
		.reply(200, {})
		.post("/repos/OWNER/REPO/check-runs")
		.reply(400, {
			message: "foo",
		});

	await using address = await startSever();

	const response = await fetch(
		`http://localhost:${address.port}/api/check-run`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${jwt}`,
			},
			body: JSON.stringify({
				name: "foo",
			}),
		},
	);
	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), {
		message: "foo",
	});
});

const appKey = crypto.generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: {
		type: "spki",
		format: "pem",
	},
	privateKeyEncoding: {
		type: "pkcs8",
		format: "pem",
	},
});

async function startSever(): Promise<nodeNet.AddressInfo & AsyncDisposable> {
	const listener = httpExt.sane(
		App.createListener({
			webhookSecret: "WEBHOOK_SECRET",
			privateKey: appKey.privateKey,
		}),
	);
	const server = http.createServer(listener);
	const address = await httpExt.listen(server, { port: 0, host: "127.0.0.1" });
	return {
		...address,
		[Symbol.asyncDispose]: async () => {
			server.closeAllConnections();
			await server[Symbol.asyncDispose]();
		},
	};
}

function enableNock(): Disposable {
	nock.enableNetConnect("localhost");
	return {
		[Symbol.dispose]() {
			nock.cleanAll();
			nock.enableNetConnect();
		},
	};
}

async function mockGithubJwt(audience = "geigerzaehler/check-approve") {
	const tokenKey = await jose.generateKeyPair("PS256");

	nock("https://token.actions.githubusercontent.com")
		.get("/.well-known/jwks")
		.reply(200, {
			keys: [await jose.exportJWK(tokenKey.publicKey)],
		});

	return await new jose.SignJWT({
		repository: "OWNER/REPO",
	})
		.setProtectedHeader({ alg: "PS256" })
		.setIssuedAt()
		.setIssuer("https://token.actions.githubusercontent.com")
		.setAudience(audience)
		.setExpirationTime("1min")
		.sign(tokenKey.privateKey);
}
