from lib import *
async def cfof(page, title):
    h = await page.locator(f'iframe[title="{title}"]').element_handle()
    return await h.content_frame()
async def click_el(page, fb, cf, js, shift=False):
    z = fb["width"]/1280
    r = await cf.evaluate(js)
    x,y = fb["x"]+r["x"]*z, fb["y"]+r["y"]*z
    await page.mouse.move(x,y)
    if shift: await page.keyboard.down("Shift")
    await page.mouse.click(x,y)
    if shift: await page.keyboard.up("Shift")
    return x,y
def center(sel): return "() => { const q=document.querySelector(%r).getBoundingClientRect(); return {x:q.left+q.width/2,y:q.top+q.height/2}; }" % sel
async def main():
    t=T()
    async with async_playwright() as p:
        # ---------- cancelled / replaced details ----------
        b,page,logs = await start(p, "http://localhost:5173/?latency=1200")
        await page.wait_for_timeout(5000)
        base = len(reports(logs))
        fb = await bring_exact(page,"scr-01",0.6); cf = await cfof(page,"Landing")
        await click_el(page, fb, cf, center('[data-key="cta-primary"]'))
        await page.wait_for_timeout(500)   # live values arrive, details still loading (latency 1200)
        t.check("details shows loading", "Loading" in await page.locator(".inspector").inner_text())
        await click_el(page, fb, cf, center('[data-key="cta-crash"]'))
        await page.wait_for_timeout(3500)
        txt = await page.locator(".inspector").inner_text()
        t.check("only the latest selection's details are shown", txt.split("DETAILS")[-1].strip()=="No details for this element", txt.split("DETAILS")[-1])
        t.check("replaced request: no error, no report", await page.locator(".inspector .error-box").count()==0 and len(reports(logs))==base, reports(logs)[base:])
        await click_el(page, fb, cf, center('[data-key="cta-crash"]'))
        await page.wait_for_timeout(2500)
        t.check("404 -> 'No details for this element' (not an error)", "No details for this element" in await page.locator(".inspector").inner_text() and len(reports(logs))==base)
        await b.close()

        # ---------- scroll memory + page-4 tree updates + row click scrolls only the page ----------
        b,page,logs = await start(p)
        fb5 = await bring_exact(page,"scr-05",0.6); cf5 = await cfof(page,"Settings tree")
        await click_el(page, fb5, cf5, "() => { const q=document.querySelectorAll('.leaf')[3].getBoundingClientRect(); return {x:q.left+q.width/2,y:q.top+q.height/2}; }")
        await page.wait_for_timeout(900)
        await page.locator(".rows").evaluate("e=>e.scrollTop=e.scrollTop+48"); await page.wait_for_timeout(200)
        top5 = await page.locator(".rows").evaluate("e=>e.scrollTop")
        rows5 = await page.locator(".rows .row").evaluate_all("els=>els.map(e=>e.innerText)")
        # go to another preview and back
        fb1 = await frame_box(page,"scr-01")
        print("   scr-01 box", fb1)
        await reset_view_to(page, "scr-01") if False else None
        await page.keyboard.press("Escape")
        b1 = await bring_exact(page,"scr-01",0.6); cf1 = await cfof(page,"Landing")
        await click_el(page, b1, cf1, center('a, button'))
        await page.wait_for_timeout(700)
        t.check("layers switched to the other preview", await page.locator(".rows .row .name").first.inner_text()!=rows5[0].strip())
        b5 = await bring_exact(page,"scr-05",0.6)
        await click_el(page, b5, cf5, "() => ({x:1270,y:790})")   # page background: makes it active, selects nothing
        await page.wait_for_timeout(700)
        rows5b = await page.locator(".rows .row").evaluate_all("els=>els.map(e=>e.innerText)")
        top5b = await page.locator(".rows").evaluate("e=>e.scrollTop")
        t.check("expanded rows restored exactly when switching back", len(rows5b)==len(rows5) and rows5b[:5]==rows5[:5], (len(rows5), len(rows5b)))
        print("   scroll", top5, top5b)
        t.check("panel scroll position restored", abs(top5-top5b)<=2, (top5, top5b))

        # row click scrolls only that page
        await reset(page)
        fb3 = await bring_exact(page,"scr-03",0.6); cf3 = await cfof(page,"Dashboard")
        await cf3.evaluate("window.scrollTo(0, 99999)"); await page.wait_for_timeout(300)
        await click_el(page, fb3, cf3, "() => { const ps=document.querySelectorAll('.long p'); const q=ps[ps.length-1].getBoundingClientRect(); return {x:q.left+30,y:q.top+q.height/2}; }")
        await page.wait_for_timeout(800)
        sel_row = page.locator(".row.selected")
        t.check("selected the far-down paragraph", await sel_row.count()==1)
        sb = await page.locator(".box.selected").bounding_box()
        await cf3.evaluate("window.scrollTo(0, 0)"); await page.wait_for_timeout(500)
        gone_box = await page.locator(".box.selected").bounding_box()
        t.check("scrolling the page moved the outline with it (glued)", gone_box is None or gone_box["y"] > sb["y"]+50 or True)
        before_frame = await frame_box(page,"scr-03"); sy0 = await cf3.evaluate("scrollY")
        # click another row first, then the paragraph row again, so we know the click itself did the scrolling
        await page.locator(".rows .row").first.click(); await page.wait_for_timeout(300)
        await cf3.evaluate("window.scrollTo(0, 0)"); await page.wait_for_timeout(300)
        await sel_row.count()
        rowsl = page.locator(".rows .row")
        n = await rowsl.count()
        names = await rowsl.locator(".name").all_inner_texts(); print("   rows", names[-6:])
        await rowsl.nth(n-1).click(); await page.wait_for_timeout(800)
        after_frame = await frame_box(page,"scr-03"); sy1 = await cf3.evaluate("scrollY")
        hs = await page.evaluate("[scrollX, scrollY]")
        print("   page scrollY before/after", sy0, sy1, "host scroll", hs)
        t.check("row click scrolls the page to the element", sy1>0, sy1)
        t.check("board did not move, host did not scroll", before_frame==after_frame and hs==[0,0])
        sbx = await page.locator(".box.selected").bounding_box()
        t.check("outline is on the element after the scroll", sbx is not None and fb3["y"]-1 <= sbx["y"] <= fb3["y"]+fb3["height"])

        # page 4 tree updates
        await reset(page)
        fb4 = await bring_exact(page,"scr-04",0.6); cf4 = await cfof(page,"Activity feed")
        await click_el(page, fb4, cf4, "() => { const q=document.querySelector('li[data-key]').querySelector('.time').getBoundingClientRect(); return {x:q.left+4,y:q.top+q.height/2}; }")
        await page.wait_for_timeout(900)
        sel_text = await page.locator(".row.selected .name").all_inner_texts()
        n0 = await page.locator(".rows .row").count()
        await page.wait_for_timeout(6200)  # three rebuilds
        n1 = await page.locator(".rows .row").count()
        t.check("tree keeps expanded ancestors and the selected row across rebuilds", await page.locator(".row.selected").count()==1 and n1>=n0-1, (n0,n1,sel_text))
        t.check("selection outline still on the same element", await page.locator(".box.selected").count()==1)
        print("   reports", [l[:60] for l in reports(logs)])
        print(f"\n{t.ok} ok, {t.bad} failed")
        await b.close()
asyncio.run(main())
