from lib import *
import re
async def cfof(page, title):
    h = await page.locator(f'iframe[title="{title}"]').element_handle()
    return await h.content_frame()
def rep(logs, skip=0):
    out=[]
    for l in reports(logs)[skip:]:
        m = re.search(r"region: (\S+), screenId: (\S+?)[,}]", l.replace("\n"," "))
        out.append((m.group(1), m.group(2)) if m else l[:80])
    return out
async def dev(page, label):
    if not await page.locator(".dev-menu").count(): await page.locator("text=Dev ▾").click()
    await page.locator(f".dev-menu >> text={label}").first.click()
    await page.locator("text=Dev ▾").click()   # close
async def main():
    t=T()
    async with async_playwright() as p:
        b,page,logs = await start(p)
        reqs=[]
        page.on("request", lambda r: reqs.append((r.url)) if "/elements/" in r.url else None)
        base = len(reports(logs))
        # page 6 analytics errors come at ~4s from 4 previews; wait for them first
        await page.wait_for_timeout(4500)
        base = len(reports(logs)); print("baseline reports (page errors)", base, rep(logs))
        t.check("page error badge on docs previews", await page.locator(".page-badge").count()==4)
        await page.locator(".page-badge").first.hover()
        t.check("badge tooltip shows message", "analytics" in await page.locator(".page-badge .tip").first.inner_text())

        # ---- board fail ----
        await dev(page, "Board: GET /screens fails"); await page.wait_for_timeout(800)
        t.check("board shows error with Retry", await page.locator(".board .error-box").count()==1 and "Couldn't load screens" in await page.locator(".board").inner_text())
        t.check("toolbar/panels unaffected", await page.locator(".panel").count()==2)
        t.check("one report (board)", rep(logs,base)==[("board","null")], rep(logs,base))
        await page.locator(".board button:has-text('Retry')").click(); await page.wait_for_timeout(2500)
        t.check("Retry reloads board", await page.locator("iframe").count()==24)
        base = len(reports(logs))

        # ---- preview can't connect ----
        await page.locator("text=Dev ▾").click()
        await page.locator(".dev-menu select").select_option("2000")
        await page.locator("text=Dev ▾").click()
        await dev(page, "Preview: can't connect"); await page.wait_for_timeout(2600)
        t.check("Couldn't connect shown on that preview only", await page.locator(".preview-error").count()==1 and "Couldn't connect to this preview" in await page.locator(".preview-error").inner_text())
        t.check("one report (preview scr-01)", [r for r in rep(logs,base) if r[1]=="scr-01"]==[("preview","scr-01")], rep(logs,base))
        await page.locator(".preview-error button").click(); await page.wait_for_timeout(1500)
        t.check("Retry recovers the preview", await page.locator(".preview-error").count()==0 and await page.locator(".loading").count()==0)
        base = len(reports(logs))

        # ---- throw inside page ----
        await dev(page, "Preview: throw an error inside the page"); await page.wait_for_timeout(500)
        t.check("page error badge on scr-01", await page.locator('.frame[data-frame="scr-01"] .page-badge').count()==1)
        t.check("one report (preview scr-01)", rep(logs,base)==[("preview","scr-01")], rep(logs,base))
        base = len(reports(logs))

        # ---- layers/inspector render errors need an active preview ----
        fb = await bring_exact(page,"scr-01",0.6); z=fb["width"]/1280
        cf = await cfof(page,"Landing")
        r = await cf.evaluate("""() => { const el=document.querySelector('[data-key="cta-primary"]'); const q=el.getBoundingClientRect(); return {x:q.left+q.width/2,y:q.top+q.height/2}; }""")
        x,y = fb["x"]+r["x"]*z, fb["y"]+r["y"]*z
        await page.mouse.move(x,y); await page.mouse.click(x,y); await page.wait_for_timeout(800)
        t.check("selected cta-primary, details shown", "Component" in await page.locator(".inspector").inner_text())
        await dev(page, "Layers panel: render error"); await page.wait_for_timeout(400)
        t.check("layers shows error", await page.locator(".panel >> nth=0").locator(".error-box").count()==1)
        t.check("board + inspector still work", await page.locator(".box.selected").count()==1 and "Component" in await page.locator(".inspector").inner_text())
        t.check("one report (layers)", rep(logs,base)==[("layers","scr-01")], rep(logs,base))
        await page.locator(".panel >> nth=0").locator("button:has-text('Retry')").click(); await page.wait_for_timeout(500)
        t.check("layers recovered", await page.locator(".rows").count()==1)
        base = len(reports(logs))
        await dev(page, "Inspector: render error"); await page.wait_for_timeout(400)
        t.check("inspector shows error, layers fine", await page.locator(".inspector .error-box").count()==1 and await page.locator(".rows").count()==1)
        t.check("one report (inspector)", rep(logs,base)==[("inspector","scr-01")], rep(logs,base))
        await page.locator(".inspector button:has-text('Retry')").click(); await page.wait_for_timeout(500)
        t.check("inspector recovered", "Component" in await page.locator(".inspector").inner_text())
        base = len(reports(logs))

        # ---- details fail ----
        await page.locator("text=Dev ▾").click(); await page.locator(".dev-menu input[type=checkbox]").check(); await page.locator("text=Dev ▾").click()
        await page.mouse.click(fb["x"]+1270*z, fb["y"]+790*z); await page.wait_for_timeout(300)   # clear (bg)
        await page.mouse.move(x,y); await page.mouse.click(x,y); await page.wait_for_timeout(1000)
        print("   element requests so far:", reqs)
        t.check("details error with Retry, live values still shown", await page.locator(".inspector .error-box").count()==1 and "Name" in await page.locator(".inspector").inner_text())
        t.check("one report (details, elementKey)", len(rep(logs,base))==1 and "details" in str(reports(logs)[base]) and "cta-primary" in reports(logs)[base], reports(logs)[base:])
        await page.locator(".inspector button:has-text('Retry')").click(); await page.wait_for_timeout(800)
        t.check("retry failing again counts as a new failure", len(reports(logs))-base==2, len(reports(logs))-base)
        await page.locator("text=Dev ▾").click(); await page.locator(".dev-menu input[type=checkbox]").uncheck(); await page.locator("text=Dev ▾").click()
        await page.locator(".inspector button:has-text('Retry')").click(); await page.wait_for_timeout(800)
        t.check("retry succeeds", "Component" in await page.locator(".inspector").inner_text())
        base = len(reports(logs))

        # ---- layers row timeout ----
        await dev(page, "Layers row: page ignores next expand")
        chevs = await page.locator(".rows .row .chev").all_inner_texts()
        idx = chevs.index("▸")
        await page.locator(".rows .row .chev").nth(idx).click(); await page.wait_for_timeout(400)
        t.check("row shows loading", "Loading" in await page.locator(".rows").inner_text())
        await page.wait_for_timeout(3200)
        t.check("row shows Couldn't load + Retry on that row only", await page.locator(".rows .row.error").count()==1)
        t.check("one report (layers-row)", rep(logs,base)==[("layers-row","scr-01")], rep(logs,base))
        await page.locator(".rows .row.error button").click(); await page.wait_for_timeout(600)
        t.check("row retry loads children", await page.locator(".rows .row.error").count()==0)
        base = len(reports(logs))

        # ---- thrown in various places ----
        for label, act in [("…while drawing outlines", None), ("…in the next click handler", "click"), ("…in the next key handler", "key"), ("…handling the next message", "msg"), ("…in a timer", None)]:
            b0 = len(reports(logs))
            await dev(page, label); await page.wait_for_timeout(300)
            if act=="click": await page.mouse.click(x,y)
            if act=="key": await page.keyboard.press("i"); await page.keyboard.press("v")
            if act=="msg": await page.wait_for_timeout(100); await page.mouse.move(x,y); await page.mouse.click(x+2,y)
            await page.wait_for_timeout(800)
            got = rep(logs,b0)
            print("   ", label, "->", got, "| error boxes:", await page.locator(".error-box").count())
            t.check(f"{label}: exactly one report", len(got)==1, got)
            # recover: click any Retry
            for _ in range(3):
                btn = page.locator(".preview-error button, .board-banner button")
                if await btn.count(): await btn.first.click(); await page.wait_for_timeout(1200)
        print(f"\n{t.ok} ok, {t.bad} failed")
        
        await b.close()
asyncio.run(main())
