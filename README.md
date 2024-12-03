# check-approve

> A GitHub App that allows you to create [status checks][] that can be manually
> approved through the GitHub UI.

With `check-approve` you can create [status checks][] from GitHub Actions and
manually approve failed checks through the Github UI to mark them successful.
This app addresses a limitation of GitHub workflows where requesting an action
on a check [does not trigger a workflow run][workflow trigger limitation].

[status checks]: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks
[workflow trigger limitation]: https://github.com/orgs/community/discussions/25826#discussioncomment-3249396

## Usage

1. [Install the app] for the organization and repositories you want to use it
2. Add an action that creates a check.

    ```yaml
    - uses: actions/github-script@v7
      with:
        script: |
          const response = await fetch("https://check-approve.axiom.fm/api/check-run", {
            method: "POST",
            body: JSON.stringify({
              name: "approval",
              head_sha: process.env.GITHUB_HEAD_SHA,
              status: "completed",
              conclusion: "failure",
              details_url: "https://axiom.fm",
              output: {
                title: "Approval required",
                summary: "This check requires approval",
              }
            }),
            headers: {
              authorization: `Bearer ${await core.getIDToken("geigerzaehler/check-approve")}`,
            },
          });
          if (!response.ok) {
            console.error(`Failed request ${response.status}`)
            console.error(await response.json())
            process.exit(1)
          }
      env:
        GITHUB_HEAD_SHA: ${{ github.event.pull_request.head.sha }}
    ```

    See the [GitHub REST API docs][] for a list of possible parameters for check
    run creation.

3. Run the workflow containing the action. It creates a failed check with the
   title “Approval required”.
4. Approve the check through the GitHub UI.

[Install the app]: https://github.com/apps/check-approve
[Github REST API docs]: https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28#create-a-check-run--parameters

## License

[ISC](./LICENSE) © 2024 Thomas Scholtes
