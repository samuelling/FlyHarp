"""Headless check of the default webcam path using Chrome's fake camera (a moving test pattern)."""
import sys, asyncio, subprocess, time, json
from playwright.async_api import async_playwright
async def main(out):
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8779'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
            ctx = await b.new_context(permissions=['camera'], viewport={'width': 1500, 'height': 1000}); pg = await ctx.new_page()
            await pg.goto('http://localhost:8779/index.html'); await pg.wait_for_timeout(6000)
            await pg.click('#go'); await pg.wait_for_timeout(6000)
            st = json.loads(await pg.evaluate('JSON.stringify(window.__flyharp.stats)'))
            print('stimulus:', await pg.evaluate('window.__flyharp.P.kind'), '| status:', await pg.text_content('#status'), '| notes', st['notes'], 'dep', st['dep'], 'hyp', st['hyp'], st['byGroup'])
            await pg.screenshot(path=f'{out}/fh_webcam.png'); await b.close()
    finally:
        srv.terminate()
asyncio.run(main(sys.argv[1]))
