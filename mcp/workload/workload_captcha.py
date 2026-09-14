"""本地验证码识别；模型按需加载，不使用云端识别服务。"""

from __future__ import annotations

import io
import math
import re
import threading

from workload_security import CaptchaRejected, WorkloadError


class CaptchaSolver:
    def __init__(self):
        self._ocr = None
        self._lock = threading.Lock()

    def solve(self, challenge: dict) -> str | int:
        if challenge["kind"] == "text":
            return self.read_text(challenge["image"])
        return self.match_slider(challenge["background"], challenge["piece"])

    def read_text(self, image: bytes) -> str:
        try:
            import ddddocr
        except ImportError as exc:
            raise WorkloadError(
                "缺少验证码识别依赖，请运行 install.ps1 安装独立环境"
            ) from exc
        with self._lock:
            if self._ocr is None:
                self._ocr = ddddocr.DdddOcr(show_ad=False)
            answer = self._ocr.classification(image).strip()
        if not re.fullmatch(r"[A-Za-z0-9]{4}", answer):
            raise CaptchaRejected("未识别出完整的 4 位验证码")
        return answer

    @staticmethod
    def match_slider(background: bytes, piece: bytes) -> int:
        try:
            from PIL import Image, UnidentifiedImageError
        except ImportError as exc:
            raise WorkloadError(
                "缺少图像依赖，请运行 install.ps1 安装独立环境"
            ) from exc
        try:
            bg = Image.open(io.BytesIO(background)).convert("RGB")
            tile = Image.open(io.BytesIO(piece)).convert("RGBA")
        except (OSError, UnidentifiedImageError) as exc:
            raise CaptchaRejected("拼图图像无法识别，请换一张重试") from exc
        if not 0 < tile.width < bg.width <= 1000 or tile.height != bg.height:
            raise WorkloadError("项目系统验证码图片尺寸发生变化，请检查登录协议")
        bp, tp = bg.load(), tile.load()
        # 避开描边和透明像素；相关系数抵消缺口的亮度遮罩。
        samples = [
            (x, y, tp[x, y][:3])
            for y in range(2, tile.height - 2, 2)
            for x in range(2, tile.width - 2, 2)
            if all(
                tp[x + dx, y + dy][3] > 240
                for dx, dy in ((0, 0), (-2, 0), (2, 0), (0, -2), (0, 2))
            )
        ]
        if not samples:
            raise CaptchaRejected("拼图内容不足，请换一张重试")
        count = 3 * len(samples)
        total = sum(sum(pixel) for _, _, pixel in samples)
        variance = (
            sum(sum(v * v for v in pixel) for _, _, pixel in samples)
            - total * total / count
        )
        best_score, best_x = -1.0, 0
        for offset in range(bg.width - tile.width + 1):
            sum_bg = square_bg = products = 0
            for x, y, pixel in samples:
                target = bp[x + offset, y]
                sum_bg += sum(target)
                square_bg += sum(v * v for v in target)
                products += sum(a * b for a, b in zip(pixel, target))
            bg_variance = square_bg - sum_bg * sum_bg / count
            if variance > 0 and bg_variance > 0:
                score = (products - total * sum_bg / count) / math.sqrt(
                    variance * bg_variance
                )
                if score > best_score:
                    best_score, best_x = score, offset
        if best_score < 0.65:
            raise CaptchaRejected("未找到可靠的拼图位置，请换一张重试")
        return best_x
