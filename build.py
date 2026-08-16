#!/usr/bin/env python3
"""
Génère les deux fichiers autonomes de RELAX MIND :

  RELAX-MIND-autonome.html  — application participante (démonstration, un seul fichier)
  RELAX-MIND-ADMIN.html     — console d'administration (usage local exclusif),
                              incluant le modèle d'application à régénérer.
"""
import base64, pathlib

d = pathlib.Path(__file__).parent
read = lambda n: (d / n).read_text(encoding="utf-8")

icon = base64.b64encode((d / "icons" / "icon-192.png").read_bytes()).decode()

# ---------------------------------------------------------------- participante
html = read("index.html")
html = html.replace('<link rel="manifest" href="manifest.webmanifest">', "")
html = html.replace('<link rel="apple-touch-icon" href="icons/icon-192.png">',
                    '<link rel="apple-touch-icon" href="data:image/png;base64,%s">' % icon)
html = html.replace('<script src="textes.js"></script>\n<script src="config.js"></script>',
                    "<script>\n%s\n%s\n</script>" % (read("textes.js"), read("config.js")))
html = html.replace('<script src="crypto.js"></script>', "<script>\n%s\n</script>" % read("crypto.js"))
html = html.replace('<script src="app.js"></script>', "<script>\n%s\n</script>" % read("app.js"))

assert "<!--__RM_DATA_START__-->" in html and "<!--__RM_DATA_END__-->" in html, "balises de modèle perdues"
(d / "RELAX-MIND-autonome.html").write_text(html, encoding="utf-8")

# ---------------------------------------------------------------------- admin
tpl = base64.b64encode(html.encode("utf-8")).decode()
adm = read("admin.html")
adm = adm.replace("__TEMPLATE__", tpl)          # avant l'inclusion des scripts :
                                                # admin.js contient lui aussi ce mot-clé
adm = adm.replace('<script src="crypto.js"></script>', "<script>\n%s\n</script>" % read("crypto.js"))
adm = adm.replace('<script src="studio.js"></script>', "<script>\n%s\n</script>" % read("studio.js"))
adm = adm.replace('<script src="textes.js"></script>', "<script>\n%s\n</script>" % read("textes.js"))
adm = adm.replace('<script src="admin.js"></script>', "<script>\n%s\n</script>" % read("admin.js"))
(d / "RELAX-MIND-ADMIN.html").write_text(adm, encoding="utf-8")

for f in ("RELAX-MIND-autonome.html", "RELAX-MIND-ADMIN.html"):
    print("écrit : %-28s %5d Ko" % (f, round(len((d / f).read_text(encoding='utf-8')) / 1024)))
