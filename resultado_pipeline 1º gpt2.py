import json
import base64
import shutil
import subprocess
from io import BytesIO
from pathlib import Path
from datetime import datetime

import requests
from openai import OpenAI
from PIL import Image, ImageDraw, ImageFont

# =========================================================
# PIPELINE 100% CHATGPT API
# =========================================================
# Fluxo:
# site -> pasta do pedido -> ChatGPT API -> resultado_final.png -> site
#
# Este arquivo NÃO usa FFmpeg.
# Este arquivo NÃO monta a arte no computador.
# Ele apenas:
# 1) lê pedido.json
# 2) encontra imagens do pedido/template
# 3) gera uma imagem única com todos os textos em branco e fundo preto
# 4) envia tudo para a API de imagem
# 5) salva resultado_final.png
# 6) envia para o site
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
PROMPT_IMAGEM_FILE = BASE_DIR / "prompt_imagem.txt"

MODEL = "gpt-image-2"
SIZE = "1024x1536"
QUALITY = "medium"
INPUT_FIDELITY = "high"
OUTPUT_FORMAT = "jpeg"
N = 1
MODO = "normal"  # normal | barato | premium

if MODO == "barato":
    QUALITY = "low"
    SIZE = "1024x1536"
elif MODO == "premium":
    QUALITY = "high"
    SIZE = "1024x1536"

W_REF = 1024
H_REF = 1536
MAX_REFERENCIAS = 16

FONT_DIR = BASE_DIR / "fonts"


# =========================================================
# LOG / ARQUIVOS
# =========================================================

def log(msg: str):
    print(msg, flush=True)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


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


def find_existing(folder: Path, names: list[str]) -> Path | None:
    for name in names:
        if not name:
            continue
        p = folder / str(name).strip()
        if p.exists() and p.is_file():
            return p
    return None


def optional_template_file(folder: Path, names: list[str]) -> Path | None:
    if not folder.exists():
        return None

    for name in names:
        p = folder / name
        if p.exists() and p.is_file():
            return p

    return None


def safe_json_list(value) -> list:
    if isinstance(value, list):
        return value

    if isinstance(value, str):
        value = value.strip()
        if not value:
            return []
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []

    return []


import unicodedata

def normalize_text(value) -> str:
    texto = " ".join(str(value or "").replace("\r", "\n").split()).strip()
    return unicodedata.normalize("NFC", texto)


def is_image_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}


# =========================================================
# PEDIDO / TEXTO
# =========================================================

def get_categoria(pedido: dict) -> str:
    return str(pedido.get("categoria", "")).strip().lower()


def build_score_text(pedido: dict) -> str:
    time_principal = normalize_text(pedido.get("time_principal", ""))
    time_adversario = normalize_text(pedido.get("time_adversario", ""))

    gols_time = str(pedido.get("gols_time_principal", "")).strip()
    gols_adv = str(pedido.get("gols_adversario", "")).strip()

    tem_placar = bool(time_principal or time_adversario or gols_time or gols_adv)

    if not tem_placar:
        return normalize_text(pedido.get("rodada", ""))

    if not gols_time:
        gols_time = "0"
    if not gols_adv:
        gols_adv = "0"

    if time_principal and time_adversario:
        return f"{time_principal} {gols_time} x {gols_adv} {time_adversario}"

    if time_principal:
        return f"{time_principal} {gols_time} x {gols_adv}"

    return f"{gols_time} x {gols_adv}"


def build_artilheiros_text(pedido: dict) -> list[str]:
    artilheiros = safe_json_list(pedido.get("artilheiros", []))
    linhas = []

    for item in artilheiros:
        if not isinstance(item, dict):
            continue

        nome = normalize_text(item.get("nome", ""))
        gols = normalize_text(item.get("gols", ""))

        if not nome:
            continue

        if gols:
            linhas.append(f"{nome} ({gols})")
        else:
            linhas.append(nome)

    return linhas


