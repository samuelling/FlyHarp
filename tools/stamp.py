"""Stamp a cache-busting version onto every script, stylesheet, worker and data file the page loads.

GitHub Pages lets browsers cache files for several minutes, so after an update a visitor can get the new
index.html with an old stylesheet or worker. Run before committing a change to the page:
    python tools/stamp.py            # stamp = current UTC time
"""
import re, time, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime('%Y%m%d%H%M', time.gmtime())
p = root / 'index.html'; s = p.read_text()
s = re.sub(r'(href="css/[^"?]+\.css)(\?v=\w+)?"', rf'\1?v={v}"', s)
s = re.sub(r'(src="js/[^"?]+\.js)(\?v=\w+)?"', rf'\1?v={v}"', s)
s = re.sub(r"window\.FH_V = '\w*'", f"window.FH_V = '{v}'", s)
p.write_text(s)
print('stamped', v)
