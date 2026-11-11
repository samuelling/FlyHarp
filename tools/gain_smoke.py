"""Headless check of the gain-control stages and the probe panel; saves screenshots to the given folder."""
import sys, asyncio, subprocess, time, json
from playwright.async_api import async_playwright

async def main(out):
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8778'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
            pg = await b.new_page(viewport={'width': 1500, 'height': 1000})
            errs = []
            pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
            pg.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
            await pg.goto('http://localhost:8778/index.html', wait_until='networkidle')
            await pg.wait_for_function('document.getElementById("status").textContent.includes("neurons")', timeout=60000)
            await pg.evaluate("(() => { const b = document.getElementById('begin'); if (b) b.remove(); document.querySelectorAll('#panels .panel').forEach(p => p.classList.add('on')); document.getElementById('drawer').classList.add('open'); })()")  # tests: no opening card, every drawer tab shown
            await pg.click('#go'); await pg.wait_for_timeout(300)
            await pg.select_option('#kind', 'grating')
            async def notes(label, secs=5):
                b0 = json.loads(await pg.evaluate('JSON.stringify(window.__flyharp.stats)')); t0 = await pg.evaluate('window.__flyharp.simT')
                await pg.wait_for_timeout(secs * 1000)
                a0 = json.loads(await pg.evaluate('JSON.stringify(window.__flyharp.stats)')); t1 = await pg.evaluate('window.__flyharp.simT')
                print(f'{label:40s} notes {a0["notes"] - b0["notes"]:4d}  sim {t1 - t0:.2f}s / {secs}s real')
            async def setv(id, v): await pg.evaluate(f'(() => {{ const e = document.getElementById("{id}"); e.value = {v}; e.dispatchEvent(new Event("input")); }})()')
            await notes('grating, trained network')
            await setv('light', -3); await notes('grating at light x1/8, no adaptation')
            await pg.check('#gAdapt'); await pg.wait_for_timeout(500); await notes('... with photoreceptor adaptation')
            await pg.click('.lens >> text=Photoreceptors'); await pg.wait_for_timeout(800); await pg.screenshot(path=f'{out}/g_photo_adapt.png')
            await setv('light', 0)
            await pg.check('#gNorm'); await pg.wait_for_timeout(500); await notes('adaptation + normalization (both)')
            await pg.click('.lens >> text=Motion')
            for d in [0, 90, 180, 270]:
                await setv('direction', d); await pg.wait_for_timeout(2500); await pg.screenshot(path=f'{out}/g_motion_{d}.png', clip={'x': 290, 'y': 60, 'width': 700, 'height': 700})
            await pg.select_option('#pType', 'Mi1'); await pg.click('#pRun')
            await pg.wait_for_function('!document.getElementById("pRun").disabled', timeout=180000)
            print('probe note:', await pg.text_content('#pNote'))
            el = await pg.query_selector('.probe'); await el.scroll_into_view_if_needed(); await el.screenshot(path=f'{out}/g_probe.png')
            await pg.screenshot(path=f'{out}/g_controls.png', clip={'x': 0, 'y': 60, 'width': 300, 'height': 940})
            print('\n'.join(errs) or 'no console errors')
            await b.close()
    finally:
        srv.terminate()

asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else '.'))
