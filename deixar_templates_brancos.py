from pathlib import Path
from PIL import Image

BASE_DIR = Path(__file__).resolve().parent
PASTAS_PREFIXO = "template_resultado"

EXTENSOES = {".png", ".webp"}

def deixar_branco(caminho: Path) -> bool:
    try:
        img = Image.open(caminho).convert("RGBA")
        dados = img.getdata()

        novos = []
        for r, g, b, a in dados:
            if a == 0:
                novos.append((0, 0, 0, 0))
            else:
                novos.append((255, 255, 255, a))

        img.putdata(novos)
        img.save(caminho)
        return True
    except Exception as e:
        print(f"ERRO ao processar {caminho.name}: {e}")
        return False

def listar_pastas_template(base_dir: Path):
    pastas = []
    for item in base_dir.iterdir():
        if item.is_dir() and item.name.startswith(PASTAS_PREFIXO):
            pastas.append(item)
    return sorted(pastas, key=lambda p: p.name.lower())

def main():
    pastas = listar_pastas_template(BASE_DIR)

    if not pastas:
        print("Nenhuma pasta template_resultado encontrada.")
        return

    total_arquivos = 0
    total_ok = 0

    for pasta in pastas:
        print(f"\nPASTA: {pasta.name}")
        arquivos_pasta = 0
        ok_pasta = 0

        for arquivo in pasta.iterdir():
            if not arquivo.is_file():
                continue
            if arquivo.suffix.lower() not in EXTENSOES:
                continue

            arquivos_pasta += 1
            total_arquivos += 1

            if deixar_branco(arquivo):
                ok_pasta += 1
                total_ok += 1
                print(f"OK  -> {arquivo.name}")

        print(f"Resumo {pasta.name}: {ok_pasta}/{arquivos_pasta}")

    print("\n===================================")
    print(f"TOTAL PROCESSADO: {total_ok}/{total_arquivos}")
    print("Finalizado.")
    input("\nPressione Enter para fechar...")

if __name__ == "__main__":
    main()