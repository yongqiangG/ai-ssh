"""拼图识别的合成图像回归，不保存真实验证码。"""

import io
import random
import unittest

from PIL import Image
from workload_captcha import CaptchaSolver
from workload_security import CaptchaRejected


def png(image):
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


class TestSliderMatching(unittest.TestCase):
    def test_transparent_border_and_darkened_gap_preserve_offset(self):
        randomizer = random.Random(42)
        background = Image.new("RGB", (96, 40))
        background.putdata(
            [
                tuple(randomizer.randrange(30, 240) for _ in range(3))
                for _ in range(96 * 40)
            ]
        )
        offset = 46
        piece = Image.new("RGBA", (20, 40))
        for y in range(8, 30):
            for x in range(3, 17):
                color = background.getpixel((x + offset, y))
                piece.putpixel((x, y), (*color, 255))
                background.putpixel(
                    (x + offset, y), tuple(round(value * 0.7) for value in color)
                )
        self.assertEqual(
            CaptchaSolver.match_slider(png(background), png(piece)), offset
        )

    def test_unusable_image_enters_captcha_fallback(self):
        with self.assertRaises(CaptchaRejected):
            CaptchaSolver.match_slider(b"invalid", b"invalid")
        with self.assertRaises(CaptchaRejected):
            CaptchaSolver.match_slider(
                png(Image.new("RGB", (96, 40))), png(Image.new("RGBA", (20, 40)))
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
