"""Helpers for the browser tests. They drive the real app in real Chromium (Playwright for Python).

    pip install playwright && python3 -m playwright install chromium
    npm start            # in one terminal
    npm test             # in another   (set CHROME=/path/to/chrome to use a browser you already have)
"""
import asyncio, json, os
from playwright.async_api import async_playwright
CHROME = os.environ.get("CHROME")
class T:
    def __init__(s): s.ok=0; s.bad=0
    def check(s, name, cond, extra=""):
        if cond: s.ok+=1; print("  ok  ", name)
        else: s.bad+=1; print("  FAIL", name, extra)
async def start(p, url="http://localhost:5173/"):
    b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"]) if CHROME else await p.chromium.launch(args=["--no-sandbox"])
    page = await b.new_page(viewport={"width":1600,"height":900})
    logs=[]
    page.on("console", lambda m: logs.append(m.text))
    page.on("pageerror", lambda e: logs.append("PAGEERROR "+str(e)))
    await page.goto(url)
    await page.wait_for_selector("iframe")
    await page.wait_for_function("document.querySelectorAll('.loading').length==0 && document.querySelectorAll('.frame').length==24", timeout=20000)
    return b, page, logs
def reports(logs): return [l for l in logs if l.startswith("[report")]
async def frame_box(page, sid):
    return await page.locator(f'.frame[data-frame="{sid}"]').bounding_box()
async def zoom_to(page, sid, z_target=1.0):
    """zoom the board so preview sid is at about z_target and fully visible; return bounding box"""
    b = await frame_box(page, sid)
    await page.mouse.move(b["x"]+5, b["y"]+5)
    await page.keyboard.down("Control")
    for _ in range(40):
        cur = float((await page.locator(".toolbar .muted").inner_text()).strip("%"))/100
        if abs(cur - z_target) < 0.03: break
        await page.mouse.wheel(0, -40 if cur < z_target else 40); await page.wait_for_timeout(20)
    await page.keyboard.up("Control")

async def bring(page, sid, z=0.6):
    """zoom to z, then drag the board so preview sid sits at the top-left of the board area"""
    await zoom_to(page, sid, z)
    fb = await frame_box(page, sid)
    bd = await page.locator("#board").bounding_box()
    sx, sy = fb["x"]-8, fb["y"]+60
    tx, ty = sx + (bd["x"]+30 - fb["x"]), sy + (bd["y"]+50 - fb["y"])
    await page.mouse.move(sx, sy); await page.mouse.down()
    await page.mouse.move((sx+tx)/2, (sy+ty)/2, steps=4); await page.mouse.move(tx, ty, steps=4)
    await page.mouse.up(); await page.wait_for_timeout(100)
    return await frame_box(page, sid)

async def reset(page):
    await page.goto("http://localhost:5173/")
    await page.wait_for_function("document.querySelectorAll('.loading').length==0 && document.querySelectorAll('.frame').length==24", timeout=20000)

INDEX = {f"scr-{i+1:02d}": i for i in range(24)}
async def bring_exact(page, sid, z=0.6):
    """put preview sid at the top-left of the board at zoom z (sets the view directly)"""
    i = INDEX[sid]
    cx, cy = (i % 4) * (1280+40), (i // 4) * (800+32+40)
    await page.evaluate("([x,y,z]) => window.__board.update(s => { s.view = {x, y, z}; s.hover = null; })", [30 - cx*z, 50 - (cy+32)*z, z])
    await page.wait_for_timeout(150)
    return await frame_box(page, sid)
