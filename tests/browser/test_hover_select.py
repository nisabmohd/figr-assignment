from lib import *
async def content_frame(page, title):
    h = await page.locator(f'iframe[title="{title}"]').element_handle()
    return await h.content_frame()
async def rect(page, sel):
    r = await page.locator(sel).first.bounding_box()
    return r
async def main():
    t=T()
    async with async_playwright() as p:
        b,page,logs = await start(p)
        await bring_exact(page,"scr-01",0.6)
        fb = await frame_box(page,"scr-01"); z = fb["width"]/1280
        cf = await content_frame(page,"Landing")
        # pick an element: first button / link in the page
        info = await cf.evaluate("""() => { const el=document.querySelector('a, button'); const r=el.getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height,name:el.tagName}; }""")
        print("target", info)
        px = fb["x"] + (info["x"]+info["w"]/2)*z; py = fb["y"] + (info["y"]+info["h"]/2)*z
        await page.mouse.move(px, py); await page.wait_for_timeout(400)
        hov = page.locator(".box.hover")
        t.check("hover outline appears", await hov.count()==1)
        hb = await hov.bounding_box()
        t.check("hover outline on element box", abs(hb["x"]-(fb["x"]+info["x"]*z))<1.5 and abs(hb["width"]-info["w"]*z)<1.5 and abs(hb["y"]-(fb["y"]+info["y"]*z))<1.5, f"{hb} vs {info} z={z}")
        bw = await page.evaluate("getComputedStyle(document.querySelector('.box.hover')).borderTopWidth")
        t.check("hover is 1px", bw=="1px", bw)
        t.check("hover label shown", await page.locator(".tag.hover").count()==1, await page.locator(".tag").all_inner_texts())
        print("label", await page.locator(".tag.hover").inner_text())
        # click -> select
        await page.mouse.click(px,py); await page.wait_for_timeout(500)
        t.check("selected outline 2px", await page.evaluate("getComputedStyle(document.querySelector('.box.selected')).borderTopWidth")=="2px")
        t.check("hover not drawn on selected", await page.locator(".box.hover").count()==0)
        t.check("layers row selected", await page.locator(".row.selected").count()==1, await page.locator(".row.selected").count())
        t.check("inspector shows live", "Name" in await page.locator(".inspector").inner_text())
        print((await page.locator(".inspector").inner_text())[:400])
        # page did not navigate / act
        t.check("page unchanged (no navigation)", "page-1" in cf.url)
        # bg click clears
        bgp = await cf.evaluate("""() => { for (let y=790;y>0;y-=20) for (let x=1270;x>0;x-=20){ const e=document.elementFromPoint(x,y); if(e===document.body||e===document.documentElement) return [x,y]; } return null; }""")
        print("bg point", bgp)
        bx, by = fb["x"]+bgp[0]*z, fb["y"]+bgp[1]*z
        await page.mouse.move(bx,by)
        await page.mouse.click(bx,by); await page.wait_for_timeout(400)
        t.check("background click clears selection", await page.locator(".box.selected").count()==0)
        t.check("no hover on background", await page.locator(".box.hover").count()==0)
        # esc clears
        await page.mouse.click(px,py); await page.wait_for_timeout(400)
        await page.keyboard.press("Escape"); await page.wait_for_timeout(200)
        t.check("Escape clears", await page.locator(".box.selected").count()==0)
        # keyboard nav
        await page.mouse.click(px,py); await page.wait_for_timeout(400)
        before = await page.locator(".box.selected").bounding_box()
        await page.keyboard.press("Shift+Enter"); await page.wait_for_timeout(400)
        after = await page.locator(".box.selected").bounding_box()
        t.check("Shift+Enter selects parent", after["width"]>=before["width"] and after!=before, f"{before} {after}")
        await page.keyboard.press("Enter"); await page.wait_for_timeout(400)
        t.check("Enter selects first child", await page.locator(".box.selected").count()==1)
        await page.keyboard.press("Tab"); await page.wait_for_timeout(400)
        t.check("Tab selects sibling", await page.locator(".box.selected").count()==1)
        # shortcuts V/I
        await page.keyboard.press("i"); await page.wait_for_timeout(200)
        t.check("I -> interact (no outlines)", await page.locator(".box").count()==0 and await page.locator(".catcher").count()==0)
        await page.keyboard.press("v"); await page.wait_for_timeout(300)
        t.check("V -> select, selection back", await page.locator(".box.selected").count()==1)
        # interact mode, click inside the page then press v
        await page.keyboard.press("i"); await page.wait_for_timeout(200)
        await page.mouse.click(fb["x"]+20, fb["y"]+20)
        await page.keyboard.press("v"); await page.wait_for_timeout(300)
        t.check("shortcut works after clicking inside a preview", await page.locator(".catcher").count()>0)
        # wheel over preview scrolls page in select mode
        sy0 = await cf.evaluate("scrollY")
        await page.mouse.move(fb["x"]+100, fb["y"]+100)
        await page.mouse.wheel(0,200); await page.wait_for_timeout(300)
        sy1 = await cf.evaluate("scrollY")
        print("scrollY", sy0, sy1)
        t.check("wheel scrolls page in select mode", sy1>sy0 or await cf.evaluate("document.documentElement.scrollHeight<=innerHeight"))
        print("reports", reports(logs))
        
        print(f"\n{t.ok} ok, {t.bad} failed")
        await b.close()
asyncio.run(main())
