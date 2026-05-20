import json
import base64
import shutil
import subprocess
import mimetypes
import re
from pathlib import Path
from collections import Counter

import cv2
import numpy as np
import requests
from openai import OpenAI
from PIL import Image, ImageFont, ImageDraw

# =========================================================
# CONFIG
# =========================================================
BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = BASE_DIR / "template_resultado"
TEMPLATE_ESCALACAO_DIR = BASE_DIR / "template_escalacao"
TEMPLATE_PROXIMO_JOGO_DIR = BASE_DIR / "template_proximo_jogo"
TEMPLATE_PATROCINADOR_DIR = BASE_DIR / "template_patrocinador"
OUT_DIR = BASE_DIR / "resultados_prontos"
OUT_DIR.mkdir(exist_ok=True)

OPENAI_KEY_FILE = BASE_DIR / "openai_key.txt"
CREDENTIALS_FILE = BASE_DIR / "credenciais.txt"
PROMPT_PALETA_FILE = BASE_DIR / "prompt_paleta.json"
PROMPT_IMAGEM_FILE = BASE_DIR / "prompt_imagem.txt"

OPENAI_URL = "https://api.openai.com/v1/responses"
OPENAI_MODEL = "gpt-4.1-mini"
OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations"
OPENAI_IMAGE_MODEL = "gpt-image-1.5"

if OPENAI_IMAGE_MODO == "barato":
    OPENAI_IMAGE_QUALITY = "low"
    OPENAI_IMAGE_SIZE = "1024x1536"
elif OPENAI_IMAGE_MODO == "premium":
    OPENAI_IMAGE_QUALITY = "high"
    OPENAI_IMAGE_SIZE = "1024x1536"

FFMPEG_BIN = "ffmpeg"

W = 1080
H = 1920

FONT_DIR = BASE_DIR / "fonts"

FONT_MAP = {
   "pesada impactante": str((FONT_DIR / "Anton-Regular.ttf") if (FONT_DIR / "Anton-Regular.ttf").exists() else Path(r"C:/Windows/Fonts/arialbd.ttf")),
    "condensada esportiva": str((FONT_DIR / "BebasNeue-Regular.ttf") if (FONT_DIR / "BebasNeue-Regular.ttf").exists() else Path(r"C:/Windows/Fonts/arialbd.ttf")),
    "moderna agressiva": str((FONT_DIR / "LeagueSpartan.ttf") if (FONT_DIR / "LeagueSpartan.ttf").exists() else Path(r"C:/Windows/Fonts/arialbd.ttf")),
    "tecnologica futurista": str((FONT_DIR / "Orbitron.ttf") if (FONT_DIR / "Orbitron.ttf").exists() else Path(r"C:/Windows/Fonts/arial.ttf")),
    "elegante forte": str((FONT_DIR / "Montserrat.ttf") if (FONT_DIR / "Montserrat.ttf").exists() else Path(r"C:/Windows/Fonts/arial.ttf"))
}
TROQUE POR ISSO:
OPENAI_IMAGE_SIZE = "1024x1536"
OPENAI_IMAGE_QUALITY = "medium"
OPENAI_INPUT_FIDELITY = "high"
OPENAI_OUTPUT_FORMAT = "jpeg"
OPENAI_IMAGE_N = 1
OPENAI_IMAGE_MODO = "normal"

if OPENAI_IMAGE_MODO == "barato":
    OPENAI_IMAGE_QUALITY = "low"
    OPENAI_IMAGE_SIZE = "1024x1536"
elif OPENAI_IMAGE_MODO == "premium":
    OPENAI_IMAGE_QUALITY = "high"
    OPENAI_IMAGE_SIZE = "1024x1536"

FFMPEG_BIN = "ffmpeg"

W = 1080
H = 1920

FONT_DIR = BASE_DIR / "fonts"

FONT_MAP = {
   "pesada impactante": str((FONT_DIR / "Anton-Regular.ttf") if (FONT_DIR / "Anton-Regular.ttf").exists() else Path(r"C:/Windows/Fonts/arialbd.ttf")),
    "condensada esportiva": str((FONT_DIR / "BebasNeue-Regular.ttf") if (FONT_DIR / "BebasNeue-Regular.ttf").exists() else Path(r"C:/Windows/Fonts/arialbd.ttf")),
    "moderna agressiva": str((FONT_DIR / "LeagueSpartan.ttf") if (FONT_DIR / "LeagueSpartan.ttf").exists() else Path(r"C:/Windows/Fonts/arialbd.ttf")),
    "tecnologica futurista": str((FONT_DIR / "Orbitron.ttf") if (FONT_DIR / "Orbitron.ttf").exists() else Path(r"C:/Windows/Fonts/arial.ttf")),
    "elegante forte": str((FONT_DIR / "Montserrat.ttf") if (FONT_DIR / "Montserrat.ttf").exists() else Path(r"C:/Windows/Fonts/arial.ttf"))
}
TROQUE POR ISSO:
if OPENAI_IMAGE_MODO == "barato":
    OPENAI_IMAGE_QUALITY = "low"
    OPENAI_IMAGE_SIZE = "1024x1536"
elif OPENAI_IMAGE_MODO == "premium":
    OPENAI_IMAGE_QUALITY = "high"
    OPENAI_IMAGE_SIZE = "1024x1536"

FFMPEG_BIN = "ffmpeg"

W = 1080
H = 1920

FONT_DIR = BASE_DIR / "fonts"

FONT_MAP = {
   "pesada impactante": str((FONT_DIR / "Anton-Regular.ttf") if (FONT_DIR / "Anton-Regular.ttf").exists() else Path(r"C:/Windows/Fonts/arialbd.ttf")),
    "condensada esportiva": str((FONT_DIR / "BebasNeue-Regular.ttf") if (FONT_DIR / "BebasNeue-Regular.ttf").exists() else Path(r"C:/Windows/Fonts/arialbd.ttf")),
    "moderna agressiva": str((FONT_DIR / "LeagueSpartan.ttf") if (FONT_DIR / "LeagueSpartan.ttf").exists() else Path(r"C:/Windows/Fonts/arialbd.ttf")),
    "tecnologica futurista": str((FONT_DIR / "Orbitron.ttf") if (FONT_DIR / "Orbitron.ttf").exists() else Path(r"C:/Windows/Fonts/arial.ttf")),
    "elegante forte": str((FONT_DIR / "Montserrat.ttf") if (FONT_DIR / "Montserrat.ttf").exists() else Path(r"C:/Windows/Fonts/arial.ttf"))
}

# =========================================================
# HELPERS
# =========================================================
DEBUG_RENDER = True

def log(msg: str):
    print(msg, flush=True)

def log_render(msg: str):
    if DEBUG_RENDER:
        print(f"[RENDER_DEBUG] {msg}", flush=True)

def ffmpeg_escape(text: str) -> str:
    if text is None:
        return ""
    text = str(text)
    text = text.replace("\\", "\\\\")
    text = text.replace(":", r"\:")
    text = text.replace("'", r"\'")
    text = text.replace("%", r"\%")
    text = text.replace(",", r"\,")
    text = text.replace("[", r"\[")
    text = text.replace("]", r"\]")
    text = text.replace("\n", r"\n")
    return text

def find_existing(folder: Path, names: list[str]) -> Path | None:
    for name in names:
        p = folder / name
        if p.exists():
            return p
    return None

def optional_template_file(folder: Path, names: list[str]) -> Path | None:
    for name in names:
        p = folder / name
        if p.exists():
            return p
    return None

def load_json(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))

def load_api_key() -> str:
    if not OPENAI_KEY_FILE.exists():
        raise FileNotFoundError(f"Não achei {OPENAI_KEY_FILE.name} na mesma pasta do script.")
    key = OPENAI_KEY_FILE.read_text(encoding="utf-8", errors="ignore").strip()
    if not key:
        raise ValueError(f"{OPENAI_KEY_FILE.name} está vazio.")
    return key

def load_credentials() -> tuple[str, str]:
    if not CREDENTIALS_FILE.exists():
        raise FileNotFoundError("credenciais.txt não encontrado na mesma pasta do script.")

    linhas = CREDENTIALS_FILE.read_text(encoding="utf-8", errors="ignore").splitlines()
    if len(linhas) < 2:
        raise ValueError("credenciais.txt inválido. Use linha 1 = whatsapp, linha 2 = senha.")

    whatsapp = linhas[0].strip()
    senha = linhas[1].strip()

    if not whatsapp or not senha:
        raise ValueError("credenciais.txt inválido. WhatsApp ou senha vazios.")

    return whatsapp, senha

def load_prompt_paleta(team_name: str = "") -> str:
    if not PROMPT_PALETA_FILE.exists():
        raise FileNotFoundError(
            f"Não achei {PROMPT_PALETA_FILE.name} na mesma pasta do script."
        )

    data = load_json(PROMPT_PALETA_FILE)

    if not isinstance(data, dict):
        raise ValueError(f"{PROMPT_PALETA_FILE.name} precisa ser um JSON objeto.")

    prompt_template = str(data.get("prompt", "")).strip()
    if not prompt_template:
        raise ValueError(f"{PROMPT_PALETA_FILE.name} está sem o campo 'prompt'.")

    team_name_value = team_name or "não informado"
    prompt = prompt_template.replace("{team_name}", team_name_value)
    return prompt.strip()

def load_prompt_imagem(pedido: dict) -> str:
    if not PROMPT_IMAGEM_FILE.exists():
        raise FileNotFoundError(f"Não achei {PROMPT_IMAGEM_FILE.name} na mesma pasta do script.")

    prompt = PROMPT_IMAGEM_FILE.read_text(encoding="utf-8", errors="ignore").strip()
    if not prompt:
        raise ValueError(f"{PROMPT_IMAGEM_FILE.name} está vazio.")

    placeholders = {
        "{categoria}": str(pedido.get("categoria", "")).strip(),
        "{time_principal}": str(pedido.get("time_principal", "")).strip(),
        "{time_adversario}": str(pedido.get("time_adversario", "")).strip(),
        "{gols_time_principal}": str(pedido.get("gols_time_principal", "")).strip(),
        "{gols_adversario}": str(pedido.get("gols_adversario", "")).strip(),
        "{rodada}": str(pedido.get("rodada", "")).strip(),
        "{data}": str(pedido.get("data", "")).strip(),
        "{hora}": str(pedido.get("hora", "")).strip(),
        "{arena}": str(pedido.get("arena", "")).strip(),
        "{nome_time}": str(pedido.get("nome_time", "")).strip(),
        "{frase}": str(pedido.get("frase", "")).strip(),
    }

    for chave, valor in placeholders.items():
        prompt = prompt.replace(chave, valor or "")

    return prompt.strip()

