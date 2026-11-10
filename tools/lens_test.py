"""Screenshot each lens of the eye for a rightward-moving ON edge (direction 0°)."""
import sys, asyncio, subprocess, time
from playwright.async_api import async_playwright
async def main(out):
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8782'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
            pg = await b.new_page(viewport={'width': 1500, 'height': 1000})
            await pg.goto('http://localhost:8782/index.html'); await pg.wait_for_timeout(8000)
            await pg.select_option('#kind', 'edge'); await pg.click('.seg button[data-pol="1"]')
            for l in ['photo', 'lamina', 'on', 'off', 'motion', 'feedback']:
                await pg.click(f'.lens[data-l="{l}"]'); await pg.wait_for_timeout(1800)
                await pg.locator('.heroEye').screenshot(path=f'{out}/lens_{l}.png')
            await b.close()
    finally: srv.terminate()
asyncio.run(main(sys.argv[1]))
