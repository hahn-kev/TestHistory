#!/usr/bin/env python3
import os
import sys
import glob
import datetime
import subprocess
import tempfile
import urllib.parse
import json
import shutil

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

                if "GITHUB_OUTPUT" in os.environ:
                    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as go:
                        go.write(f"run-id={run_id}\n")
                        go.write(f"total={total}\n")
                        go.write(f"passed={passed}\n")
                        go.write(f"failed={failed}\n")
                        go.write(f"errored={errored}\n")
                        go.write(f"skipped={skipped}\n")
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
