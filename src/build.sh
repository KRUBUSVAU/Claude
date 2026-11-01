#!/bin/sh
# Assembles index.html from the source parts. Run from the repository root: sh src/build.sh
cd "$(dirname "$0")/.." || exit 1
{ cat src/p1_head.html src/p2_body.html; echo '<script>'; cat src/p3_a.js src/p3_b.js src/p3_c.js src/p3_d.js src/p3_e.js; echo '</script>'; echo '<!-- ARTIFACT-END -->'; echo '</body>'; echo '</html>'; } > index.html
echo "wrote index.html"
