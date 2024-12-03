import type * as http from "node:http";
import { json } from "node:stream/consumers";
import { createNodeMiddleware } from "@octokit/webhooks";
import * as jose from "jose";
import * as octokit from "octokit";
import * as rt from "runtypes";

import * as httpExt from "./http-ext.js";

export function createListener({
	webhookSecret,
	privateKey,
}: {
	privateKey: string;
	webhookSecret: string;
}): httpExt.RequestListener {
	let Octokit: typeof octokit.Octokit = octokit.Octokit;

	if (process.env.NODE_ENV === "test") {
		Octokit = octokit.Octokit.defaults({
			throttle: { enabled: false },
			retry: { enabled: false },
		});
	}

	const app = new octokit.App({
		appId: "898950",
		privateKey,
		webhooks: {
			secret: webhookSecret,
		},
		Octokit,
	});

	app.webhooks.on("check_run.requested_action", async (event) => {
		if (!event.payload.installation) {
			throw new Error("No installation provided with webhoook");
		}
		const client = await app.getInstallationOctokit(
			event.payload.installation.id,
		);

		await client.request(
			"PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
			{
				owner: event.payload.repository.owner.login,
				repo: event.payload.repository.name,
				check_run_id: event.payload.check_run.id,
				status: "completed",
				conclusion: "success",
			},
		);
		console.log("END");
	});

	const handleWebhooks = createNodeMiddleware(app.webhooks);

	return httpExt.sane(
		httpExt.dispatcher([checkRunPostRoute(app), handleWebhooks]),
	);
}

function checkRunPostRoute(app: octokit.App) {
	return httpExt.path("POST", "/api/check-run", async (req, res) => {
		const jwtClaims = await githubJwtAuthenticate(req);

		// biome-ignore lint/suspicious/noExplicitAny: <explanation>
		const data: any = await json(req).catch((err) => {
			throw httpExt.HttpError.json(
				400,
				{
					message: "Failed to parse request body as JSON",
				},
				{ cause: err },
			);
		});

		if (typeof data !== "object" && data) {
			throw httpExt.HttpError.json(400, {
				name: "Request body must be an object",
			});
		}

		const [owner, repo] = jwtClaims.repository.split("/");
		const installationResponse = await app.octokit.request(
			"GET /repos/{owner}/{repo}/installation",
			{
				owner,
				repo,
			},
		);

		const octo = await app.getInstallationOctokit(installationResponse.data.id);

		const createResponse = await octo
			.request("POST /repos/{owner}/{repo}/check-runs", {
				...data,
				owner,
				repo,
				actions: [
					{
						identifier: "approve",
						label: "Approve",
						description: "Approve",
					},
				],
			})
			.catch((error) => {
				if (error instanceof octokit.RequestError) {
					// TODO log
					return {
						status: error.status,
						data: error.response?.data,
					};
				}

				throw error;
			});

		res.statusCode = createResponse.status;
		res.end(JSON.stringify(createResponse.data));
	});
}

const ghTokenClaimsSchema = rt.Record({
	repository: rt.String,
});

type GhTokenClaims = rt.Static<typeof ghTokenClaimsSchema>;

async function githubJwtAuthenticate(
	req: http.IncomingMessage,
): Promise<GhTokenClaims> {
	const jwkSet = jose.createRemoteJWKSet(
		new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
	);

	const match = req.headers.authorization?.match(/^Bearer (\S+)$/i);
	if (!match) {
		throw httpExt.HttpError.json(403, {
			message: "Invalid authorization header",
		});
	}

	const jwt = await jose
		.jwtVerify(match[1], jwkSet, {
			audience: "geigerzaehler/check-approve",
			issuer: "https://token.actions.githubusercontent.com",
		})
		.catch((error) => {
			if (error instanceof jose.errors.JOSEError) {
				throw httpExt.HttpError.json(
					403,
					{ name: error.name, code: error.code, message: error.message },
					{
						cause: error,
					},
				);
			}

			throw error;
		});

	return ghTokenClaimsSchema.check(jwt.payload);
}
