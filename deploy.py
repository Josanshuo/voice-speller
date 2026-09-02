"""Build the site and publish dist/ to the `dist` branch on GitHub.

GitHub Pages serves that branch at https://josanshuo.github.io/voice-speller/

    python deploy.py                # commit message "Deploy static site"
    python deploy.py "message"      # custom commit message

The branch is a snapshot of dist/ (history is rewritten on every deploy).
It is built with git plumbing (a temporary index + commit-tree), so no
checkout, worktree or branch switch is needed.
"""
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent.resolve()
DIST = ROOT / "dist"
REMOTE = "origin"
BRANCH = "dist"


def git(*args, env=None, cwd=ROOT):
    print("$ git", " ".join(args))
    return subprocess.run(
        ["git", *args], cwd=str(cwd), env=env, check=True,
        capture_output=True, text=True,
    ).stdout.strip()


def main():
    message = sys.argv[1] if len(sys.argv) > 1 else "Deploy static site"
    subprocess.run([sys.executable, str(ROOT / "build.py")], check=True)

    index = ROOT / ".git" / "dist-index"
    env = dict(os.environ, GIT_INDEX_FILE=str(index))
    try:
        if index.exists():
            index.unlink()
        # stage dist/ as the whole tree of the snapshot commit
        git("--work-tree", str(DIST), "add", "-A", "--force", ".", env=env, cwd=DIST)
        tree = git("write-tree", env=env)
        commit = git("commit-tree", tree, "-m", message, env=env)
        git("update-ref", f"refs/heads/{BRANCH}", commit)
        print(git("push", "--force", REMOTE, f"refs/heads/{BRANCH}:refs/heads/{BRANCH}"))
    finally:
        if index.exists():
            index.unlink()
    print(f"deployed {BRANCH} ({commit[:7]}) -> https://josanshuo.github.io/voice-speller/")


if __name__ == "__main__":
    main()
