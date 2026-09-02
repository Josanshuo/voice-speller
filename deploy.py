"""Build the site and publish dist/ to the `dist` branch on GitHub.

GitHub Pages serves that branch at https://josanshuo.github.io/voice-speller/

    python deploy.py                # commit message "Deploy static site"
    python deploy.py "message"      # custom commit message

The branch is a snapshot of dist/ (history is rewritten on every deploy).
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).parent
REMOTE = "origin"
BRANCH = "dist"


def run(*args, cwd=ROOT, check=True):
    print("$", " ".join(args))
    return subprocess.run(args, cwd=str(cwd), check=check)


def main():
    message = sys.argv[1] if len(sys.argv) > 1 else "Deploy static site"
    run(sys.executable, "build.py")

    tmp = pathlib.Path(tempfile.mkdtemp(prefix="voice-speller-dist-"))
    wt = tmp / "site"
    try:
        run("git", "worktree", "prune")
        run("git", "branch", "-D", BRANCH, check=False)
        run("git", "worktree", "add", "--orphan", "-b", BRANCH, str(wt))
        shutil.copytree(ROOT / "dist", wt, dirs_exist_ok=True)
        run("git", "add", "-A", cwd=wt)
        run("git", "commit", "-q", "-m", message, cwd=wt)
        run("git", "push", "--force", REMOTE, f"{BRANCH}:{BRANCH}", cwd=wt)
    finally:
        run("git", "worktree", "remove", "--force", str(wt), check=False)
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"deployed {BRANCH} -> https://josanshuo.github.io/voice-speller/")


if __name__ == "__main__":
    main()
