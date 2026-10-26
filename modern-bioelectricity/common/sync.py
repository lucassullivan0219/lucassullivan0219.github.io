"""Copy common/background.html into hw2-lab/index.html and hw3-lab/index.html between the markers
<!-- common-background:begin --> and <!-- common-background:end -->.  Run from any directory."""
import os, re
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, 'background.html'), encoding='utf-8').read()
src = re.sub(r'^<!--.*?-->\n', '', src, count=1, flags=re.S)        # drop the file's own header comment
for page in ('hw2-lab/index.html', 'hw3-lab/index.html'):
    p = os.path.join(here, '..', page)
    t = open(p, encoding='utf-8').read()
    a, b = '<!-- common-background:begin -->', '<!-- common-background:end -->'
    i, j = t.index(a) + len(a), t.index(b)
    t = t[:i] + '\n' + src + t[j:]
    open(p, 'w', encoding='utf-8').write(t)
    print('synced', page)
