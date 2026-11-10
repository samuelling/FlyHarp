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
            await pg.screenshot(path=f'{out}/fh_webcam.png')
            box = await pg.locator('#cascade').bounding_box()
            sc = box['width'] / 1180
            await pg.mouse.move(box['x'] + 60 * sc, box['y'] + 4 * 70 * sc + 30 * sc); await pg.wait_for_timeout(300)
            await pg.screenshot(path=f'{out}/fh_hover_area.png')
            await pg.mouse.move(box['x'] + (150 + 78 * 0 + 30) * sc, box['y'] + (8 + 5 * 70 + 30) * sc); await pg.wait_for_timeout(300)
            await pg.screenshot(path=f'{out}/fh_hover_cell.png')
            await pg.locator('#fbMeter').scroll_into_view_if_needed(); await pg.wait_for_timeout(400)
            sec = pg.locator('#fbMeter').locator('xpath=..'); await sec.screenshot(path=f'{out}/fh_fb.png'); await b.close()
    finally:
        srv.terminate()
asyncio.run(main(sys.argv[1]))
