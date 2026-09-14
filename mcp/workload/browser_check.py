"""独立浏览器验收：合成验证码、本机 HTTP、桌面/窄窗截图，无真实系统登录。"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import queue
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright
from workload_security import CancelledError, CaptchaRejected, RunContext, WorkloadError
from workload_verification import ManualVerifier

ROOT = Path(__file__).parent
EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")


def png(image):
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def sample(kind):
    if kind == "text":
        image = Image.new("RGB", (145, 50), "#ebf0f5")
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 32)
        draw.text((25, 7), "a3bc", fill="#204c62", font=font)
        return {
            "kind": "text",
            "image": png(image),
            "_token": "synthetic-private-token",
        }
    background = Image.new("RGB", (310, 155))
    for y in range(155):
        for x in range(310):
            background.putpixel((x, y), (35 + x // 3, 70 + y // 2, 100 + (x + y) // 4))
    draw = ImageDraw.Draw(background)
    for x in range(20, 300, 35):
        draw.line((x, 0, x + 60, 155), fill="#c2b992", width=6)
    piece = Image.new("RGBA", (47, 155))
    for y in range(50, 94):
        for x in range(3, 44):
            color = background.getpixel((x + 80, y))
            piece.putpixel((x, y), (*color, 255))
            background.putpixel((x + 80, y), tuple(value // 2 for value in color))
    return {"kind": "slider", "background": png(background), "piece": png(piece)}


@contextmanager
def verification(kind, submit, timeout=30):
    urls = queue.Queue()
    context = RunContext()
    verifier = ManualVerifier(
        context, timeout_seconds=timeout, open_browser=lambda url: urls.put(url) or True
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(
            verifier.solve,
            "OA 系统" if kind == "text" else "项目系统",
            lambda: sample(kind),
            submit,
        )
        try:
            yield urls.get(timeout=5), future
        finally:
            context.cancelled.set()


async def run(browser_path, screenshots):
    screenshots.mkdir(parents=True, exist_ok=True)
    checks, errors = [], []

    def check(name, passed):
        checks.append({"name": name, "passed": bool(passed)})

    async def fits(page, name):
        check(
            name,
            await page.evaluate("document.documentElement.scrollWidth <= innerWidth"),
        )

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=str(browser_path), headless=True
        )
        page = await browser.new_page(
            viewport={"width": 1280, "height": 900}, device_scale_factor=1
        )
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.set_default_timeout(8000)

        def submit_text(challenge, answer):
            if answer != "a3bc":
                raise CaptchaRejected("验证码不正确，请使用新图片重试")
            return "synthetic-session"

        with verification("text", submit_text) as (url, future):
            await page.goto(url)
            await page.locator("#answer").wait_for(state="visible")
            check(
                "OA input receives initial focus",
                await page.locator("#answer").evaluate(
                    "el => el === document.activeElement"
                ),
            )
            await fits(page, "Desktop has no horizontal overflow")
            await page.screenshot(path=str(screenshots / "desktop.png"), full_page=True)
            generation = await page.evaluate("current.generation")
            await page.locator("#answer").fill("bad1")
            await page.locator("#submit").click()
            await page.wait_for_function(
                "previous => current.generation !== previous && !busy", arg=generation
            )
            check(
                "Wrong answer displays recovery text",
                "不正确" in await page.locator("#message").inner_text(),
            )
            check(
                "Wrong answer returns focus to the input",
                await page.locator("#answer").evaluate(
                    "el => el === document.activeElement"
                ),
            )
            await page.screenshot(
                path=str(screenshots / "desktop-error.png"), full_page=True
            )
            generation = await page.evaluate("current.generation")
            await page.locator("#refresh").click()
            await page.wait_for_function(
                "previous => current.generation !== previous && !busy", arg=generation
            )
            check(
                "Refresh returns focus to the input",
                await page.locator("#answer").evaluate(
                    "el => el === document.activeElement"
                ),
            )

            # 保留一个真实的旧状态响应，模拟用户验证完成后轮询才抵达的竞态。
            held, release, delivered = asyncio.Event(), asyncio.Event(), asyncio.Event()

            async def delay_state(route):
                response = await route.fetch()
                held.set()
                await release.wait()
                await route.fulfill(response=response)
                delivered.set()

            await page.route("**/api/state", delay_state)
            try:
                await asyncio.wait_for(held.wait(), timeout=5)
                await page.locator("#answer").fill("a3bc")
                await page.locator("#submit").click()
                await page.wait_for_function("() => finished")
                check(
                    "Successful verification resumes the caller",
                    future.result(timeout=2) == "synthetic-session",
                )
                release.set()
                await asyncio.wait_for(delivered.wait(), timeout=3)
                await page.wait_for_timeout(150)
                check(
                    "Late polling does not reopen a completed form",
                    await page.locator("#form").is_hidden(),
                )
            finally:
                release.set()
                await page.unroute("**/api/state", delay_state)

        with verification("slider", lambda challenge, answer: {"selected": answer}) as (
            url,
            future,
        ):
            await page.set_viewport_size({"width": 360, "height": 800})
            await page.goto(url)
            await page.locator("#slider").wait_for(state="visible")
            await fits(page, "Narrow window has no horizontal overflow")
            await page.screenshot(path=str(screenshots / "mobile.png"), full_page=True)
            await page.locator("#slider").press("ArrowRight")
            check(
                "Slider supports keyboard adjustment",
                await page.locator("#slider").input_value() == "1",
            )
            position = await page.locator("#piece").evaluate(
                "el => parseFloat(el.style.left)"
            )
            check("Puzzle follows the keyboard position", 0 < position < 1)
            slider = await page.locator("#slider").bounding_box()
            await page.mouse.click(
                slider["x"] + slider["width"] * 0.4, slider["y"] + slider["height"] / 2
            )
            selected = int(await page.locator("#slider").input_value())
            await page.locator("#submit").click()
            await page.wait_for_function("() => finished")
            check(
                "Slider submits its selected coordinate",
                future.result(timeout=2) == {"selected": selected},
            )
            await page.screenshot(
                path=str(screenshots / "mobile-completed.png"), full_page=True
            )

        with verification("text", submit_text) as (url, future):
            await page.goto(url)
            await page.locator("#cancel").click()
            await page.wait_for_function("() => finished")
            try:
                future.result(timeout=2)
                check("Cancel ends the waiting report", False)
            except CancelledError:
                check("Cancel ends the waiting report", True)

        with verification("text", submit_text, timeout=2) as (url, future):
            await page.goto(url)
            await page.wait_for_function("() => finished")
            try:
                future.result(timeout=2)
                check("Deadline ends the waiting report", False)
            except WorkloadError as exc:
                check("Deadline ends the waiting report", "超时" in str(exc))

        check("No JavaScript runtime errors", not errors)
        await browser.close()

    result = {"checks": checks, "errors": errors, "screenshots": str(screenshots)}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if all(item["passed"] for item in checks) else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", type=Path, default=EDGE)
    parser.add_argument(
        "--screenshots", type=Path, default=ROOT / ".impeccable" / "review"
    )
    arguments = parser.parse_args()
    raise SystemExit(asyncio.run(run(arguments.browser, arguments.screenshots)))
