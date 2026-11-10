"""Headless check: page loads, network runs, strings pluck for each stimulus; saves screenshots."""
import sys, asyncio, subprocess, time, json
from playwright.async_api import async_playwright

async def main(out):
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8777'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
            pg = await b.new_page(viewport={'width': 1500, 'height': 1000})
            errs = []
            pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
            pg.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
            await pg.goto('http://localhost:8777/index.html', wait_until='networkidle')
            await pg.wait_for_function('document.getElementById("status").textContent.includes("neurons")', timeout=60000)
            print(await pg.text_content('#status'))
            await pg.click('#go'); await pg.wait_for_timeout(500)
            for kind in ['flash', 'grating', 'loom', 'edge', 'dots']:
                await pg.select_option('#kind', kind)
                before = await pg.evaluate('JSON.stringify(window.__flyharp.stats)')
                t0 = await pg.evaluate('window.__flyharp.simT')
                await pg.wait_for_timeout(6000)
                after = await pg.evaluate('JSON.stringify(window.__flyharp.stats)')
                t1 = await pg.evaluate('window.__flyharp.simT')
                b0, a0 = json.loads(before), json.loads(after)
                print(kind, 'notes', a0['notes'] - b0['notes'], 'by layer', [x - y for x, y in zip(a0['byGroup'], b0['byGroup'])], f'sim {t1 - t0:.2f}s in 6s real')
                await pg.screenshot(path=f'{out}/fh_{kind}.png')
            # solo the lobula plate: only its notes should sound
            await pg.click('#hier .area[data-g="4"] .solo')
            await pg.select_option('#kind', 'edge')
            b0 = json.loads(await pg.evaluate('JSON.stringify(window.__flyharp.stats)'))
            await pg.wait_for_timeout(5000)
            a0 = json.loads(await pg.evaluate('JSON.stringify(window.__flyharp.stats)'))
            print('solo lobula plate, by layer', [x - y for x, y in zip(a0['byGroup'], b0['byGroup'])])
            # every engine on the lamina, check the audio graph stays alive
            for eng in ['pad', 'modal', 'pluck', 'fm', 'glass', 'click']:
                await pg.select_option('#hier .area[data-g="4"] .eng', eng); await pg.wait_for_timeout(1200)
            print('audio running:', await pg.evaluate('Sound.running()'))
            await pg.click('#hier .area[data-g="4"] .solo')
            await pg.click('#cascade', position={'x': 420, 'y': 250})
            print('strings after clicking a tile:', await pg.evaluate('window.__flyharp.strings.length'))
            await pg.screenshot(path=f'{out}/fh_hier.png', full_page=True)
            st = json.loads(await pg.evaluate('JSON.stringify(window.__flyharp.stats)'))
            print('depolarisation notes', st['dep'], 'hyperpolarisation notes', st['hyp'])
            await pg.click('#hier .area[data-g="1"] .pl[data-pol="hyp"]'); await pg.click('#hier .area[data-g="1"] .solo')
            await pg.select_option('#kind', 'flash')
            b0 = json.loads(await pg.evaluate('JSON.stringify(window.__flyharp.stats)')); await pg.wait_for_timeout(5000)
            a0 = json.loads(await pg.evaluate('JSON.stringify(window.__flyharp.stats)'))
            print('lamina hyperpol only + solo: dep', a0['dep'] - b0['dep'], 'hyp', a0['hyp'] - b0['hyp'], 'by layer', [x - y for x, y in zip(a0['byGroup'], b0['byGroup'])])
            await pg.screenshot(path=f'{out}/fh_hyp.png')
            print('\n'.join(errs) or 'no console errors')
            await b.close()
    finally:
        srv.terminate()
asyncio.run(main(sys.argv[1]))