def build_jogadores_text(pedido: dict) -> list[str]:
    jogadores = safe_json_list(pedido.get("jogadores", []))
    linhas = []

    for item in jogadores:
        if not isinstance(item, dict):
            continue

        nome = normalize_text(item.get("nome", ""))
        posicao = normalize_text(item.get("posicao", ""))

        if nome and posicao:
            linhas.append(f"{nome} - {posicao}")
        elif nome:
            linhas.append(nome)
        elif posicao:
            linhas.append(posicao)

    return linhas


def add_line(lines: list[str], text: str):
    text = normalize_text(text)
    if text and text not in lines:
        lines.append(text)


def build_text_lines(pedido: dict) -> list[str]:
    categoria = get_categoria(pedido)

    titulo_pedido = normalize_text(pedido.get("titulo", ""))
    nome_time = normalize_text(pedido.get("nome_time", ""))
    rodada = normalize_text(pedido.get("rodada", ""))
    data = normalize_text(pedido.get("data", ""))
    hora = normalize_text(pedido.get("hora", ""))
    arena = normalize_text(pedido.get("arena", ""))
    frase = normalize_text(pedido.get("frase", ""))

    lines: list[str] = []

    if categoria == "escalacao":
        add_line(lines, titulo_pedido or "ESCALAÇÃO")
        add_line(lines, nome_time or pedido.get("time_principal", ""))

        if rodada or data or hora or arena:
            add_line(lines, rodada)
            if data and hora:
                add_line(lines, f"{data} - {hora}")
            else:
                add_line(lines, data)
                add_line(lines, hora)
            add_line(lines, arena)

        jogadores = build_jogadores_text(pedido)
        for jogador in jogadores:
            add_line(lines, jogador)

    elif categoria == "proximo_jogo":
        add_line(lines, titulo_pedido or "PRÓXIMO JOGO")

        time_principal = normalize_text(pedido.get("time_principal", ""))
        time_adversario = normalize_text(pedido.get("time_adversario", ""))

        if time_principal and time_adversario:
            add_line(lines, f"{time_principal} x {time_adversario}")
        else:
            add_line(lines, time_principal)
            add_line(lines, time_adversario)

        add_line(lines, rodada)

        if data and hora:
            add_line(lines, f"{data} - {hora}")
        else:
            add_line(lines, data)
            add_line(lines, hora)

        add_line(lines, arena)
        add_line(lines, frase)

    elif categoria == "patrocinador":
        add_line(lines, titulo_pedido or "PATROCINADOR")
        add_line(lines, nome_time or pedido.get("time_principal", ""))
        add_line(lines, frase)
        add_line(lines, rodada)
        add_line(lines, data)
        add_line(lines, hora)
        add_line(lines, arena)

    else:
        add_line(lines, titulo_pedido or "RESULTADO FINAL")
        add_line(lines, build_score_text(pedido))
        add_line(lines, rodada)

        if data and hora:
            add_line(lines, f"{data} - {hora}")
        else:
            add_line(lines, data)
            add_line(lines, hora)

        add_line(lines, arena)
        add_line(lines, frase)

        artilheiros = build_artilheiros_text(pedido)
        if artilheiros:
            add_line(lines, "Artilheiros:")
            for linha in artilheiros:
                add_line(lines, linha)

    # Campos extras textuais úteis, sem puxar dados internos/sensíveis.
    ignorar = {
        "id", "whatsapp", "senha", "categoria",
        "foto_jogo", "foto", "escudo_principal", "escudo2", "escudo_adversario",
        "artilheiros", "jogadores"
    }

    for chave, valor in pedido.items():
        chave_str = str(chave).strip().lower()

        if chave_str in ignorar:
            continue

        if chave_str.startswith("patrocinador_"):
            continue

        if isinstance(valor, str):
            texto = normalize_text(valor)

            if not texto:
                continue

            if texto.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                continue

            if len(texto) <= 90:
                add_line(lines, texto)

    return lines


