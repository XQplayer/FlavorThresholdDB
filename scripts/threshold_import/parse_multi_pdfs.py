import pdfplumber
import re
import json
import os

pdf_files = [
    ("PART 1-空气.pdf", "空气"),
    ("PART 2 -水.pdf", "水"),
    ("PART 3 -其他介质.pdf", "其他介质"),
]
base_dir = r"d:\antigravity project\香气阈值小程序"
old_json_path = os.path.join(base_dir, "aroma_data.json")
out_json = os.path.join(base_dir, "aroma_data_merged.json")

# Load chinese name dictionary from old JSON
cas_to_chinese = {}
if os.path.exists(old_json_path):
    try:
        with open(old_json_path, 'r', encoding='utf-8') as f:
            old_data = json.load(f)
            for item in old_data:
                cas = item.get("cas", "")
                cn = item.get("chinese_name", "").strip()
                if cas and cn:
                    cas_to_chinese[cas] = cn
    except Exception as e:
        print(f"Failed to load old json: {e}")

data = []

cas_pattern = re.compile(r'^(.+?)\s+\[(\d{2,7}-\d{1,2}-\d)\]\s*$')

medium_translations = {
    "vegetable oil": "植物油",
    "paraffin oil": "石蜡油",
    "skim milk": "脱脂牛奶",
    "skimmed milk": "脱脂牛奶",
    "milk": "牛奶",
    "sunflower oil": "葵花籽油",
    "mineral oil": "矿物油",
    "water": "水",
    "ethanol": "乙醇",
    "starch": "淀粉",
    "wine": "葡萄酒",
    "beer": "啤酒",
    "apple juice": "苹果汁",
    "orange juice": "橙汁",
    "oil": "油"
}

for pdf_name, current_medium in pdf_files:
    pdf_path = os.path.join(base_dir, pdf_name)
    if not os.path.exists(pdf_path):
        print(f"Warning: {pdf_path} not found.")
        continue
        
    print(f"Starting to parse {pdf_name} (Medium: {current_medium})...")
    current_compound = None
    
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            if i % 10 == 0:
                print(f"Processing {pdf_name} page {i}...")
                
            text = page.extract_text(layout=True)
            if not text:
                text = page.extract_text()
                if not text: continue
                
            lines = text.split('\n')
            for line in lines:
                stripped = line.strip()
                if not stripped: continue
                if re.match(r'^\d+$', stripped): continue
                if "COMPILATIONS OF ODOUR THRESHOLD" in line.upper() or "EDITION" in line.upper(): continue
                
                normalized_line = re.sub(r'\s+', ' ', stripped)
                cas_match = cas_pattern.match(normalized_line)
                
                if cas_match:
                    name = cas_match.group(1).strip()
                    cas = cas_match.group(2).strip()
                    
                    current_compound = {
                        "cas": cas,
                        "english_name": name,
                        "chinese_name": cas_to_chinese.get(cas, ""),
                        "medium": current_medium,
                        "threshold_data": []
                    }
                    data.append(current_compound)
                elif current_compound:
                    line_data = line.rstrip()
                    if line_data.startswith("Compound") and "CAS" in line_data:
                        continue
                    if len(line_data.strip()) > 3:
                        current_compound["threshold_data"].append(line_data)

print(f"Extracted {len(data)} compound entries from all PDFs.")

# Translate threshold data for other media
for comp in data:
    if comp["medium"] == "其他介质":
        for i, line in enumerate(comp["threshold_data"]):
            for en, cn in medium_translations.items():
                pattern = re.compile(r'\b' + en + r'\b', re.IGNORECASE)
                line = pattern.sub(cn, line)
            comp["threshold_data"][i] = line

with open(out_json, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"Saved merged PDF data to {out_json}")
