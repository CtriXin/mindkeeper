#!/usr/bin/env python3
import argparse
import math
import os
from collections import Counter

from PIL import Image


def parse_ratio(value: str) -> float:
    if ":" in value:
        left, right = value.split(":", 1)
        return float(left) / float(right)
    return float(value)


def corner_background_color(img: Image.Image) -> tuple[int, int, int]:
    width, height = img.size
    block = max(8, min(width, height) // 12)
    samples = []
    corners = [
        (0, 0),
        (width - block, 0),
        (0, height - block),
        (width - block, height - block),
    ]
    for left, top in corners:
        for y in range(top, top + block):
            for x in range(left, left + block):
                samples.append(img.getpixel((x, y)))
    channels = list(zip(*samples))
    return tuple(int(sorted(channel)[len(channel) // 2]) for channel in channels)


def is_bg(pixel: tuple[int, int, int], bg: tuple[int, int, int], threshold: int) -> bool:
    return max(abs(pixel[i] - bg[i]) for i in range(3)) <= threshold


def line_bg_ratio(
    img: Image.Image,
    bg: tuple[int, int, int],
    threshold: int,
    index: int,
    axis: str,
) -> float:
    width, height = img.size
    if axis == "row":
      sample_count = max(24, width // 4)
      step = max(1, width // sample_count)
      points = ((x, index) for x in range(0, width, step))
    else:
      sample_count = max(24, height // 4)
      step = max(1, height // sample_count)
      points = ((index, y) for y in range(0, height, step))

    total = 0
    matches = 0
    for point in points:
      total += 1
      if is_bg(img.getpixel(point), bg, threshold):
        matches += 1
    return matches / max(1, total)


def detect_margin(
    img: Image.Image,
    bg: tuple[int, int, int],
    threshold: int,
    bg_ratio: float,
    side: str,
) -> int:
    width, height = img.size
    margin = 0
    if side == "top":
        for y in range(height):
            if line_bg_ratio(img, bg, threshold, y, "row") >= bg_ratio:
                margin += 1
            else:
                break
    elif side == "bottom":
        for y in range(height - 1, -1, -1):
            if line_bg_ratio(img, bg, threshold, y, "row") >= bg_ratio:
                margin += 1
            else:
                break
    elif side == "left":
        for x in range(width):
            if line_bg_ratio(img, bg, threshold, x, "col") >= bg_ratio:
                margin += 1
            else:
                break
    elif side == "right":
        for x in range(width - 1, -1, -1):
            if line_bg_ratio(img, bg, threshold, x, "col") >= bg_ratio:
                margin += 1
            else:
                break
    return margin


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def centered_aspect_box(box: tuple[int, int, int, int], target_ratio: float) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    width = right - left
    height = bottom - top
    if width <= 0 or height <= 0:
        raise ValueError("invalid crop box")

    current_ratio = width / height
    if math.isclose(current_ratio, target_ratio, rel_tol=0.03, abs_tol=0.03):
        return box

    if current_ratio > target_ratio:
        new_width = int(round(height * target_ratio))
        delta = width - new_width
        left += delta // 2
        right = left + new_width
    else:
        new_height = int(round(width / target_ratio))
        delta = height - new_height
        top += delta // 2
        bottom = top + new_height
    return (left, top, right, bottom)


def derive_box(
    img: Image.Image,
    target_ratio: float,
    threshold: int,
    bg_ratio: float,
) -> tuple[int, int, int, int]:
    width, height = img.size
    bg = corner_background_color(img)
    top = detect_margin(img, bg, threshold, bg_ratio, "top")
    bottom = detect_margin(img, bg, threshold, bg_ratio, "bottom")
    left = detect_margin(img, bg, threshold, bg_ratio, "left")
    right = detect_margin(img, bg, threshold, bg_ratio, "right")

    box = (left, top, width - right, height - bottom)
    box_width = box[2] - box[0]
    box_height = box[3] - box[1]

    if box_width < width * 0.3 or box_height < height * 0.3:
        # Margins look unreliable. Fall back to center crop from full image.
        box = (0, 0, width, height)

    return centered_aspect_box(box, target_ratio)


def main() -> int:
    parser = argparse.ArgumentParser(description="Crop a square canvas to the centered target aspect panel.")
    parser.add_argument("input_path")
    parser.add_argument("output_path", nargs="?")
    parser.add_argument("--aspect", default="3:4", help="Target aspect ratio like 3:4 or 16:9")
    parser.add_argument("--bg-threshold", type=int, default=18)
    parser.add_argument("--margin-bg-ratio", type=float, default=0.96)
    args = parser.parse_args()

    output_path = args.output_path
    if not output_path:
        root, ext = os.path.splitext(args.input_path)
        output_path = f"{root}_cropped{ext}"

    target_ratio = parse_ratio(args.aspect)

    image = Image.open(args.input_path).convert("RGB")
    crop_box = derive_box(image, target_ratio, args.bg_threshold, args.margin_bg_ratio)
    cropped = image.crop(crop_box)
    cropped.save(output_path)
    print(f"CROPPED {crop_box[0]},{crop_box[1]},{crop_box[2]},{crop_box[3]} -> {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
