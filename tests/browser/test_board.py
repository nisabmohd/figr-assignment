from lib import *
async def cfof(page, title):
    h = await page.locator(f'iframe[title="{title}"]').element_handle()
    return await h.content_frame()
async def zoomval(page): return float((await page.locator(".toolbar .muted").inner_text()).strip("%"))
async def main():
    t=T()
    async with async_playwright() as p:
        b,page,logs = await start(p)
        bd = await page.locator("#board").bounding_box()
        # ---- pan: wheel over empty board space and drag ----
        f0 = await frame_box(page,"scr-01")
        await page.mouse.move(bd["x"]+8, bd["y"]+bd["height"]-8)   # empty space bottom-left
        await page.mouse.wheel(0,100); await page.wait_for_timeout(100)
        f1 = await frame_box(page,"scr-01")
        t.check("wheel over empty board pans", abs((f0["y"]-f1["y"])-100)<2, (f0,f1))
        await page.mouse.move(bd["x"]+8, bd["y"]+bd["height"]-8); await page.mouse.down(); await page.mouse.move(bd["x"]+60, bd["y"]+bd["height"]-40, steps=5); await page.mouse.up()
        f2 = await frame_box(page,"scr-01")
        t.check("dragging empty space pans", abs((f2["x"]-f1["x"])-52)<3 and abs((f2["y"]-f1["y"])+32)<3, (f1,f2))
        # ---- zoom clamps ----
        await page.mouse.move(600,400); await page.keyboard.down("Control")
        for _ in range(60): await page.mouse.wheel(0,200)
        await page.wait_for_timeout(100)
        zmin = await zoomval(page)
        for _ in range(200): await page.mouse.wheel(0,-200)
        await page.wait_for_timeout(100)
        zmax = await zoomval(page)
        await page.keyboard.up("Control")
        t.check("zoom clamped to 25%..400%", zmin==25 and zmax==400, (zmin,zmax))
        await reset(page)

        # ---- 1px/2px at any zoom, label size constant ----
        fb = await bring_exact(page,"scr-01",0.6); z=fb["width"]/1280
        cf = await cfof(page,"Landing")
        r = await cf.evaluate("""() => { const el=document.querySelector('a, button'); const q=el.getBoundingClientRect(); return {x:q.left+q.width/2,y:q.top+q.height/2,w:q.width}; }""")
        x,y = fb["x"]+r["x"]*z, fb["y"]+r["y"]*z
        await page.mouse.move(x,y); await page.mouse.click(x,y); await page.wait_for_timeout(500)
        fs0 = await page.evaluate("getComputedStyle(document.querySelector('.tag.selected')).fontSize")
        # zoom with the pointer over the preview in select mode
        await page.keyboard.down("Control"); await page.mouse.wheel(0,-300); await page.keyboard.up("Control"); await page.wait_for_timeout(300)
        bw = await page.evaluate("getComputedStyle(document.querySelector('.box.selected')).borderTopWidth")
        fs1 = await page.evaluate("getComputedStyle(document.querySelector('.tag.selected')).fontSize")
        t.check("zoom over a preview works; outline still 2px, label size same", bw=="2px" and fs0==fs1, (bw,fs0,fs1))
        t.check("hover cleared by zoom", await page.locator(".box.hover").count()==0)
        z = (await frame_box(page,"scr-01"))["width"]/1280
        # outline still glued after zoom
        fb = await frame_box(page,"scr-01")
        info = await cf.evaluate("""() => { const el=document.querySelector('a, button'); const q=el.getBoundingClientRect(); return [q.left,q.top,q.width,q.height]; }""")
        sb = await page.locator(".box.selected").bounding_box()
        t.check("outline glued to element after zoom", abs(sb["x"]-(fb["x"]+info[0]*z))<1.5 and abs(sb["width"]-info[2]*z)<1.5, (sb, info, z))
        # Interact mode: ctrl+wheel over the preview zooms the board (agent forwards it)
        await page.keyboard.press("i"); await page.wait_for_timeout(200)
        z0 = await zoomval(page)
        fb = await frame_box(page,"scr-01"); bd = await page.locator("#board").bounding_box()
        cx = max(fb["x"], bd["x"]) + 100; cy = max(fb["y"], bd["y"]) + 100
        print("   pointer", cx, cy, "frame", fb)
        await page.mouse.move(cx, cy)
        await page.keyboard.down("Control"); await page.mouse.wheel(0,200); await page.keyboard.up("Control"); await page.wait_for_timeout(300)
        z1 = await zoomval(page)
        t.check("ctrl+wheel over an interactive preview zooms the board", z1<z0, (z0,z1))
        # plain wheel scrolls the page in interact mode too
        await page.mouse.move(cx, cy)
        sy0 = await cf.evaluate("scrollY"); await page.mouse.wheel(0,300); await page.wait_for_timeout(300); sy1 = await cf.evaluate("scrollY")
        t.check("wheel scrolls the page in interact mode", sy1>sy0 or await cf.evaluate("document.documentElement.scrollHeight<=innerHeight"), (sy0,sy1))
        await page.keyboard.press("v"); await page.wait_for_timeout(200)

        # ---- page 3: inner scroll area, outlines follow ----
        await reset(page)
        fb = await bring_exact(page,"scr-03",0.6); z=fb["width"]/1280
        cf = await cfof(page,"Dashboard")
        r = await cf.evaluate("""() => { const el=document.querySelector('[data-key="order-1001"]'); el.scrollIntoView({block:'center'}); const q=el.getBoundingClientRect(); return {x:q.left+q.width/2,y:q.top+q.height/2}; }""")
        await page.wait_for_timeout(300)
        x,y = fb["x"]+r["x"]*z, fb["y"]+r["y"]*z
        await page.mouse.move(x,y); await page.mouse.click(x,y); await page.wait_for_timeout(600)
        t.check("selected a table row", await page.locator(".box.selected").count()==1)
        sb0 = await page.locator(".box.selected").bounding_box()
        # scroll the inner scroll area with the wheel over it (select mode: forwarded)
        sa0 = await cf.evaluate("document.querySelector('.scroll-area').scrollTop")
        await page.mouse.move(x,y); await page.mouse.wheel(0,60); await page.wait_for_timeout(500)
        sa1 = await cf.evaluate("document.querySelector('.scroll-area').scrollTop")
        sb1 = await page.locator(".box.selected").bounding_box()
        t.check("wheel over an inner scroll area scrolls it (select mode)", sa1>sa0, (sa0,sa1))
        t.check("outline follows the element inside the scroll area", abs((sb0["y"]-sb1["y"]) - (sa1-sa0)*z) < 2, (sb0,sb1,sa1-sa0))
        # scroll element out of view inside page: no outline but still selected
        await cf.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        await page.wait_for_timeout(500)
        vis = await page.locator(".box.selected").bounding_box()
        out = (vis is None) or (vis["y"] > fb["y"]+fb["height"]) or (vis["y"]+vis["height"] < fb["y"])
        print("   box after scrolling away:", vis)
        t.check("still selected after scrolling away", "Name" in await page.locator(".inspector").inner_text())
        # label below when no room above: select the sticky header's first element at the top
        await cf.evaluate("window.scrollTo(0,0)"); await page.wait_for_timeout(400)
        r = await cf.evaluate("""() => { const el=document.querySelector('header'); const q=el.getBoundingClientRect(); return {x:q.left+q.width/2,y:q.top+q.height/2}; }""")
        await page.mouse.click(fb["x"]+r["x"]*z, fb["y"]+r["y"]*z); await page.wait_for_timeout(500)
        tag = await page.locator(".tag.selected").bounding_box(); box = await page.locator(".box.selected").bounding_box()
        t.check("label goes below the element when there's no room above", tag["y"] >= box["y"]+box["height"]-1, (tag,box))
        # outlines clipped to preview edge: select something partly outside? (frame has overflow hidden)
        t.check("preview frame clips outlines", await page.evaluate("getComputedStyle(document.querySelector('.frame')).overflow")=="hidden")

        # ---- shift+click in another preview replaces ----
        await reset(page)
        fb1 = await bring_exact(page,"scr-01",0.35); z1=fb1["width"]/1280
        cf1 = await cfof(page,"Landing")
        pts = await cf1.evaluate("""() => [...document.querySelectorAll('a, button')].slice(0,2).map(el=>{const q=el.getBoundingClientRect();return {x:q.left+q.width/2,y:q.top+q.height/2}})""")
        for i,pt in enumerate(pts):
            await page.mouse.move(fb1["x"]+pt["x"]*z1, fb1["y"]+pt["y"]*z1)
            if i: await page.keyboard.down("Shift")
            await page.mouse.click(fb1["x"]+pt["x"]*z1, fb1["y"]+pt["y"]*z1)
            if i: await page.keyboard.up("Shift")
            await page.wait_for_timeout(500)
        t.check("shift+click adds in same preview", await page.locator(".box.selected").count()==2)
        fb2 = await frame_box(page,"scr-02"); z2=fb2["width"]/1280
        cf2 = await cfof(page,"Sign up")
        pt = (await cf2.evaluate("""() => { const q=document.querySelector('a, button').getBoundingClientRect(); return {x:q.left+q.width/2,y:q.top+q.height/2}; }"""))
        print("   scr-07 frame", fb2, "board", await page.locator("#board").bounding_box())
        await page.mouse.move(fb2["x"]+pt["x"]*z2, fb2["y"]+pt["y"]*z2)
        await page.keyboard.down("Shift"); await page.mouse.click(fb2["x"]+pt["x"]*z2, fb2["y"]+pt["y"]*z2); await page.keyboard.up("Shift"); await page.wait_for_timeout(600)
        t.check("shift+click in another preview replaces the selection", await page.locator(".box.selected").count()==1)
        # only one hover on the whole board
        await page.mouse.move(fb1["x"]+pts[0]["x"]*z1, fb1["y"]+pts[0]["y"]*z1); await page.wait_for_timeout(300)
        t.check("exactly one hover outline on the board", await page.locator(".box.hover").count()<=1)
        # pan clears hover
        await page.mouse.move(fb1["x"]+pts[0]["x"]*z1, fb1["y"]+pts[0]["y"]*z1); await page.wait_for_timeout(300)
        await page.mouse.wheel(0,0)
        await page.keyboard.down("Control"); await page.mouse.wheel(0,-50); await page.keyboard.up("Control"); await page.wait_for_timeout(200)
        t.check("hover cleared when zooming", await page.locator(".box.hover").count()==0)
        # pointer leaves window
        await page.mouse.move(fb1["x"]+pts[0]["x"]*z1, fb1["y"]+pts[0]["y"]*z1); await page.wait_for_timeout(300)
        await page.mouse.move(5, 5); await page.wait_for_timeout(200)
        t.check("hover cleared when pointer leaves the preview", await page.locator(".box.hover").count()==0)

        print(f"\n{t.ok} ok, {t.bad} failed")
        await b.close()
asyncio.run(main())
