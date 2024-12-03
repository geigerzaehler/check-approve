# /// script
# dependencies = ["requests"]
# ///

import requests
import os

response = requests.get(
    os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"],
    params={"audience": "geigerzaehler/check-approve"},
    headers={"authorization": f"Bearer {os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']}"},
)
response.raise_for_status()
id_token = response.json()["value"]

r = requests.post(
    "https://check-approve.axiom.fm/api/check-run",
    headers={"authorization": f"Bearer ${id_token}"},
    json={
        "name": "screenshot-comparison",
        "head_sha": os.environ["GITHUB_HEAD_SHA"],
        "status": "completed",
        "conclusion": "success",
        "output": {"title": "TITLE", "summary": ""},
    },
)