def render_text_reference_image(output_path: Path, blocos: list[dict]):
    canvas = Image.new("RGB", (W, H), (0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    for bloco in blocos:
        if not bloco.get("visible", True):
            continue

        texto = str(bloco.get("text", "") or "").strip()
        if not texto:
            continue

        cfg = bloco.get("cfg", {})
        font_path = str(bloco.get("font_path", "")).strip()
        font_size = int(bloco.get("font_size", 32))
        align = cfg_align(cfg, "center")
        font = load_font(font_path, font_size)

        x = int(cfg.get("x", 0))
        y = int(cfg.get("y", 0))
        w = int(cfg.get("w", W))
        h = int(cfg.get("h", 80))
        pad_x = int(cfg.get("pad_x", 0))
        line_spacing = int(bloco.get("line_spacing", 6))

        bbox = draw.multiline_textbbox((0, 0), texto, font=font, spacing=line_spacing, align=align)
        text_w = max(1, bbox[2] - bbox[0])
        text_h = max(1, bbox[3] - bbox[1])

        if align == "left":
            draw_x = x + pad_x
        elif align == "right":
            draw_x = x + w - text_w - pad_x
        else:
            draw_x = x + ((w - text_w) / 2)

        draw_y = y + max(0, ((h - text_h) / 2))

        draw.multiline_text(
            (draw_x, draw_y),
            texto,
            font=font,
            fill=(255, 255, 255),
            spacing=line_spacing,
            align=align
        )

    canvas.save(output_path)

def render_via_chatgpt_api(output_path: Path, prompt: str, arquivos_referencia: list[Path]):
    api_key = load_api_key()
    client = OpenAI(api_key=api_key)

    image_files = []
    try:
        for caminho in arquivos_referencia:
            if caminho and Path(caminho).exists():
                image_files.append(open(caminho, "rb"))

        if not image_files:
            raise ValueError("Nenhuma imagem de referência encontrada para enviar ao ChatGPT API.")

        result = client.images.edit(
            model=OPENAI_IMAGE_MODEL,
            image=image_files,
            prompt=prompt,
            size=OPENAI_IMAGE_SIZE,
            quality=OPENAI_IMAGE_QUALITY,
            output_format=OPENAI_OUTPUT_FORMAT,
            input_fidelity=OPENAI_INPUT_FIDELITY,
            n=OPENAI_IMAGE_N,
        )

        imagem_b64 = result.data[0].b64_json
        output_path.write_bytes(base64.b64decode(imagem_b64))
    finally:
        for f in image_files:
            try:
                f.close()
            except Exception:
                pass

def rgb_to_hex(rgb):
    return "#{:02x}{:02x}{:02x}".format(*rgb)

def hex_to_rgb(hx: str):
    hx = hx.strip().lstrip("#")
    if len(hx) != 6:
        raise ValueError(f"HEX inválido: {hx}")
    return tuple(int(hx[i:i+2], 16) for i in (0, 2, 4))

def clamp_opacity(value, default=1.0) -> float:
    try:
        value = float(value)
    except Exception:
        value = default
    return max(0.0, min(1.0, value))

def luminance(rgb):
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def choose_text_color(bg_rgb):
    return (255, 255, 255) if luminance(bg_rgb) < 150 else (15, 20, 30)

def choose_stroke_color(text_rgb):
    return (15, 20, 30) if luminance(text_rgb) >= 150 else (255, 255, 255)

def ensure_template_files(template_dir: Path):
    layout_file = template_dir / "layout.json"
    if not layout_file.exists():
        raise FileNotFoundError(f"layout.json não encontrado em: {template_dir}")

def run_ffmpeg(cmd: list[str]):
    log("Rodando FFmpeg...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    print("FFMPEG STDOUT:")
    print(result.stdout)
    print("FFMPEG STDERR:")
    print(result.stderr)

    if result.returncode != 0:
        raise RuntimeError("FFmpeg falhou.")

def image_to_data_url(img_path: Path) -> str:
    mime, _ = mimetypes.guess_type(str(img_path))
    if not mime:
        mime = "image/png"
    b64 = base64.b64encode(img_path.read_bytes()).decode("utf-8")
    return f"data:{mime};base64,{b64}"

def extract_json_from_text(text: str) -> dict:
    text = text.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Não encontrei JSON válido na resposta da API.")
    raw = text[start:end + 1]
    return json.loads(raw)

def load_font(font_path: str, size: int):
    try:
        return ImageFont.truetype(font_path, size=size)
    except Exception:
        return ImageFont.load_default()

def measure_text_block(text: str, font_path: str, font_size: int, line_spacing: int = 8) -> tuple[int, int]:
    text = text or ""
    font = load_font(font_path, font_size)
    dummy = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    draw = ImageDraw.Draw(dummy)
    bbox = draw.multiline_textbbox((0, 0), text, font=font, spacing=line_spacing, align="center")
    w = max(1, bbox[2] - bbox[0])
    h = max(1, bbox[3] - bbox[1])
    return w, h

def wrap_text_pixel(text: str, font_path: str, font_size: int, max_width: int, max_lines: int) -> str:
    text = " ".join((text or "").split())
    if not text:
        return ""

    words = text.split(" ")
    lines = []
    current = ""
    truncated = False

    for word in words:
        test = word if not current else f"{current} {word}"
        test_w, _ = measure_text_block(test, font_path, font_size)
        if test_w <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
                current = word
            else:
                current = word

            if len(lines) >= max_lines:
                truncated = True
                current = ""
                break

    if current and len(lines) < max_lines:
        lines.append(current)

    if not lines:
        return text

    if truncated and lines:
        last = lines[-1].rstrip()
        ellipsis = "..."
        while last:
            candidate = f"{last}{ellipsis}"
            candidate_w, _ = measure_text_block(candidate, font_path, font_size)
            if candidate_w <= max_width:
                lines[-1] = candidate
                break
            last = last[:-1].rstrip()
        else:
            lines[-1] = ellipsis

    return "\n".join(lines)

def fit_wrapped_text(text: str, font_path: str, start_size: int, min_size: int, max_width: int, max_lines: int, line_spacing: int = 8, max_height: int | None = None):
    size = start_size
    chosen_text = " ".join((text or "").split()) or ""

    while size >= min_size:
        wrapped = wrap_text_pixel(chosen_text, font_path, size, max_width, max_lines)
        w, h = measure_text_block(wrapped, font_path, size, line_spacing=line_spacing)
        lines_count = wrapped.count("\n") + 1 if wrapped else 1

        height_ok = True if max_height is None else h <= max_height

        if w <= max_width and lines_count <= max_lines and height_ok:
            return {
                "text": wrapped,
                "font_size": size,
                "text_w": w,
                "text_h": h,
                "lines": lines_count,
                "line_spacing": line_spacing,
            }
        size -= 1

    wrapped = wrap_text_pixel(chosen_text, font_path, min_size, max_width, max_lines)
    w, h = measure_text_block(wrapped, font_path, min_size, line_spacing=line_spacing)

    if max_height is not None:
        while (w > max_width or h > max_height) and len(wrapped) > 3:
            wrapped = wrapped[:-4].rstrip(" .\n") + "..."
            w, h = measure_text_block(wrapped, font_path, min_size, line_spacing=line_spacing)

    return {
        "text": wrapped,
        "font_size": min_size,
        "text_w": w,
        "text_h": h,
        "lines": wrapped.count("\n") + 1 if wrapped else 1,
        "line_spacing": line_spacing,
    }

def font_path_from_cfg(cfg: dict, fallback: str) -> str:
    font_file = str(cfg.get("font_file", "")).strip()
    if font_file and Path(font_file).exists():
        return font_file

    family = str(cfg.get("font_family", "")).strip().lower()
    weight_raw = str(cfg.get("font_weight", "")).strip().lower()

    weight_value = 400
    if weight_raw in {"thin"}:
        weight_value = 100
    elif weight_raw in {"extralight", "ultralight"}:
        weight_value = 200
    elif weight_raw in {"light"}:
        weight_value = 300
    elif weight_raw in {"regular", "normal", ""}:
        weight_value = 400
    elif weight_raw in {"medium"}:
        weight_value = 500
    elif weight_raw in {"semibold", "demibold"}:
        weight_value = 600
    elif weight_raw in {"bold"}:
        weight_value = 700
    elif weight_raw in {"extrabold", "ultrabold"}:
        weight_value = 800
    elif weight_raw in {"black", "heavy"}:
        weight_value = 900
    else:
        try:
            weight_value = int(float(weight_raw))
        except Exception:
            weight_value = 400

    is_bold = weight_value >= 700
    want_black = weight_value >= 850
    want_extrabold = 750 <= weight_value < 850
    want_semibold = 600 <= weight_value < 700
    want_medium = 500 <= weight_value < 600
    want_regular = weight_value < 500

    candidates = []

    if "brusher" in family:
        candidates += ["Brusher.ttf"]
    elif "blowbrush" in family:
        candidates += ["blowbrush.ttf", "blowbrush.otf"]
    elif "konthen" in family:
        candidates += ["Konthen.otf"]
    elif "rumbledgrunge" in family or "rumbled grunge" in family:
        candidates += ["RumbledGrunge.ttf", "RumbledGrunge.otf"]
    elif "league spartan" in family or "leaguespartan" in family:
        candidates += ["LeagueSpartan[wght].ttf", "LeagueSpartan-Black.ttf", "LeagueSpartan-Bold.ttf", "LeagueSpartan-SemiBold.ttf", "LeagueSpartan.ttf"] if is_bold else ["LeagueSpartan[wght].ttf", "LeagueSpartan-Regular.ttf", "LeagueSpartan.ttf"]
    elif "anton" in family:
        candidates += ["Anton-Regular.ttf"]
    elif "bebas" in family:
        candidates += ["BebasNeue-Regular.ttf"]
    elif "oswald" in family:
        candidates += ["Oswald-Bold.ttf", "Oswald-SemiBold.ttf", "Oswald-Medium.ttf", "Oswald.ttf"] if is_bold else ["Oswald-Regular.ttf", "Oswald.ttf"]
    elif "rajdhani" in family:
        candidates += ["Rajdhani-Bold.ttf", "Rajdhani-SemiBold.ttf", "Rajdhani-Medium.ttf", "Rajdhani-Regular.ttf"] if is_bold else ["Rajdhani-Regular.ttf", "Rajdhani.ttf"]
    elif "orbitron" in family:
        candidates += ["Orbitron-Bold.ttf", "Orbitron-SemiBold.ttf", "Orbitron-Medium.ttf", "Orbitron.ttf"] if is_bold else ["Orbitron-Regular.ttf", "Orbitron.ttf"]
    elif "exo 2" in family or "exo2" in family:
        candidates += ["Exo2-Bold.ttf", "Exo2-SemiBold.ttf", "Exo2-Medium.ttf", "Exo2-Regular.ttf", "Exo2.ttf"] if is_bold else ["Exo2-Regular.ttf", "Exo2.ttf"]
    elif "teko" in family:
        candidates += ["Teko-Bold.ttf", "Teko-SemiBold.ttf", "Teko-Medium.ttf", "Teko-Regular.ttf", "Teko.ttf"] if is_bold else ["Teko-Regular.ttf", "Teko.ttf"]
    elif "barlow condensed" in family or "barlowcondensed" in family:
        candidates += ["BarlowCondensed-Bold.ttf", "BarlowCondensed-SemiBold.ttf", "BarlowCondensed-Medium.ttf", "BarlowCondensed-Regular.ttf"] if is_bold else ["BarlowCondensed-Regular.ttf", "BarlowCondensed.ttf"]
    elif "saira condensed" in family or "sairacondensed" in family:
        candidates += ["SairaCondensed-Bold.ttf", "SairaCondensed-SemiBold.ttf", "SairaCondensed-Medium.ttf", "SairaCondensed-Regular.ttf"] if is_bold else ["SairaCondensed-Regular.ttf", "SairaCondensed.ttf"]
    elif "montserrat" in family:
        candidates += ["Montserrat[wght].ttf", "Montserrat-Black.ttf", "Montserrat-ExtraBold.ttf", "Montserrat-Bold.ttf", "Montserrat-SemiBold.ttf", "Montserrat.ttf"] if is_bold else ["Montserrat[wght].ttf", "Montserrat-Regular.ttf", "Montserrat.ttf"]
    elif "poppins" in family:
        candidates += ["Poppins-Black.ttf", "Poppins-ExtraBold.ttf", "Poppins-Bold.ttf", "Poppins-SemiBold.ttf", "Poppins-Regular.ttf"] if is_bold else ["Poppins-Regular.ttf", "Poppins.ttf"]
    elif "open sans" in family or "opensans" in family:
        candidates += ["OpenSans-Bold.ttf", "OpenSans-SemiBold.ttf", "OpenSans-Regular.ttf", "OpenSans.ttf"] if is_bold else ["OpenSans-Regular.ttf", "OpenSans.ttf"]
    elif "lato" in family:
        candidates += ["Lato-Black.ttf", "Lato-Bold.ttf", "Lato-Semibold.ttf", "Lato-Regular.ttf"] if is_bold else ["Lato-Regular.ttf", "Lato.ttf"]
    elif "nirakolu" in family:
        candidates += ["Nirakolu.ttf", "Nirakolu.otf"]
    elif "palms delight" in family:
        candidates += ["Palms Delight.otf"]
    elif "somelist" in family:
        candidates += ["Somelist.ttf", "Somelist.otf"]
    elif "strong" in family:
        candidates += ["Strong.ttf"]
    elif "the secret mouse" in family:
        candidates += ["The Secret Mouse.ttf"]
    elif "mr lucky clover" in family:
        candidates += ["Mr Lucky Clover.ttf"]
    elif "celtaniya bioffany italic" in family:
        candidates += ["Celtaniya Bioffany Italic.ttf", "Celtaniya Bioffany Italic.otf"]
    elif "celtaniya bioffany" in family:
        candidates += ["Celtaniya Bioffany.ttf", "Celtaniya Bioffany.otf"]

    for name in candidates:
        p = FONT_DIR / name
        if p.exists():
            return str(p)

    if family:
        slug_family = re.sub(r"[^a-z0-9]+", "", family)
        font_files = list(FONT_DIR.glob("*.ttf")) + list(FONT_DIR.glob("*.otf"))
        ranked = []
        for p in font_files:
            slug_file = re.sub(r"[^a-z0-9]+", "", p.stem.lower())
            if slug_family and slug_family in slug_file:
                score = 0

                if want_black:
                    if "black" in slug_file:
                        score += 200
                    if "extrabold" in slug_file or "ultrabold" in slug_file:
                        score += 170
                    if "bold" in slug_file:
                        score += 130
                    if "semibold" in slug_file:
                        score += 90
                    if "medium" in slug_file:
                        score += 40
                    if "regular" in slug_file or "book" in slug_file:
                        score -= 30

                elif want_extrabold:
                    if "extrabold" in slug_file or "ultrabold" in slug_file:
                        score += 200
                    if "black" in slug_file:
                        score += 180
                    if "bold" in slug_file:
                        score += 150
                    if "semibold" in slug_file:
                        score += 100
                    if "medium" in slug_file:
                        score += 50
                    if "regular" in slug_file or "book" in slug_file:
                        score -= 20

                elif is_bold:
                    if "bold" in slug_file:
                        score += 200
                    if "semibold" in slug_file:
                        score += 170
                    if "extrabold" in slug_file or "ultrabold" in slug_file:
                        score += 150
                    if "black" in slug_file:
                        score += 130
                    if "medium" in slug_file:
                        score += 80
                    if "regular" in slug_file or "book" in slug_file:
                        score += 10

                elif want_semibold:
                    if "semibold" in slug_file:
                        score += 200
                    if "medium" in slug_file:
                        score += 170
                    if "bold" in slug_file:
                        score += 130
                    if "regular" in slug_file or "book" in slug_file:
                        score += 80
                    if "black" in slug_file or "extrabold" in slug_file or "ultrabold" in slug_file:
                        score += 60

                elif want_medium:
                    if "medium" in slug_file:
                        score += 200
                    if "regular" in slug_file or "book" in slug_file:
                        score += 170
                    if "semibold" in slug_file:
                        score += 120
                    if "bold" in slug_file:
                        score += 60
                    if "black" in slug_file or "extrabold" in slug_file or "ultrabold" in slug_file:
                        score += 20

                elif want_regular:
                    if "regular" in slug_file:
                        score += 200
                    if "book" in slug_file:
                        score += 180
                    if "medium" in slug_file:
                        score += 120
                    if "semibold" in slug_file:
                        score += 70
                    if "bold" in slug_file:
                        score += 20
                    if "black" in slug_file or "extrabold" in slug_file or "ultrabold" in slug_file:
                        score -= 20

                ranked.append((score, str(p)))
        if ranked:
            ranked.sort(key=lambda x: x[0], reverse=True)
            return ranked[0][1]

    if "arial" in family:
        return r"C:/Windows/Fonts/arialbd.ttf" if is_bold else r"C:/Windows/Fonts/arial.ttf"

    return fallback

def cfg_color_hex(cfg: dict, fallback: str) -> str:
    color = str(cfg.get("color", "")).strip()
    if color.startswith("#") and len(color) == 7:
        return color
    return fallback

def cfg_alpha_suffix(cfg: dict) -> str:
    opacity = clamp_opacity(cfg.get("opacity", 1.0), 1.0)
    if opacity >= 0.999:
        return ""
    return f"@{opacity:.3f}"

def cfg_align(cfg: dict, default: str = "center") -> str:
    return str(cfg.get("text_align", cfg.get("align", default))).strip().lower()

def fit_block_text(text: str, font_path: str, cfg: dict, default_max_lines: int = 1, line_spacing: int = 6):
    font_path = font_path_from_cfg(cfg, font_path)
    font_base = int(cfg.get("font_base", 48))
    font_min = int(cfg.get("font_min", 20))
    max_lines = int(cfg.get("max_lines", default_max_lines))

    pad_x = int(cfg.get("pad_x", 0))
    pad_y = int(cfg.get("pad_y", 0))
    box_w = int(cfg.get("w", 200))
    box_h = int(cfg.get("h", 60))

    stroke_enabled = bool(cfg.get("stroke_enabled", False))
    stroke_width = int(cfg.get("stroke_width", 1)) if stroke_enabled else 0
    shadow_enabled = bool(cfg.get("shadow_enabled", False))
    shadow_x = abs(int(cfg.get("shadow_x", 2))) if shadow_enabled else 0
    shadow_y = abs(int(cfg.get("shadow_y", 2))) if shadow_enabled else 0

    safety_x = (stroke_width * 2) + shadow_x + 12
    safety_y = (stroke_width * 2) + shadow_y + 12

    max_width = max(40, box_w - (pad_x * 2) - safety_x)
    max_height = max(20, box_h - (pad_y * 2) - safety_y)

    return fit_wrapped_text(
        text=text,
        font_path=font_path,
        start_size=font_base,
        min_size=font_min,
        max_width=max_width,
        max_lines=max_lines,
        line_spacing=line_spacing,
        max_height=max_height,
    )

def drawtext_block(text: str, font_path: str, font_size: int, color_hex: str, x_expr: str, y_expr: str, line_spacing: int = 6, alpha: str = "", cfg: dict | None = None) -> str:
    if cfg is not None:
        font_path = font_path_from_cfg(cfg, font_path)
        color_hex = cfg_color_hex(cfg, color_hex)
        if not alpha:
            alpha = cfg_alpha_suffix(cfg)

    alpha_suffix = alpha if alpha else ""
    font_path_ffmpeg = str(font_path).replace("\\", "/").replace(":", r"\:")

    if cfg is not None:
        stroke_enabled = bool(cfg.get("stroke_enabled", False))
        stroke_width = int(cfg.get("stroke_width", 1))
        stroke_color = str(cfg.get("stroke_color", "#000000")).strip() or "#000000"
        shadow_enabled = bool(cfg.get("shadow_enabled", False))
        shadow_x = int(cfg.get("shadow_x", 2))
        shadow_y = int(cfg.get("shadow_y", 2))
        shadow_color = str(cfg.get("shadow_color", "#000000")).strip() or "#000000"
    else:
        stroke_enabled = True
        stroke_width = max(4, int(round(font_size * 0.10)))
        stroke_color = rgb_to_hex(choose_stroke_color(hex_to_rgb(color_hex)))
        shadow_enabled = True
        shadow_x = max(2, int(round(font_size * 0.05)))
        shadow_y = max(2, int(round(font_size * 0.05)))
        shadow_color = "black@0.85"

    extra = ":fix_bounds=true"
    if stroke_enabled and stroke_width > 0:
        extra += f":borderw={stroke_width}:bordercolor={stroke_color}"
    if shadow_enabled:
        extra += f":shadowx={shadow_x}:shadowy={shadow_y}:shadowcolor={shadow_color}"

    return (
        f"drawtext=fontfile='{font_path_ffmpeg}':text='{ffmpeg_escape(text)}':"
        f"fontcolor={color_hex}{alpha_suffix}:"
        f"fontsize={font_size}:"
        f"x={x_expr}:"
        f"y={y_expr}:"
        f"line_spacing={line_spacing}"
        f"{extra}"
    )

def box_x_expr(x: int, w: int, align: str = "center", pad: int = 0) -> str:
    align = (align or "center").strip().lower()
    if align == "left":
        return f"{x}+{pad}"
    if align == "right":
        return f"{x}+{w}-text_w-{pad}"
    return f"{x}+({w}-text_w)/2"

def box_y_expr(y: int, h: int) -> str:
    return f"{y}"

def rgba_from_hex(hex_color: str, alpha: int = 255, fallback=(255, 255, 255, 255)):
    try:
        r, g, b = hex_to_rgb(str(hex_color or "").strip())
        return (r, g, b, max(0, min(255, int(alpha))))
    except Exception:
        return fallback

def render_text_box_png(temp_dir: Path, layer_id: str, fit: dict, cfg: dict, font_path: str, fallback_color_hex: str) -> dict | None:
    if not cfg.get("visible", True):
        log_render(f"{layer_id} | SKIP visible=False")
        return None

    text = str(fit.get("text", "") or "")
    if not text.strip():
        log_render(f"{layer_id} | SKIP text vazio")
        return None

    box_x = int(cfg.get("x", 0))
    box_y = int(cfg.get("y", 0))
    box_w = max(1, int(cfg.get("w", 1)))
    box_h = max(1, int(cfg.get("h", 1)))

    font_path_original = font_path
    font_path = font_path_from_cfg(cfg, font_path)
    font_size = int(fit.get("font_size", cfg.get("font_base", 48)))
    font = load_font(font_path, font_size)

    pad_x = int(cfg.get("pad_x", 0))
    pad_y = int(cfg.get("pad_y", 0))
    line_spacing = int(fit.get("line_spacing", 6))
    align = cfg_align(cfg, "center")

    opacity = clamp_opacity(cfg.get("opacity", 1), 1)
    alpha = int(255 * opacity)

    fill_color = rgba_from_hex(cfg_color_hex(cfg, fallback_color_hex), alpha)
    stroke_enabled = bool(cfg.get("stroke_enabled", False))
    stroke_width = int(cfg.get("stroke_width", 0)) if stroke_enabled else 0
    stroke_color = rgba_from_hex(str(cfg.get("stroke_color", "#000000")), alpha, (0, 0, 0, alpha))

    shadow_enabled = bool(cfg.get("shadow_enabled", False))
    shadow_x = int(cfg.get("shadow_x", 0)) if shadow_enabled else 0
    shadow_y = int(cfg.get("shadow_y", 0)) if shadow_enabled else 0
    shadow_color = rgba_from_hex(str(cfg.get("shadow_color", "#000000")), alpha, (0, 0, 0, alpha))

    img = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    raw_lines = text.split("\n")
    lines = raw_lines if raw_lines else [text]

    line_data = []
    for line in lines:
        safe_line = line if line else " "
        bbox = draw.textbbox((0, 0), safe_line, font=font, stroke_width=stroke_width)
        lw = max(1, bbox[2] - bbox[0])
        lh = max(1, bbox[3] - bbox[1])
        line_data.append({
            "text": safe_line,
            "bbox": bbox,
            "w": lw,
            "h": lh
        })

    total_h = sum(item["h"] for item in line_data) + (line_spacing * max(0, len(line_data) - 1))
    usable_w = max(1, box_w - (pad_x * 2))
    usable_h = max(1, box_h - (pad_y * 2))

    if total_h <= usable_h:
        cursor_y = pad_y + ((usable_h - total_h) / 2)
    else:
        cursor_y = pad_y

    for item in line_data:
        line = item["text"]
        bbox = item["bbox"]
        line_w = item["w"]
        line_h = item["h"]

        if align == "left":
            draw_x = pad_x
        elif align == "right":
            draw_x = box_w - pad_x - line_w
        else:
            draw_x = pad_x + ((usable_w - line_w) / 2)

        draw_x = max(pad_x, min(draw_x, box_w - pad_x - line_w))
        draw_y = cursor_y

        text_x = draw_x - bbox[0]
        text_y = draw_y - bbox[1]

        if shadow_enabled:
            draw.text(
                (text_x + shadow_x, text_y + shadow_y),
                line,
                font=font,
                fill=shadow_color,
                stroke_width=0
            )

        draw.text(
            (text_x, text_y),
            line,
            font=font,
            fill=fill_color,
            stroke_width=stroke_width,
            stroke_fill=stroke_color
        )

        cursor_y += line_h + line_spacing

    safe_id = re.sub(r"[^a-zA-Z0-9_\-]+", "_", str(layer_id))
    out_path = temp_dir / f"text_layer_{safe_id}.png"
    img.save(out_path)

    log_render(
        f"{layer_id} | text={text!r} | family={cfg.get('font_family', '')} | weight={cfg.get('font_weight', '')} | "
        f"font_base={cfg.get('font_base', '')} | font_min={cfg.get('font_min', '')} | font_size_final={font_size} | "
        f"font_path_in={font_path_original} | font_path_final={font_path} | font_file_exists={Path(font_path).exists()} | "
        f"box=({box_x},{box_y},{box_w},{box_h}) | text_size=({fit.get('text_w', 0)},{fit.get('text_h', 0)}) | "
        f"lines={fit.get('lines', 0)} | align={align} | color={cfg_color_hex(cfg, fallback_color_hex)} | "
        f"opacity={cfg.get('opacity', 1)} | stroke={stroke_enabled}:{stroke_width}:{cfg.get('stroke_color', '#000000')} | "
        f"shadow={shadow_enabled}:{shadow_x}:{shadow_y}:{cfg.get('shadow_color', '#000000')} | "
        f"png={out_path.name}"
    )

    return {
        "path": out_path,
        "x": box_x,
        "y": box_y,
        "w": box_w,
        "h": box_h
    }

def no_effects_cfg(cfg: dict) -> dict:
    clean = dict(cfg)
    clean["stroke_enabled"] = False
    clean["stroke_width"] = 0
    clean["shadow_enabled"] = False
    clean["shadow_x"] = 0
    clean["shadow_y"] = 0
    return clean

# =========================================================
# MOTOR TXT
# =========================================================
CORES_UNIVERSAIS = {
    'vermelho': {'baixo': [0, 15, 15], 'alto': [10, 255, 255]},
    'vinho': {'baixo': [0, 50, 50], 'alto': [10, 200, 200]},
    'bordo': {'baixo': [0, 50, 50], 'alto': [10, 200, 200]},
    'amarelo': {'baixo': [15, 15, 15], 'alto': [40, 255, 255]},
    'dourado': {'baixo': [20, 100, 100], 'alto': [35, 255, 255]},
    'mostarda': {'baixo': [20, 80, 80], 'alto': [35, 255, 200]},
    'verde': {'baixo': [40, 15, 15], 'alto': [85, 255, 255]},
    'verde_limao': {'baixo': [50, 100, 100], 'alto': [80, 255, 255]},
    'verde_escuro': {'baixo': [40, 50, 50], 'alto': [85, 200, 200]},
    'ciano': {'baixo': [85, 15, 15], 'alto': [105, 255, 255]},
    'azul': {'baixo': [100, 10, 10], 'alto': [135, 255, 255]},
    'azul_marinho': {'baixo': [100, 50, 20], 'alto': [130, 255, 150]},
    'azul_claro': {'baixo': [85, 50, 100], 'alto': [115, 255, 255]},
    'roxo': {'baixo': [135, 15, 15], 'alto': [160, 255, 255]},
    'magenta': {'baixo': [140, 80, 80], 'alto': [170, 255, 255]},
    'lilas': {'baixo': [135, 50, 150], 'alto': [160, 200, 255]},
    'laranja': {'baixo': [10, 100, 100], 'alto': [25, 255, 255]},
    'marrom': {'baixo': [10, 50, 20], 'alto': [20, 200, 150]},
    'bege': {'baixo': [15, 30, 150], 'alto': [40, 120, 255]},
    'cinza': {'s': 0, 'v': 180, 'is_color': False},
    'prata': {'s': 0, 'v': 200, 'is_color': False},
    'branco': {'s': 0, 'v': 255, 'is_color': False},
    'preto': {'s': 0, 'v': 0, 'is_color': False}
}

def parse_color_string_to_config(color_str: str):
    color_str = str(color_str or "").strip().lower()
    if not color_str:
        return None

    if color_str in CORES_UNIVERSAIS:
        return CORES_UNIVERSAIS[color_str].copy()

    if color_str.startswith("#"):
        return hex_para_config(color_str)

    m = re.match(r"rgba?\(([^)]+)\)", color_str)
    if m:
        partes = [p.strip() for p in m.group(1).split(",")]
        if len(partes) < 3:
            return None
        try:
            r = max(0, min(255, int(float(partes[0]))))
            g = max(0, min(255, int(float(partes[1]))))
            b = max(0, min(255, int(float(partes[2]))))
        except Exception:
            return None
        return hex_para_config(f"#{r:02X}{g:02X}{b:02X}")

    return None

def criar_mascara(hsv, cor_nome):
    config_origem = cor_nome if isinstance(cor_nome, dict) else parse_color_string_to_config(cor_nome)
    if not config_origem:
        return None

    if config_origem.get('is_color', True):
        h = int(config_origem.get('h', 0))
        tol_h = int(config_origem.get('tol_h', 10))
        s_min = int(config_origem.get('s_min', 2))
        v_min = int(config_origem.get('v_min', 2))

        h1 = h - tol_h
        h2 = h + tol_h

        if h1 < 0:
            mascara1 = cv2.inRange(hsv, np.array([0, s_min, v_min]), np.array([h2, 255, 255]))
            mascara2 = cv2.inRange(hsv, np.array([180 + h1, s_min, v_min]), np.array([179, 255, 255]))
            return cv2.bitwise_or(mascara1, mascara2)

        if h2 > 179:
            mascara1 = cv2.inRange(hsv, np.array([h1, s_min, v_min]), np.array([179, 255, 255]))
            mascara2 = cv2.inRange(hsv, np.array([0, s_min, v_min]), np.array([h2 - 180, 255, 255]))
            return cv2.bitwise_or(mascara1, mascara2)

        return cv2.inRange(hsv, np.array([h1, s_min, v_min]), np.array([h2, 255, 255]))

    s_max = int(config_origem.get('s_max', 40))
    v = int(config_origem.get('v', 0))
    tol_v = int(config_origem.get('tol_v', 45))
    baixo = np.array([0, 0, max(0, v - tol_v)])
    alto = np.array([179, s_max, min(255, v + tol_v)])
    return cv2.inRange(hsv, baixo, alto)

def detectar_cores_na_imagem(img_path: Path, cobertura_minima: float = 0.01) -> list[str]:
    img = cv2.imread(str(img_path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"Erro ao abrir imagem para detectar cores: {img_path}")

    if len(img.shape) == 2:
        bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        alpha = None
    elif img.shape[2] == 4:
        bgr = img[:, :, :3].copy()
        alpha = img[:, :, 3].copy()
    else:
        bgr = img.copy()
        alpha = None

    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    total_pixels_validos = bgr.shape[0] * bgr.shape[1]

    if alpha is not None:
        total_pixels_validos = int(np.sum(alpha > 0))
        if total_pixels_validos <= 0:
            total_pixels_validos = bgr.shape[0] * bgr.shape[1]

    cores_detectadas = []

    for cor_nome in CORES_UNIVERSAIS.keys():
        if cor_nome in ("preto", "branco"):
            continue

        mascara = criar_mascara(hsv, cor_nome)
        if mascara is None:
            continue

        if alpha is not None:
            mascara = np.where(alpha > 0, mascara, 0).astype(np.uint8)

        qtd = int(np.sum(mascara > 0))
        proporcao = qtd / max(1, total_pixels_validos)

        if proporcao >= cobertura_minima:
            cores_detectadas.append(cor_nome)

    return sorted(set(cores_detectadas))

def gerar_txt_automatico_por_cor_detectada(src_path: Path, txt_path: Path, cor_destino_hex: str):
    if txt_path.exists():
        log(f"ℹ️ {txt_path.name} já existe; mantendo regras existentes.")
        return

    cores_detectadas = detectar_cores_na_imagem(src_path)

    if not cores_detectadas:
        log(f"⚠️ Nenhuma cor detectada em {src_path.name}; TXT automático não foi criado.")
        return

    linhas = [f"{cor} = {cor_destino_hex.upper()}" for cor in cores_detectadas]
    txt_path.write_text("\n".join(linhas), encoding="utf-8")
    log(f"🔥 {txt_path.name} criado automaticamente com: {', '.join(linhas)}")

def detectar_cores_exatas_na_imagem(img_path: Path, max_cores: int = 6, min_pixels: int = 40) -> list[str]:
    img = cv2.imread(str(img_path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"Erro ao abrir imagem para detectar cores exatas: {img_path}")

    if len(img.shape) == 2:
        bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        alpha = None
    elif img.shape[2] == 4:
        bgr = img[:, :, :3].copy()
        alpha = img[:, :, 3].copy()
    else:
        bgr = img.copy()
        alpha = None

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    pixels = rgb.reshape(-1, 3)

    if alpha is not None:
        mask_alpha = (alpha.reshape(-1) > 0)
        pixels = pixels[mask_alpha]

    if len(pixels) == 0:
        return []

    quant = (np.round(pixels / 16) * 16).clip(0, 255).astype(np.uint8)
    counter = Counter(map(tuple, quant.tolist()))

    cores = []
    for cor, qtd in counter.most_common():
        if qtd < min_pixels:
            continue
        hx = "#{:02X}{:02X}{:02X}".format(*cor)
        if hx not in cores:
            cores.append(hx)
        if len(cores) >= max_cores:
            break

    return cores

def detectar_percentual_cores_na_imagem(img_path: Path, max_cores: int = 10, min_pixels: int = 40) -> list[dict]:
    img = cv2.imread(str(img_path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"Erro ao abrir imagem para detectar percentual de cores: {img_path}")

    if len(img.shape) == 2:
        bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        alpha = None
    elif img.shape[2] == 4:
        bgr = img[:, :, :3].copy()
        alpha = img[:, :, 3].copy()
    else:
        bgr = img.copy()
        alpha = None

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    pixels = rgb.reshape(-1, 3)

    if alpha is not None:
        mask_alpha = (alpha.reshape(-1) > 0)
        pixels = pixels[mask_alpha]

    if len(pixels) == 0:
        return []

    quant = (np.round(pixels / 16) * 16).clip(0, 255).astype(np.uint8)
    counter = Counter(map(tuple, quant.tolist()))
    total_pixels = sum(counter.values())

    cores = []
    for cor, qtd in counter.most_common():
        if qtd < min_pixels:
            continue
        percentual = round((qtd / max(1, total_pixels)) * 100, 2)
        cores.append({
            "hex": "#{:02X}{:02X}{:02X}".format(*cor),
            "pixels": int(qtd),
            "percentual": percentual
        })
        if len(cores) >= max_cores:
            break

    return cores

def normalizar_destinos_txt(regras: dict, fallback_hexes: list[str]) -> list[str]:
    destinos = []
    for destino in regras.values():
        destino = str(destino or "").strip().upper()
        if not destino:
            continue
        if destino.startswith("#") and len(destino) == 7:
            destinos.append(destino)

    for hx in fallback_hexes:
        hx = str(hx or "").strip().upper()
        if hx.startswith("#") and len(hx) == 7:
            destinos.append(hx)

    unicos = []
    for d in destinos:
        if d not in unicos:
            unicos.append(d)
    return unicos

def complementar_txt_com_cores_detectadas(src_path: Path, txt_path: Path, fallback_hexes: list[str]):
    regras = ler_regras_txt(txt_path)
    destinos = normalizar_destinos_txt(regras, fallback_hexes)

    if not destinos:
        return

    cores_exatas = detectar_cores_exatas_na_imagem(src_path)
    if not cores_exatas:
        return

    regras_finais = {}
    idx = 0
    for cor in cores_exatas:
        regras_finais[cor.lower()] = destinos[min(idx, len(destinos) - 1)]
        if idx < len(destinos) - 1:
            idx += 1

    for origem, destino in regras.items():
        origem_norm = str(origem or "").strip().lower()
        destino_norm = str(destino or "").strip().upper()
        if origem_norm and destino_norm and origem_norm not in regras_finais:
            regras_finais[origem_norm] = destino_norm

    linhas = [f"{origem} = {destino}" for origem, destino in regras_finais.items()]
    txt_path.write_text("\n".join(linhas), encoding="utf-8")
    log(f"🧠 TXT ajustado com cores reais detectadas em {src_path.name}: {txt_path.name}")

def hex_para_config(hex_str):
    hex_str = hex_str.lstrip('#')
    try:
        r, g, b = tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))
        pixel_bgr = np.uint8([[[b, g, r]]])
        pixel_hsv = cv2.cvtColor(pixel_bgr, cv2.COLOR_BGR2HSV)[0][0]
        h, s, v = pixel_hsv

        if v < 50:
            return {'s': 0, 'v': 0, 'is_color': False}
        elif s < 30 and v > 200:
            return {'s': 0, 'v': 255, 'is_color': False}
        else:
            return {'h': int(h), 'is_color': True}
    except ValueError:
        return None

def ler_regras_txt(caminho_txt: Path):
    regras = {}
    if not caminho_txt.exists():
        return regras

    with open(caminho_txt, 'r', encoding='utf-8') as f:
        linhas = f.readlines()
        for linha in linhas:
            if '=' in linha:
                origem, destino = linha.split('=', 1)
                regras[origem.strip().lower()] = destino.strip().upper()
    return regras

def aplicar_regras_txt(src_path: Path, dst_path: Path, txt_path: Path):
    if not src_path.exists():
        return

    if not txt_path.exists():
        shutil.copy2(src_path, dst_path)
        log(f"⚠️ Sem regras em {txt_path.name}; copiado original.")
        return

    regras = ler_regras_txt(txt_path)
    if not regras:
        shutil.copy2(src_path, dst_path)
        log(f"⚠️ {txt_path.name} vazio ou inválido; copiado original.")
        return

    img = cv2.imread(str(src_path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"Erro ao abrir asset: {src_path}")

    alpha = None
    if len(img.shape) == 2:
        bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        bgr = img[:, :, :3].copy()
        alpha = img[:, :, 3].copy()
    else:
        bgr = img.copy()

    template_processado = bgr.copy()
    hsv_original = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    for cor_origem, cor_destino in regras.items():
        config_origem = parse_color_string_to_config(cor_origem)
        if config_origem is None:
            log(f"⚠️ Cor base desconhecida em {txt_path.name}: {cor_origem}")
            continue

        config_destino = None
        if cor_destino.startswith('#'):
            config_destino = hex_para_config(cor_destino)
        elif cor_destino.lower() in CORES_UNIVERSAIS:
            config_destino = CORES_UNIVERSAIS[cor_destino.lower()].copy()
            if 'h' not in config_destino and 's' not in config_destino:
                meio = int((config_destino['baixo'][0] + config_destino['alto'][0]) / 2)
                config_destino = {'h': meio, 'is_color': True}

        if config_destino is None:
            log(f"⚠️ Destino inválido em {txt_path.name}: {cor_destino}")
            continue

        mascara = criar_mascara(hsv_original, config_origem)
        if mascara is None:
            continue

        if alpha is not None:
            mascara = np.where(alpha > 0, mascara, 0).astype(np.uint8)

        mascara = cv2.GaussianBlur(mascara, (25, 25), 0)

        hsv_novo = hsv_original.copy()

        if config_destino['is_color']:
            hsv_novo[:, :, 0] = np.where(mascara > 0, config_destino['h'], hsv_novo[:, :, 0])
        else:
            hsv_novo[:, :, 1] = np.where(mascara > 0, config_destino['s'], hsv_novo[:, :, 1])
            if config_destino['v'] == 255:
                brilho_atual = hsv_novo[:, :, 2].astype(int)
                novo_brilho = np.clip(brilho_atual + 100, 0, 255)
                hsv_novo[:, :, 2] = np.where(mascara > 0, novo_brilho, hsv_novo[:, :, 2]).astype(np.uint8)
            else:
                hsv_novo[:, :, 2] = np.where(mascara > 0, 0, hsv_novo[:, :, 2])

        img_nova_cor = cv2.cvtColor(hsv_novo, cv2.COLOR_HSV2BGR)

        mascara_float = mascara.astype(np.float32) / 255.0
        mascara_float = cv2.merge([mascara_float, mascara_float, mascara_float])

        template_processado = template_processado * (1 - mascara_float) + img_nova_cor * mascara_float
        template_processado = template_processado.astype(np.uint8)

    if alpha is not None:
        out = np.dstack([template_processado, alpha])
    else:
        out = template_processado

    cv2.imwrite(str(dst_path), out)
    log(f"✅ Regras aplicadas: {txt_path.name} -> {dst_path.name}")

# =========================================================
# LAYOUT JSON
# =========================================================
def apply_text_defaults(layout: dict, key: str, defaults: dict):
    layout.setdefault(key, {})
    for k, v in defaults.items():
        layout[key].setdefault(k, v)

def load_layout(template_dir: Path) -> dict:
    layout_file = template_dir / "layout.json"
    if not layout_file.exists():
        raise FileNotFoundError(f"layout.json não encontrado em: {template_dir}")
    layout = load_json(layout_file)

    layout.setdefault("safe_margin_x", 22)

    layout.setdefault("moldura", {})
    layout["moldura"].setdefault("x", 0)
    layout["moldura"].setdefault("y", 0)
    layout["moldura"].setdefault("visible", True)

    layout.setdefault("logo", {})
    layout["logo"].setdefault("x", 30)
    layout["logo"].setdefault("y", 22)
    layout["logo"].setdefault("w", 350)
    layout["logo"].setdefault("h", 0)
    layout["logo"].setdefault("gap_right", 16)
    layout["logo"].setdefault("visible", True)

    layout.setdefault("topo", {})
    layout["topo"].setdefault("x", 396)
    layout["topo"].setdefault("y", 22)
    layout["topo"].setdefault("base_w", 620)
    layout["topo"].setdefault("base_h", 112)
    layout["topo"].setdefault("pad_x", 28)
    layout["topo"].setdefault("pad_y", 18)
    layout["topo"].setdefault("visible", True)

    layout.setdefault("faixa_principal", {})
    layout["faixa_principal"].setdefault("x", 80)
    layout["faixa_principal"].setdefault("y", 1215)
    layout["faixa_principal"].setdefault("base_w", 920)
    layout["faixa_principal"].setdefault("base_h", 132)
    layout["faixa_principal"].setdefault("pad_x", 50)
    layout["faixa_principal"].setdefault("pad_y", 18)
    layout["faixa_principal"].setdefault("visible", True)

    layout.setdefault("faixa_secundaria", {})
    layout["faixa_secundaria"].setdefault("x", 160)
    layout["faixa_secundaria"].setdefault("y", 1375)
    layout["faixa_secundaria"].setdefault("base_w", 760)
    layout["faixa_secundaria"].setdefault("base_h", 94)
    layout["faixa_secundaria"].setdefault("pad_x", 40)
    layout["faixa_secundaria"].setdefault("pad_y", 18)
    layout["faixa_secundaria"].setdefault("visible", True)

    apply_text_defaults(layout, "time_principal", {
        "x": 414, "y": 40, "w": 250, "h": 46,
        "font_base": 34, "font_min": 20, "max_lines": 2,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })
    apply_text_defaults(layout, "gols_time_principal", {
        "x": 670, "y": 32, "w": 78, "h": 60,
        "font_base": 56, "font_min": 28, "max_lines": 1,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })
    apply_text_defaults(layout, "placar_x", {
        "x": 754, "y": 34, "w": 44, "h": 56,
        "text": "X", "font_base": 48, "font_min": 24, "max_lines": 1,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })
    apply_text_defaults(layout, "gols_adversario", {
        "x": 804, "y": 32, "w": 78, "h": 60,
        "font_base": 56, "font_min": 28, "max_lines": 1,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })
    apply_text_defaults(layout, "time_adversario", {
        "x": 888, "y": 40, "w": 110, "h": 46,
        "font_base": 34, "font_min": 20, "max_lines": 2,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })
    apply_text_defaults(layout, "titulo", {
        "x": 80, "y": 1215, "w": 920, "h": 132,
        "text": "RESULTADO FINAL",
        "font_base": 72, "font_min": 50, "max_lines": 2,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })
    apply_text_defaults(layout, "frase", {
        "x": 160, "y": 1375, "w": 760, "h": 94,
        "font_base": 30, "font_min": 20, "max_lines": 3,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })
    apply_text_defaults(layout, "artilheiros", {
        "x": 170, "y": 1498, "w": 740, "h": 120,
        "font_base": 28, "font_min": 18, "max_lines": 4,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })

    layout.setdefault("bg", {})
    layout["bg"].setdefault("brightness", 0.0)
    layout["bg"].setdefault("saturation", 1.0)
    layout["bg"].setdefault("contrast", 1.0)

    return layout

# =========================================================
# CORES / FONTE / FOTO (mantidos)
# =========================================================
def is_neutral_color(rgb, sat_min=35, lum_min=35, lum_max=220):
    r, g, b = rgb
    mx = max(rgb)
    mn = min(rgb)
    sat = mx - mn
    lum = (r + g + b) / 3
    return sat < sat_min or lum < lum_min or lum > lum_max

def force_non_neutral_palette(primary, secondary):
    if is_neutral_color(primary) and is_neutral_color(secondary):
        primary = (30, 30, 30)
        secondary = (180, 180, 180)
    return primary, secondary

def pick_background_focus_color(crest_path: Path):
    img = Image.open(crest_path).convert("RGBA")
    img.thumbnail((250, 250))

    pixels = []
    neutros = 0
    total_validos = 0

    for r, g, b, a in img.getdata():
        if a < 40:
            continue
        rgb = (r, g, b)
        pixels.append(rgb)
        total_validos += 1
        if is_neutral_color(rgb):
            neutros += 1

    if not pixels:
        return (30, 30, 30)

    counter = Counter(pixels).most_common(500)

    if total_validos > 0 and (neutros / total_validos) >= 0.5:
        for color, _ in counter:
            if not is_neutral_color(color):
                return color
        return (200, 200, 200)

    return counter[0][0]

def extract_main_colors_local(crest_path: Path):
    img = Image.open(crest_path).convert("RGBA")
    img.thumbnail((250, 250))

    pixels = []
    for r, g, b, a in img.getdata():
        if a < 40:
            continue
        rgb = (r, g, b)
        if False and is_neutral_color(rgb):
            continue
        pixels.append(rgb)

    if not pixels:
        primary = (255, 255, 255)
        secondary = (0, 0, 0)
        return {
            "primary": primary,
            "secondary": secondary,
            "text_on_primary": choose_text_color(primary),
            "text_on_secondary": choose_text_color(secondary),
            "primary_opacity": 0.85,
            "secondary_opacity": 0.75,
            "font_style": "condensada esportiva",
            "photo_mode": "contain_center",
            "photo_box_x": 170,
            "photo_box_y": 470,
            "photo_box_w": 740,
            "photo_box_h": 520,
            "raw": {}
        }

    counter = Counter(pixels).most_common(500)
    primary = counter[0][0]

    def dist(c1, c2):
        return sum((a - b) ** 2 for a, b in zip(c1, c2))

    secondary = primary
    best_d = -1
    for color, _ in counter[1:]:
        if is_neutral_color(color):
            continue
        d = dist(primary, color)
        if d > best_d:
            best_d = d
            secondary = color

    primary, secondary = force_non_neutral_palette(primary, secondary)

    return {
        "primary": primary,
        "secondary": secondary,
        "text_on_primary": choose_text_color(primary),
        "text_on_secondary": choose_text_color(secondary),
        "primary_opacity": 0.85,
        "secondary_opacity": 0.75,
        "font_style": "condensada esportiva",
        "photo_mode": "contain_center",
        "photo_box_x": 170,
        "photo_box_y": 470,
        "photo_box_w": 740,
        "photo_box_h": 520,
        "raw": {}
    }

def generate_background_image(prompt: str, output_path: Path):
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("background_prompt veio vazio.")

    api_key = load_api_key()

    payload = {
        "model": OPENAI_IMAGE_MODEL,
        "prompt": prompt,
        "size": "auto",
        "background": "opaque",
        "output_format": "png"
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    log("Consultando OpenAI para gerar o fundo...")
    resp = requests.post(OPENAI_IMAGE_URL, headers=headers, json=payload, timeout=300)

    if resp.status_code != 200:
        raise RuntimeError(f"OpenAI Image HTTP {resp.status_code}: {resp.text[:1000]}")

    data = resp.json()
    images = data.get("data", [])
    if not images:
        raise RuntimeError("A API de imagem não retornou nenhuma imagem.")

    b64 = images[0].get("b64_json", "")
    if not b64:
        raise RuntimeError("A API de imagem não retornou b64_json.")

    output_path.write_bytes(base64.b64decode(b64))
    log(f"🖼️ Fundo gerado salvo em: {output_path}")

def get_palette_from_openai(escudo1_path: Path, escudo2_path: Path | None, template_dir: Path, team_name: str = "") -> dict:
    api_key = load_api_key()
    image_data_url_escudo1 = image_to_data_url(escudo1_path)
    image_data_url_escudo2 = image_to_data_url(escudo2_path) if escudo2_path and escudo2_path.exists() else None
    image_data_url_template = image_to_data_url(template_dir / "faixa_secundaria.png")
    
    moldura_path = template_dir / "moldura.png"
    image_data_url_moldura = None
    if moldura_path.exists():
        image_data_url_moldura = image_to_data_url(moldura_path)

    prompt = load_prompt_paleta(team_name=team_name)

    prompt_injetado = (
        prompt
        + "\n\nORDEM EXATA DAS IMAGENS ENVIADAS:"
        + "\n1) TEMPLATE DA PEÇA faixa_secundaria.png -> você deve identificar as cores visíveis dessa peça."
    )
    
    if image_data_url_moldura:
        prompt_injetado += "\n2) TEMPLATE DA MOLDURA moldura.png -> você deve identificar as cores visíveis dessa peça."
        prompt_injetado += "\n3) ESCUDO 1 (time principal) -> essa imagem manda totalmente no lado esquerdo do fundo e na identidade visual do time principal."
        prompt_injetado += "\n4) ESCUDO 2 (adversário) -> essa imagem manda totalmente no lado direito do fundo e na identidade visual do adversário."
    else:
        prompt_injetado += "\n2) ESCUDO 1 (time principal) -> essa imagem manda totalmente no lado esquerdo do fundo e na identidade visual do time principal."
        prompt_injetado += "\n3) ESCUDO 2 (adversário) -> essa imagem manda totalmente no lado direito do fundo e na identidade visual do adversário."

    prompt_injetado += (
        "\n\nMISSÃO ESPECÍFICA:"
        + "\n- Analise a faixa_secundaria.png e (se enviada) a moldura.png."
        + "\n- Identifique as cores reais existentes nelas."
        + "\n- Cruze isso SOMENTE com os escudos enviados."
        + "\n- Ignore totalmente qualquer influência de foto do jogo."
        + "\n- Gere os campos txt_moldura, txt_topo, txt_faixa_principal e txt_faixa_secundaria com as trocas corretas."
        + "\n- O txt_moldura será aplicado na moldura."
        + "\n- O txt_topo será aplicado no topo_barra."
        + "\n- O txt_faixa_principal será aplicado na faixa_principal."
        + "\n- O txt_faixa_secundaria será aplicado na faixa_secundaria."
        + "\n- Não invente cores-base que não existam na peça."
        + "\n- Gere também um background_prompt extremamente detalhado para criar um FUNDO PREMIUM da arte."
        + "\n- Esse fundo deve ser abstrato esportivo, cinematográfico, premium, sem textos, sem letras, sem números, sem escudos, sem jogadores, sem pessoas."
        + "\n- O fundo precisa conversar somente com o ESCUDO 1 e com o ESCUDO 2."
        + "\n- O lado esquerdo deve valorizar apenas o ESCUDO 1."
        + "\n- O lado direito deve valorizar apenas o ESCUDO 2."
        + "\n- Não usar a foto do jogo como referência de paleta, fundo ou atmosfera."
        + "\n- O fundo deve ter profundidade, iluminação dramática, atmosfera esportiva, energia visual e área visualmente útil para montagem posterior."
        + "\n- O fundo deve ser vertical, pensado para Instagram Story 1080x1920."
        + "\n- Retorne também background_negative_prompt."
        + "\n- Retorne esses dois campos no JSON final: background_prompt e background_negative_prompt."
    )

    content_list = [
        {"type": "input_text", "text": prompt_injetado},
        {"type": "input_image", "image_url": image_data_url_template, "detail": "high"},
    ]
    
    if image_data_url_moldura:
        content_list.append({"type": "input_image", "image_url": image_data_url_moldura, "detail": "high"})
        
    content_list.append({"type": "input_image", "image_url": image_data_url_escudo1, "detail": "high"})

    if image_data_url_escudo2:
        content_list.append({"type": "input_image", "image_url": image_data_url_escudo2, "detail": "high"})

    payload = {
        "model": OPENAI_MODEL,
        "input": [
            {
                "role": "user",
                "content": content_list
            }
        ]
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    log("Consultando OpenAI para definir paleta...")
    resp = requests.post(OPENAI_URL, headers=headers, json=payload, timeout=180)

    if resp.status_code != 200:
        raise RuntimeError(f"OpenAI HTTP {resp.status_code}: {resp.text[:1000]}")

    data = resp.json()

    text_out = data.get("output_text", "").strip()
    if not text_out:
        collected = []
        for item in data.get("output", []):
            for content in item.get("content", []):
                if content.get("type") in ("output_text", "text"):
                    if content.get("text"):
                        collected.append(content["text"])
        text_out = "\n".join(collected).strip()

    if not text_out:
        raise RuntimeError("A API respondeu, mas não trouxe texto com a paleta.")

    parsed = extract_json_from_text(text_out)

    primary = hex_to_rgb(parsed["primary_hex"])
    secondary = hex_to_rgb(parsed["secondary_hex"])
    if is_neutral_color(primary) and is_neutral_color(secondary):
        parsed["accent_hex"] = ""
        parsed["background_prompt"] = "Fundo cinematográfico premium em estádio de futebol à noite usando apenas preto, branco e cinza do escudo1.png, fumaça neutra, iluminação dramática branca, energia central branca, partículas no ar, atmosfera de final, grama visível, névoa realista, textura rica, profundidade de campo, sem texto, sem escudos, sem pessoas"
    primary, secondary = force_non_neutral_palette(primary, secondary)

    text_on_primary_hex = str(parsed.get("text_on_primary_hex", "#FFFFFF")).strip()
    text_on_secondary_hex = str(parsed.get("text_on_secondary_hex", "#FFFFFF")).strip()

    text_on_primary = hex_to_rgb(text_on_primary_hex)
    text_on_secondary = hex_to_rgb(text_on_secondary_hex)

    primary_opacity = clamp_opacity(parsed.get("primary_opacity", 0.85), 0.85)
    secondary_opacity = clamp_opacity(parsed.get("secondary_opacity", 0.75), 0.75)
    font_style = str(parsed.get("font_style", "condensada esportiva")).strip().lower()

    photo_mode = str(parsed.get("photo_mode", "contain_center")).strip().lower()
    if photo_mode not in {"contain_center"}:
        photo_mode = "contain_center"

    def safe_int(value, default):
        try:
            return int(value)
        except Exception:
            return default

    photo_box_x = safe_int(parsed.get("photo_box_x", 170), 170)
    photo_box_y = safe_int(parsed.get("photo_box_y", 470), 470)
    photo_box_w = safe_int(parsed.get("photo_box_w", 740), 740)
    photo_box_h = safe_int(parsed.get("photo_box_h", 520), 520)

    photo_box_x = max(0, min(W - 40, photo_box_x))
    photo_box_y = max(0, min(H - 40, photo_box_y))
    photo_box_w = max(120, min(W - photo_box_x, photo_box_w))
    photo_box_h = max(120, min(H - photo_box_y, photo_box_h))

    return {
        "primary": primary,
        "secondary": secondary,
        "text_on_primary": text_on_primary,
        "text_on_secondary": text_on_secondary,
        "primary_opacity": primary_opacity,
        "secondary_opacity": secondary_opacity,
        "font_style": font_style,
        "photo_mode": photo_mode,
        "photo_box_x": photo_box_x,
        "photo_box_y": photo_box_y,
        "photo_box_w": photo_box_w,
        "photo_box_h": photo_box_h,
        "txt_moldura": parsed.get("txt_moldura", ""),
        "txt_topo": parsed.get("txt_topo", ""),
        "txt_faixa_principal": parsed.get("txt_faixa_principal", ""),
        "txt_faixa_secundaria": parsed.get("txt_faixa_secundaria", ""),
        "background_prompt": parsed.get("background_prompt", ""),
        "background_negative_prompt": parsed.get("background_negative_prompt", ""),
        "raw": parsed,
    }

# =========================================================
# UPLOAD
# =========================================================
def upload_resultado_para_site(pedido_dir: Path, pedido_id: str, imagem_path: Path):
    pedido_json = pedido_dir / "pedido.json"
    if not pedido_json.exists():
        raise FileNotFoundError("pedido.json não encontrado para upload do resultado")

    pedido = load_json(pedido_json)
    whatsapp = str(pedido.get("whatsapp", "")).strip()

    if not whatsapp:
        raise ValueError("whatsapp não encontrado no pedido.json")

    whatsapp_login, senha_login = load_credentials()

    login_resp = requests.post(
        "https://api.omascote.com.br/auth/login",
        json={
            "whatsapp": whatsapp_login,
            "senha": senha_login
        },
        timeout=60
    )

    if login_resp.status_code != 200:
        raise RuntimeError(f"Falha no login da API: {login_resp.status_code} | {login_resp.text[:500]}")

    login_data = login_resp.json()
    token = login_data.get("token", "").strip()

    if not token:
        raise RuntimeError("Login da API não retornou token")

    with open(imagem_path, "rb") as f:
        up_resp = requests.post(
            f"https://api.omascote.com.br/pedidos/{pedido_id}/upload-resultado",
            headers={
                "Authorization": f"Bearer {token}"
            },
            files={
                "resultado": ("resultado_final.png", f, "image/png")
            },
            timeout=120
        )

    if up_resp.status_code != 200:
        raise RuntimeError(f"Falha ao enviar resultado: {up_resp.status_code} | {up_resp.text[:500]}")

    log("✅ Resultado enviado para o site com sucesso")

# =========================================================
# MAIN
# =========================================================
def main():
    import sys

    if len(sys.argv) < 2:
        raise SystemExit("Uso: python resultado_pipeline.py <PASTA_DO_PEDIDO>")

    pedido_dir = Path(sys.argv[1]).resolve()
    if not pedido_dir.exists():
        raise SystemExit(f"Pasta não encontrada: {pedido_dir}")

    pedido_json = pedido_dir / "pedido.json"
    if not pedido_json.exists():
        raise SystemExit("pedido.json não encontrado")

    pedido = load_json(pedido_json)
    categoria = str(pedido.get("categoria", "")).strip().lower()
    is_escalacao = categoria == "escalacao"
    is_proximo_jogo = categoria == "proximo_jogo"
    is_patrocinador = categoria == "patrocinador"

    TEMPLATE_DIR_ATUAL = TEMPLATE_ESCALACAO_DIR if is_escalacao else (TEMPLATE_PROXIMO_JOGO_DIR if is_proximo_jogo else (TEMPLATE_PATROCINADOR_DIR if is_patrocinador else TEMPLATE_DIR))

    ensure_template_files(TEMPLATE_DIR_ATUAL)
    layout = load_layout(TEMPLATE_DIR_ATUAL)

    foto_jogo = None
    escudo = None
    escudo2 = None

    # NOVO PADRÃO (pedido.json)
    foto_nome = str(pedido.get("foto_jogo", "")).strip()
    escudo_nome = str(pedido.get("escudo_principal", "")).strip()
    escudo2_nome = str(pedido.get("escudo2", "") or pedido.get("escudo_adversario", "")).strip()

    if foto_nome:
        foto_jogo = find_existing(pedido_dir, [foto_nome])
    if escudo_nome:
        escudo = find_existing(pedido_dir, [escudo_nome])
    if escudo2_nome:
        escudo2 = find_existing(pedido_dir, [escudo2_nome])

    # FALLBACK (padrão antigo)
    if not foto_jogo:
        foto_jogo = find_existing(
            pedido_dir,
            ["foto_jogo.png", "foto_jogo.jpg", "foto_jogo.jpeg", "foto_jogo.webp", "foto.png", "foto.jpg", "foto.jpeg", "foto.webp"]
        )

    if not escudo:
        escudo = find_existing(
            pedido_dir,
            ["escudo_principal_sem_fundo.png", "escudo_principal.png", "escudo_principal.jpg", "escudo_principal.jpeg", "escudo_principal.webp", "escudo1_sem_fundo.png", "escudo1.png", "escudo1.jpg", "escudo1.jpeg", "escudo1.webp"]
        )

    if not escudo2:
        escudo2 = find_existing(
            pedido_dir,
            ["escudo2_sem_fundo.png", "escudo2.png", "escudo2.jpg", "escudo2.jpeg", "escudo2.webp", "escudo_adversario_sem_fundo.png", "escudo_adversario.png", "escudo_adversario.jpg", "escudo_adversario.jpeg", "escudo_adversario.webp"]
        )

    if not foto_jogo and not is_escalacao and not is_proximo_jogo and not is_patrocinador:
        raise SystemExit("Imagem do jogo não encontrada")
    if not escudo:
        raise SystemExit("Escudo do time principal não encontrado")

    time_principal = str(pedido.get("time_principal", "")).strip()
    gols_time = int(pedido.get("gols_time_principal", 0))
    gols_adv = int(pedido.get("gols_adversario", 0))
    time_adv = str(pedido.get("time_adversario", "")).strip()

    resultado = str(pedido.get("rodada", "")).strip()
    use_split_score = bool(time_principal or time_adv or gols_time or gols_adv)

    if use_split_score:
        if time_principal and time_adv:
            resultado = f"{time_principal} {gols_time} x {gols_adv} {time_adv}"
        elif time_principal:
            resultado = f"{time_principal} {gols_time} x {gols_adv}"
        else:
            resultado = f"{gols_time} x {gols_adv}"

    frase = str(pedido.get("data", "")).strip()
    nome_time = str(pedido.get("nome_time", "")).strip()
    pedido_id = str(pedido.get("id", "sem_id")).strip()

    artilheiros_raw = pedido.get("artilheiros", "[]")

    try:
        if isinstance(artilheiros_raw, str):
            artilheiros = json.loads(artilheiros_raw)
        elif isinstance(artilheiros_raw, list):
            artilheiros = artilheiros_raw
        else:
            artilheiros = []
    except Exception:
        artilheiros = []

    artilheiros_linhas = []
    for a in artilheiros:
        if not isinstance(a, dict):
            continue
        nome_art = str(a.get("nome", "")).strip()
        gols_art = str(a.get("gols", "")).strip()
        if not nome_art:
            continue
        if gols_art:
            artilheiros_linhas.append(f"{nome_art} ({gols_art})")
        else:
            artilheiros_linhas.append(nome_art)

    artilheiros_texto = ""
    if artilheiros_linhas:
        artilheiros_texto = "Artilheiros:\n" + "\n".join(artilheiros_linhas)

    jogadores_raw = pedido.get("jogadores", [])

    try:
        if isinstance(jogadores_raw, str):
            jogadores = json.loads(jogadores_raw)
        elif isinstance(jogadores_raw, list):
            jogadores = jogadores_raw
        else:
            jogadores = []
    except Exception:
        jogadores = []

    jogador_textos = {}
    for idx in range(1, 23):
        texto_jogador = ""
        if idx <= len(jogadores) and isinstance(jogadores[idx - 1], dict):
            nome_jogador = str(jogadores[idx - 1].get("nome", "")).strip()
            info_jogador = str(jogadores[idx - 1].get("posicao", "")).strip()

            if nome_jogador and info_jogador:
                texto_jogador = f"{nome_jogador} - {info_jogador}"
            elif nome_jogador:
                texto_jogador = nome_jogador
            elif info_jogador:
                texto_jogador = info_jogador

        jogador_textos[f"jogador_{idx}"] = texto_jogador

    rodada_text_final = str(pedido.get("rodada", "")).strip()
    data_text_final = str(pedido.get("data", "")).strip()
    hora_text_final = str(pedido.get("hora", "")).strip()
    arena_text_final = str(pedido.get("arena", "")).strip()

    palette = extract_main_colors_local(escudo)
    cor_primaria = palette["primary"]
    cor_secundaria = palette["secondary"]
    cor_texto = palette["text_on_primary"]
    cor_texto_sec = palette["text_on_secondary"]
    opacidade_primaria = palette["primary_opacity"]
    opacidade_secundaria = palette["secondary_opacity"]
    font_style = "condensada esportiva"
    photo_mode = "contain_center"
    photo_box_x = 170
    photo_box_y = 470
    photo_box_w = 740
    photo_box_h = 520
    palette_source = "local"

    if "photo_box" in layout:
        try:
            photo_box_data = layout["photo_box"]
            photo_box_x = int(photo_box_data.get("x", photo_box_x))
            photo_box_y = int(photo_box_data.get("y", photo_box_y))
            photo_box_w = int(photo_box_data.get("w", photo_box_w))
            photo_box_h = int(photo_box_data.get("h", photo_box_h))
            log("📦 Usando coordenadas da foto vindas de layout.json")
        except Exception as e:
            log(f"⚠️ Erro ao ler photo_box do layout.json: {e}")

    bg_local_1 = pick_background_focus_color(escudo)
    if escudo2:
        bg_local_2 = pick_background_focus_color(escudo2)
    else:
        bg_local_2 = extract_main_colors_local(escudo)["secondary"]

    log(f"Paleta origem: {palette_source}")
    log(f"Cor primária: {cor_primaria} {rgb_to_hex(cor_primaria)}")
    log(f"Cor secundária: {cor_secundaria} {rgb_to_hex(cor_secundaria)}")
    log(f"Texto sobre primária: {cor_texto} {rgb_to_hex(cor_texto)}")
    log(f"Texto sobre secundária: {cor_texto_sec} {rgb_to_hex(cor_texto_sec)}")
    log(f"Opacidade primária: {opacidade_primaria}")
    log(f"Opacidade secundária: {opacidade_secundaria}")
    log(f"Font style: {font_style}")
    log(f"Photo mode: {photo_mode}")
    log(f"Photo box: x={photo_box_x}, y={photo_box_y}, w={photo_box_w}, h={photo_box_h}")

    FONT_BOLD = FONT_MAP.get(font_style, str((FONT_DIR / "Anton-Regular.ttf") if (FONT_DIR / "Anton-Regular.ttf").exists() else Path(r"C:/Windows/Fonts/arialbd.ttf")))
    FONT_REG = str((FONT_DIR / "Montserrat.ttf") if (FONT_DIR / "Montserrat.ttf").exists() else Path(r"C:/Windows/Fonts/arial.ttf"))

    temp_dir = pedido_dir / "_resultado_temp"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True, exist_ok=True)

    bg_negative_prompt = ""
    bg_path = temp_dir / "background_gerado.png"
    bg_prompt = ""

    Image.new("RGB", (W, H), (0, 0, 0)).save(bg_path)

    if not foto_jogo:
        foto_placeholder = temp_dir / "foto_placeholder.png"
        Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(foto_placeholder)
        foto_jogo = foto_placeholder

    moldura_src = optional_template_file(TEMPLATE_DIR_ATUAL, ["moldura.png", "moldura.jpg", "moldura.jpeg", "moldura.webp"])
    topo_src = optional_template_file(TEMPLATE_DIR_ATUAL, ["topo_barra.png", "topo_barra.jpg", "topo_barra.jpeg", "topo_barra.webp", "topo.png", "topo.jpg", "topo.jpeg", "topo.webp"])
    faixa1_src = optional_template_file(TEMPLATE_DIR_ATUAL, ["faixa_principal.png", "faixa_principal.jpg", "faixa_principal.jpeg", "faixa_principal.webp"])
    faixa2_src = optional_template_file(TEMPLATE_DIR_ATUAL, ["faixa_secundaria.png", "faixa_secundaria.jpg", "faixa_secundaria.jpeg", "faixa_secundaria.webp"])

    moldura_t = temp_dir / "moldura_t.png"
    topo_t = temp_dir / "topo_t.png"
    faixa1_t = temp_dir / "faixa1_t.png"
    faixa2_t = temp_dir / "faixa2_t.png"

    moldura_txt = pedido_dir / "moldura.txt"
    topo_txt = pedido_dir / "topo.txt"
    faixa1_txt = pedido_dir / "faixa_principal.txt"
    faixa2_txt = pedido_dir / "faixa_secundaria.txt"

    def salvar_txt_api(path, conteudo):
        conteudo = (conteudo or "").strip()

        if conteudo:
            path.write_text(conteudo, encoding="utf-8")
            log(f"🔥 TXT atualizado pela API: {path.name}")
        else:
            if path.exists():
                path.unlink()
                log(f"🧹 TXT removido porque a API retornou vazio: {path.name}")

    def preparar_txt_do_asset(src_path: Path | None, txt_path: Path, fallback_hexes: list[str]):
        if not src_path or not src_path.exists():
            return

        complementar_txt_com_cores_detectadas(src_path, txt_path, fallback_hexes)

        if not txt_path.exists() or not txt_path.read_text(encoding="utf-8").strip():
            for hx in fallback_hexes:
                if hx:
                    gerar_txt_automatico_por_cor_detectada(src_path, txt_path, hx)
                    break

    if moldura_txt.exists():
        moldura_txt.unlink()
    salvar_txt_api(topo_txt, palette.get("txt_topo", ""))
    salvar_txt_api(faixa1_txt, palette.get("txt_faixa_principal", ""))
    salvar_txt_api(faixa2_txt, palette.get("txt_faixa_secundaria", ""))

    pass
    preparar_txt_do_asset(topo_src, topo_txt, [rgb_to_hex(cor_secundaria), rgb_to_hex(cor_primaria)])
    preparar_txt_do_asset(faixa1_src, faixa1_txt, [rgb_to_hex(cor_primaria), rgb_to_hex(cor_secundaria)])
    preparar_txt_do_asset(faixa2_src, faixa2_txt, [rgb_to_hex(cor_secundaria), rgb_to_hex(cor_primaria)])

    if moldura_src:
        shutil.copy2(moldura_src, moldura_t)
    if topo_src:
        aplicar_regras_txt(topo_src, topo_t, topo_txt)
    if faixa1_src:
        aplicar_regras_txt(faixa1_src, faixa1_t, faixa1_txt)
    if faixa2_src:
        aplicar_regras_txt(faixa2_src, faixa2_t, faixa2_txt)

    out_final_pedido = pedido_dir / "resultado_final.png"
    out_final_geral = OUT_DIR / f"resultado_{pedido_id}.png"

    MOLDURA_CFG = layout["moldura"]
    MOLDURA_X = int(MOLDURA_CFG["x"])
    MOLDURA_Y = int(MOLDURA_CFG["y"])
    if moldura_src and moldura_t.exists():
        moldura_size_ref = Image.open(moldura_t).convert("RGBA")
        MOLDURA_W_DEFAULT, MOLDURA_H_DEFAULT = moldura_size_ref.size
    elif moldura_src:
        moldura_size_ref = Image.open(moldura_src).convert("RGBA")
        MOLDURA_W_DEFAULT, MOLDURA_H_DEFAULT = moldura_size_ref.size
    else:
        MOLDURA_W_DEFAULT, MOLDURA_H_DEFAULT = W, H
    MOLDURA_W = int(MOLDURA_CFG.get("w", MOLDURA_W_DEFAULT))
    MOLDURA_H = int(MOLDURA_CFG.get("h", MOLDURA_H_DEFAULT))
    MOLDURA_OPACITY = float(MOLDURA_CFG.get("opacity", opacidade_secundaria))

    LOGO_CFG = layout["logo"]
    LOGO_X = int(LOGO_CFG["x"])
    LOGO_Y = int(LOGO_CFG["y"])
    LOGO_W = int(LOGO_CFG["w"])
    LOGO_VISIBLE = bool(LOGO_CFG.get("visible", True))

    ESCUDO2_CFG = layout.get("escudo2", {})
    ESCUDO2_X = int(ESCUDO2_CFG.get("x", 0))
    ESCUDO2_Y = int(ESCUDO2_CFG.get("y", 0))
    ESCUDO2_W = int(ESCUDO2_CFG.get("w", 350))
    ESCUDO2_VISIBLE = bool(ESCUDO2_CFG.get("visible", True)) and bool(escudo2)

    TOPO_CFG = layout["topo"]
    TOPO_BOX_X = int(TOPO_CFG["x"])
    TOPO_BOX_Y = int(TOPO_CFG["y"])
    TOPO_BOX_W = int(TOPO_CFG["base_w"])
    TOPO_BOX_H = int(TOPO_CFG["base_h"])

    FAIXA1_CFG = layout["faixa_principal"]
    FAIXA1_X = int(FAIXA1_CFG["x"])
    FAIXA1_Y = int(FAIXA1_CFG["y"])
    FAIXA1_W = int(FAIXA1_CFG["base_w"])
    FAIXA1_H = int(FAIXA1_CFG["base_h"])

    FAIXA2_CFG = layout["faixa_secundaria"]
    FAIXA2_X = int(FAIXA2_CFG["x"])
    FAIXA2_Y = int(FAIXA2_CFG["y"])
    FAIXA2_W = int(FAIXA2_CFG["base_w"])
    FAIXA2_H = int(FAIXA2_CFG["base_h"])

    BG_BRIGHTNESS = float(layout["bg"]["brightness"])
    BG_SATURATION = float(layout["bg"]["saturation"])
    BG_CONTRAST = float(layout["bg"]["contrast"])

    TIME_PRINCIPAL_CFG = layout["time_principal"]
    GOLS_TIME_CFG = layout["gols_time_principal"]
    PLACAR_X_CFG = layout["placar_x"]
    GOLS_ADV_CFG = layout["gols_adversario"]
    TIME_ADV_CFG = layout["time_adversario"]
    TITULO_CFG = layout["titulo"]
    FRASE_CFG = layout["frase"]
    ARTILHEIROS_CFG = layout["artilheiros"]

    def text_cfg_from_layout(key: str, fallback_text: str = "", visible_default: bool = False) -> dict:
        cfg = dict(layout.get(key, {}))
        cfg.setdefault("x", 0)
        cfg.setdefault("y", 0)
        cfg.setdefault("w", 1)
        cfg.setdefault("h", 1)
        cfg.setdefault("text", fallback_text)
        cfg.setdefault("font_base", 28)
        cfg.setdefault("font_min", 16)
        cfg.setdefault("max_lines", 1)
        cfg.setdefault("visible", visible_default)
        cfg.setdefault("color", "#ffffff")
        cfg.setdefault("pad_x", 0)
        cfg.setdefault("pad_y", 0)
        cfg.setdefault("opacity", 1)
        cfg.setdefault("text_align", "center")
        return cfg

    RODADA_TEXT_CFG = text_cfg_from_layout("rodada_text", "RODADA", False)
    DATA_TEXT_CFG = text_cfg_from_layout("data_text", "DATA", False)
    HORA_TEXT_CFG = text_cfg_from_layout("hora_text", "HORA", False)
    ARENA_TEXT_CFG = text_cfg_from_layout("arena_text", "ARENA", False)
    JOGADOR_CFGS = {
        f"jogador_{i}": text_cfg_from_layout(f"jogador_{i}", f"Jogador {i}", False)
        for i in range(1, 23)
    }
    PATROCINADOR_CFGS = {
        f"patrocinador_{i}": dict(layout.get(f"patrocinador_{i}", {}))
        for i in range(1, 21)
    }

    tp_fit = fit_block_text(time_principal, FONT_BOLD, TIME_PRINCIPAL_CFG, default_max_lines=2, line_spacing=6)
    gt_fit = fit_block_text(str(gols_time), FONT_BOLD, GOLS_TIME_CFG, default_max_lines=1, line_spacing=4)
    px_fit = fit_block_text(str(PLACAR_X_CFG.get("text", "x")), FONT_BOLD, PLACAR_X_CFG, default_max_lines=1, line_spacing=4)
    ga_fit = fit_block_text(str(gols_adv), FONT_BOLD, GOLS_ADV_CFG, default_max_lines=1, line_spacing=4)
    ta_fit = fit_block_text(time_adv, FONT_BOLD, TIME_ADV_CFG, default_max_lines=2, line_spacing=6)

    titulo_text_final = str(TITULO_CFG.get("text", "RESULTADO FINAL"))
    titulo_fit = fit_block_text(titulo_text_final, FONT_BOLD, TITULO_CFG, default_max_lines=int(TITULO_CFG.get("max_lines", 2)), line_spacing=8)

    frase_text_final = frase if frase else str(FRASE_CFG.get("text", ""))
    frase_fit = fit_block_text(frase_text_final, FONT_BOLD, FRASE_CFG, default_max_lines=int(FRASE_CFG.get("max_lines", 3)), line_spacing=8)

    artilheiros_text_final = artilheiros_texto if artilheiros_texto else str(ARTILHEIROS_CFG.get("text", ""))
    artilheiros_fit = fit_block_text(artilheiros_text_final, FONT_REG, ARTILHEIROS_CFG, default_max_lines=int(ARTILHEIROS_CFG.get("max_lines", 4)), line_spacing=6)

    rodada_text_render = rodada_text_final if rodada_text_final else str(RODADA_TEXT_CFG.get("text", ""))
    data_text_render = data_text_final if data_text_final else str(DATA_TEXT_CFG.get("text", ""))
    hora_text_render = hora_text_final if hora_text_final else str(HORA_TEXT_CFG.get("text", ""))
    arena_text_render = arena_text_final if arena_text_final else str(ARENA_TEXT_CFG.get("text", ""))

    rodada_text_fit = fit_block_text(rodada_text_render, FONT_BOLD, RODADA_TEXT_CFG, default_max_lines=int(RODADA_TEXT_CFG.get("max_lines", 2)), line_spacing=6)
    data_text_fit = fit_block_text(data_text_render, FONT_REG, DATA_TEXT_CFG, default_max_lines=int(DATA_TEXT_CFG.get("max_lines", 1)), line_spacing=6)
    hora_text_fit = fit_block_text(hora_text_render, FONT_REG, HORA_TEXT_CFG, default_max_lines=int(HORA_TEXT_CFG.get("max_lines", 1)), line_spacing=6)
    arena_text_fit = fit_block_text(arena_text_render, FONT_REG, ARENA_TEXT_CFG, default_max_lines=int(ARENA_TEXT_CFG.get("max_lines", 1)), line_spacing=6)

    jogador_fits = {}
    for jogador_id, jogador_cfg in JOGADOR_CFGS.items():
        jogador_text_render = jogador_textos.get(jogador_id, "") or str(jogador_cfg.get("text", ""))
        jogador_fits[jogador_id] = fit_block_text(
            jogador_text_render,
            FONT_REG,
            jogador_cfg,
            default_max_lines=int(jogador_cfg.get("max_lines", 1)),
            line_spacing=6
        )

    patrocinador_files = {}
    for i in range(1, 21):
        pid = f"patrocinador_{i}"
        patrocinador_files[pid] = find_existing(
            pedido_dir,
            [
                f"{pid}.png", f"{pid}.jpg", f"{pid}.jpeg", f"{pid}.webp",
                f"patrocinador{i}.png", f"patrocinador{i}.jpg", f"patrocinador{i}.jpeg", f"patrocinador{i}.webp",
                f"pat{i:02d}.png", f"pat{i:02d}.jpg", f"pat{i:02d}.jpeg", f"pat{i:02d}.webp",
                f"pat{i}.png", f"pat{i}.jpg", f"pat{i}.jpeg", f"pat{i}.webp"
            ]
        )

    placar_fit = fit_wrapped_text(
        resultado,
        FONT_BOLD,
        int(layout.get("placar", {}).get("font_base", 62)),
        int(layout.get("placar", {}).get("font_min", 40)),
        max(120, TOPO_BOX_W - (int(TOPO_CFG.get("pad_x", 0)) * 2)),
        int(layout.get("placar", {}).get("max_lines", 2)),
        line_spacing=6,
    )

    nome_time_fit = fit_wrapped_text(
        nome_time,
        FONT_REG,
        int(layout.get("nome_time", {}).get("font_base", 22)),
        int(layout.get("nome_time", {}).get("font_min", 16)),
        max(100, TOPO_BOX_W - 36),
        1,
        line_spacing=4,
    )

    logo_img = Image.open(escudo).convert("RGBA")
    logo_h_original = logo_img.size[1]
    logo_w_original = logo_img.size[0]
    LOGO_H = max(1, int(round(logo_h_original * (LOGO_W / logo_w_original)))) if logo_w_original > 0 else LOGO_W

    ESCUDO2_H = ESCUDO2_W
    if ESCUDO2_VISIBLE:
        escudo2_img = Image.open(escudo2).convert("RGBA")
        escudo2_h_original = escudo2_img.size[1]
        escudo2_w_original = escudo2_img.size[0]
        ESCUDO2_H = max(1, int(round(escudo2_h_original * (ESCUDO2_W / escudo2_w_original)))) if escudo2_w_original > 0 else ESCUDO2_W

    draw_ops = []

    if use_split_score:
        if TIME_PRINCIPAL_CFG.get("visible", True) and tp_fit["text"]:
            draw_ops.append(drawtext_block(
                text=tp_fit["text"],
                font_path=FONT_BOLD,
                font_size=tp_fit["font_size"],
                color_hex=rgb_to_hex(cor_texto_sec),
                x_expr=box_x_expr(int(TIME_PRINCIPAL_CFG["x"]), int(TIME_PRINCIPAL_CFG["w"]), cfg_align(TIME_PRINCIPAL_CFG), int(TIME_PRINCIPAL_CFG.get("pad_x", 0))),
                y_expr=box_y_expr(int(TIME_PRINCIPAL_CFG["y"]), int(TIME_PRINCIPAL_CFG["h"])),
                line_spacing=tp_fit["line_spacing"],
                cfg=TIME_PRINCIPAL_CFG,
            ))

        if GOLS_TIME_CFG.get("visible", True) and gt_fit["text"]:
            draw_ops.append(drawtext_block(
                text=gt_fit["text"],
                font_path=FONT_BOLD,
                font_size=gt_fit["font_size"],
                color_hex=rgb_to_hex(cor_texto_sec),
                x_expr=box_x_expr(int(GOLS_TIME_CFG["x"]), int(GOLS_TIME_CFG["w"]), cfg_align(GOLS_TIME_CFG), int(GOLS_TIME_CFG.get("pad_x", 0))),
                y_expr=box_y_expr(int(GOLS_TIME_CFG["y"]), int(GOLS_TIME_CFG["h"])),
                line_spacing=gt_fit["line_spacing"],
                cfg=GOLS_TIME_CFG,
            ))

        if PLACAR_X_CFG.get("visible", True) and px_fit["text"]:
            draw_ops.append(drawtext_block(
                text=px_fit["text"],
                font_path=FONT_BOLD,
                font_size=px_fit["font_size"],
                color_hex=rgb_to_hex(cor_texto_sec),
                x_expr=box_x_expr(int(PLACAR_X_CFG["x"]), int(PLACAR_X_CFG["w"]), cfg_align(PLACAR_X_CFG), int(PLACAR_X_CFG.get("pad_x", 0))),
                y_expr=box_y_expr(int(PLACAR_X_CFG["y"]), int(PLACAR_X_CFG["h"])),
                line_spacing=px_fit["line_spacing"],
                cfg=PLACAR_X_CFG,
            ))

        if GOLS_ADV_CFG.get("visible", True) and ga_fit["text"]:
            draw_ops.append(drawtext_block(
                text=ga_fit["text"],
                font_path=FONT_BOLD,
                font_size=ga_fit["font_size"],
                color_hex=rgb_to_hex(cor_texto_sec),
                x_expr=box_x_expr(int(GOLS_ADV_CFG["x"]), int(GOLS_ADV_CFG["w"]), cfg_align(GOLS_ADV_CFG), int(GOLS_ADV_CFG.get("pad_x", 0))),
                y_expr=box_y_expr(int(GOLS_ADV_CFG["y"]), int(GOLS_ADV_CFG["h"])),
                line_spacing=ga_fit["line_spacing"],
                cfg=GOLS_ADV_CFG,
            ))

        if TIME_ADV_CFG.get("visible", True) and ta_fit["text"]:
            draw_ops.append(drawtext_block(
                text=ta_fit["text"],
                font_path=FONT_BOLD,
                font_size=ta_fit["font_size"],
                color_hex=rgb_to_hex(cor_texto_sec),
                x_expr=box_x_expr(int(TIME_ADV_CFG["x"]), int(TIME_ADV_CFG["w"]), cfg_align(TIME_ADV_CFG), int(TIME_ADV_CFG.get("pad_x", 0))),
                y_expr=box_y_expr(int(TIME_ADV_CFG["y"]), int(TIME_ADV_CFG["h"])),
                line_spacing=ta_fit["line_spacing"],
                cfg=TIME_ADV_CFG,
            ))
    else:
        if (not is_escalacao) and layout.get("placar", {}).get("visible", True):
            draw_ops.append(drawtext_block(
                text=placar_fit["text"],
                font_path=FONT_BOLD,
                font_size=placar_fit["font_size"],
                color_hex=rgb_to_hex(cor_texto_sec),
                x_expr=box_x_expr(TOPO_BOX_X, TOPO_BOX_W, "center", int(TOPO_CFG.get("pad_x", 0))),
                y_expr=box_y_expr(TOPO_BOX_Y, TOPO_BOX_H),
                line_spacing=placar_fit["line_spacing"],
            ))

        if (not is_escalacao) and nome_time_fit["text"] and layout.get("nome_time", {}).get("visible", True):
            draw_ops.append(drawtext_block(
                text=nome_time_fit["text"],
                font_path=FONT_REG,
                font_size=nome_time_fit["font_size"],
                color_hex=rgb_to_hex(cor_texto_sec),
                x_expr=f"{TOPO_BOX_X}+18",
                y_expr=f"{TOPO_BOX_Y}+6",
                line_spacing=4,
                alpha="@0.18",
            ))

    if TITULO_CFG.get("visible", True) and titulo_fit["text"]:
        draw_ops.append(drawtext_block(
            text=titulo_fit["text"],
            font_path=FONT_BOLD,
            font_size=titulo_fit["font_size"],
            color_hex=rgb_to_hex(cor_texto),
            x_expr=box_x_expr(int(TITULO_CFG["x"]), int(TITULO_CFG["w"]), cfg_align(TITULO_CFG), int(TITULO_CFG.get("pad_x", 0))),
            y_expr=box_y_expr(int(TITULO_CFG["y"]), int(TITULO_CFG["h"])),
            line_spacing=titulo_fit["line_spacing"],
            cfg=TITULO_CFG,
        ))

    if FRASE_CFG.get("visible", True) and frase_fit["text"]:
        draw_ops.append(drawtext_block(
            text=frase_fit["text"],
            font_path=FONT_BOLD,
            font_size=frase_fit["font_size"],
            color_hex=rgb_to_hex(cor_texto_sec),
            x_expr=box_x_expr(int(FRASE_CFG["x"]), int(FRASE_CFG["w"]), cfg_align(FRASE_CFG), int(FRASE_CFG.get("pad_x", 0))),
            y_expr=box_y_expr(int(FRASE_CFG["y"]), int(FRASE_CFG["h"])),
            line_spacing=frase_fit["line_spacing"],
            cfg=FRASE_CFG,
        ))

    if ARTILHEIROS_CFG.get("visible", True) and artilheiros_fit["text"]:
        draw_ops.append(drawtext_block(
            text=artilheiros_fit["text"],
            font_path=FONT_REG,
            font_size=artilheiros_fit["font_size"],
            color_hex=rgb_to_hex(cor_texto_sec),
            x_expr=box_x_expr(int(ARTILHEIROS_CFG["x"]), int(ARTILHEIROS_CFG["w"]), cfg_align(ARTILHEIROS_CFG), int(ARTILHEIROS_CFG.get("pad_x", 0))),
            y_expr=box_y_expr(int(ARTILHEIROS_CFG["y"]), int(ARTILHEIROS_CFG["h"])),
            line_spacing=artilheiros_fit["line_spacing"],
            cfg=ARTILHEIROS_CFG,
        ))

    draw_chain = ",".join(draw_ops)

    TEXT_LAYER_FILES = []
    texto_ref_path = temp_dir / "texto_referencia_chatgpt.png"

    blocos_texto_chatgpt = []

    if use_split_score:
        blocos_texto_chatgpt += [
            {"text": tp_fit["text"], "cfg": TIME_PRINCIPAL_CFG, "font_path": FONT_BOLD, "font_size": tp_fit["font_size"], "line_spacing": tp_fit["line_spacing"], "visible": TIME_PRINCIPAL_CFG.get("visible", True)},
            {"text": gt_fit["text"], "cfg": GOLS_TIME_CFG, "font_path": FONT_BOLD, "font_size": gt_fit["font_size"], "line_spacing": gt_fit["line_spacing"], "visible": GOLS_TIME_CFG.get("visible", True)},
            {"text": px_fit["text"], "cfg": PLACAR_X_CFG, "font_path": FONT_BOLD, "font_size": px_fit["font_size"], "line_spacing": px_fit["line_spacing"], "visible": PLACAR_X_CFG.get("visible", True)},
            {"text": ga_fit["text"], "cfg": GOLS_ADV_CFG, "font_path": FONT_BOLD, "font_size": ga_fit["font_size"], "line_spacing": ga_fit["line_spacing"], "visible": GOLS_ADV_CFG.get("visible", True)},
            {"text": ta_fit["text"], "cfg": TIME_ADV_CFG, "font_path": FONT_BOLD, "font_size": ta_fit["font_size"], "line_spacing": ta_fit["line_spacing"], "visible": TIME_ADV_CFG.get("visible", True)},
        ]
    else:
        blocos_texto_chatgpt += [
            {"text": placar_fit["text"], "cfg": {"x": TOPO_BOX_X, "y": TOPO_BOX_Y, "w": TOPO_BOX_W, "h": TOPO_BOX_H, "pad_x": int(TOPO_CFG.get("pad_x", 0)), "text_align": "center"}, "font_path": FONT_BOLD, "font_size": placar_fit["font_size"], "line_spacing": placar_fit["line_spacing"], "visible": True},
            {"text": nome_time_fit["text"], "cfg": {"x": TOPO_BOX_X, "y": TOPO_BOX_Y + 6, "w": TOPO_BOX_W, "h": 40, "pad_x": 18, "text_align": "left"}, "font_path": FONT_REG, "font_size": nome_time_fit["font_size"], "line_spacing": 4, "visible": bool(nome_time_fit["text"])},
        ]

    blocos_texto_chatgpt += [
        {"text": titulo_fit["text"], "cfg": TITULO_CFG, "font_path": FONT_BOLD, "font_size": titulo_fit["font_size"], "line_spacing": titulo_fit["line_spacing"], "visible": TITULO_CFG.get("visible", True)},
        {"text": frase_fit["text"], "cfg": FRASE_CFG, "font_path": FONT_BOLD, "font_size": frase_fit["font_size"], "line_spacing": frase_fit["line_spacing"], "visible": FRASE_CFG.get("visible", True)},
        {"text": artilheiros_fit["text"], "cfg": ARTILHEIROS_CFG, "font_path": FONT_REG, "font_size": artilheiros_fit["font_size"], "line_spacing": artilheiros_fit["line_spacing"], "visible": ARTILHEIROS_CFG.get("visible", True)},
        {"text": rodada_text_fit["text"], "cfg": RODADA_TEXT_CFG, "font_path": FONT_BOLD, "font_size": rodada_text_fit["font_size"], "line_spacing": rodada_text_fit["line_spacing"], "visible": RODADA_TEXT_CFG.get("visible", False)},
        {"text": data_text_fit["text"], "cfg": DATA_TEXT_CFG, "font_path": FONT_REG, "font_size": data_text_fit["font_size"], "line_spacing": data_text_fit["line_spacing"], "visible": DATA_TEXT_CFG.get("visible", False)},
        {"text": hora_text_fit["text"], "cfg": HORA_TEXT_CFG, "font_path": FONT_REG, "font_size": hora_text_fit["font_size"], "line_spacing": hora_text_fit["line_spacing"], "visible": HORA_TEXT_CFG.get("visible", False)},
        {"text": arena_text_fit["text"], "cfg": ARENA_TEXT_CFG, "font_path": FONT_REG, "font_size": arena_text_fit["font_size"], "line_spacing": arena_text_fit["line_spacing"], "visible": ARENA_TEXT_CFG.get("visible", False)},
    ]

    for jogador_id, jogador_fit in jogador_fits.items():
        bloco_cfg = JOGADOR_CFGS.get(jogador_id, {})
        blocos_texto_chatgpt.append({
            "text": jogador_fit["text"],
            "cfg": bloco_cfg,
            "font_path": FONT_REG,
            "font_size": jogador_fit["font_size"],
            "line_spacing": jogador_fit["line_spacing"],
            "visible": bloco_cfg.get("visible", False)
        })

    render_text_reference_image(texto_ref_path, blocos_texto_chatgpt)

    prompt_imagem = load_prompt_imagem(pedido)

    arquivos_chatgpt = []
    for caminho in [
        moldura_t if moldura_src and moldura_t.exists() else None,
        topo_t if topo_src and topo_t.exists() else None,
        faixa1_t if faixa1_src and faixa1_t.exists() else None,
        faixa2_t if faixa2_src and faixa2_t.exists() else None,
        escudo,
        escudo2 if escudo2 and escudo2.exists() else None,
        foto_jogo,
        texto_ref_path if texto_ref_path.exists() else None,
    ]:
        if caminho and Path(caminho).exists():
            arquivos_chatgpt.append(Path(caminho))

    render_via_chatgpt_api(out_final_pedido, prompt_imagem, arquivos_chatgpt)
    shutil.copy2(out_final_pedido, out_final_geral)
    upload_resultado_para_site(pedido_dir, pedido_id, out_final_pedido)
    return

    info = {
        "pedido_id": pedido_id,
        "template_dir": str(TEMPLATE_DIR_ATUAL),
        "palette_source": palette_source,
        "cor_primaria": rgb_to_hex(cor_primaria),
        "cor_secundaria": rgb_to_hex(cor_secundaria),
        "cor_texto_principal": rgb_to_hex(cor_texto),
        "cor_texto_secundaria": rgb_to_hex(cor_texto_sec),
        "opacidade_primaria": opacidade_primaria,
        "opacidade_secundaria": opacidade_secundaria,
        "font_style": font_style,
        "photo_mode": photo_mode,
        "photo_box_x": photo_box_x,
        "photo_box_y": photo_box_y,
        "photo_box_w": photo_box_w,
        "photo_box_h": photo_box_h,
        "background_prompt": bg_prompt,
        "background_negative_prompt": bg_negative_prompt,
        "background_gerado": str(bg_path),
        "txt_regras": {
            "moldura": str(moldura_txt),
            "topo": str(topo_txt),
            "faixa_principal": str(faixa1_txt),
            "faixa_secundaria": str(faixa2_txt),
        },
        "cores_detectadas_faixa_secundaria": detectar_cores_na_imagem(faixa2_src) if faixa2_src and faixa2_src.exists() else [],
        "cores_exatas_detectadas": {
            "moldura": detectar_cores_exatas_na_imagem(moldura_src) if moldura_src and moldura_src.exists() else [],
            "topo": detectar_cores_exatas_na_imagem(topo_src) if topo_src and topo_src.exists() else [],
            "faixa_principal": detectar_cores_exatas_na_imagem(faixa1_src) if faixa1_src and faixa1_src.exists() else [],
            "faixa_secundaria": detectar_cores_exatas_na_imagem(faixa2_src) if faixa2_src and faixa2_src.exists() else [],
        },
        "percentual_cores_detectadas": {
            "moldura": detectar_percentual_cores_na_imagem(moldura_src) if moldura_src and moldura_src.exists() else [],
            "topo": detectar_percentual_cores_na_imagem(topo_src) if topo_src and topo_src.exists() else [],
            "faixa_principal": detectar_percentual_cores_na_imagem(faixa1_src) if faixa1_src and faixa1_src.exists() else [],
            "faixa_secundaria": detectar_percentual_cores_na_imagem(faixa2_src) if faixa2_src and faixa2_src.exists() else [],
        },
        "resultado_final": str(out_final_pedido),
        "resultado_copia": str(out_final_geral),
        "artilheiros_raw": artilheiros_raw,
        "artilheiros_processados": artilheiros,
        "artilheiros_texto": artilheiros_fit["text"],
        "categoria": categoria,
        "is_escalacao": is_escalacao,
        "jogadores_raw": jogadores_raw,
        "jogadores_processados": jogadores,
        "jogadores_textos": jogador_textos,
        "layout_json": layout,
        "layout_renderizado": {
            "moldura": {"x": MOLDURA_X, "y": MOLDURA_Y, "w": MOLDURA_W, "h": MOLDURA_H, "visible": layout["moldura"].get("visible", True), "opacity": MOLDURA_OPACITY},
            "logo": {"x": LOGO_X, "y": LOGO_Y, "w": LOGO_W, "h": LOGO_H, "visible": LOGO_VISIBLE},
            "escudo2": {"x": ESCUDO2_X, "y": ESCUDO2_Y, "w": ESCUDO2_W, "h": ESCUDO2_H, "visible": ESCUDO2_VISIBLE},
            "topo_box": {"x": TOPO_BOX_X, "y": TOPO_BOX_Y, "w": TOPO_BOX_W, "h": TOPO_BOX_H, "visible": layout["topo"].get("visible", True)},
            "faixa_principal": {"x": FAIXA1_X, "y": FAIXA1_Y, "w": FAIXA1_W, "h": FAIXA1_H, "visible": layout["faixa_principal"].get("visible", True)},
            "faixa_secundaria": {"x": FAIXA2_X, "y": FAIXA2_Y, "w": FAIXA2_W, "h": FAIXA2_H, "visible": layout["faixa_secundaria"].get("visible", True)},
            "photo_box": {
                "mode": photo_mode,
                "x": photo_box_x,
                "y": photo_box_y,
                "w": photo_box_w,
                "h": photo_box_h
            },
            "time_principal": {"text": tp_fit["text"], "font": tp_fit["font_size"], "cfg": TIME_PRINCIPAL_CFG},
            "gols_time_principal": {"text": gt_fit["text"], "font": gt_fit["font_size"], "cfg": GOLS_TIME_CFG},
            "placar_x": {"text": px_fit["text"], "font": px_fit["font_size"], "cfg": PLACAR_X_CFG},
            "gols_adversario": {"text": ga_fit["text"], "font": ga_fit["font_size"], "cfg": GOLS_ADV_CFG},
            "time_adversario": {"text": ta_fit["text"], "font": ta_fit["font_size"], "cfg": TIME_ADV_CFG},
            "titulo": {"text": titulo_fit["text"], "font": titulo_fit["font_size"], "cfg": TITULO_CFG},
            "frase": {"text": frase_fit["text"], "font": frase_fit["font_size"], "cfg": FRASE_CFG},
            "artilheiros": {"text": artilheiros_fit["text"], "font": artilheiros_fit["font_size"], "cfg": ARTILHEIROS_CFG},
            "fallback_placar_legacy": {"text": placar_fit["text"], "font": placar_fit["font_size"]},
            "fallback_nome_time_legacy": {"text": nome_time_fit["text"], "font": nome_time_fit["font_size"]},
        }
    }

    if "raw" in palette:
        info["openai_raw"] = palette["raw"]

    (pedido_dir / "resultado_cores.json").write_text(
        json.dumps(info, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    log(f"✅ Final salvo em: {out_final_pedido}")
    log(f"✅ Cópia salva em: {out_final_geral}")

if __name__ == "__main__":
    main()







