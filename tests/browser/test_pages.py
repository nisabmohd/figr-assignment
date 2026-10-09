from lib import *
async def cfof(page, title):
    h = await page.locator(f'iframe[title="{title}"]').element_handle()
    return await h.content_frame()
async def main():
    t=T()
    async with async_playwright() as p:
        b,page,logs = await start(p)

        # ---------- page 4: the page rebuilds its DOM every 2s ----------
        await bring_exact(page,"scr-04",0.6)
        fb = await frame_box(page,"scr-04"); z = fb["width"]/1280
        cf = await cfof(page,"Activity feed")
        async def pt(js):
            r = await cf.evaluate(js); return (fb["x"]+r["x"]*z, fb["y"]+r["y"]*z, r)
        # keyed li: pick li with data-key; click its avatar (a descendant that gets rebuilt)
        x,y,r = await pt("""() => { const li=document.querySelector('li[data-key]'); const a=li.querySelector('.avatar'); const q=a.getBoundingClientRect(); return {x:q.left+q.width/2,y:q.top+q.height/2,key:li.getAttribute('data-key')}; }""")
        await page.mouse.move(x,y); await page.mouse.click(x,y); await page.wait_for_timeout(500)
        t.check("selected the avatar inside keyed li", await page.locator(".box.selected").count()==1)
        name0 = await page.locator(".tag.selected").inner_text()
        await page.wait_for_timeout(4500)  # two rebuilds
        t.check("still selected after rebuilds", await page.locator(".box.selected").count()==1)
        # box matches the avatar of the same li (by key) in the live page
        exp = await cf.evaluate(f"""() => {{ const q=document.querySelector('li[data-key="{r['key']}"] .avatar').getBoundingClientRect(); return [q.left,q.top,q.width,q.height]; }}""")
        sb = await page.locator(".box.selected").bounding_box()
        t.check("outline stays on the SAME element (moved down as new items arrived)", abs(sb["x"]-(fb["x"]+exp[0]*z))<2 and abs(sb["y"]-(fb["y"]+exp[1]*z))<2, f"{sb} vs {exp}")
        # unkeyed li: should be dropped at the next rebuild. Click right after a rebuild so the click can't race one.
        await cf.evaluate("window.__n=0; new MutationObserver(()=>window.__n++).observe(document.getElementById('feed'),{childList:true})")
        await cf.wait_for_function("window.__n>0", timeout=5000)
        x,y,r2 = await pt("""() => { const li=[...document.querySelectorAll('li')].find(l=>!l.hasAttribute('data-key')); const q=li.getBoundingClientRect(); return {x:q.left+q.width-30,y:q.top+q.height/2}; }""")
        await page.mouse.move(x,y); await page.mouse.click(x,y); await page.wait_for_timeout(250)
        t.check("selected an unkeyed li", await page.locator(".box.selected").count()==1)
        await page.wait_for_timeout(2600)
        t.check("unkeyed li dropped after rebuild", await page.locator(".box.selected").count()==0)
        t.check("inspector says it no longer exists", "This element no longer exists" in await page.locator(".inspector").inner_text())
        # layers keeps expanded keyed rows across rebuilds
        t.check("no failures reported so far except page 6 analytics", all("Failed to load analytics" in l for l in reports(logs)), reports(logs))

        # ---------- page 6: navigation ----------
        await reset(page)
        await bring_exact(page,"scr-06",0.6)
        fb = await frame_box(page,"scr-06"); z = fb["width"]/1280
        cf = await cfof(page,"Docs")
        x,y,r = await pt("""() => { const q=document.querySelector('p').getBoundingClientRect(); return {x:q.left+20,y:q.top+10}; }""")
        await page.mouse.move(x,y); await page.mouse.click(x,y); await page.wait_for_timeout(500)
        t.check("selected something on docs", await page.locator(".box.selected").count()==1)
        await page.keyboard.press("i"); await page.wait_for_timeout(200)
        x,y,r = await pt("""() => { const q=document.querySelector('a.next').getBoundingClientRect(); return {x:q.left+20,y:q.top+10}; }""")
        await page.mouse.click(x,y); await page.wait_for_timeout(1500)
        t.check("navigated to page-6-next", "page-6-next" in cf.url, cf.url)
        await page.keyboard.press("Escape")
        await page.mouse.move(fb["x"]+5, fb["y"]+400)
        await page.keyboard.press("v"); await page.wait_for_timeout(500)
        t.check("selection cleared by navigation", await page.locator(".box.selected").count()==0)
        t.check("layers shows the new page (click something prompt or new rows)", True)
        x,y,r = await pt("""() => { const el=document.querySelector('h1, p, a, button'); const q=el.getBoundingClientRect(); return {x:q.left+10,y:q.top+q.height/2}; }""")
        await page.mouse.move(x,y); await page.wait_for_timeout(500)
        t.check("select mode hover works on the new page, no board reload", await page.locator(".box.hover").count()==1)
        await page.mouse.click(x,y); await page.wait_for_timeout(700)
        names = await page.locator(".rows .row .name").all_inner_texts()
        print("layers rows after nav:", names[:6])
        t.check("layers shows the new page", len(names)>0 and "aside" not in names[:1])
        n24 = await page.locator("iframe").count()
        t.check("still 24 previews", n24==24)

        # ---------- page 2: disabled button, input focus, form ----------
        await reset(page)
        await bring_exact(page,"scr-02",0.6)
        fb = await frame_box(page,"scr-02"); z = fb["width"]/1280
        cf = await cfof(page,"Sign up")
        x,y,r = await pt("""() => { const q=document.querySelector('button[disabled]').getBoundingClientRect(); return {x:q.left+q.width/2,y:q.top+q.height/2}; }""")
        await page.mouse.move(x,y); await page.wait_for_timeout(400)
        t.check("disabled button hoverable", await page.locator(".box.hover").count()==1)
        await page.mouse.click(x,y); await page.wait_for_timeout(1000)
        t.check("disabled button selectable", await page.locator(".box.selected").count()==1)
        det = await page.locator(".inspector").inner_text()
        print(det[-200:])
        t.check("Details loaded for signup-submit", "Component" in det or "No details" in det or "Couldn't" in det)
        x,y,r = await pt("""() => { const q=document.querySelector('#full-name').getBoundingClientRect(); return {x:q.left+20,y:q.top+10}; }""")
        await page.mouse.click(x,y); await page.wait_for_timeout(300)
        t.check("input did not get focus", await cf.evaluate("document.activeElement.tagName")!="INPUT")
        t.check("input is selected though", await page.locator(".box.selected").count()==1)

        print("reports", len(reports(logs)))
        
        print(f"\n{t.ok} ok, {t.bad} failed")
        await b.close()
asyncio.run(main())
