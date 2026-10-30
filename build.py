t=open('template.html').read()
t=t.replace('/*CSS*/',open('style.css').read()).replace('/*ENGINE*/',open('engine.js').read()).replace('/*APP*/',open('app.js').read())
open('public/index.html','w').write(t); print('built public/index.html',len(t),'bytes')
