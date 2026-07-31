import pdfplumber
import re
import json
import os

pdf_path = r"d:\antigravity project\香气阈值小程序\香气阈值手册.pdf"
old_json_path = r"d:\antigravity project\香气阈值小程序\aroma_data.json"
out_json = r"d:\antigravity project\香气阈值小程序\aroma_data_pdf.json"

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
current_compound = None
current_medium = "Unknown"

# Match something like: ACETOPHENONE [98-86-2]
cas_pattern = re.compile(r'^(.+?)\s+\[(\d{2,7}-\d{1,2}-\d)\]\s*$')
# Some lines in PDF might be bold or just plain text.

print("Starting to parse PDF...")
with pdfplumber.open(pdf_path) as pdf:
    for i, page in enumerate(pdf.pages):
        # Print progress
        if i % 50 == 0:
            print(f"Processing page {i}...")
            
        text = page.extract_text(layout=True) # layout=True tries to preserve visual spaces
        if not text:
            # fallback if layout fails
            text = page.extract_text()
            if not text:
                continue
            
        lines = text.split('\n')
        for line in lines:
            # Detect section changes (based on common titles)
            line_upper = line.upper().strip()
            clean_line = re.sub(r'\s+', '', line_upper)
            
            if "PARTIII" in clean_line or "OTHERMEDIA" in clean_line:
                current_medium = "其他介质"
            elif "PARTII" in clean_line or "INWATER" in clean_line:
                current_medium = "水"
            elif "PARTI" in clean_line or "INAIR" in clean_line:
                current_medium = "空气"

            # Clean line
            stripped = line.strip()
            if not stripped:
                continue
                
            if re.match(r'^\d+$', stripped): # Skip page numbers
                continue
            if "COMPILATIONS OF ODOUR THRESHOLD" in line_upper or "EDITION" in line_upper:
                continue

            # Check if this line defines a new compound
            # PDF text might have multiple spaces, so replace with single space to check regex
            normalized_line = re.sub(r'\s+', ' ', stripped)
            cas_match = cas_pattern.match(normalized_line)
            
            if cas_match:
                name = cas_match.group(1).strip()
                cas = cas_match.group(2).strip()
                
                # Check for synonym arrow
                if '→' in name or '->' in name or '=' in name:
                    pass # It might be a synonym redirect, but we can treat it as part of name or ignore
                
                current_compound = {
                    "cas": cas,
                    "english_name": name,
                    "chinese_name": cas_to_chinese.get(cas, ""),
                    "medium": current_medium,
                    "threshold_data": []
                }
                data.append(current_compound)
            elif current_compound:
                # Append threshold data line.
                # Since layout=True keeps spaces, let's keep it as is, but trim end.
                line_data = line.rstrip()
                # Skip if it's just the column headers running over
                if line_data.startswith("Compound") and "CAS" in line_data:
                    continue
                # If the line is fairly long and has numbers, it's likely data
                if len(line_data.strip()) > 3:
                    current_compound["threshold_data"].append(line_data)

print(f"Extracted {len(data)} compound entries from PDF.")

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

for comp in data:
    if comp["medium"] == "其他介质":
        for i, line in enumerate(comp["threshold_data"]):
            for en, cn in medium_translations.items():
                pattern = re.compile(r'\b' + en + r'\b', re.IGNORECASE)
                line = pattern.sub(cn, line)
            comp["threshold_data"][i] = line

# Save to JSON
with open(out_json, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"Saved extracted PDF data to {out_json}")
print("Sample of first compound:")
if len(data) > 0:
    print(json.dumps(data[0], ensure_ascii=False, indent=2))
