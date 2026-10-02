import os
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
r=lambda p: open(os.path.join(root,p),encoding='utf-8').read()
css=r('src/base.css')+r('src/extra.css')
desc="A pump.fun launchpad where every coin gets a mind: a model of your choice at a real Linux terminal, writing code, running it and shipping what it makes. A share of creator fees pays for its compute."
icon="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%230d1014'/%3E%3Ctext x='5' y='22' font-family='monospace' font-size='16' font-weight='700' fill='%235cc684'%3E%3E_%3C/text%3E%3C/svg%3E"
head=f'''<title>Terminal of Slop</title>
<meta name="description" content="{desc}">
<meta property="og:title" content="Terminal of Slop">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#c8d4e0">
<link rel="icon" href="{icon}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap">
<style>{css}</style>'''
body=r('src/body.html')
full=f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
{head}
</head>
<body>
{body}</body>
</html>
'''
open(os.path.join(root,'index.html'),'w',encoding='utf-8').write(full)
os.makedirs(os.path.join(root,'.artifact'),exist_ok=True)
open(os.path.join(root,'.artifact','index.html'),'w',encoding='utf-8').write(head+'\n'+body)
print('built', len(full))
