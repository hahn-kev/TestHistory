#!/usr/bin/env python3
import os
import sys
import glob
import datetime
import subprocess
import tempfile
import urllib.parse
import urllib.request
import urllib.error
import json
import shutil


def _gh_api(method, url, token, body=None):
    """Call the GitHub REST API. Returns (status_code, parsed_json_or_None).

    Never raises for HTTP error statuses — returns them so the caller can decide
    whether a failure (e.g. 403 for a missing `checks: write` permission) should
    be a soft warning rather than a hard failure of the upload.
    """
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="ignore") if e.fp else ""
        try:
            parsed = json.loads(raw) if raw else None
        except Exception:
            parsed = {"message": raw}
        return e.code, parsed


def upsert_check(server_url, project_id, run_id, run_key, commit, counts, started_at):
    """Create — or update, if it already exists for this build — a GitHub check run
    that links to the run on the TestHistory server.

    Deduplication: the check's `external_id` is set to the run key, which is unique
    per build and shared by every invocation of this action within that build. So we
    list the commit's check runs by name, and if one already carries this run key we
    PATCH it instead of creating a second check. This holds across steps and jobs.

    Failures here never fail the upload — the most common case is a workflow that
    hasn't granted `checks: write` (or a forked PR's read-only token), which we
    surface as a warning.
    """
    token = os.environ.get("INPUT_GITHUB_TOKEN", "")
    check_name = os.environ.get("INPUT_CHECK_NAME", "TestHistory") or "TestHistory"
    api_url = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")
    repo = os.environ.get("GITHUB_REPOSITORY", "")

    if not token:
        print("::warning::create-check is enabled but no github-token was provided; skipping check creation.")
        return None
    if not repo:
        print("::warning::GITHUB_REPOSITORY is not set; skipping check creation.")
        return None
    if not commit:
        print("::warning::No commit SHA available; skipping check creation.")
        return None

    total = counts["total"]
    passed = counts["passed"]
    failed = counts["failed"]
    errored = counts["errored"]
    skipped = counts["skipped"]

    if failed or errored:
        conclusion = "failure"
    elif total == 0:
        conclusion = "neutral"
    else:
        conclusion = "success"

    parts = [f"{passed} passed"]
    if failed:
        parts.append(f"{failed} failed")
    if errored:
        parts.append(f"{errored} errored")
    if skipped:
        parts.append(f"{skipped} skipped")
    title = ", ".join(parts)

    details_url = f"{server_url}/projects/{urllib.parse.quote(str(project_id))}/runs/{urllib.parse.quote(str(run_id))}"
    completed_at = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    # NOTE: GitHub ignores `details_url` for check runs created with the Actions
    # GITHUB_TOKEN (it only honors it for GitHub App tokens), so the check row/Details
    # link won't navigate to TestHistory. We therefore lead the summary with a large,
    # obvious heading link so there's always a one-click path from the check output.
    summary = (
        f"## ▶️ [View this run on TestHistory]({details_url})\n\n"
        f"| Total | Passed | Failed | Errored | Skipped |\n"
        f"| ---: | ---: | ---: | ---: | ---: |\n"
        f"| {total} | {passed} | {failed} | {errored} | {skipped} |\n\n"
        f"[Open the full run on TestHistory →]({details_url})\n"
    )
    output = {"title": title, "summary": summary}

    # Look for an existing check for this build (matched by run key in external_id).
    existing_id = None
    list_url = (
        f"{api_url}/repos/{repo}/commits/{urllib.parse.quote(str(commit))}/check-runs"
        f"?check_name={urllib.parse.quote(check_name)}&per_page=100"
    )
    status, listed = _gh_api("GET", list_url, token)
    if status == 200 and isinstance(listed, dict):
        for cr in listed.get("check_runs", []):
            if run_key and cr.get("external_id") == run_key:
                existing_id = cr.get("id")
                break
    elif status in (401, 403):
        print(f"::warning::Cannot access the Checks API (HTTP {status}). Grant `checks: write` to enable the run check. Skipping.")
        return None

    if existing_id:
        patch_url = f"{api_url}/repos/{repo}/check-runs/{existing_id}"
        body = {
            "status": "completed",
            "conclusion": conclusion,
            "completed_at": completed_at,
            "details_url": details_url,
            "output": output,
        }
        status, _ = _gh_api("PATCH", patch_url, token, body)
        if 200 <= status < 300:
            print(f"Updated check run {existing_id} ({check_name}): {title}")
            return existing_id
        print(f"::warning::Failed to update check run (HTTP {status}).")
        return None

    post_url = f"{api_url}/repos/{repo}/check-runs"
    body = {
        "name": check_name,
        "head_sha": commit,
        "external_id": run_key or "",
        "status": "completed",
        "conclusion": conclusion,
        "details_url": details_url,
        "output": output,
    }
    if started_at:
        body["started_at"] = started_at
    body["completed_at"] = completed_at
    status, created = _gh_api("POST", post_url, token, body)
    if 200 <= status < 300 and isinstance(created, dict):
        check_id = created.get("id")
        print(f"Created check run {check_id} ({check_name}): {title}")
        return check_id
    if status in (401, 403):
        print(f"::warning::Cannot create a check run (HTTP {status}). Grant `checks: write` to enable the run check. Skipping.")
    else:
        msg = created.get("message") if isinstance(created, dict) else ""
        print(f"::warning::Failed to create check run (HTTP {status}). {msg}")
    return None

