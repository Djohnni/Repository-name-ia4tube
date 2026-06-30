import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
CATALOG_FILE = BASE_DIR / "company_characteristics_knowledge.json"

CHARACTERISTIC_KEYS = {
    "caracteristicas_empresa",
    "caracteristicasEmpresa",
    "company_characteristics",
    "companyCharacteristics",
}

VALUE_KEYS = (
    "id",
    "label",
    "labels",
    "nome",
    "name",
    "titulo",
    "title",
    "valor",
    "value",
    "text",
    "texto",
)


def normalize_characteristic_id(value):
    if isinstance(value, dict):
        for key in VALUE_KEYS:
            if key in value:
                normalized = normalize_characteristic_id(value.get(key))
                if normalized:
                    return normalized
        return ""

    if isinstance(value, (list, tuple, set)):
        for item in value:
            normalized = normalize_characteristic_id(item)
            if normalized:
                return normalized
        return ""

    text = str(value or "").strip().lower()
    if not text:
        return ""

    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return re.sub(r"_+", "_", text).strip("_")


def _normalize_text_items(value):
    if value is None:
        return []

    if isinstance(value, list):
        result = []
        for item in value:
            result.extend(_normalize_text_items(item))
        return result

    if isinstance(value, dict):
        result = []
        for key in VALUE_KEYS:
            if key in value:
                result.extend(_normalize_text_items(value.get(key)))
        return result

    text = str(value or "").strip()
    if not text:
        return []

    try:
        parsed = json.loads(text)
        if not isinstance(parsed, str):
            parsed_items = _normalize_text_items(parsed)
            if parsed_items:
                return parsed_items
    except Exception:
        pass

    return [item.strip() for item in re.split(r"\r?\n|[,;]", text) if item.strip()]


def _catalog_match_keys(item):
    keys = set()
    for value in [item.get("id"), *item.get("labels", []), *item.get("aliases", [])]:
        normalized = normalize_characteristic_id(value)
        if normalized:
            keys.add(normalized)
    return keys


@lru_cache(maxsize=1)
def load_company_characteristics_catalog():
    try:
        data = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
    except Exception:
        data = {}

    raw_items = data.get("items", []) if isinstance(data, dict) else []
    items = []
    index = {}

    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue

        item = dict(raw_item)
        item_id = normalize_characteristic_id(item.get("id"))
        if not item_id:
            continue

        item["id"] = item_id
        item["labels"] = [str(label).strip() for label in item.get("labels", []) if str(label).strip()]
        item["aliases"] = [str(alias).strip() for alias in item.get("aliases", []) if str(alias).strip()]
        items.append(item)

        for match_key in _catalog_match_keys(item):
            index[match_key] = item

    return {
        "version": data.get("version", 1) if isinstance(data, dict) else 1,
        "items": items,
        "index": index,
    }


def resolve_company_characteristic(value):
    catalog = load_company_characteristics_catalog()
    index = catalog.get("index", {})

    for candidate in _normalize_text_items(value):
        normalized = normalize_characteristic_id(candidate)
        if normalized in index:
            return index[normalized]

    normalized = normalize_characteristic_id(value)
    if normalized in index:
        return index[normalized]

    return None


def _extract_characteristic_values(value):
    if value is None:
        return []

    if not isinstance(value, dict):
        return _normalize_text_items(value)

    result = []

    def visit(node):
        if isinstance(node, dict):
            for key, child in node.items():
                if key in CHARACTERISTIC_KEYS:
                    result.extend(_normalize_text_items(child))
                elif isinstance(child, (dict, list, tuple)):
                    visit(child)
        elif isinstance(node, (list, tuple)):
            for child in node:
                visit(child)

    visit(value)
    return list(dict.fromkeys(item for item in result if str(item or "").strip()))


def build_company_characteristics_knowledge_for_order(pedido):
    selected_values = _extract_characteristic_values(pedido)
    selected_items = []
    seen = set()

    for value in selected_values:
        item = resolve_company_characteristic(value)
        if not item:
            continue
        item_id = item.get("id")
        if not item_id or item_id in seen:
            continue
        seen.add(item_id)
        selected_items.append(item)

    selected_items.sort(key=lambda item: int(item.get("prioridade", 999)))
    return selected_items


def _format_list(label, values):
    values = [str(value).strip() for value in (values or []) if str(value).strip()]
    if not values:
        return ""
    return f"- {label}: " + "; ".join(values)


def build_company_characteristics_prompt_block(selected_items):
    selected_items = [item for item in (selected_items or []) if isinstance(item, dict)]
    if not selected_items:
        return ""

    lines = [
        "CONHECIMENTO DAS CARACTERÍSTICAS MARCADAS",
        "Use este conhecimento apenas para as caracteristicas que o cliente marcou.",
        "Nao use conhecimento de caracteristicas ausentes.",
        "Escolha no maximo 1 ou 2 caracteristicas por imagem, conforme coerencia com o objetivo.",
        "",
    ]

    for item in selected_items:
        label = item.get("labels", [item.get("id", "")])[0] if item.get("labels") else item.get("id", "")
        lines.extend([
            f"## {label}",
            f"- Categoria: {item.get('categoria', 'geral')}",
            f"- Descricao: {item.get('descricao', '')}",
            f"- Significado real: {item.get('significado_real', '')}",
        ])
        for optional_line in (
            _format_list("Impacto visual", item.get("impacto_visual")),
            _format_list("Impacto textual", item.get("impacto_textual")),
            _format_list("Quando usar", item.get("quando_usar")),
            _format_list("Quando evitar", item.get("quando_evitar")),
            _format_list("CTAs possiveis", item.get("ctas")),
            _format_list("Selos possiveis", item.get("selos")),
            _format_list("Beneficios", item.get("beneficios")),
            _format_list("Limites", item.get("limites")),
        ):
            if optional_line:
                lines.append(optional_line)
        if item.get("max_usos_por_arte"):
            lines.append(f"- Maximo de usos por arte: {item.get('max_usos_por_arte')}")
        lines.append("")

    return "\n".join(lines).strip()
