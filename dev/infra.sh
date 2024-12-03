#!/bin/bash

set -euo pipefail

export CLOUDSDK_CORE_PROJECT="geigerzaehler-dev"
export CLOUDSDK_RUN_REGION="europe-west1"
export CLOUDSDK_ARTIFACTS_LOCATION="europe-west1"

# TODO: update Github App configuration (title, description, public key, webhook
# secret)

SERVICE_NAME="check-approve"
RUN_SERVICE_ACCOUNT_NAME="check-approve"
RUN_SERVICE_ACCOUNT_EMAIL="${RUN_SERVICE_ACCOUNT_NAME}@${CLOUDSDK_CORE_PROJECT}.iam.gserviceaccount.com"
APP_KEY_SECRET_NAME="check-approve-app-private-key"
WEBHOOK_SECRET_NAME="check-approve-webhook-secret"

project_number=$(gcloud projects describe $CLOUDSDK_CORE_PROJECT --format="value(projectNumber)")

service_account_exists=$(gcloud iam service-accounts list --filter="email:$RUN_SERVICE_ACCOUNT_EMAIL" --format="value(email)")
if [[ -z "$service_account_exists" ]]; then
	echo "Creating service account ${RUN_SERVICE_ACCOUNT_EMAIL}"
	gcloud iam service-accounts create \
		"${RUN_SERVICE_ACCOUNT_EMAIL}" \
		--display-name "Service account for run/check-approve"
fi

app_key_secret_exists=$(gcloud secrets list --filter="name:$APP_KEY_SECRET_NAME" --format="value(name)")
if [[ -z "$app_key_secret_exists" ]]; then
	echo "Creating secret/$APP_KEY_SECRET_NAME."
	gcloud secrets create \
		"$APP_KEY_SECRET_NAME" \
		--replication-policy="automatic"
fi

# TODO: generate update app key secret if provided

webhook_secret_exists=$(gcloud secrets list --filter="name:$WEBHOOK_SECRET_NAME" --format="value(name)")
if [[ -z "$webhook_secret_exists" ]]; then
	echo "Creating secret/$WEBHOOK_SECRET_NAME."
	gcloud secrets create \
		"$WEBHOOK_SECRET_NAME" \
		--replication-policy="automatic"
fi

if [[ -n "${WEBHOOK_SECRET:-}" ]]; then
	echo "Updating secret/$WEBHOOK_SECRET_NAME."
	gcloud secrets versions add \
		"$WEBHOOK_SECRET_NAME" \
		--data-file=- < <(echo -n "${WEBHOOK_SECRET}")
fi

gcloud secrets add-iam-policy-binding "$APP_KEY_SECRET_NAME" \
	--member="serviceAccount:$RUN_SERVICE_ACCOUNT_EMAIL" \
	--role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding "$WEBHOOK_SECRET_NAME" \
	--member="serviceAccount:$RUN_SERVICE_ACCOUNT_EMAIL" \
	--role="roles/secretmanager.secretAccessor"

gcloud run services replace <(
	WEBHOOK_SECRET_NAME=${WEBHOOK_SECRET_NAME} \
		APP_KEY_SECRET_NAME=${APP_KEY_SECRET_NAME} \
		RUN_SERVICE_ACCOUNT_EMAIL=${RUN_SERVICE_ACCOUNT_EMAIL} \
		envsubst <knative-service.yaml
)

# Github Actions permissions
{
	gha_pool_id="iam.googleapis.com/projects/${project_number}/locations/global/workloadIdentityPools/github-actions"
	gha_deploy_principal="principal://${gha_pool_id}/subject/repo:geigerzaehler/check-approve:environment:production"

	# Github Actions deployment can update `run/check-approve`
	gcloud run services add-iam-policy-binding \
		"$SERVICE_NAME" \
		--member "${gha_deploy_principal}" \
		--role roles/run.developer

	# Github Actions deployment can push act as `run/check-approve`
	gcloud iam service-accounts add-iam-policy-binding \
		"$RUN_SERVICE_ACCOUNT_EMAIL" \
		--member "${gha_deploy_principal}" \
		--role roles/iam.serviceAccountUser

	# Github Actions deployment can update image tags
	gcloud artifacts repositories add-iam-policy-binding \
		"check-approve" \
		--member "${gha_deploy_principal}" \
		--role roles/artifactregistry.createOnPushRepoAdmin

	# Github Actions can push image `check-approve/check-approve`
	gcloud artifacts repositories add-iam-policy-binding \
		"check-approve" \
		--member "principalSet://${gha_pool_id}/attribute.repository/geigerzaehler/check-approve" \
		--role roles/artifactregistry.createOnPushWriter
}
