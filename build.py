"""Bundle Vox Tower into single-file HTML.

Outputs:
  dist/vox-tower.html      standalone page (full document)
  dist/vox-tower.artifact.html   body-only fragment for hosts that wrap the page

Sprite sheets are inlined as data URIs; CSS and JS are inlined; Google Fonts
stay as a <link>.
"""
import base64
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
DIST = ROOT / "dist"
DIST.mkdir(exist_ok=True)

html = (ROOT / "index.html").read_text(encoding="utf-8")
css = (ROOT / "css" / "style.css").read_text(encoding="utf-8")
scripts = [
    (ROOT / "js" / p).read_text(encoding="utf-8")
    for p in ("pitch.js", "i18n.js", "levels.js", "game.js")
]

def data_uri(path: pathlib.Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")

levels_idx = 2
for rel in ("assets/kenney/tiny-dungeon.png", "assets/kenney/pixel-platformer.png"):
    scripts[levels_idx] = scripts[levels_idx].replace(f"'{rel}'", f"'{data_uri(ROOT / rel)}'")

js_blob = "\n".join(scripts).replace("</script", "<\\/script")

# --- standalone document ---
out = html
out = re.sub(r'<link rel="stylesheet" href="css/style.css">', lambda m: "<style>\n" + css + "\n</style>", out)
out = re.sub(r'(<script src="js/[^"]+"></script>\s*)+', lambda m: "<script>\n" + js_blob + "\n</script>\n", out, count=1)
(DIST / "vox-tower.html").write_text(out, encoding="utf-8")

# --- body-only fragment (title + style first, then markup, then script) ---
body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
body = re.sub(r'(<script src="js/[^"]+"></script>\s*)+', "", body)
fonts_link = re.search(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>', html).group(0)
fragment = (
    "<title>Vox Tower</title>\n"
    + fonts_link + "\n"
    + "<style>\n" + css + "\n</style>\n"
    + body.strip() + "\n"
    + "<script>\n" + js_blob + "\n</script>\n"
)
(DIST / "vox-tower.artifact.html").write_text(fragment, encoding="utf-8")

print("wrote", DIST / "vox-tower.html", len(out) // 1024, "KB")
print("wrote", DIST / "vox-tower.artifact.html", len(fragment) // 1024, "KB")
