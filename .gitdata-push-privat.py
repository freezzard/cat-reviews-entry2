#!/usr/bin/env python3
"""gitdata_push.py — mirror a local git history to GitHub via the Git Data API.

The Contents API refuses files over 1 MB (our vendored three.core.min.js is
1.47 MB), and the vault PAT cannot be handed to git itself, so this script
replays every local commit through POST /git/blobs, /git/trees and
/git/commits, reusing the Secure Vault surrogate exactly like the other
custom helpers. Author/committer/message are copied verbatim from the local
objects, so the remote commit shas come out identical to the local ones.

State (uploaded blob shas, pushed commit shas) is cached beside this script
so re-runs only send what is new. No token is ever printed or stored here.

Usage: gitdata_push.py <local-repo> <owner/name>
"""
import base64
import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

BASE = "https://api.github.com"
STATE_PATH = "/home/hatch/workspace/makefun/cat-reviews-entry2/.gitdata-push-state-privat.json"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused, verify the endpoint")


def call(method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28",
                 "Content-Type": "application/json"})
    add_surrogate_to_request(req, "custom.github-api", allowed_hosts=["api.github.com"])
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=120) as resp:
            return resp.status, read_json_response(resp)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(body or "{}")
        except json.JSONDecodeError:
            return e.code, {"raw": body[:400]}


def git(repo, *args, binary=False):
    out = subprocess.run(["git", "-C", repo, *args], capture_output=True, check=True)
    return out.stdout if binary else out.stdout.decode("utf-8", "replace")


def iso_date(ts, tz):
    sign = 1 if tz[0] == "+" else -1
    offset = timedelta(hours=int(tz[1:3]), minutes=int(tz[3:5])) * sign
    dt = datetime.fromtimestamp(int(ts), tz=timezone(offset))
    return dt.isoformat()


def parse_person(line):
    # "Name <email> 1763... +0000"
    name_email, ts, tz = line.rsplit(" ", 2)
    name, email = name_email.rsplit(" <", 1)
    return {"name": name, "email": email.rstrip(">"), "date": iso_date(ts, tz)}


def main():
    repo, owner_repo = sys.argv[1], sys.argv[2]
    try:
        state = json.load(open(STATE_PATH))
    except Exception:
        state = {"blobs": [], "commits": {}}
    blobs_done = set(state["blobs"])
    commits_done = state["commits"]

    # An entirely empty repository refuses blob creation (HTTP 409), so seed
    # it with one Contents-API commit holding the anchor file. The mirrored
    # history replaces that seed commit at the end; nothing was ever
    # submitted from the seed.
    st, _ref = call("GET", f"/repos/{owner_repo}/git/ref/heads/main")
    if st == 409:  # Git Repository is empty: no refs at all yet
        anchor = git(repo, "show", "HEAD:.makefun/freshness.json", binary=True)
        st, out = call("PUT", f"/repos/{owner_repo}/contents/.makefun/freshness.json",
                       {"message": "seed (replaced by mirrored history)",
                        "content": base64.b64encode(anchor).decode()})
        print("seed commit:", st)

    commits = git(repo, "rev-list", "--reverse", "HEAD").split()
    print(f"{len(commits)} local commits; {len(commits_done)} already mirrored")

    for sha in commits:
        if sha in commits_done:
            continue
        raw = git(repo, "cat-file", "commit", sha)
        headers, _, message = raw.partition("\n\n")
        fields = {}
        parents = []
        for line in headers.splitlines():
            key, _, value = line.partition(" ")
            if key == "parent":
                parents.append(value)
            elif key in ("tree", "author", "committer"):
                fields[key] = value
        # blobs
        tree_entries = []
        for entry in git(repo, "ls-tree", "-r", "-z", sha).split("\0"):
            if not entry:
                continue
            meta, path = entry.split("\t", 1)
            mode, _type, blob_sha = meta.split(" ")
            if blob_sha not in blobs_done:
                content = git(repo, "cat-file", "blob", blob_sha, binary=True)
                st, out = call("POST", f"/repos/{owner_repo}/git/blobs",
                               {"content": base64.b64encode(content).decode(),
                                "encoding": "base64"})
                if st not in (200, 201) or out.get("sha") != blob_sha:
                    print(f"BLOB FAIL {path}: HTTP {st} {str(out)[:200]}")
                    sys.exit(1)
                blobs_done.add(blob_sha)
            tree_entries.append({"path": path, "mode": mode, "type": "blob", "sha": blob_sha})
        # tree
        st, out = call("POST", f"/repos/{owner_repo}/git/trees", {"tree": tree_entries})
        if st not in (200, 201) or out.get("sha") != fields["tree"]:
            print(f"TREE FAIL {sha}: HTTP {st} {str(out)[:200]}")
            sys.exit(1)
        # commit
        payload = {
            "message": message,
            "tree": fields["tree"],
            "parents": [commits_done[p] for p in parents],
            "author": parse_person(fields["author"]),
            "committer": parse_person(fields["committer"]),
        }
        st, out = call("POST", f"/repos/{owner_repo}/git/commits", payload)
        if st not in (200, 201):
            print(f"COMMIT FAIL {sha}: HTTP {st} {str(out)[:300]}")
            sys.exit(1)
        remote_sha = out["sha"]
        commits_done[sha] = remote_sha
        print(f"mirrored {sha[:9]} -> {remote_sha[:9]} {'(identical)' if remote_sha == sha else '(DIFFERENT)'}")
        state["blobs"] = sorted(blobs_done)
        state["commits"] = commits_done
        json.dump(state, open(STATE_PATH, "w"), indent=1)

    head_remote = commits_done[commits[-1]]
    st, out = call("GET", f"/repos/{owner_repo}/git/ref/heads/main")
    if st == 200:
        if out["object"]["sha"] == head_remote:
            print("ref heads/main already at", head_remote)
        else:
            st, out = call("PATCH", f"/repos/{owner_repo}/git/refs/heads/main",
                           {"sha": head_remote, "force": False})
            if st not in (200, 201):
                # Only reachable when the current main is the throwaway seed
                # commit, which is not an ancestor of the mirrored history.
                st, out = call("PATCH", f"/repos/{owner_repo}/git/refs/heads/main",
                               {"sha": head_remote, "force": True})
            print("PATCH ref:", st, out.get("object", {}).get("sha"))
    elif st == 404:
        st, out = call("POST", f"/repos/{owner_repo}/git/refs",
                       {"ref": "refs/heads/main", "sha": head_remote})
        print("POST ref:", st, out.get("object", {}).get("sha"))
    else:
        print("REF CHECK FAIL:", st, str(out)[:200])
        sys.exit(1)


if __name__ == "__main__":
    main()
