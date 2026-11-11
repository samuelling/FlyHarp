"""Headless check of The Tonnectome: the ear hears the instrument, the network responds, the eye sees it."""
import sys, asyncio, subprocess, time
from playwright.async_api import async_playwright
async def main(out):
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8796'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
            pg = await b.new_page(viewport={'width': 1440, 'height': 1000})
            errs = []
            pg.on('pageerror', lambda e: errs.append(f'pageerror: {e}')); pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
            await pg.goto('http://localhost:8796/index.html', wait_until='networkidle')
            await pg.wait_for_function('document.getElementById("status").textContent.includes("neurons")', timeout=60000)
            await pg.evaluate("(() => { const b = document.getElementById('begin'); if (b) b.remove(); document.querySelectorAll('#panels .panel').forEach(p => p.classList.add('on')); document.getElementById('drawer').classList.add('open'); document.querySelectorAll('.view').forEach(v => v.classList.add('on')); })()")  # tests: no opening card, every drawer tab and both views shown
            await pg.evaluate("document.querySelector('.lobeBox').style.display = 'none'")
            await pg.select_option('#kind', 'flash'); await pg.click('#go')
            await pg.wait_for_timeout(8000)
            st = await pg.evaluate('({attached: Tonnectome.attached, frames: Tonnectome.frames, active: Tonnectome.rates ? Array.from(Tonnectome.rates).filter(v => v > 0.02).length : -1, notes: window.__flyharp.stats.notes})')
            print('instrument -> ear:', st, '|', await pg.text_content('#tnNote'))
            await pg.locator('.hears').screenshot(path=f'{out}/tn_card.png')
            # the ear back into the eye
            await pg.select_option('#kind', 'ear'); await pg.click('.lens >> text=Photoreceptors'); await pg.wait_for_timeout(5000)
            await pg.locator('.heroEye').screenshot(path=f'{out}/tn_eye_coch.png')
            for v in ['coch', 'brain', 'chladni', 'ripples', 'helix', 'rhythm', 'glass']:
                await pg.click(f'#tnViews button[data-v="{v}"]'); await pg.wait_for_timeout(2500)
                await pg.locator('#tnArt').screenshot(path=f'{out}/tn_art_{v}.png')
                await pg.locator('#eye').screenshot(path=f'{out}/tn_eye_{v}.png')
            st2 = await pg.evaluate('({frames: Tonnectome.frames, notes: window.__flyharp.stats.notes})')
            print('closed loop:', st2)
            print('\n'.join(errs) or 'no errors')
            await b.close()
    finally: srv.terminate()
asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else '.'))