def main():
    # Retrieve configuration from environment
    server_url = os.environ.get("INPUT_SERVER_URL", "").rstrip("/")
    project_id = os.environ.get("INPUT_PROJECT_ID", "")
    api_token = os.environ.get("INPUT_API_TOKEN", "")
    files_input = os.environ.get("INPUT_FILES", "")
    on_no_files = os.environ.get("INPUT_ON_NO_FILES", "error").lower()
    run_key = os.environ.get("INPUT_RUN_KEY", "")
    branch = os.environ.get("INPUT_BRANCH", "")
    commit = os.environ.get("INPUT_COMMIT", "")
    format_override = os.environ.get("INPUT_FORMAT", "")
    label = os.environ.get("INPUT_LABEL", "")
    ci_url = os.environ.get("INPUT_CI_URL", "")
    started_at = os.environ.get("INPUT_STARTED_AT", "")

    # Validate required fields
    if not server_url:
        print("Error: server-url input is required.", file=sys.stderr)
        sys.exit(1)
    if not project_id:
        print("Error: project-id input is required.", file=sys.stderr)
        sys.exit(1)
    if not api_token:
        print("Error: api-token input is required.", file=sys.stderr)
        sys.exit(1)
    if not files_input:
        print("Error: files input is required.", file=sys.stderr)
        sys.exit(1)

    # Resolve and expand glob patterns
    patterns = [line.strip() for line in files_input.splitlines() if line.strip()]
    matched_files = []
    for pattern in patterns:
        for path in glob.glob(pattern, recursive=True):
            if os.path.isfile(path):
                matched_files.append(os.path.abspath(path))

    # De-duplicate preserving order
    seen = set()
    unique_files = []
    for f in matched_files:
        if f not in seen:
            seen.add(f)
            unique_files.append(f)

    # Handle zero files matched
    if not unique_files:
        msg = f"No files matched the specified patterns: {patterns}"
        if on_no_files == "ignore":
            print(f"::warning::{msg}")
            sys.exit(0)
        else:
            print(f"Error: {msg}", file=sys.stderr)
            sys.exit(1)

    print(f"Found {len(unique_files)} file(s) to upload:")
    for f in unique_files:
        print(f"  - {f}")

    # Generate default dynamic started_at if not provided
    if not started_at:
        started_at = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

    # Verify curl is available
    if not shutil.which("curl"):
        print("Error: 'curl' executable is not found in PATH. It is required by this action.", file=sys.stderr)
        sys.exit(1)

    # Build endpoint URL
    url = f"{server_url}/api/projects/{project_id}/runs"
    if format_override:
        url += f"?format={urllib.parse.quote(format_override)}"

    # Create temporary file to store the response body
    with tempfile.NamedTemporaryFile(delete=False) as tf:
        resp_path = tf.name

    # Build curl command
    cmd = [
        "curl", "-s",
        "-w", "%{http_code}",
        "-o", resp_path,
        "-X", "POST",
        "-H", f"Authorization: Bearer {api_token}"
    ]

    # Add metadata fields as form fields
    fields = {
        "run_key": run_key,
        "branch": branch,
        "commit": commit,
        "label": label,
        "ci_url": ci_url,
        "started_at": started_at
    }
    for name, value in fields.items():
        if value:
            cmd += ["-F", f"{name}={value}"]

    # Add files
    for fpath in unique_files:
        cmd += ["-F", f"file=@{fpath}"]

    # Add URL
    cmd.append(url)

    try:
        # Run curl
        result = subprocess.run(cmd, capture_output=True, text=True)

        # Read response body
        resp_body = ""
        if os.path.exists(resp_path):
            try:
                with open(resp_path, "r", encoding="utf-8", errors="ignore") as f:
                    resp_body = f.read()
                os.unlink(resp_path)
            except Exception as re:
                print(f"Warning: Failed to read or clean up response file: {re}", file=sys.stderr)

        http_code = result.stdout.strip()

        if http_code.startswith("2"):
            print("Successfully uploaded test results!")
            print(resp_body)

            # Parse response and output
            try:
                data = json.loads(resp_body)
                run_data = data.get("run", {})
                run_id = run_data.get("id")
                total = run_data.get("total", 0)
                passed = run_data.get("passed", 0)
                failed = run_data.get("failed", 0)
                errored = run_data.get("errored", 0)
                skipped = run_data.get("skipped", 0)

                # Create or update the linking check run (best-effort).
                check_run_id = None
                create_check = os.environ.get("INPUT_CREATE_CHECK", "true").strip().lower()
                if create_check not in ("false", "0", "no", ""):
                    try:
                        check_run_id = upsert_check(
                            server_url,
                            project_id,
                            run_id,
                            run_key,
                            commit,
                            {
                                "total": total,
                                "passed": passed,
                                "failed": failed,
                                "errored": errored,
                                "skipped": skipped,
                            },
                            started_at,
                        )
                    except Exception as check_err:
                        print(f"::warning::Unexpected error while creating the check run: {check_err}")

                if "GITHUB_OUTPUT" in os.environ:
                    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as go:
                        go.write(f"run-id={run_id}\n")
                        go.write(f"total={total}\n")
                        go.write(f"passed={passed}\n")
                        go.write(f"failed={failed}\n")
                        go.write(f"errored={errored}\n")
                        go.write(f"skipped={skipped}\n")
                        go.write(f"check-run-id={check_run_id if check_run_id is not None else ''}\n")
            except Exception as json_err:
                print(f"Warning: Failed to parse response JSON or write outputs: {json_err}", file=sys.stderr)

            sys.exit(0)
        else:
            print(f"Error: Upload failed with status code {http_code}", file=sys.stderr)
            if resp_body:
                print("Response body:", file=sys.stderr)
                print(resp_body, file=sys.stderr)
            else:
                print("(No response body from server)", file=sys.stderr)
            if result.stderr:
                print("curl stderr:", file=sys.stderr)
                print(result.stderr, file=sys.stderr)
            sys.exit(1)

    except Exception as run_err:
        print(f"Error executing curl: {run_err}", file=sys.stderr)
        if os.path.exists(resp_path):
            try:
                os.unlink(resp_path)
            except:
                pass
        sys.exit(1)

if __name__ == "__main__":
    main()