def load_font(size: int, bold: bool = False):
    candidates = []

    if bold:
        candidates.extend([
            FONT_DIR / "Anton-Regular.ttf",
            FONT_DIR / "Montserrat-Bold.ttf",
            FONT_DIR / "Montserrat[wght].ttf",
        ])

    candidates.extend([
        FONT_DIR / "Montserrat.ttf",
        FONT_DIR / "Montserrat-Regular.ttf",
        FONT_DIR / "BebasNeue-Regular.ttf",
        Path("C:/Windows/Fonts/arialbd.ttf") if bold else Path("C:/Windows/Fonts/arial.ttf"),
    ])

    for path in candidates:
        try:
            if path.exists():
                return ImageFont.truetype(str(path), size=size)
        except Exception:
            pass

    return ImageFont.load_default()


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    words = str(text or "").split()
    if not words:
        return []

    lines = []
    current = ""

    for word in words:
        candidate = word if not current else f"{current} {word}"
        bbox = draw.textbbox((0, 0), candidate, font=font)
        w = bbox[2] - bbox[0]

        if w <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word

    if current:
        lines.append(current)

    return lines


def render_text_reference_image(lines: list[str], output_path: Path):
    img = Image.new("RGB", (W_REF, H_REF), (0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin_x = 70
    y = 70
    max_width = W_REF - (margin_x * 2)

    title_font = load_font(58, bold=True)
    body_font = load_font(34, bold=True)
    small_font = load_font(28, bold=False)

    for idx, line in enumerate(lines):
        if y > H_REF - 90:
            break

        font = title_font if idx == 0 else body_font
        line_spacing = 12 if idx == 0 else 8

        wrapped = wrap_text(draw, line, font, max_width)

        for subline in wrapped:
            bbox = draw.textbbox((0, 0), subline, font=font)
            w = bbox[2] - bbox[0]
            h = bbox[3] - bbox[1]

            x = int((W_REF - w) / 2)
            draw.text((x, y), subline, font=font, fill=(255, 255, 255))

            y += h + line_spacing

        if idx == 0:
            y += 28
        else:
            y += 10

    if y > H_REF - 120:
        aviso = "Texto extra cortado por limite visual."
        draw.text((margin_x, H_REF - 70), aviso, font=small_font, fill=(255, 255, 255))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path)


# =========================================================
# PROMPT
# =========================================================

DEFAULT_PROMPT_IMAGEM = ""


def ensure_prompt_file():
    return


def load_prompt_imagem(pedido: dict, linhas_texto: list[str]) -> str:
    if not PROMPT_IMAGEM_FILE.exists():
        raise FileNotFoundError(f"Não achei {PROMPT_IMAGEM_FILE.name} na mesma pasta do script.")

    prompt = PROMPT_IMAGEM_FILE.read_text(encoding="utf-8", errors="ignore").strip()
    if not prompt:
        raise ValueError(f"{PROMPT_IMAGEM_FILE.name} está vazio.")

    return prompt


# =========================================================
# REFERÊNCIAS DE IMAGEM
# =========================================================

def template_dir_for_categoria(categoria: str) -> Path:
    if categoria == "escalacao":
        return TEMPLATE_ESCALACAO_DIR
    if categoria == "proximo_jogo":
        return TEMPLATE_PROXIMO_JOGO_DIR
    if categoria == "patrocinador":
        return TEMPLATE_PATROCINADOR_DIR
    return TEMPLATE_DIR


def find_core_assets(pedido_dir: Path, pedido: dict) -> dict:
    foto = None
    escudo = None
    escudo2 = None

    foto_nome = normalize_text(pedido.get("foto_jogo", "")) or normalize_text(pedido.get("foto", ""))
    escudo_nome = normalize_text(pedido.get("escudo_principal", ""))
    escudo2_nome = normalize_text(pedido.get("escudo2", "")) or normalize_text(pedido.get("escudo_adversario", ""))

    if foto_nome:
        foto = find_existing(pedido_dir, [foto_nome])
    if escudo_nome:
        escudo = find_existing(pedido_dir, [escudo_nome])
    if escudo2_nome:
        escudo2 = find_existing(pedido_dir, [escudo2_nome])

    if not foto:
        foto = find_existing(
            pedido_dir,
            [
                "foto_jogo.png", "foto_jogo.jpg", "foto_jogo.jpeg", "foto_jogo.webp",
                "foto.png", "foto.jpg", "foto.jpeg", "foto.webp"
            ]
        )

    if not escudo:
        escudo = find_existing(
            pedido_dir,
            [
                "escudo_principal_sem_fundo.png", "escudo_principal.png",
                "escudo_principal.jpg", "escudo_principal.jpeg", "escudo_principal.webp",
                "escudo1_sem_fundo.png", "escudo1.png", "escudo1.jpg", "escudo1.jpeg", "escudo1.webp"
            ]
        )

    if not escudo2:
        escudo2 = find_existing(
            pedido_dir,
            [
                "escudo2_sem_fundo.png", "escudo2.png", "escudo2.jpg", "escudo2.jpeg", "escudo2.webp",
                "escudo_adversario_sem_fundo.png", "escudo_adversario.png",
                "escudo_adversario.jpg", "escudo_adversario.jpeg", "escudo_adversario.webp"
            ]
        )

    return {
        "foto": foto,
        "escudo": escudo,
        "escudo2": escudo2,
    }


def find_patrocinadores(pedido_dir: Path) -> list[Path]:
    arquivos = []

    for i in range(1, 21):
        pid = f"patrocinador_{i}"
        found = find_existing(
            pedido_dir,
            [
                f"{pid}.png", f"{pid}.jpg", f"{pid}.jpeg", f"{pid}.webp",
                f"patrocinador{i}.png", f"patrocinador{i}.jpg", f"patrocinador{i}.jpeg", f"patrocinador{i}.webp",
                f"pat{i:02d}.png", f"pat{i:02d}.jpg", f"pat{i:02d}.jpeg", f"pat{i:02d}.webp",
                f"pat{i}.png", f"pat{i}.jpg", f"pat{i}.jpeg", f"pat{i}.webp",
            ]
        )

        if found:
            arquivos.append(found)

    return arquivos


def collect_template_refs(template_dir: Path) -> list[Path]:
    refs = []

    for names in [
        ["moldura.png", "moldura.jpg", "moldura.jpeg", "moldura.webp"],
        ["topo_barra.png", "topo_barra.jpg", "topo_barra.jpeg", "topo_barra.webp", "topo.png", "topo.jpg"],
        ["faixa_principal.png", "faixa_principal.jpg", "faixa_principal.jpeg", "faixa_principal.webp"],
        ["faixa_secundaria.png", "faixa_secundaria.jpg", "faixa_secundaria.jpeg", "faixa_secundaria.webp"],
    ]:
        found = optional_template_file(template_dir, names)
        if found:
            refs.append(found)

    return refs


def collect_extra_images(pedido_dir: Path, already: set[Path]) -> list[Path]:
    extras = []

    for path in sorted(pedido_dir.iterdir()):
        if not is_image_file(path):
            continue

        resolved = path.resolve()
        if resolved in already:
            continue

        name = path.name.lower()
        if name.startswith("resultado_") or name in {"resultado_final.png", "resultado_final.jpg"}:
            continue

        if "_resultado_temp" in str(path):
            continue

        extras.append(path)

    return extras


def unique_append(lista: list[Path], path: Path | None, seen: set[Path]):
    if not path:
        return

    if not path.exists() or not path.is_file():
        return

    resolved = path.resolve()
    if resolved in seen:
        return

    lista.append(path)
    seen.add(resolved)


def build_reference_images(pedido_dir: Path, pedido: dict, text_ref_path: Path) -> list[Path]:
    categoria = get_categoria(pedido)
    template_dir = template_dir_for_categoria(categoria)
    assets = find_core_assets(pedido_dir, pedido)

    refs: list[Path] = []
    seen: set[Path] = set()

    # Ordem importante: em gpt-image-1.5, as primeiras referências têm mais peso.
    pedido_layout_img = pedido_dir / "pedido.png"
    unique_append(refs, pedido_layout_img, seen)
    # imagem de texto não vai para a API
    unique_append(refs, assets.get("escudo"), seen)
    unique_append(refs, assets.get("escudo2"), seen)
    unique_append(refs, assets.get("foto"), seen)

    for p in collect_template_refs(template_dir):
        unique_append(refs, p, seen)

    for p in find_patrocinadores(pedido_dir):
        unique_append(refs, p, seen)

    for p in collect_extra_images(pedido_dir, seen):
        unique_append(refs, p, seen)

    if len(refs) > MAX_REFERENCIAS:
        log(f"⚠️ Foram encontradas {len(refs)} imagens. Enviarei só as primeiras {MAX_REFERENCIAS}.")
        refs = refs[:MAX_REFERENCIAS]

    return refs


# =========================================================
# OPENAI IMAGE
# =========================================================

def render_via_chatgpt_api(output_path: Path, prompt: str, arquivos_referencia: list[Path]):
    api_key = load_api_key()
    client = OpenAI(api_key=api_key)

    image_files = []

    try:
        for caminho in arquivos_referencia:
            if caminho and caminho.exists():
                image_files.append(open(caminho, "rb"))

        if not image_files:
            raise ValueError("Nenhuma imagem de referência encontrada para enviar ao ChatGPT API.")

        log(f"🚀 Enviando {len(image_files)} imagens para ChatGPT API...")
        log(f"🧠 Modelo: {MODEL} | Size: {SIZE} | Quality: {QUALITY} | Formato API: {OUTPUT_FORMAT}")

        result = client.images.edit(
            model=MODEL,
            image=image_files,
            prompt=prompt,
            size=SIZE,
            quality=QUALITY,
            output_format=OUTPUT_FORMAT,
            n=N,
        )

        imagem_b64 = result.data[0].b64_json
        imagem_bytes = base64.b64decode(imagem_b64)

        raw_path = output_path.with_suffix(f".raw.{OUTPUT_FORMAT}")
        raw_path.write_bytes(imagem_bytes)

        # Mantém compatibilidade com o site antigo: resultado_final.png.
        try:
            img = Image.open(BytesIO(imagem_bytes)).convert("RGB")
            img.save(output_path, "PNG")
        except Exception:
            output_path.write_bytes(imagem_bytes)

        log(f"✅ Resultado salvo em: {output_path}")

    finally:
        for f in image_files:
            try:
                f.close()
            except Exception:
                pass


# =========================================================
# UPLOAD SITE
# =========================================================

def upload_resultado_para_site(pedido_dir: Path, pedido_id: str, imagem_path: Path):
    pedido_json = pedido_dir / "pedido.json"
    if not pedido_json.exists():
        raise FileNotFoundError("pedido.json não encontrado para upload do resultado.")

    pedido = load_json(pedido_json)
    whatsapp = normalize_text(pedido.get("whatsapp", ""))

    if not whatsapp:
        raise ValueError("whatsapp não encontrado no pedido.json.")

    whatsapp_login, senha_login = load_credentials()

    log("🔐 Fazendo login no site...")

    login_resp = requests.post(
        "https://api.omascote.com.br/auth/login",
        json={
            "whatsapp": whatsapp_login,
            "senha": senha_login,
        },
        timeout=60,
    )

    if login_resp.status_code != 200:
        raise RuntimeError(f"Falha no login da API: {login_resp.status_code} | {login_resp.text[:500]}")

    login_data = login_resp.json()
    token = str(login_data.get("token", "")).strip()

    if not token:
        raise RuntimeError("Login da API não retornou token.")

    log("📤 Enviando resultado para o site...")

    with open(imagem_path, "rb") as f:
        up_resp = requests.post(
            f"https://api.omascote.com.br/pedidos/{pedido_id}/upload-resultado",
            headers={
                "Authorization": f"Bearer {token}",
            },
            files={
                "resultado": ("resultado_final.png", f, "image/png"),
            },
            timeout=180,
        )

    if up_resp.status_code != 200:
        raise RuntimeError(f"Falha ao enviar resultado: {up_resp.status_code} | {up_resp.text[:500]}")

    log("✅ Resultado enviado para o site com sucesso.")


# =========================================================
# MAIN
# =========================================================

def main():
    import sys

    if len(sys.argv) < 2:
        raise SystemExit("Uso: python resultado_pipeline_api_only.py <PASTA_DO_PEDIDO>")

    pedido_dir = Path(sys.argv[1]).resolve()
    if not pedido_dir.exists():
        raise SystemExit(f"Pasta não encontrada: {pedido_dir}")

    pedido_json = pedido_dir / "pedido.json"
    if not pedido_json.exists():
        raise SystemExit("pedido.json não encontrado.")

    pedido = load_json(pedido_json)
    pedido_id = normalize_text(pedido.get("id", "sem_id")) or "sem_id"

    temp_dir = pedido_dir / "_resultado_api_temp"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True, exist_ok=True)

    out_final_pedido = pedido_dir / "resultado_final.png"
    out_final_geral = OUT_DIR / f"resultado_{pedido_id}.png"

    linhas_texto = []

    texto_ref_path = temp_dir / "texto_referencia_chatgpt.png"

    prompt = load_prompt_imagem(pedido, linhas_texto)

    referencias = build_reference_images(pedido_dir, pedido, texto_ref_path)
    if not referencias:
        raise RuntimeError("Nenhuma referência visual encontrada.")

    log("📦 Referências enviadas:")
    for idx, ref in enumerate(referencias, start=1):
        log(f"   {idx:02d}. {ref}")

    render_via_chatgpt_api(out_final_pedido, prompt, referencias)

    render_html_script = BASE_DIR / "render_textos_html.py"
    render_png = pedido_dir / "render_textos_teste.png"

    if render_html_script.exists():
        log("📝 Renderizando textos HTML por cima da imagem da API...")
        subprocess.run(
            [sys.executable, str(render_html_script), str(pedido_dir)],
            check=True
        )

        if render_png.exists():
            base_img = Image.open(out_final_pedido).convert("RGBA")
            texto_img = Image.open(render_png).convert("RGBA")
            texto_img = texto_img.resize(base_img.size, Image.LANCZOS)
            final_img = Image.alpha_composite(base_img, texto_img)
            final_img.save(out_final_pedido, "PNG")
            log("✅ Textos HTML aplicados sobre a imagem final.")

    shutil.copy2(out_final_pedido, out_final_geral)
    log(f"✅ Cópia salva em: {out_final_geral}")

    info = {
        "pedido_id": pedido_id,
        "modelo": MODEL,
        "size": SIZE,
        "quality": QUALITY,
        "input_fidelity": INPUT_FIDELITY,
        "output_format_api": OUTPUT_FORMAT,
        "resultado_final": str(out_final_pedido),
        "resultado_copia": str(out_final_geral),
        "prompt_file": str(PROMPT_IMAGEM_FILE),
        "texto_referencia": "",
        "linhas_texto": linhas_texto,
        "referencias": [str(p) for p in referencias],
        "gerado_em": datetime.now().isoformat(timespec="seconds"),
    }

    (pedido_dir / "resultado_api_info.json").write_text(
        json.dumps(info, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    upload_resultado_para_site(pedido_dir, pedido_id, out_final_pedido)


if __name__ == "__main__":
    main()






